import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceRecord } from '@dsh-cockpit/shared'
import { DeviceEventsService } from '../src/connectivity/device-events.service.js'

const probeSshIdentity = vi.fn()
const validateSshAlias = vi.fn((alias: string) => alias)
const streamInstances: FakeDualEventStream[] = []

class FakeRc2Client {
  constructor(readonly options: { endpoint: URL }) {}
  async probe() { return { ok: true, state: 'READY' as const, diagnostic: 'ok' } }
  async listSessions() { return [] }
}

class FakeDualEventStream extends EventEmitter {
  disposed = false
  constructor(readonly options: { endpoint: URL; deviceId: string }) {
    super()
    streamInstances.push(this)
  }
  async open() {}
  async dispose() { this.disposed = true }
}

vi.mock('../src/connectivity/ssh.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/connectivity/ssh.js')>()
  return { ...actual, probeSshIdentity, validateSshAlias }
})

vi.mock('../src/connectivity/rc2-client.js', () => ({
  Rc2Client: FakeRc2Client,
  DualEventStream: FakeDualEventStream,
}))

const { ConnectivityService } = await import('../src/connectivity/connectivity.service.js')

const remote = (deviceId: string, order: number, overrides: Partial<DeviceRecord> = {}): DeviceRecord => ({
  deviceId,
  displayName: deviceId.toUpperCase(),
  kind: 'remote',
  sshAlias: `${deviceId}-alias`,
  remoteDshPort: 3080,
  enabled: false,
  order,
  ...overrides,
})

class FakeRegistry {
  records: readonly DeviceRecord[]
  readonly saves: DeviceRecord[][] = []

  constructor(records: readonly DeviceRecord[]) {
    this.records = records
  }

  async load(): Promise<readonly DeviceRecord[]> {
    return this.records
  }

  async save(records: readonly DeviceRecord[]): Promise<readonly DeviceRecord[]> {
    const snapshot = records.map(record => ({ ...record }))
    this.saves.push(snapshot)
    this.records = snapshot
    return snapshot
  }
}

async function serviceFor(records: readonly DeviceRecord[]) {
  const registry = new FakeRegistry(records)
  const events = new DeviceEventsService()
  const published: (readonly string[])[] = []
  events.subscribe(facts => { published.push(facts.map(fact => `${fact.deviceId}:${fact.order}`)) })
  const service = new ConnectivityService(registry as never, events)
  for (let attempt = 0; attempt < 50 && service.statuses().length !== records.length; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  expect(service.statuses()).toHaveLength(records.length)
  return { service, registry, published }
}

beforeEach(() => {
  probeSshIdentity.mockReset()
  validateSshAlias.mockClear()
  streamInstances.length = 0
})

describe('connectivity device updates', () => {
  it('outputs editable connection configuration in device facts', async () => {
    const local = remote('local', 1, { kind: 'local', sshAlias: undefined })
    const { service } = await serviceFor([remote('remote', 0), local])

    expect(service.statuses()).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceId: 'remote', sshAlias: 'remote-alias', remoteDshPort: 3080 }),
    ]))
    const localFacts = service.statuses().find(device => device.deviceId === 'local')
    expect(localFacts).toEqual(expect.objectContaining({ remoteDshPort: 3080 }))
    expect(localFacts).not.toHaveProperty('sshAlias')

    await service.onApplicationShutdown()
  })

  it('omits the outcome-unknown counter from device facts', async () => {
    const { service } = await serviceFor([remote('a', 0)])

    expect(service.statuses()[0]).not.toHaveProperty('outcomeUnknownCount')

    await service.onApplicationShutdown()
  })

  it('refuses an unconfirmed delete and keeps the registry and connection intact', async () => {
    const original = remote('a', 0)
    const { service, registry } = await serviceFor([original])

    await expect(service.removeDevice('a', false)).resolves.toEqual({
      removed: false,
      requiresConfirmation: true,
    })
    expect(registry.saves).toHaveLength(0)
    expect(registry.records).toEqual([original])
    expect(service.statuses().map(device => device.deviceId)).toEqual(['a'])

    await service.onApplicationShutdown()
  })

  it('removes the device and its lifecycle once the delete is confirmed', async () => {
    const { service, registry } = await serviceFor([remote('a', 0), remote('b', 1)])

    await expect(service.removeDevice('a', true)).resolves.toEqual({
      removed: true,
      requiresConfirmation: false,
    })
    expect(registry.saves).toHaveLength(1)
    expect(registry.records.map(device => device.deviceId)).toEqual(['b'])
    expect(service.statuses().map(device => device.deviceId)).toEqual(['b'])

    await service.onApplicationShutdown()
  })

  it('does not save or mutate lifecycle facts when edited SSH verification fails', async () => {
    probeSshIdentity.mockResolvedValue({ ok: false, diagnostic: 'permission denied' })
    const original = remote('a', 0)
    const { service, registry } = await serviceFor([original])

    await expect(service.updateDevice('a', { sshAlias: 'unreachable' })).rejects.toThrow(
      'SSH identity verification failed: permission denied',
    )

    expect(registry.saves).toHaveLength(0)
    expect(registry.records).toEqual([original])
    expect(service.statuses()[0]).toEqual(expect.objectContaining({ sshAlias: 'a-alias', remoteDshPort: 3080 }))
    await service.onApplicationShutdown()
  })

  it('revalidates the effective SSH alias for a remote connection edit but not for toggle or reorder', async () => {
    probeSshIdentity.mockResolvedValue({ ok: false, diagnostic: 'host offline' })
    const original = remote('a', 0)
    const { service, registry } = await serviceFor([original])

    await expect(service.updateDevice('a', {
      displayName: 'Renamed A',
      sshAlias: 'a-alias',
      remoteDshPort: 4090,
    })).rejects.toThrow('SSH identity verification failed: host offline')
    expect(probeSshIdentity).toHaveBeenCalledWith('a-alias', { sshExecutable: 'ssh' })
    expect(registry.saves).toHaveLength(0)
    expect(registry.records).toEqual([original])
    expect(service.statuses()[0]).toEqual(expect.objectContaining({
      displayName: original.displayName,
      sshAlias: original.sshAlias,
      remoteDshPort: original.remoteDshPort,
    }))

    probeSshIdentity.mockClear()
    probeSshIdentity.mockResolvedValue({ ok: true, diagnostic: 'ok' })
    await service.updateDevice('a', { enabled: true })
    await service.updateDevice('a', { order: 0 })
    expect(probeSshIdentity).not.toHaveBeenCalled()
    await service.onApplicationShutdown()
  })

  it('rejects sshAlias updates for local devices without probing or saving', async () => {
    const original = remote('local', 0, { kind: 'local', sshAlias: undefined })
    const { service, registry } = await serviceFor([original])

    await expect(service.updateDevice('local', { sshAlias: 'should-not-apply' })).rejects.toThrow(
      'local device local does not accept sshAlias',
    )
    expect(probeSshIdentity).not.toHaveBeenCalled()
    expect(registry.saves).toHaveLength(0)
    expect(registry.records).toEqual([original])
    expect(service.statuses()[0]).not.toHaveProperty('sshAlias')
    await service.onApplicationShutdown()
  })

  it('adds a local device without requiring an ssh executable', async () => {
    const { service, registry } = await serviceFor([])

    const added = await service.addDevice({
      displayName: 'This PC',
      kind: 'local',
      remoteDshPort: 3080,
      enabled: false,
    })

    expect(added.kind).toBe('local')
    expect(probeSshIdentity).not.toHaveBeenCalled()
    expect(registry.saves).toHaveLength(1)
    await service.onApplicationShutdown()
  })

  it('keeps disabled facts stable, rejects reconnect, and re-enables through a fresh lifecycle', async () => {
    probeSshIdentity.mockResolvedValue({ ok: true, diagnostic: 'ok' })
    const { service } = await serviceFor([remote('a', 0)])

    expect(service.statuses()[0]).toEqual(expect.objectContaining({
      enabled: false,
      state: 'DISABLED',
      runningSessionCount: 0,
      pendingInteractionCount: 0,
      sessionStatuses: [],
    }))
    expect(service.statuses()[0]).not.toHaveProperty('endpoint')
    await expect(service.refreshDevice('a')).rejects.toThrow('device a is disabled')
    await expect(service.reconnectDevice('a')).rejects.toThrow('device a is disabled')

    await service.updateDevice('a', { enabled: true })
    expect(service.statuses()[0]).toEqual(expect.objectContaining({ enabled: true, state: 'CONNECTING' }))
    await service.updateDevice('a', { enabled: false })
    expect(service.statuses()[0]).toEqual(expect.objectContaining({ enabled: false, state: 'DISABLED' }))
    expect(service.statuses()[0]).not.toHaveProperty('endpoint')
    expect(service.statuses()[0]).not.toHaveProperty('bridgeSeenAt')
    await service.updateDevice('a', { enabled: true })
    expect(service.statuses()[0]).toEqual(expect.objectContaining({ enabled: true, state: 'CONNECTING' }))
    expect(service.statuses()[0]).not.toHaveProperty('endpoint')
    expect(service.statuses()[0]).not.toHaveProperty('bridgeSeenAt')

    await service.onApplicationShutdown()
  })

  it('clears live endpoint and bridge presence when an enabled local device is disabled', async () => {
    const { service } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true, remoteDshPort: 3080,
    })])
    for (let attempt = 0; attempt < 100 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const before = service.statuses()[0]!
    expect(before).toEqual(expect.objectContaining({ enabled: true, state: 'READY' }))
    expect(before.endpoint).toBe('http://127.0.0.1:3080/')
    service.bridgeHello(new URL(before.endpoint!).origin, 'test')
    expect(service.statuses()[0]).toHaveProperty('bridgeSeenAt')
    const activeStream = streamInstances.at(-1)!

    await service.updateDevice('local', { enabled: false })

    expect(activeStream.disposed).toBe(true)
    expect(service.statuses()[0]).toEqual(expect.objectContaining({ enabled: false, state: 'DISABLED' }))
    expect(service.statuses()[0]).not.toHaveProperty('endpoint')
    expect(service.statuses()[0]).not.toHaveProperty('bridgeSeenAt')
    await expect(() => service.bridgeHello(new URL(before.endpoint!).origin, 'test')).toThrow('no cockpit device matches origin')
    await service.onApplicationShutdown()
  })

  it('clamps a target order, normalizes every order, saves once, and synchronizes lifecycles', async () => {
    const { service, registry, published } = await serviceFor([
      remote('b', -2),
      remote('a', 10),
      remote('c', 10),
    ])

    const moved = await service.updateDevice('a', { order: 99 })

    expect(moved.order).toBe(2)
    expect(registry.saves).toHaveLength(1)
    expect(registry.saves[0]?.map(device => [device.deviceId, device.order])).toEqual([
      ['b', 0],
      ['c', 1],
      ['a', 2],
    ])
    expect(service.statuses().map(device => [device.deviceId, device.order])).toEqual([
      ['b', 0],
      ['c', 1],
      ['a', 2],
    ])
    expect(published.at(-1)).toEqual(['b:0', 'c:1', 'a:2'])

    await service.onApplicationShutdown()
  })

  it('clamps a negative target order to the start', async () => {
    const { service, registry } = await serviceFor([
      remote('a', 0),
      remote('b', 1),
      remote('c', 2),
    ])

    await service.updateDevice('c', { order: -7 })

    expect(registry.saves).toHaveLength(1)
    expect(registry.saves[0]?.map(device => [device.deviceId, device.order])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ])
    await service.onApplicationShutdown()
  })
})
