import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdditionalForwardRow, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { ConnectivityService } from '../src/connectivity/connectivity.service.js'
import { DeviceEventsService } from '../src/connectivity/device-events.service.js'
import { TunnelManager } from '../src/connectivity/tunnel-manager.js'
import type { OwnedProcess } from '../src/connectivity/ssh.js'
import { BridgeCapabilityService } from '../src/auth/bridge-capability.js'
import { DevicesController } from '../src/devices/devices.controller.js'
import { DeviceRegistry } from '../src/storage/registry.js'

/** Page-and-instance reclaim (design D4), assembled from the real pieces: the
 * status-stream handler counts connections per page in DeviceEventsService,
 * and ConnectivityService reclaims holders from the per-device forward table.
 * Only the ssh children are fake; no HTTP server runs. */

class FakeSsh implements OwnedProcess {
  readonly stderr = new Readable({ read() {} })
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  alive = true
  #exit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void
  constructor(readonly pid: number, readonly argv: readonly string[]) {
    this.exited = new Promise(resolve => { this.#exit = resolve })
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.alive = false
    this.#exit({ code: null, signal: signal ?? 'SIGTERM' })
    return true
  }
}

const P = 'page-PPPPPPPPPPPPPPPP'
const P1 = 'page-1111111111111111'
const P2 = 'page-2222222222222222'
const I1 = 'inst-1111111111111111'
const I2 = 'inst-2222222222222222'

/** A status-stream request as the SSE handler sees it. */
function streamRequest(page?: string) {
  const request = new EventEmitter() as EventEmitter & { query: Record<string, string>; headers: Record<string, string> }
  request.query = page === undefined ? {} : { page }
  request.headers = {}
  const writes: DeviceStatusFacts[][] = []
  const response = {
    setHeader() {},
    flushHeaders() {},
    write(chunk: string) {
      writes.push(JSON.parse(chunk.replace(/^data: /, '')).device)
      return true
    },
  }
  return { request, response, writes, close: () => { request.emit('close') } }
}

let directory: string
let owned: FakeSsh[]
let service: ConnectivityService
let events: DeviceEventsService
let controller: DevicesController
let capabilities: BridgeCapabilityService

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400 && !check(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
  expect(check()).toBe(true)
}

const row = (devicePort: number): AdditionalForwardRow | undefined => (service.statuses()[0]?.forwards?.rows ?? [])
  .find((candidate): candidate is AdditionalForwardRow => candidate.kind === 'additional' && candidate.devicePort === devicePort)
const children = (devicePort: number) => owned.filter(child => child.argv.some(arg => arg.endsWith(`:127.0.0.1:${devicePort}`)))
const deviceOrigin = () => new URL(service.statuses()[0]!.endpoint!).origin

/** A capability issued through the cockpit route, as page `pageId` would. */
async function capabilityFor(pageId: string): Promise<string> {
  return (await controller.bridgeCapability('vm', { pageId })).capability
}

async function acquire(pageId: string, instanceId: string, devicePort = 3939) {
  return service.acquireBridgeForward(deviceOrigin(), await capabilityFor(pageId), { devicePort, holder: 'memex', instanceId })
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'forward-page-reclaim-'))
  const registry = new DeviceRegistry(directory)
  await registry.save([{ deviceId: 'vm', displayName: 'VM', kind: 'remote', sshAlias: 'vm-a', remoteDshPort: 3080, enabled: true, order: 0 }])
  owned = []
  let pid = 40_000
  const tunnels = new TunnelManager({
    spawn: (_executable, argv) => { const child = new FakeSsh(pid++, argv); owned.push(child); return child },
    readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
  })
  events = new DeviceEventsService()
  capabilities = new BridgeCapabilityService()
  const stream = { on() { return this }, off() { return this }, open: async () => {}, dispose() {} }
  service = new ConnectivityService(registry, events, {
    tunnels,
    capabilities,
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
  })
  controller = new DevicesController(service, events)
  await until(() => service.statuses()[0]?.state === 'READY')
})

afterEach(async () => {
  vi.useRealTimers()
  await service.onApplicationShutdown()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

describe('page and instance reclaim', () => {
  it('rejects capability issue without a page id and serves but does not count a page-less stream', async () => {
    const issue = vi.spyOn(service, 'issueBridgeCapability')
    for (const body of [{}, { pageId: 'short' }, { pageId: 'bad page id with spaces!' }, undefined]) {
      await expect(controller.bridgeCapability('vm', body as never)).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ code: 'invalid-page' }),
      })
    }
    expect(issue).not.toHaveBeenCalled()

    const page = streamRequest(P)
    controller.stream(page.request as never, page.response as never)
    const anonymous = streamRequest()
    controller.stream(anonymous.request as never, anonymous.response as never)
    await acquire(P, I1)
    await until(() => row(3939)?.state === 'ready')
    const [child] = children(3939)

    // The page-less stream is served like any other.
    expect(anonymous.writes.at(-1)?.[0]?.forwards?.rows).toContainEqual(expect.objectContaining({ devicePort: 3939, state: 'ready' }))

    // ...but it does not keep page P alive: P's last connection closing
    // starts the grace period regardless.
    vi.useFakeTimers()
    page.close()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(row(3939)).toBeUndefined()
    expect(child!.alive).toBe(false)
    anonymous.close()
  })

  it("reclaims a page's holders 30s after its last stream connection closes", async () => {
    const first = streamRequest(P)
    const second = streamRequest(P)
    controller.stream(first.request as never, first.response as never)
    controller.stream(second.request as never, second.response as never)
    await acquire(P, I1)
    await until(() => row(3939)?.state === 'ready')
    const [child] = children(3939)

    vi.useFakeTimers()
    // One of two connections closing starts nothing.
    first.close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(row(3939)?.holderCount).toBe(1)

    second.close()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(row(3939)?.holderCount).toBe(1)
    expect(child!.alive).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(row(3939)).toBeUndefined()
    expect(child!.alive).toBe(false)
  })

  it('keeps holders when the page reconnects within the grace period', async () => {
    const page = streamRequest(P)
    controller.stream(page.request as never, page.response as never)
    await acquire(P, I1)
    await until(() => row(3939)?.state === 'ready')
    const { pid } = row(3939)!

    vi.useFakeTimers()
    page.close()
    await vi.advanceTimersByTimeAsync(5_000)
    const again = streamRequest(P)
    controller.stream(again.request as never, again.response as never)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(row(3939)).toEqual(expect.objectContaining({ state: 'ready', pid, holderCount: 1 }))
    again.close()
  })

  it('takes the holder page id from the capability grant, not the request body', async () => {
    const p1 = streamRequest(P1)
    const p2 = streamRequest(P2)
    controller.stream(p1.request as never, p1.response as never)
    controller.stream(p2.request as never, p2.response as never)
    const capability = await capabilityFor(P1)
    service.acquireBridgeForward(deviceOrigin(), capability, { devicePort: 3939, holder: 'memex', instanceId: I1, pageId: P2 } as never)
    await until(() => row(3939)?.state === 'ready')

    vi.useFakeTimers()
    p2.close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(row(3939)?.holderCount).toBe(1)
    // Releasing under P2 does not touch P1's holder either.
    await service.releaseBridgeForward(deviceOrigin(), await capabilityFor(P2), { devicePort: 3939, holder: 'memex', instanceId: I1 })
    expect(row(3939)?.holderCount).toBe(1)

    p1.close()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(row(3939)).toBeUndefined()
  })

  it('rejects an acquire whose instance was already ended for that page', async () => {
    const page = streamRequest(P)
    controller.stream(page.request as never, page.response as never)
    const spawned = owned.length

    // release-instance overtakes the in-flight acquire of the same instance.
    await controller.releaseForwardInstance('vm', { instanceId: I1, pageId: P })
    await expect(acquire(P, I1)).rejects.toMatchObject({ code: 'invalid-holder' })
    expect(row(3939)).toBeUndefined()
    expect(owned).toHaveLength(spawned)

    // A fresh instance of the same page (bfcache restore) is accepted, and
    // releasing it removes only its holders.
    await acquire(P, I2)
    await until(() => row(3939)?.state === 'ready')
    await controller.releaseForwardInstance('vm', { instanceId: I2, pageId: P })
    expect(row(3939)).toBeUndefined()
    page.close()
  })
})
