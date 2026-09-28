import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenService } from '../src/auth/token.js'
import { requiresToken } from '../src/auth/token.middleware.js'
import { RuntimeControlService } from '../src/runtime/runtime-control.service.js'
import { RuntimeController } from '../src/runtime/runtime.controller.js'
import { RuntimeRecordStore } from '../src/runtime/runtime-record.js'
import { ConnectivityService } from '../src/connectivity/connectivity.service.js'
import { DeviceEventsService } from '../src/connectivity/device-events.service.js'
import { TunnelManager } from '../src/connectivity/tunnel-manager.js'
import type { OwnedProcess } from '../src/connectivity/ssh.js'
import { DeviceRegistry } from '../src/storage/registry.js'

/** An ssh child stand-in that records the signals it receives. */
class FakeSsh implements OwnedProcess {
  readonly stderr = new Readable({ read() {} })
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly signals: string[] = []
  #exit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void
  constructor(readonly pid: number, readonly argv: readonly string[] = []) {
    this.exited = new Promise(resolve => { this.#exit = resolve })
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    this.#exit({ code: null, signal: signal ?? 'SIGTERM' })
    return true
  }
}

let directory: string
let service: RuntimeControlService
let store: RuntimeRecordStore

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cockpit-control-'))
  store = new RuntimeRecordStore(directory)
  service = new RuntimeControlService(store, new TokenService(directory))
})

afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('runtime control', () => {
  it('publishes a verifiable status and creates the token before becoming active', async () => {
    const active = await service.activate({ port: 43090, repoRoot: path.resolve('repo'), shutdown: async () => {} })
    expect(service.status()).toEqual(active)
    expect(active).toEqual(expect.objectContaining({ app: 'dsh-cockpit', pid: process.pid, port: 43090 }))
    await expect(import('node:fs/promises').then(fs => fs.readFile(path.join(directory, 'token'), 'utf8'))).resolves.toMatch(/\S+/)
    expect(requiresToken('/api/runtime/status')).toBe(true)
    await service.onApplicationShutdown()
  })

  it('rejects the wrong instance and schedules shutdown only once for the owner', async () => {
    const shutdown = vi.fn(async () => {})
    const active = await service.activate({ port: 3090, repoRoot: path.resolve('repo'), shutdown })
    expect(() => service.requestShutdown('wrong')).toThrow('runtime instance mismatch')
    expect(shutdown).not.toHaveBeenCalled()
    expect(service.requestShutdown(active.instanceId)).toEqual({ accepted: true })
    expect(service.requestShutdown(active.instanceId)).toEqual({ accepted: true })
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(shutdown).toHaveBeenCalledTimes(1)
    await service.onApplicationShutdown()
  })

  it('maps a mismatched controller request to conflict', async () => {
    await service.activate({ port: 3090, repoRoot: path.resolve('repo'), shutdown: async () => {} })
    const controller = new RuntimeController(service)
    expect(() => controller.shutdown('wrong')).toThrow(expect.objectContaining({ status: 409 }))
    await service.onApplicationShutdown()
  })

  it('uses the controlled shutdown path to run application cleanup hooks', async () => {
    @Injectable()
    class FakeOwnedSsh implements OnApplicationShutdown {
      readonly signals: string[] = []
      onApplicationShutdown(): void { this.signals.push('SIGTERM') }
    }

    @Module({
      providers: [
        { provide: RuntimeRecordStore, useValue: store },
        { provide: TokenService, useValue: new TokenService(directory) },
        RuntimeControlService,
        FakeOwnedSsh,
      ],
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, { logger: false })
    const runtime = app.get(RuntimeControlService)
    const ownedSsh = app.get(FakeOwnedSsh)
    const active = await runtime.activate({ port: 3090, repoRoot: path.resolve('repo'), shutdown: () => app.close() })

    runtime.requestShutdown(active.instanceId)
    let stored = await store.read()
    for (let attempt = 0; attempt < 30 && (ownedSsh.signals.length === 0 || stored !== undefined); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
      stored = await store.read()
    }

    expect(ownedSsh.signals).toEqual(['SIGTERM'])
    expect(stored).toBeUndefined()
  })

  it('terminates owned additional forward children on shutdown without touching foreign ssh', async () => {
    const registry = new DeviceRegistry(directory)
    await registry.save([{ deviceId: 'vm', displayName: 'VM', kind: 'remote', sshAlias: 'vm-a', remoteDshPort: 3080, enabled: true, order: 0 }])
    const owned: FakeSsh[] = []
    let pid = 20_000
    const tunnels = new TunnelManager({
      spawn: (_exe, argv) => { const child = new FakeSsh(pid++, argv); owned.push(child); return child },
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    // A user's own ssh session: not spawned by the cockpit, never signalled.
    const foreign = new FakeSsh(31_337)
    const stream = { on() { return this }, off() { return this }, open: async () => {}, dispose() {} }

    @Module({
      providers: [
        { provide: RuntimeRecordStore, useValue: store },
        { provide: TokenService, useValue: new TokenService(directory) },
        { provide: DeviceRegistry, useValue: registry },
        DeviceEventsService,
        {
          provide: ConnectivityService,
          inject: [DeviceRegistry, DeviceEventsService],
          useFactory: (devices: DeviceRegistry, events: DeviceEventsService) => new ConnectivityService(devices, events, {
            tunnels,
            createProtocol: async () => ({
              kind: 'rc2' as const,
              client: {
                kind: 'rc2' as const,
                probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
                listSessions: async () => [],
                listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
              },
              stream,
            }),
          }),
        },
        RuntimeControlService,
      ],
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, { logger: false })
    const connectivity = app.get(ConnectivityService)
    const until = async (check: () => boolean) => {
      for (let attempt = 0; attempt < 200 && !check(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
      expect(check()).toBe(true)
    }
    await until(() => connectivity.statuses()[0]?.state === 'READY')
    const holder = { pageId: 'page-aaaaaaaaaaaaaaaa', instanceId: 'inst-aaaaaaaaaaaaaaaa', holder: 'memex' }
    connectivity.acquireForward('vm', 3939, holder)
    await connectivity.pinForward('vm', 5432)
    const additionalReady = () => (connectivity.statuses()[0]?.forwards?.rows ?? [])
      .filter(row => row.kind === 'additional' && row.state === 'ready').length === 2
    await until(additionalReady)
    const forwards = owned.filter(child => child.argv.some(arg => /:127\.0\.0\.1:(3939|5432)$/.test(arg)))
    expect(forwards).toHaveLength(2)

    const runtime = app.get(RuntimeControlService)
    const active = await runtime.activate({ port: 3090, repoRoot: path.resolve('repo'), shutdown: () => app.close() })
    runtime.requestShutdown(active.instanceId)
    await until(() => owned.every(child => child.signals.length > 0))

    // Every owned child (workbench and both forwards) got SIGTERM first.
    for (const child of owned) expect(child.signals[0]).toBe('SIGTERM')
    expect(foreign.signals).toEqual([])
  })
})
