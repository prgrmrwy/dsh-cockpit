import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AdditionalForwardRow } from '@dsh-cockpit/shared'
import { ConnectivityService } from '../src/connectivity/connectivity.service.js'
import { DeviceEventsService } from '../src/connectivity/device-events.service.js'
import { TunnelManager } from '../src/connectivity/tunnel-manager.js'
import type { OwnedProcess } from '../src/connectivity/ssh.js'
import { BRIDGE_CAPABILITY_HEADER, BridgeCapabilityService } from '../src/auth/bridge-capability.js'
import { DevicesController } from '../src/devices/devices.controller.js'
import { DeviceRegistry } from '../src/storage/registry.js'

/** The bridge forwards endpoints at the controller boundary (design D7): the
 * check order 401 → 400 → 409 → business, and grant-located release. Real
 * ConnectivityService and capability grants; only ssh children are fake. */

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

const PAGE = 'page-PPPPPPPPPPPPPPPP'
const INSTANCE = 'inst-1111111111111111'

let directory: string
let owned: FakeSsh[]
let now: number
let service: ConnectivityService
let controller: DevicesController
let workbenchUp: boolean

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400 && !check(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
  expect(check()).toBe(true)
}

const row = (devicePort: number): AdditionalForwardRow | undefined => (service.statuses()[0]?.forwards?.rows ?? [])
  .find((candidate): candidate is AdditionalForwardRow => candidate.kind === 'additional' && candidate.devicePort === devicePort)
const children = (devicePort: number) => owned.filter(child => child.argv.some(arg => arg.endsWith(`:127.0.0.1:${devicePort}`)))

function bridgeRequest(origin: string, capability?: string) {
  return { headers: { origin, ...(capability === undefined ? {} : { [BRIDGE_CAPABILITY_HEADER]: capability }) } } as never
}

const body = (devicePort = 3939) => ({ devicePort, holder: 'memex', instanceId: INSTANCE })

async function rejection(promise: Promise<unknown>): Promise<{ status: number; code: string | undefined }> {
  try {
    await promise
  } catch (cause) {
    const error = cause as { getStatus?: () => number; getResponse?: () => unknown }
    const response = error.getResponse?.() as { code?: string } | undefined
    return { status: error.getStatus?.() ?? -1, code: response?.code }
  }
  throw new Error('expected a rejection')
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'forwards-controller-'))
  const registry = new DeviceRegistry(directory)
  await registry.save([{ deviceId: 'vm', displayName: 'VM', kind: 'remote', sshAlias: 'vm-a', remoteDshPort: 3080, enabled: true, order: 0 }])
  owned = []
  workbenchUp = true
  now = Date.now()
  let pid = 50_000
  const tunnels = new TunnelManager({
    spawn: (_executable, argv) => {
      const child = new FakeSsh(pid++, argv)
      owned.push(child)
      // A workbench spawn while "down" exits at once, keeping the device
      // reconnecting with no endpoint.
      if (!workbenchUp && argv.some(arg => arg.endsWith(':127.0.0.1:3080'))) queueMicrotask(() => child.kill())
      return child
    },
    readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
  })
  const events = new DeviceEventsService()
  const stream = { on() { return this }, off() { return this }, open: async () => {}, dispose() {} }
  service = new ConnectivityService(registry, events, {
    tunnels,
    capabilities: new BridgeCapabilityService({ now: () => now }),
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
  await service.onApplicationShutdown()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

async function issued(): Promise<{ capability: string; origin: string }> {
  const origin = new URL(service.statuses()[0]!.endpoint!).origin
  const { capability } = await controller.bridgeCapability('vm', { pageId: PAGE })
  return { capability, origin }
}

describe('bridge forwards endpoints', () => {
  it('rejects an expired, unknown or origin-mismatched capability on acquire with 400', async () => {
    const { capability, origin } = await issued()
    const spawned = owned.length

    const unknown = await rejection(controller.bridgeForwardsAcquire(bridgeRequest(origin, 'not-a-real-capability'), body()))
    const mismatched = await rejection(controller.bridgeForwardsAcquire(bridgeRequest('http://127.0.0.1:1', capability), body()))
    now += 61_000
    const expired = await rejection(controller.bridgeForwardsAcquire(bridgeRequest(origin, capability), body()))

    for (const outcome of [unknown, mismatched, expired]) expect(outcome).toEqual({ status: 400, code: 'bridge-capability-invalid' })
    expect(row(3939)).toBeUndefined()
    expect(owned).toHaveLength(spawned)
  })

  it('returns 400, not 409, for an invalid capability from an origin with no live device', async () => {
    const { origin } = await issued()
    // Take the workbench down: no enabled device has an endpoint now.
    workbenchUp = false
    await service.reconnectDevice('vm')
    await until(() => service.statuses()[0]?.endpoint === undefined)

    // A garbage capability cannot tell a caller whether an origin is online.
    for (const target of [origin, 'http://127.0.0.1:1']) {
      expect(await rejection(controller.bridgeForwardsAcquire(bridgeRequest(target, 'garbage'), body())))
        .toEqual({ status: 400, code: 'bridge-capability-invalid' })
    }
    // Missing header beats everything.
    expect(await rejection(controller.bridgeForwardsAcquire(bridgeRequest(origin), body())))
      .toEqual({ status: 401, code: 'unauthorized' })
  })

  it('releases a holder by the grant device while the workbench channel is reconnecting', async () => {
    const { capability, origin } = await issued()
    await expect(controller.bridgeForwardsAcquire(bridgeRequest(origin, capability), body())).resolves.toMatchObject({ devicePort: 3939 })
    await until(() => row(3939)?.state === 'ready')

    workbenchUp = false
    await service.reconnectDevice('vm')
    await until(() => service.statuses()[0]?.endpoint === undefined)
    // A valid grant but a device with no endpoint: acquire is 409, never 400.
    expect(await rejection(controller.bridgeForwardsAcquire(bridgeRequest(origin, capability), body(4000))))
      .toEqual({ status: 409, code: 'device-unavailable' })

    // Release still finds the table through the grant's device.
    await expect(controller.bridgeForwardsRelease(bridgeRequest(origin, capability), body())).resolves.toEqual({ released: true })
    expect(row(3939)).toBeUndefined()
    expect(children(3939).every(child => !child.alive)).toBe(true)
  })
})
