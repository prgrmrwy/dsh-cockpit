import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Every socket entry point of node:net is observable: the table must stay out
// of the data path entirely (design D2 — ssh owns the listening socket).
const netCalls = vi.hoisted(() => [] as string[])
vi.mock('node:net', async importOriginal => {
  const actual = await importOriginal<typeof import('node:net')>()
  const watch = <T extends (...args: never[]) => unknown>(name: string, fn: T) =>
    ((...args: Parameters<T>) => { netCalls.push(name); return fn(...args) }) as T
  const patched = {
    ...actual,
    createServer: watch('createServer', actual.createServer),
    createConnection: watch('createConnection', actual.createConnection),
    connect: watch('connect', actual.connect),
  }
  return { ...patched, default: patched }
})

import { DeviceForwards, ForwardRejection, type ForwardChannelConnector, type ForwardChannelRequest } from '../src/connectivity/forward-table.js'
import { TunnelManager } from '../src/connectivity/tunnel-manager.js'
import type { OwnedProcess } from '../src/connectivity/ssh.js'

/** One fake ssh child handed out by the connector. */
interface FakeChannel {
  readonly request: ForwardChannelRequest
  readonly localPort: number
  readonly pid: number
  disposed: boolean
  /** Model the child dying on its own after it was reported ready. */
  die(diagnostic: string): void
}

/** The D2 seam: the table drives processes only through connect/dispose and
 * the post-ready exit callback. `hold` parks connects so a test can observe
 * `starting` and finish them by hand. */
class FakeConnector implements ForwardChannelConnector {
  readonly requests: ForwardChannelRequest[] = []
  readonly channels: FakeChannel[] = []
  readonly #parked: { resolve: () => void; reject: (cause: Error) => void }[] = []
  hold = false
  failWith: string | undefined
  #nextPort = 52000
  #nextPid = 9000

  async connect(request: ForwardChannelRequest) {
    this.requests.push(request)
    if (this.hold) {
      await new Promise<void>((resolve, reject) => { this.#parked.push({ resolve, reject }) })
    }
    if (this.failWith !== undefined) throw new Error(this.failWith)
    const channel: FakeChannel = {
      request,
      localPort: this.#nextPort++,
      pid: this.#nextPid++,
      disposed: false,
      die: diagnostic => {
        channel.disposed = true
        request.onExit?.({ deviceId: request.deviceId, channelId: request.channelId, generation: 1, diagnostic })
      },
    }
    this.channels.push(channel)
    return {
      localPort: channel.localPort,
      pid: channel.pid,
      dispose: async () => { channel.disposed = true },
    }
  }

  /** Finish every parked connect (successfully unless failWith is set). */
  release(): void {
    for (const parked of this.#parked.splice(0)) parked.resolve()
  }

  live(): FakeChannel[] { return this.channels.filter(channel => !channel.disposed) }
}

const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() }

function holder(label: string, pageId = 'page-aaaaaaaaaaaaaaaa', instanceId = 'inst-aaaaaaaaaaaaaaaa') {
  return { pageId, instanceId, holder: label }
}

function table(connector: FakeConnector, overrides: Partial<ConstructorParameters<typeof DeviceForwards>[0]> = {}) {
  return new DeviceForwards({
    deviceId: 'a',
    kind: 'remote',
    sshAlias: 'vm-a',
    remoteDshPort: 3080,
    connector,
    mainAvailable: true,
    random: () => 0.5,
    ...overrides,
  })
}

const additional = (forwards: DeviceForwards) => forwards.projection()

afterEach(() => { vi.useRealTimers() })

describe('forward table: one entry per device port', () => {
  it('reuses one entry per device port and spawns once under concurrent acquires', async () => {
    const connector = new FakeConnector()
    connector.hold = true
    const forwards = table(connector)

    const first = forwards.acquire(3939, holder('h1', 'page-aaaaaaaaaaaaaaaa', 'inst-1111111111111111'))
    const second = forwards.acquire(3939, holder('h2', 'page-aaaaaaaaaaaaaaaa', 'inst-2222222222222222'))
    // Same identity again: idempotent, no extra holder.
    forwards.acquire(3939, holder('h1', 'page-aaaaaaaaaaaaaaaa', 'inst-1111111111111111'))

    expect(first.state).toBe('starting')
    expect(second.state).toBe('starting')
    expect(first.localPort).toBeUndefined()
    connector.release()
    await settle()

    expect(connector.requests).toHaveLength(1)
    expect(connector.requests[0]).toMatchObject({ deviceId: 'a', sshAlias: 'vm-a', channelId: 'fwd-3939', remoteDshPort: 3939 })
    const rows = additional(forwards)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ devicePort: 3939, state: 'ready', holderCount: 2, holders: ['h1', 'h2'], pinned: false })
    expect(rows[0]!.localPort).toBe(connector.channels[0]!.localPort)
    expect(rows[0]!.pid).toBe(connector.channels[0]!.pid)
    expect(forwards.acquire(3939, holder('h1', 'page-aaaaaaaaaaaaaaaa', 'inst-1111111111111111'))).toEqual({
      devicePort: 3939, state: 'ready', localPort: connector.channels[0]!.localPort,
    })
    await forwards.terminate()
  })

  it('admits exactly one of two concurrent acquires at 7 of 8', async () => {
    const connector = new FakeConnector()
    connector.hold = true
    const forwards = table(connector)
    for (let port = 4001; port <= 4007; port += 1) forwards.acquire(port, holder(`h${port}`))

    // Both arrive while every earlier start is still in flight: the cap must
    // count entries that are only `starting`, not just the ready ones.
    const outcomes = [5001, 5002].map(port => {
      try { return forwards.acquire(port, holder(`n${port}`)).devicePort } catch (error) { return error }
    })

    expect(outcomes[0]).toBe(5001)
    expect(outcomes[1]).toBeInstanceOf(ForwardRejection)
    expect((outcomes[1] as ForwardRejection).code).toBe('forward-limit')
    expect(forwards.projection()).toHaveLength(8)
    expect(connector.requests.map(request => request.remoteDshPort)).not.toContain(5002)
    expect(connector.requests).toHaveLength(8)
    connector.release()
    await forwards.terminate()
  })

  it('rejects invalid, reserved and local-device ports without touching the table', async () => {
    const connector = new FakeConnector()
    const remote = table(connector)
    const local = table(connector, { deviceId: 'local', kind: 'local', sshAlias: undefined })
    const codeOf = (run: () => unknown) => {
      try { run(); return 'accepted' } catch (error) { return error instanceof ForwardRejection ? error.code : String(error) }
    }

    expect([
      codeOf(() => remote.acquire(0, holder('h'))),
      codeOf(() => remote.acquire(65536, holder('h'))),
      codeOf(() => remote.acquire(3939.5, holder('h'))),
      codeOf(() => remote.acquire('3939' as unknown as number, holder('h'))),
      codeOf(() => remote.acquire(3080, holder('h'))),
      codeOf(() => local.acquire(3939, holder('h'))),
    ]).toEqual(['invalid-port', 'invalid-port', 'invalid-port', 'invalid-port', 'reserved-port', 'local-device'])

    await settle()
    expect(remote.projection()).toEqual([])
    expect(local.projection()).toEqual([])
    expect(connector.requests).toEqual([])
  })
})

describe('forward table: pinned and held lifetimes', () => {
  it('reclaims a held entry after its last holder and keeps a pinned one', async () => {
    const connector = new FakeConnector()
    const forwards = table(connector)
    const a = holder('A', 'page-aaaaaaaaaaaaaaaa', 'inst-aaaaaaaaaaaaaaaa')
    const b = holder('B', 'page-aaaaaaaaaaaaaaaa', 'inst-bbbbbbbbbbbbbbbb')
    const c = holder('C', 'page-cccccccccccccccc', 'inst-cccccccccccccccc')
    forwards.acquire(3939, a)
    forwards.acquire(3939, b)
    forwards.pin(5432, 'db')
    forwards.acquire(5432, c)
    await settle()
    const child3939 = connector.channels.find(channel => channel.request.remoteDshPort === 3939)!
    const child5432 = connector.channels.find(channel => channel.request.remoteDshPort === 5432)!
    const row = (port: number) => forwards.projection().find(candidate => candidate.devicePort === port)

    await forwards.release(3939, a)
    expect(row(3939)).toMatchObject({ state: 'ready', holderCount: 1, holders: ['B'] })
    expect(child3939.disposed).toBe(false)

    await forwards.release(3939, b)
    expect(row(3939)).toBeUndefined()
    expect(child3939.disposed).toBe(true)

    await forwards.release(5432, c)
    expect(row(5432)).toMatchObject({ state: 'ready', pinned: true, label: 'db', holderCount: 0 })
    expect(child5432.disposed).toBe(false)

    const before = forwards.projection()
    await forwards.release(3939, a)
    await forwards.release(5432, a)
    expect(forwards.projection()).toEqual(before)
    expect(connector.requests).toHaveLength(2)
    await forwards.terminate()
  })

  it('kills the child that finishes starting after its entry was deleted', async () => {
    const connector = new FakeConnector()
    connector.hold = true
    const forwards = table(connector)
    forwards.pin(3939)
    forwards.acquire(3939, holder('H'))
    expect(forwards.projection()[0]).toMatchObject({ state: 'starting', pinned: true, holderCount: 1 })

    await forwards.remove(3939)
    expect(forwards.projection()).toEqual([])
    connector.release()
    await settle()

    expect(connector.channels).toHaveLength(1)
    expect(connector.channels[0]!.disposed).toBe(true)
    expect(forwards.projection()).toEqual([])
    // Deleting a missing entry is idempotent.
    await forwards.remove(3939)
    expect(forwards.projection()).toEqual([])
  })
})

describe('forward table: self-heal', () => {
  it('marks a ready entry retrying without an address and rebuilds it after backoff', async () => {
    vi.useFakeTimers()
    const connector = new FakeConnector()
    // random() = 0.5 is the neutral jitter point: delays are exactly 1s, 2s, 4s.
    const forwards = table(connector)
    forwards.acquire(3939, holder('H'))
    await settle()
    expect(forwards.projection()[0]).toMatchObject({ state: 'ready', localPort: 52000, pid: 9000 })

    connector.channels[0]!.die('Connection reset by peer')
    const retrying = forwards.projection()[0]!
    expect(retrying).toMatchObject({ state: 'retrying', diagnostic: 'Connection reset by peer', holderCount: 1 })
    expect(retrying.localPort).toBeUndefined()
    expect(retrying.pid).toBeUndefined()

    // Establishment itself fails twice: 1s, then 2s, then 4s later it lands.
    connector.failWith = 'bind: Address already in use'
    await vi.advanceTimersByTimeAsync(999)
    expect(connector.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(connector.requests).toHaveLength(2)
    expect(forwards.projection()[0]).toMatchObject({ state: 'retrying', diagnostic: 'bind: Address already in use' })
    await vi.advanceTimersByTimeAsync(1999)
    expect(connector.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(connector.requests).toHaveLength(3)
    connector.failWith = undefined
    await vi.advanceTimersByTimeAsync(4000)
    expect(connector.requests).toHaveLength(4)
    expect(forwards.projection()[0]).toMatchObject({ state: 'ready', localPort: 52001, pid: 9001 })

    await forwards.terminate()
  })

  it('caps the backoff at 60s and applies the injected jitter', async () => {
    vi.useFakeTimers()
    const connector = new FakeConnector()
    connector.failWith = 'ssh: connect to host vm-a: Connection refused'
    // random() = 1 is the top of the ±20% jitter band.
    const forwards = table(connector, { random: () => 1 })
    forwards.acquire(3939, holder('H'))
    await settle()
    expect(connector.requests).toHaveLength(1)
    // 1.2s, 2.4s, 4.8s, 9.6s, 19.2s, 38.4s, then capped: 60s * 1.2 = 72s.
    for (const delay of [1200, 2400, 4800, 9600, 19200, 38400, 72000, 72000]) {
      const before = connector.requests.length
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(connector.requests).toHaveLength(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(connector.requests).toHaveLength(before + 1)
    }
    await forwards.terminate()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(connector.requests).toHaveLength(9)
  })

  it('pauses self-heal while the workbench channel is unavailable and rebuilds on READY', async () => {
    vi.useFakeTimers()
    const connector = new FakeConnector()
    const forwards = table(connector)
    forwards.acquire(3939, holder('H'))
    forwards.pin(5432)
    await settle()
    const [child3939, child5432] = connector.channels

    // Workbench enters its reconnect backoff; live children are left alone.
    forwards.setMainAvailable(false)
    expect(forwards.projection().map(row => [row.devicePort, row.state, row.pid])).toEqual([
      [3939, 'ready', child3939!.pid],
      [5432, 'ready', child5432!.pid],
    ])
    expect(child3939!.disposed).toBe(false)

    // 3939 then dies: it needs a rebuild, which must wait for the workbench.
    child3939!.die('Timeout, server vm-a not responding.')
    // A brand-new entry requested meanwhile waits too.
    forwards.acquire(6000, holder('H'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(connector.requests).toHaveLength(2)
    const paused = forwards.projection().find(row => row.devicePort === 3939)!
    expect(paused).toMatchObject({ state: 'paused', diagnostic: 'Timeout, server vm-a not responding.' })
    expect(paused.localPort).toBeUndefined()
    expect(forwards.projection().find(row => row.devicePort === 6000)).toMatchObject({ state: 'paused' })
    expect(forwards.projection().find(row => row.devicePort === 5432)).toMatchObject({ state: 'ready', pid: child5432!.pid })

    forwards.setMainAvailable(true)
    await settle()
    expect(connector.requests.map(request => request.remoteDshPort).slice(2).sort()).toEqual([3939, 6000])
    expect(forwards.projection().map(row => row.state)).toEqual(['ready', 'ready', 'ready'])
    await forwards.terminate()
  })
})

describe('forward table: data hygiene', () => {
  it('rejects a newline holder and a 65-char label and truncates a 5000-char diagnostic to 300', async () => {
    vi.useFakeTimers()
    const connector = new FakeConnector()
    const forwards = table(connector)
    const codeOf = (run: () => unknown) => {
      try { run(); return 'accepted' } catch (error) { return error instanceof ForwardRejection ? error.code : String(error) }
    }

    expect(codeOf(() => forwards.acquire(3939, holder('memex\nbrowse')))).toBe('invalid-holder')
    expect(codeOf(() => forwards.acquire(3939, holder('')))).toBe('invalid-holder')
    expect(codeOf(() => forwards.acquire(3939, holder('x'.repeat(65))))).toBe('invalid-holder')
    expect(codeOf(() => forwards.acquire(3939, holder('ok', 'short')))).toBe('invalid-holder')
    expect(codeOf(() => forwards.acquire(3939, holder('ok', 'page-aaaaaaaaaaaaaaaa', 'inst/../aaaaaaaaaaaa')))).toBe('invalid-holder')
    expect(codeOf(() => forwards.pin(5432, 'x'.repeat(65)))).toBe('invalid-label')
    expect(codeOf(() => forwards.pin(5432, 'tab\there'))).toBe('invalid-label')
    expect(forwards.projection()).toEqual([])
    expect(connector.requests).toEqual([])

    expect(codeOf(() => forwards.acquire(7000, holder('x'.repeat(64))))).toBe('accepted')
    await settle()
    connector.channels[0]!.die('e'.repeat(5000))
    const row = forwards.projection()[0]!
    expect(row.diagnostic).toHaveLength(300)
    await forwards.terminate()
  })
})

/** Minimal owned ssh child for driving the real TunnelManager argv. */
class FakeSsh implements OwnedProcess {
  readonly stderr = new Readable({ read() {} })
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly killed: string[] = []
  #exit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void
  constructor(readonly pid: number) {
    this.exited = new Promise(resolve => { this.#exit = resolve })
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.killed.push(signal ?? 'SIGTERM')
    this.#exit({ code: null, signal: signal ?? 'SIGTERM' })
    return true
  }
}

describe('forward table: out of the data path', () => {
  it('spawns ssh -L to device loopback and never opens the forwarded port itself', async () => {
    // 1. The table on its own, across its whole lifecycle, touches no socket.
    netCalls.length = 0
    const connector = new FakeConnector()
    const alone = table(connector)
    alone.acquire(3939, holder('H'))
    alone.pin(5432, 'db')
    await settle()
    alone.projection()
    await alone.release(3939, holder('H'))
    await alone.terminate()
    expect(netCalls).toEqual([])

    // 2. Through the real TunnelManager, the child is exactly one loopback-to-
    //    loopback `ssh -L` with the argv `--` boundary before the alias.
    const spawned: string[][] = []
    const children: FakeSsh[] = []
    const tunnels = new TunnelManager({
      sshExecutable: '/usr/bin/ssh',
      spawn: (_exe, argv) => { spawned.push(argv); const child = new FakeSsh(4242); children.push(child); return child },
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    const forwards = table(connector, { connector: tunnels })
    forwards.acquire(3939, holder('H'))
    await vi.waitFor(() => { expect(forwards.projection()[0]?.state).toBe('ready') }, { timeout: 2000 })

    expect(spawned).toHaveLength(1)
    const argv = spawned[0]!
    const forward = argv[argv.indexOf('-L') + 1]!
    const local = forwards.projection()[0]!.localPort!
    expect(forward).toBe(`127.0.0.1:${local}:127.0.0.1:3939`)
    expect(argv.slice(-2)).toEqual(['--', 'vm-a'])
    expect(forwards.projection()[0]!.pid).toBe(4242)

    await forwards.terminate()
    expect(children[0]!.killed).not.toEqual([])
    await tunnels.disposeAll()
  })
})
