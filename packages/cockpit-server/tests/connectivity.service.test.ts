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
  async listWorkspaces() { return { items: [], archivedSessionIds: [] } }
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

/** Tunnel stand-in: never spawns ssh. Off by default so tests that do not opt
 * in keep the original "no tunnel is ever established" behaviour. When on, it
 * honours a preferred port unless that port is in the "taken" set, mirroring
 * the real manager's bind-then-fall-back. */
const tunnel = { established: false }
const takenPorts = new Set<number>()
let nextFreshPort = 51000
const tunnelConnects: { deviceId: string; preferredLocalPort?: number }[] = []

class FakeTunnelManager {
  constructor(readonly options: unknown) {}
  async connect(request: { deviceId: string; preferredLocalPort?: number }) {
    tunnelConnects.push({ deviceId: request.deviceId, preferredLocalPort: request.preferredLocalPort })
    if (!tunnel.established) throw new Error('no ssh in test environment')
    const preferred = request.preferredLocalPort
    const localPort = preferred !== undefined && !takenPorts.has(preferred) ? preferred : nextFreshPort++
    return {
      deviceId: request.deviceId,
      generation: 1,
      endpoint: new URL(`http://127.0.0.1:${localPort}`),
      localPort,
      diagnostic: 'ok',
      dispose: async () => {},
    }
  }
  async disposeNode() {}
  async disposeAll() {}
}

vi.mock('../src/connectivity/tunnel-manager.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/connectivity/tunnel-manager.js')>()
  return { ...actual, TunnelManager: FakeTunnelManager }
})

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
  readonly localPortWrites: [string, number][] = []

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

  async updateLocalPort(deviceId: string, localPort: number): Promise<void> {
    const target = this.records.find(record => record.deviceId === deviceId)
    if (target === undefined || target.localPort === localPort) return
    this.localPortWrites.push([deviceId, localPort])
    this.records = this.records.map(record => (record.deviceId === deviceId ? { ...record, localPort } : record))
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
  takenPorts.clear()
  tunnelConnects.length = 0
  nextFreshPort = 51000
  tunnel.established = false
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

  it('redacts launch tokens from add and update return values', async () => {
    const { service } = await serviceFor([])
    const added = await service.addDevice({ displayName: 'Local', kind: 'local', remoteDshPort: 3081, enabled: false, dshLaunchUrl: 'http://127.0.0.1:3081/?token=abcdefghijklmnop' })
    expect(added).not.toHaveProperty('dshLaunchToken')
    const updated = await service.updateDevice(added.deviceId, { dshLaunchUrl: 'http://127.0.0.1:3081/?token=qrstuvwxyzabcdef' })
    expect(updated).not.toHaveProperty('dshLaunchToken')
    await service.onApplicationShutdown()
  })

  it('never projects a persisted DSH launch token into device facts', async () => {
    const { service } = await serviceFor([remote('a', 0, { dshLaunchToken: 'opaque-secret-value' })])
    expect(JSON.stringify(service.statuses())).not.toContain('opaque-secret-value')
    expect(service.statuses()[0]).not.toHaveProperty('dshLaunchToken')
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
      pendingInteractionCount: 0, pendingInteractionObservability: 'available',
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

  /** The workbench iframe is loaded from `http://127.0.0.1:<localPort>`, so a
   * port that changes on every reconnect throws away the device's own DSH web
   * localStorage. The port must become a durable device property. */
  it('persists the bound forward port and reuses it on the next connection', async () => {
    tunnel.established = true
    const { service, registry } = await serviceFor([remote('a', 0, { enabled: true })])
    for (let i = 0; i < 200 && registry.localPortWrites.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(registry.localPortWrites).toHaveLength(1)
    const [deviceId, port] = registry.localPortWrites[0]!
    expect(deviceId).toBe('a')
    expect(registry.records[0]?.localPort).toBe(port)
    // First connection had nothing to reuse.
    expect(tunnelConnects[0]?.preferredLocalPort).toBeUndefined()

    // Reconnect: the persisted port is offered, reused, and not rewritten.
    await service.reconnectDevice('a')
    for (let i = 0; i < 200 && tunnelConnects.length < 2; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(tunnelConnects[1]?.preferredLocalPort).toBe(port)
    expect(registry.localPortWrites).toHaveLength(1)
    expect(service.statuses()[0]?.endpoint).toBe(`http://127.0.0.1:${port}/`)

    await service.onApplicationShutdown()
  })

  it('records a replacement port when the persisted one is no longer bindable', async () => {
    tunnel.established = true
    takenPorts.add(49999)
    const { service, registry } = await serviceFor([remote('a', 0, { enabled: true, localPort: 49999 })])
    for (let i = 0; i < 200 && registry.localPortWrites.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(tunnelConnects[0]?.preferredLocalPort).toBe(49999)
    // Reconnect still succeeded on a different port.
    expect(registry.localPortWrites).toHaveLength(1)
    const port = registry.localPortWrites[0]![1]
    expect(port).not.toBe(49999)
    expect(registry.records[0]?.localPort).toBe(port)
    for (let i = 0; i < 200 && service.statuses()[0]?.state !== 'READY'; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(service.statuses()[0]?.state).toBe('READY')

    await service.onApplicationShutdown()
  })

  it('does not persist a forward port for a local device', async () => {
    tunnel.established = true
    const { service, registry } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true,
    })])
    for (let i = 0; i < 100 && service.statuses()[0]?.state !== 'READY'; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(service.statuses()[0]?.endpoint).toBe('http://127.0.0.1:3080/')
    expect(registry.localPortWrites).toEqual([])
    expect(tunnelConnects).toEqual([])

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

describe('bridge capability and protocol', () => {
  it('issues a capability only for a connected, enabled device and rejects an unknown one', async () => {
    const { service } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true, remoteDshPort: 3080,
    })])
    for (let attempt = 0; attempt < 100 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const grant = service.issueBridgeCapability('local')
    expect(grant.capability).toBeTruthy()
    expect(grant.protocolVersion).toBe(2)

    expect(() => service.issueBridgeCapability('missing-device')).toThrow('unknown device')
    await service.onApplicationShutdown()
  })

  it('a capability is bound to the DEVICE origin (where the bridge actually calls from), not the issuing caller', async () => {
    const { service } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true, remoteDshPort: 3080,
    })])
    for (let attempt = 0; attempt < 100 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    // Issuance happens through the cockpit's OWN same-origin page — a
    // completely different origin from the device's DSH endpoint.
    const deviceOrigin = new URL(service.statuses()[0]!.endpoint!).origin
    const grant = service.issueBridgeCapability('local')

    // Validated as if presented FROM the device origin: succeeds.
    expect(() => service.validateBridgeCapability(deviceOrigin, grant.capability)).not.toThrow()
    // Presented from any other origin (e.g. the cockpit's own, or an
    // unrelated one) must be rejected — the whole point of Origin binding.
    expect(() => service.validateBridgeCapability('http://127.0.0.1:9999', grant.capability)).toThrow()
  })

  it('validateBridgeCapability rejects a forged or missing token from the correct device origin', async () => {
    const { service } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true, remoteDshPort: 3080,
    })])
    for (let attempt = 0; attempt < 100 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const origin = new URL(service.statuses()[0]!.endpoint!).origin

    expect(() => service.validateBridgeCapability(origin, 'forged-token')).toThrow('invalid or expired bridge capability')
    expect(() => service.validateBridgeCapability(origin, undefined)).toThrow('invalid or expired bridge capability')
    await service.onApplicationShutdown()
  })

  it('disabling a device revokes its outstanding bridge capabilities', async () => {
    const { service } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true, remoteDshPort: 3080,
    })])
    for (let attempt = 0; attempt < 100 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const origin = new URL(service.statuses()[0]!.endpoint!).origin
    const grant = service.issueBridgeCapability('local')

    await service.updateDevice('local', { enabled: false })

    expect(() => service.validateBridgeCapability(origin, grant.capability)).toThrow()
    await service.onApplicationShutdown()
  })

  it('bridgeSessionOpened and bridgeHello stamp bridgeSeenAt, which reports plugin presence rather than a freshness window', async () => {
    const { service } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true, remoteDshPort: 3080,
    })])
    for (let attempt = 0; attempt < 100 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const origin = new URL(service.statuses()[0]!.endpoint!).origin

    // No bridge contact yet: the plugin has not been seen on this device.
    expect(service.statuses()[0]?.bridgeSeenAt).toBeUndefined()

    // A hello means "this device's DSH web client runs the plugin". The
    // protocol version is accepted (the reliable-protocol plugin sends it) but
    // is deliberately NOT projected as UI state: bridgeSeenAt answers only
    // "is the plugin installed", never "is it still fresh".
    service.bridgeHello(origin, 'legacy-plugin', 1)
    const afterHello = service.statuses()[0]?.bridgeSeenAt
    expect(afterHello).toBeDefined()

    // A selection ack refreshes the same stamp; nothing else is surfaced.
    service.bridgeSessionOpened(origin, 's1', 2)
    expect(service.statuses()[0]?.bridgeSeenAt).toBeGreaterThanOrEqual(afterHello!)

    await service.onApplicationShutdown()
  })

  it('ackCompleted clears completion reminders for an enabled device and rejects a disabled or unknown one', async () => {
    const { service } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true, remoteDshPort: 3080,
    })])
    for (let attempt = 0; attempt < 100 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    // No throw for a connected, enabled device even with nothing to clear.
    expect(() => service.ackCompleted('local')).not.toThrow()
    expect(() => service.ackCompleted('missing-device')).toThrow('unknown device')

    await service.updateDevice('local', { enabled: false })
    expect(() => service.ackCompleted('local')).toThrow('is disabled')
    await service.onApplicationShutdown()
  })
})
