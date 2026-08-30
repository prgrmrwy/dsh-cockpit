import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenService } from '../src/auth/token.js'
import { requiresToken } from '../src/auth/token.middleware.js'
import { RuntimeControlService } from '../src/runtime/runtime-control.service.js'
import { RuntimeController } from '../src/runtime/runtime.controller.js'
import { RuntimeRecordStore } from '../src/runtime/runtime-record.js'

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
})
