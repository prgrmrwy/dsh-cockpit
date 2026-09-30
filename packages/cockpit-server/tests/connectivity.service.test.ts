import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Logger } from '@nestjs/common'
import type { DeviceRecord } from '@dsh-cockpit/shared'
import { DeviceEventsService } from '../src/connectivity/device-events.service.js'
import { dshCookieName, exchangeDshLaunchToken } from '../src/connectivity/dsh-auth.js'

const probeSshIdentity = vi.fn()
const validateSshAlias = vi.fn((alias: string) => alias)
const streamInstances: FakeDualEventStream[] = []

/** rc.2 classification stand-in. On by default so existing rc.2 suites keep
 * their behaviour; a typert fixture turns it OFF, because a probe that succeeds
 * classifies the device as rc.2 and never reaches the typert path at all. */
const rc2 = { available: true }
/** The stream handed to the lifecycle for the most recent typert fixture. */
let lastProtocolStream: { readonly disposed: boolean } | undefined

class FakeRc2Client {
  constructor(readonly options: { endpoint: URL }) {}
  async probe() {
    if (!rc2.available) return { ok: false, state: 'DSH_UNAVAILABLE' as const, diagnostic: 'not an rc.2 endpoint' }
    return { ok: true, state: 'READY' as const, diagnostic: 'ok' }
  }
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

const discoverLocalDshLaunchToken = vi.fn()
const discoverRemoteDshLaunchToken = vi.fn()

/** Discovery reads real logs over the real filesystem/SSH; every workbench test
 * drives it explicitly so "did the server read discovery logs?" is assertable. */
vi.mock('../src/connectivity/dsh-auth-discovery.js', () => ({
  discoverLocalDshLaunchToken,
  discoverRemoteDshLaunchToken,
}))

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
const tunnelConnects: { deviceId: string; preferredLocalPort?: number; channelId?: string; remoteDshPort?: number }[] = []

class FakeTunnelManager {
  constructor(readonly options: unknown) {}
  async connect(request: { deviceId: string; channelId?: string; remoteDshPort: number; preferredLocalPort?: number }) {
    tunnelConnects.push({ deviceId: request.deviceId, preferredLocalPort: request.preferredLocalPort, channelId: request.channelId, remoteDshPort: request.remoteDshPort })
    if (!tunnel.established) throw new Error('no ssh in test environment')
    const preferred = request.preferredLocalPort
    const localPort = preferred !== undefined && !takenPorts.has(preferred) ? preferred : nextFreshPort++
    return {
      deviceId: request.deviceId,
      channelId: request.channelId ?? 'workbench',
      generation: 1,
      endpoint: new URL(`http://127.0.0.1:${localPort}`),
      localPort,
      diagnostic: 'ok',
      dispose: async () => {},
    }
  }
  async disposeNode() {}
  async disposeChannel() {}
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

  async mutateDevices(update: (current: readonly DeviceRecord[]) => readonly DeviceRecord[]): Promise<readonly DeviceRecord[]> {
    const snapshot = update(this.records).map(record => ({ ...record }))
    this.saves.push([...snapshot])
    this.records = snapshot
    return snapshot
  }

  async updateLocalPort(deviceId: string, localPort: number): Promise<void> {
    const target = this.records.find(record => record.deviceId === deviceId)
    if (target === undefined || target.localPort === localPort) return
    this.localPortWrites.push([deviceId, localPort])
    this.records = this.records.map(record => (record.deviceId === deviceId ? { ...record, localPort } : record))
  }

  /** Mirrors the real registry's compare-and-swap, including the generation
   * fence and the discovery-consent requirement, so tests exercise the same
   * commit semantics the production path relies on. */
  async mutateDevice(deviceId: string, update: (current: DeviceRecord) => DeviceRecord | undefined): Promise<DeviceRecord | undefined> {
    const current = this.records.find(record => record.deviceId === deviceId)
    if (current === undefined) return undefined
    const next = update(current)
    if (next === undefined || next === current) return current
    this.records = this.records.map(record => (record.deviceId === deviceId ? next : record))
    return next
  }
  async commitRecoveredAuth(deviceId: string, expectedGeneration: number, auth: NonNullable<DeviceRecord['dshAuth']>, requireDiscovery = false): Promise<DeviceRecord | undefined> {
    const current = this.records.find(record => record.deviceId === deviceId)
    if (current === undefined || !current.enabled || current.dshAuth?.generation !== expectedGeneration) return undefined
    if (requireDiscovery && current.dshAuth.autoDiscovery !== 'ohmydsh-log') return undefined
    const { dshLaunchToken: _legacy, ...withoutLegacy } = current
    const committed: DeviceRecord = {
      ...withoutLegacy,
      ...(auth.launchToken === undefined ? {} : { dshLaunchToken: auth.launchToken }),
      dshAuth: auth,
    }
    this.records = this.records.map(record => (record.deviceId === deviceId ? committed : record))
    this.saves.push([...this.records])
    return committed
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

/**
 * A typert device that reaches READY, plus the two independent fetch seams the
 * workbench path needs:
 *
 * - `globalThis.fetch` serves the CONNECTION layer, which builds real
 *   `TypertClient`s internally and therefore always uses the global fetch.
 * - the injected `workbenchFetch` serves token VALIDATION in the workbench path,
 *   so a test can make validation succeed, reject or fail without also
 *   disturbing the live connection.
 *
 * Discovery is mocked module-wide, so `discoveryCalls` is the authoritative
 * answer to "did this launch read DSH logs?".
 */
async function typertServiceFor(options: {
  readonly deviceId?: string
  readonly auth?: DeviceRecord['dshAuth']
  readonly enabled?: boolean
  readonly validation?: (url: string, init?: RequestInit) => Response | Promise<Response>
}) {
  const deviceId = options.deviceId ?? 'a'
  const port = 51_777
  tunnel.established = true
  // A REAL typert device: rc.2 classification must fail, otherwise the typert
  // authentication path is never reached.
  rc2.available = false
  const records = [remote(deviceId, 0, {
    enabled: options.enabled ?? true,
    localPort: port,
    ...(options.auth === undefined ? {} : { dshAuth: options.auth }),
  })]
  const registry = new FakeRegistry(records)
  const events = new DeviceEventsService()
  const workbenchFetch = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    if (options.validation !== undefined) return await options.validation(url, init)
    if (!url.includes('?token=')) return challenge()
    return mintedCookie(new URL(url).searchParams.get('token') ?? 'unknown')
  }) as unknown as typeof fetch
  globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/session/list')) {
      const rpcId = JSON.parse(String(init?.body)).rpcId
      return json({ type: 'server-response', rpcId, result: { ok: true, value: { items: [] } } })
    }
    if (url.endsWith('/api/workspace/list')) {
      const rpcId = JSON.parse(String(init?.body)).rpcId
      return json({ type: 'server-response', rpcId, result: { ok: true, value: { items: [], archivedSessionIds: [] } } })
    }
    // rc.2 classification AND the DSH root probe both land here.
    return challenge()
  }) as unknown as typeof fetch
  const service = new ConnectivityService(registry as never, events, {
    fetch: workbenchFetch,
    // A typert handshake needs a real WebSocket against the device; the fixture
    // models an ALREADY-READY typert device, which is exactly the scenario this
    // change is about (server cookie healthy, browser still needs a token).
    createProtocol: async (endpoint, record) => {
      const auth = record.dshAuth
      return {
        kind: 'typert' as const,
        client: {
          kind: 'typert' as const,
          probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'typert ok' }),
          listSessions: async () => [],
          listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
        },
        stream: (() => {
          const stream = {
            disposed: false,
            on() { return this },
            off() { return this },
            open: async () => {},
            dispose() { stream.disposed = true },
          }
          lastProtocolStream = stream
          return stream
        })(),
        // Mirror the record EXACTLY (including the expiry): a fabricated value
        // makes onAuthAccepted see a change and commit a new generation on every
        // connect, which would silently invalidate the generation assertions.
        ...(auth === undefined ? {} : {
          auth: {
            ...(auth.launchToken === undefined ? {} : { launchToken: auth.launchToken }),
            ...(auth.serverCookie === undefined ? {} : { cookie: auth.serverCookie }),
            ...(auth.cookieAuthority === undefined ? { authority: endpoint.host } : { authority: auth.cookieAuthority }),
            ...(auth.cookieExpiresAt === undefined ? {} : { expiresAt: auth.cookieExpiresAt }),
          },
        }),
      }
    },
  })
  for (let attempt = 0; attempt < 200 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  if ((options.enabled ?? true) && service.statuses()[0]?.state !== 'READY') {
    throw new Error(`fixture never reached READY: ${JSON.stringify(service.statuses()[0])}`)
  }
  return { service, registry, workbenchFetch, deviceId, port }
}

const AUTH_CHALLENGE = 'dsh web authentication required; reopen the URL printed by dsh web.'
const challenge = (): Response => new Response(AUTH_CHALLENGE, { status: 401 })
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const exchangeRejected = (): Response => new Response('', { status: 401 })
const mintedCookie = (token: string, authority = '127.0.0.1:51777'): Response => new Response('', {
  status: 303,
  headers: { location: '/', 'set-cookie': `${dshCookieName(authority)}=minted-${token}; Max-Age=2592000; Path=/; HttpOnly` },
})

async function withGlobalFetch<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

beforeEach(() => {
  probeSshIdentity.mockReset()
  validateSshAlias.mockClear()
  discoverLocalDshLaunchToken.mockReset()
  discoverRemoteDshLaunchToken.mockReset()
  streamInstances.length = 0
  takenPorts.clear()
  tunnelConnects.length = 0
  nextFreshPort = 51000
  tunnel.established = false
  rc2.available = true
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

  it('keeps the connection alive and warns when persisting the port fails', async () => {
    tunnel.established = true
    // Persisted port is unavailable, so the connection drifts to a fresh port
    // and must persist the new one — that durable write is what we fail.
    takenPorts.add(49999)
    const warnings: string[] = []
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => { warnings.push(String(message)) })
    try {
      const registry = new FakeRegistry([remote('a', 0, { enabled: true, localPort: 49999 })])
      registry.updateLocalPort = async () => { throw new Error('disk full') }
      const events = new DeviceEventsService()
      const service = new ConnectivityService(registry as never, events)
      for (let i = 0; i < 200 && service.statuses()[0]?.state !== 'READY'; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      // The failed persist did not break the connection.
      expect(service.statuses()[0]?.state).toBe('READY')
      // The failure is observable rather than silently swallowed.
      expect(warnings.some(w => w.includes('local port persist failed') && w.includes('device=a'))).toBe(true)
      await service.onApplicationShutdown()
    } finally {
      warnSpy.mockRestore()
    }
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

/** Additional port forwards: registration is device-scoped by construction
 * (the device is resolved from Origin, never named by the caller), and the
 * real limits are structural — bound channel, per-device cap, loopback only. */
describe('publishable port registration and publishing', () => {
  async function connectedRemote() {
    tunnel.established = true
    const built = await serviceFor([remote('a', 0, { enabled: true })])
    for (let attempt = 0; attempt < 200 && built.service.statuses()[0]?.endpoint === undefined; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const origin = new URL(built.service.statuses()[0]!.endpoint!).origin
    return { ...built, origin }
  }

  it('publishes a registered port and reuses the same forward on repeat calls', async () => {
    const { service, origin } = await connectedRemote()
    service.registerPublishablePort(origin, 'cards', 3939)

    const before = tunnelConnects.length
    const first = await service.publishPort(origin, 'cards')
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(tunnelConnects.at(-1)).toMatchObject({ deviceId: 'a', channelId: 'cards', remoteDshPort: 3939 })

    // Idempotent: a second publish must not spawn another forward.
    const second = await service.publishPort(origin, 'cards')
    expect(second).toEqual(first)
    expect(tunnelConnects.length).toBe(before + 1)

    await service.onApplicationShutdown()
  })

  it('refuses to publish a port that was never registered', async () => {
    const { service, origin } = await connectedRemote()
    const before = tunnelConnects.length
    await expect(service.publishPort(origin, 'cards')).rejects.toMatchObject({ code: 'port-not-registered', message: /not registered/ })
    // The refusal must happen before any ssh child is created.
    expect(tunnelConnects.length).toBe(before)
    await service.onApplicationShutdown()
  })

  it('rejects an unknown origin, so a caller cannot register for another device', async () => {
    const { service } = await connectedRemote()
    expect(() => service.registerPublishablePort('http://127.0.0.1:1', 'cards', 3939)).toThrow(/matches origin/)
    await service.onApplicationShutdown()
  })

  it('rejects an invalid channel id or port, including the reserved workbench id', async () => {
    const { service, origin } = await connectedRemote()
    expect(() => service.registerPublishablePort(origin, 'workbench', 3939)).toThrow(/invalid channel id/)
    expect(() => service.registerPublishablePort(origin, 'bad id', 3939)).toThrow(/invalid channel id/)
    expect(() => service.registerPublishablePort(origin, 'cards', 0)).toThrow(/invalid device port/)
    expect(() => service.registerPublishablePort(origin, 'cards', 70000)).toThrow(/invalid device port/)
    await service.onApplicationShutdown()
  })

  it('caps the number of publishable channels per device', async () => {
    const { service, origin } = await connectedRemote()
    for (let i = 0; i < 8; i += 1) service.registerPublishablePort(origin, `c${i}`, 4000 + i)
    expect(() => service.registerPublishablePort(origin, 'c8', 4100)).toThrow(expect.objectContaining({ code: 'forward-limit' }))
    // Re-registering an existing channel stays allowed at the cap.
    expect(() => service.registerPublishablePort(origin, 'c0', 4999)).not.toThrow()
    await service.onApplicationShutdown()
  })

  it('a local device needs no forward and is refused with a stable reason', async () => {
    const { service } = await serviceFor([remote('local', 0, {
      kind: 'local', sshAlias: undefined, enabled: true, remoteDshPort: 3080,
    })])
    for (let attempt = 0; attempt < 100 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const origin = new URL(service.statuses()[0]!.endpoint!).origin
    service.registerPublishablePort(origin, 'cards', 3939)
    // The consumer keys its loopback fallback on this exact code: a local
    // device is the one case where "no forward" means "use your own address".
    await expect(service.publishPort(origin, 'cards')).rejects.toMatchObject({ code: 'local-device', message: /local device needs no port forward/ })
    expect(tunnelConnects.some(c => c.channelId === 'cards')).toBe(false)
    await service.onApplicationShutdown()
  })
})

/** Browser workbench start-up. The whole point of this change: a device can be
 * READY on the server's own cookie while the browser still needs a CURRENT
 * token, so the stored token is validated and only a rejected one may trigger
 * the (already consented) bounded discovery. */
describe('workbench launch authentication for a fresh browser', () => {
  it('validates a current repeatable token before issuing a new-browser launch URL', async () => {
    const auth = {
      version: 1 as const, launchToken: 'current-token-abcdef', serverCookie: 'server-cookie',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'disabled' as const,
      updatedAt: 0, generation: 3,
    }
    await withGlobalFetch(async () => {
      const { service, workbenchFetch } = await typertServiceFor({ auth })
      const launch = await service.workbenchLaunch('a')

      expect(launch.url).toBe('http://127.0.0.1:51777/?token=current-token-abcdef')
      expect(launch.authGeneration).toBe(3)
      // Validation must not commit: every exchange mints a DIFFERENT cookie, so
      // writing one back would bump the generation on every single launch.
      expect(service.statuses()[0]).toMatchObject({ dshAuthGeneration: 3 })
      expect(discoverLocalDshLaunchToken).not.toHaveBeenCalled()
      expect(discoverRemoteDshLaunchToken).not.toHaveBeenCalled()
      const validated = workbenchFetch.mock.calls.map(([url]) => String(url))
      expect(validated.filter(url => url.includes('?token='))).toHaveLength(1)
      await service.onApplicationShutdown()
    })
  })

  it('discovers validates and commits a current token for an authorized browser launch', async () => {
    const auth = {
      version: 1 as const, launchToken: 'stale-token-abcdefg', serverCookie: 'server-cookie',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'ohmydsh-log' as const,
      updatedAt: 0, generation: 4,
    }
    discoverRemoteDshLaunchToken.mockResolvedValue({ ok: true, token: 'fresh-token-abcdefg' })
    await withGlobalFetch(async () => {
      const { service, registry } = await typertServiceFor({
        auth,
        // The stored (stale) token is the only one the current DSH process rejects.
        validation: (url) => {
          if (!url.includes('?token=')) return challenge()
          return url.includes('stale-token-abcdefg') ? exchangeRejected() : mintedCookie('fresh-token-abcdefg')
        },
      })

      const launch = await service.workbenchLaunch('a')

      expect(launch.url).toBe('http://127.0.0.1:51777/?token=fresh-token-abcdefg')
      expect(launch.authGeneration).toBe(5)
      expect(discoverRemoteDshLaunchToken).toHaveBeenCalledTimes(1)
      const record = registry.records.find(candidate => candidate.deviceId === 'a')!
      expect(record.dshAuth).toMatchObject({ launchToken: 'fresh-token-abcdefg', generation: 5 })
      expect(service.statuses()[0]).toMatchObject({ dshAuthGeneration: 5 })
      await service.onApplicationShutdown()
    })
  })

  it('never invokes local or remote discovery when auto recovery is disabled', async () => {
    const auth = {
      version: 1 as const, launchToken: 'stale-token-abcdefg',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'disabled' as const,
      updatedAt: 0, generation: 2,
    }
    await withGlobalFetch(async () => {
      const { service } = await typertServiceFor({
        auth,
        validation: (url) => url.includes('?token=') ? exchangeRejected() : challenge(),
      })

      await expect(service.workbenchLaunch('a')).rejects.toMatchObject({ code: 'workbench-auth-required' })
      expect(discoverLocalDshLaunchToken).not.toHaveBeenCalled()
      expect(discoverRemoteDshLaunchToken).not.toHaveBeenCalled()
      expect(service.statuses()[0]).toMatchObject({ dshAuthGeneration: 2 })
      await service.onApplicationShutdown()
    })
  })

  it('returns a stable redacted auth-required result when no current token can be obtained', async () => {
    const auth = {
      version: 1 as const, launchToken: 'stale-token-abcdefg',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'ohmydsh-log' as const,
      updatedAt: 0, generation: 6,
    }
    discoverRemoteDshLaunchToken.mockResolvedValue({ ok: false, reason: 'source-unavailable' })
    await withGlobalFetch(async () => {
      const { service } = await typertServiceFor({
        auth,
        validation: (url) => url.includes('?token=') ? exchangeRejected() : challenge(),
      })

      const failure = await service.workbenchLaunch('a').catch((cause: unknown) => cause as Error)
      expect(failure).toMatchObject({ code: 'workbench-auth-required' })
      expect(String(failure.message)).not.toContain('stale-token-abcdefg')
      expect(String(failure.message)).not.toContain('source-unavailable')
      await service.onApplicationShutdown()
    })
  })

  it('recovers browser launch auth without disturbing the healthy server connection', async () => {
    const auth = {
      version: 1 as const, launchToken: 'stale-token-abcdefg', serverCookie: 'server-cookie',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'ohmydsh-log' as const,
      updatedAt: 0, generation: 7,
    }
    discoverRemoteDshLaunchToken.mockResolvedValue({ ok: true, token: 'fresh-token-abcdefg' })
    await withGlobalFetch(async () => {
      const { service, registry } = await typertServiceFor({
        auth,
        validation: (url) => {
          if (!url.includes('?token=')) return challenge()
          return url.includes('stale-token-abcdefg') ? exchangeRejected() : mintedCookie('fresh-token-abcdefg')
        },
      })
      const streamBefore = lastProtocolStream!
      const tunnelConnectsBefore = tunnelConnects.length

      await service.workbenchLaunch('a')

      // Browser-side recovery is its own consumer: the live stream, tunnel and
      // READY state of the server connection must be untouched.
      expect(streamBefore).toBeDefined()
      expect(streamBefore.disposed).toBe(false)
      expect(service.statuses()[0]).toMatchObject({ state: 'READY' })
      expect(tunnelConnects.length).toBe(tunnelConnectsBefore)
      expect(registry.records.find(candidate => candidate.deviceId === 'a')!.dshAuth).toMatchObject({
        // The registry stores the full `name=value` pair, not the bare value.
        serverCookie: dshCookieName('127.0.0.1:51777') + '=minted-fresh-token-abcdefg',
        launchToken: 'fresh-token-abcdefg',
      })
      await service.onApplicationShutdown()
    })
  })

  it('returns the clean rc2 endpoint without token validation or discovery', async () => {
    tunnel.established = true
    const { service, registry } = await serviceFor([
      remote('rc2', 0, { enabled: true, localPort: 51_888, dshAuth: {
        version: 1, launchToken: 'ignored-token-abcdef', autoDiscovery: 'ohmydsh-log', updatedAt: 0, generation: 3,
      } }),
    ])
    for (let attempt = 0; attempt < 200 && service.statuses()[0]?.state !== 'READY'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(service.statuses()[0]).toMatchObject({ state: 'READY' })

    const launch = await service.workbenchLaunch('rc2')

    expect(launch).toEqual({ url: 'http://127.0.0.1:51888/', authGeneration: 3 })
    expect(discoverLocalDshLaunchToken).not.toHaveBeenCalled()
    expect(discoverRemoteDshLaunchToken).not.toHaveBeenCalled()
    expect(registry.saves).toHaveLength(0)
    await service.onApplicationShutdown()
  })

  it('never reuses an old-authority cookie after the workbench endpoint changes', async () => {
    const auth = {
      version: 1 as const, launchToken: 'current-token-abcdef', serverCookie: 'old-authority-cookie',
      cookieAuthority: '127.0.0.1:50000', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'disabled' as const,
      updatedAt: 0, generation: 8,
    }
    await withGlobalFetch(async () => {
      const { service } = await typertServiceFor({
        auth,
        // The endpoint's own authority is 127.0.0.1:51777, but the minted cookie
        // claims the OLD authority: that must never be accepted as validation.
        validation: (url) => url.includes('?token=') ? mintedCookie('current-token-abcdef', '127.0.0.1:50000') : challenge(),
      })

      await expect(service.workbenchLaunch('a')).rejects.toMatchObject({ code: 'workbench-unavailable' })
      await service.onApplicationShutdown()
    })
  })

  it('projects auth status without token cookie or reversible derivatives', async () => {
    const auth = {
      version: 1 as const, launchToken: 'secret-token-abcdefg', serverCookie: 'secret-cookie-value',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'ohmydsh-log' as const,
      updatedAt: 0, generation: 9,
    }
    await withGlobalFetch(async () => {
      const { service } = await typertServiceFor({ auth })
      const serialized = JSON.stringify(service.statuses())

      expect(serialized).not.toContain('secret-token-abcdefg')
      expect(serialized).not.toContain('secret-cookie-value')
      expect(service.statuses()[0]).toMatchObject({ dshAuthConfigured: true, dshAuthAutoDiscovery: true, dshAuthGeneration: 9 })
      expect(service.statuses()[0]).not.toHaveProperty('dshAuth')
      await service.onApplicationShutdown()
    })
  })

  it('launches a standard remote dsh web without requiring a bridge', async () => {
    const auth = {
      version: 1 as const, launchToken: 'current-token-abcdef', autoDiscovery: 'disabled' as const,
      updatedAt: 0, generation: 1,
    }
    await withGlobalFetch(async () => {
      const { service } = await typertServiceFor({ auth })
      // No bridge hello, no capability, no plugin: a plain standard `dsh web`.
      const launch = await service.workbenchLaunch('a')
      expect(launch.url).toContain('?token=current-token-abcdef')
      expect(service.statuses()[0]).not.toHaveProperty('bridgeSeenAt')
      await service.onApplicationShutdown()
    })
  })

  it('drops a workbench launch result after its connection tuple becomes stale', async () => {
    const auth = {
      version: 1 as const, launchToken: 'current-token-abcdef', autoDiscovery: 'disabled' as const,
      updatedAt: 0, generation: 1,
    }
    await withGlobalFetch(async () => {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const { service } = await typertServiceFor({
        auth,
        validation: async url => {
          if (!url.includes('?token=')) return challenge()
          await gate
          return mintedCookie('current-token-abcdef')
        },
      })

      const pending = service.workbenchLaunch('a')
      // Disabling the device supersedes the connection generation while the
      // validation is still in flight.
      await service.updateDevice('a', { enabled: false })
      release()

      await expect(pending).rejects.toMatchObject({ code: 'workbench-launch-stale' })
      await service.onApplicationShutdown()
    })
  })

  it('prevents in-flight validation or discovery from restoring replaced or deleted auth', async () => {
    const auth = {
      version: 1 as const, launchToken: 'stale-token-abcdefg',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'ohmydsh-log' as const,
      updatedAt: 0, generation: 2,
    }
    discoverRemoteDshLaunchToken.mockResolvedValue({ ok: true, token: 'fresh-token-abcdefg' })
    await withGlobalFetch(async () => {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const { service, registry } = await typertServiceFor({
        auth,
        validation: async url => {
          if (!url.includes('?token=')) return challenge()
          if (url.includes('stale-token-abcdefg')) return exchangeRejected()
          await gate
          return mintedCookie('fresh-token-abcdefg')
        },
      })

      const pending = service.workbenchLaunch('a')
      for (let attempt = 0; attempt < 200 && discoverRemoteDshLaunchToken.mock.calls.length === 0; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      // The user replaces the material while recovery is in flight.
      const userAuth = {
        version: 1 as const, launchToken: 'user-supplied-abcdefg',
        cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'ohmydsh-log' as const,
        updatedAt: Date.now(), generation: 3,
      }
      await registry.mutateDevice('a', current => ({ ...current, dshAuth: userAuth }))
      release()

      await expect(pending).rejects.toMatchObject({ code: 'workbench-launch-stale' })
      expect(registry.records.find(candidate => candidate.deviceId === 'a')!.dshAuth?.launchToken).toBe('user-supplied-abcdefg')
      await service.onApplicationShutdown()
    })
  })
})

  it('serves two fresh browsers the same validated current token while the server cookie stays valid', async () => {
    // The headline scenario of this change, end to end and with no cookie relay:
    // the server's own cookie keeps the device READY, and two brand-new browsers
    // each obtain their OWN authority-bound cookie from the SAME validated
    // current token. Nothing about the second browser requires a new discovery or
    // a generation bump, because the token is repeatable for the supported
    // typert contract — and the server never hands its own cookie over.
    const auth = {
      version: 1 as const, launchToken: 'current-token-abcdef', serverCookie: 'server-cookie',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'disabled' as const,
      updatedAt: 0, generation: 3,
    }
    await withGlobalFetch(async () => {
      const { service, workbenchFetch } = await typertServiceFor({ auth })

      const first = await service.workbenchLaunch('a')
      const second = await service.workbenchLaunch('a')

      expect(first).toEqual({ url: 'http://127.0.0.1:51777/?token=current-token-abcdef', authGeneration: 3 })
      expect(second).toEqual(first)
      // No discovery, no generation churn: the server cookie is still the one
      // the connection layer keeps using.
      expect(discoverRemoteDshLaunchToken).not.toHaveBeenCalled()
      expect(service.statuses()[0]).toMatchObject({ state: 'READY', dshAuthGeneration: 3 })

      // Each browser then performs its OWN official exchange with that token.
      // The server's validation minted its own cookie and discarded it, so the
      // two browser cookie jars are independent and both valid.
      const token = new URL(first.url).searchParams.get('token')!
      const browserJar = async (label: string) => {
        const calls: string[] = []
        const session = await exchangeDshLaunchToken(
          new URL('http://127.0.0.1:51777'),
          token,
          {
            fetch: (async (input: Parameters<typeof fetch>[0]) => {
              calls.push(String(input))
              return mintedCookie(label)
            }) as unknown as typeof fetch,
          },
        )
        return { session, calls }
      }
      const browserA = await browserJar('browser-a')
      const browserB = await browserJar('browser-b')

      expect(browserA.calls).toEqual(['http://127.0.0.1:51777/?token=current-token-abcdef'])
      expect(browserB.calls).toEqual(browserA.calls)
      expect(browserA.session.cookie).toBe(dshCookieName('127.0.0.1:51777') + '=minted-browser-a')
      expect(browserB.session.cookie).toBe(dshCookieName('127.0.0.1:51777') + '=minted-browser-b')
      expect(browserA.session.cookie).not.toBe(browserB.session.cookie)
      // The server's persisted cookie is whatever the registry already held; it
      // was never relayed, replaced or used to satisfy a browser.
      expect(workbenchFetch.mock.calls.some(([url]) => String(url).includes('minted-browser-a'))).toBe(false)
      await service.onApplicationShutdown()
    })
  })

  it('fails closed to manual recovery without scanning or exposing discovery output', async () => {
    const auth = {
      version: 1 as const, launchToken: 'stale-token-abcdefg',
      cookieAuthority: '127.0.0.1:51777', cookieExpiresAt: Date.now() + 60_000, autoDiscovery: 'ohmydsh-log' as const,
      updatedAt: 0, generation: 5,
    }
    // A real bounded-reader failure, with hostile text that must never surface.
    discoverRemoteDshLaunchToken.mockResolvedValue({
      ok: false,
      reason: 'invalid-output',
      diagnostic: 'token=leaked-secret-abcdef https://evil.test/',
    } as never)
    await withGlobalFetch(async () => {
      const { service } = await typertServiceFor({
        auth,
        validation: url => url.includes('?token=') ? exchangeRejected() : challenge(),
      })

      const failure = await service.workbenchLaunch('a').catch((cause: unknown) => cause as Error)
      expect(failure).toMatchObject({ code: 'workbench-auth-required' })
      expect(String(failure.message)).not.toMatch(/leaked-secret|evil\.test|invalid-output/u)
      // Exactly one bounded reader, with the registered port — never a scan.
      expect(discoverRemoteDshLaunchToken).toHaveBeenCalledTimes(1)
      expect(discoverRemoteDshLaunchToken.mock.calls[0]?.[0]).toBe('a-alias')
      expect(discoverRemoteDshLaunchToken.mock.calls[0]?.[1]).toBe(3080)
      await service.onApplicationShutdown()
    })
  })
