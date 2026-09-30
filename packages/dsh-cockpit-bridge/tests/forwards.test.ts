import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CockpitForwardsService, ForwardHandle, ForwardNotice, ForwardsSnapshot } from '@dsh-cockpit/shared'

/** `cockpitBridge.forwards` (device-forward-registry D4(a), D7). Same fakes as
 * client.test.ts, plus page lifecycle events and parent postMessage capture. */

const COCKPIT_ORIGIN = 'http://127.0.0.1:4317'
const CAPABILITY = 'short-lived-capability'
const SERVICE = 'cockpitBridge.forwards'

const json = (status: number, body: unknown): Pick<Response, 'ok' | 'status' | 'json'> => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

class FakeWindow {
  readonly parentPostMessage = vi.fn()
  readonly open = vi.fn()
  readonly parent: unknown = { postMessage: (...args: unknown[]) => { this.parentPostMessage(...args) } }
  readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener as (event: unknown) => void)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener as (event: unknown) => void)
  }

  emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  emitMessage(data: unknown, source: unknown = this.parent, origin = COCKPIT_ORIGIN): void {
    this.emit('message', { data, source, origin })
  }
}

function fakeCtx() {
  const services = new Map<string, unknown>()
  const cleanups: Array<() => void> = []
  let effectFn: (() => () => void) | undefined
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} } },
    provide: (name: string, value: unknown) => { services.set(name, value); return () => { services.delete(name) } },
    effect: (fn: () => () => void) => {
      effectFn ??= fn
      cleanups.push(fn())
    },
  }
  return {
    ctx,
    service: () => services.get(SERVICE) as CockpitForwardsService | undefined,
    dispose: () => { for (const cleanup of cleanups.splice(0)) cleanup() },
  }
}

const fakeWindow = () => window as unknown as FakeWindow
const configure = () => fakeWindow().emitMessage({ type: 'dsh-cockpit:bridge-config', cockpitOrigin: COCKPIT_ORIGIN, capability: CAPABILITY })

function snapshot(rows: Array<{ devicePort: number; state: string; localPort?: number; holders?: string[] }>): ForwardsSnapshot {
  return {
    rows: [
      { kind: 'system', devicePort: 3080, state: 'ready', localPort: 52000 },
      ...rows.map(row => ({
        kind: 'additional' as const,
        devicePort: row.devicePort,
        state: row.state as 'ready',
        pinned: false,
        holders: row.holders ?? ['memex-browse:default'],
        holderCount: (row.holders ?? ['memex-browse:default']).length,
        ...(row.localPort === undefined ? {} : { localPort: row.localPort }),
      })),
    ],
    additionalCount: rows.length,
    limit: 8,
  }
}

const pushSnapshot = (value: ForwardsSnapshot, origin = COCKPIT_ORIGIN) =>
  fakeWindow().emitMessage({ type: 'dsh-cockpit:forwards-snapshot', snapshot: value }, fakeWindow().parent, origin)

const forwardsCalls = (suffix: 'acquire' | 'release') => fetchMock.mock.calls
  .filter(([url]) => String(url) === `${COCKPIT_ORIGIN}/api/bridge/forwards/${suffix}`)
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>)

const fetchMock = vi.fn()

async function loaded() {
  const fixture = fakeCtx()
  const mod = await import('../src/client/index.js')
  ;(mod.apply as (ctx: unknown) => void)(fixture.ctx)
  return fixture
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/api/bridge/forwards/acquire')) return json(200, { devicePort: 3939, state: 'starting' })
    return json(200, {})
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', new FakeWindow())
})

afterEach(() => {
  fetchMock.mockReset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('cockpitBridge.forwards', () => {
  it('throws unavailable synchronously without fetching when not configured', async () => {
    const fixture = await loaded()
    const service = fixture.service()!
    expect(service).toBeDefined()
    expect(() => service.acquire(3939, 'memex-browse:default')).toThrow(expect.objectContaining({ code: 'unavailable' }))
    expect(() => service.list()).toThrow(expect.objectContaining({ code: 'unavailable' }))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchMock).not.toHaveBeenCalled()
    fixture.dispose()
  })

  it('returns starting immediately and notifies ready with loopback address and URL', async () => {
    const fixture = await loaded()
    configure()
    const service = fixture.service()!
    const handle = await service.acquire(3939, 'memex-browse:default')
    expect(handle).toEqual(expect.objectContaining({ devicePort: 3939, holder: 'memex-browse:default', state: 'starting' }))
    expect(handle.address).toBeUndefined()

    const [request] = forwardsCalls('acquire')
    expect(request).toEqual(expect.objectContaining({ devicePort: 3939, holder: 'memex-browse:default' }))
    expect(request!.instanceId).toMatch(/^[A-Za-z0-9_-]{22,64}$/)
    expect(request).not.toHaveProperty('pageId')

    const notices: ForwardNotice[] = []
    handle.onChange(notice => { notices.push(notice) })
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 54321 }]))
    expect(notices).toEqual([{ devicePort: 3939, state: 'ready', address: { host: '127.0.0.1', port: 54321, url: 'http://127.0.0.1:54321' } }])
    expect(handle.state).toBe('ready')
    expect(handle.address?.url).toBe('http://127.0.0.1:54321')
    expect(service.list()?.rows).toHaveLength(2)
    fixture.dispose()
  })

  it('notifies retrying then ready with the new port when the address changes', async () => {
    const fixture = await loaded()
    configure()
    const handle = await fixture.service()!.acquire(3939, 'memex-browse:default')
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 54321 }]))
    const notices: ForwardNotice[] = []
    handle.onChange(notice => { notices.push(notice) })

    // An unrelated change (another entry appears) is not this holder's news.
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 54321 }, { devicePort: 5432, state: 'starting' }]))
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'retrying' }]))
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 60001 }]))
    expect(notices.map(notice => [notice.state, notice.address?.port])).toEqual([['retrying', undefined], ['ready', 60001]])
    fixture.dispose()
  })

  it('ignores a forwards snapshot from a non-cockpit origin', async () => {
    const fixture = await loaded()
    configure()
    const service = fixture.service()!
    const handle = await service.acquire(3939, 'memex-browse:default')
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 54321 }]))
    const notices: ForwardNotice[] = []
    const snapshots: ForwardsSnapshot[] = []
    handle.onChange(notice => { notices.push(notice) })
    service.subscribe(value => { snapshots.push(value) })

    pushSnapshot(snapshot([]), 'http://127.0.0.1:9999')
    fakeWindow().emitMessage({ type: 'dsh-cockpit:forwards-snapshot', snapshot: snapshot([]) }, {}, COCKPIT_ORIGIN)
    expect(notices).toEqual([])
    expect(snapshots).toEqual([])
    expect(service.list()?.rows.map(row => row.devicePort)).toEqual([3080, 3939])
    expect(handle.state).toBe('ready')
    fixture.dispose()
  })

  it('notifies removed when a snapshot drops the entry and does not re-acquire within 60s', async () => {
    const fixture = await loaded()
    configure()
    const handle = await fixture.service()!.acquire(3939, 'memex-browse:default')
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 54321 }]))
    const notices: ForwardNotice[] = []
    handle.onChange(notice => { notices.push(notice) })

    pushSnapshot(snapshot([]))
    expect(notices).toEqual([{ devicePort: 3939, state: 'removed' }])
    expect(handle.state).toBe('removed')
    const acquiresBefore = forwardsCalls('acquire').length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(forwardsCalls('acquire')).toHaveLength(acquiresBefore)
    // A later snapshot with the port again (someone else acquired it) does
    // not resurrect this dropped holder.
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 54321, holders: ['other'] }]))
    expect(notices).toHaveLength(1)
    fixture.dispose()
  })

  it('surfaces forward-limit from a 409 without renewing or retrying', async () => {
    const fixture = await loaded()
    configure()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/bridge/forwards/acquire')) return json(409, { code: 'forward-limit' })
      return json(200, {})
    })
    await expect(fixture.service()!.acquire(3939, 'memex-browse:default')).rejects.toMatchObject({ code: 'forward-limit' })

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/bridge/forwards/acquire')) return json(409, { code: 'device-unavailable' })
      return json(200, {})
    })
    await expect(fixture.service()!.acquire(3939, 'memex-browse:default')).rejects.toMatchObject({ code: 'device-unavailable' })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(forwardsCalls('acquire')).toHaveLength(2)
    // No capability renewal was requested for a business rejection.
    expect(fakeWindow().parentPostMessage.mock.calls.filter(([message]) => (message as { type?: string }).type === 'dsh-cockpit:capability-expired')).toEqual([])
    fixture.dispose()
  })

  it('switches to a fresh instance id on persisted pageshow and acquires with it', async () => {
    const fixture = await loaded()
    configure()
    const service = fixture.service()!
    const first = await service.acquire(3939, 'memex-browse:default')
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 54321 }]))
    const notices: ForwardNotice[] = []
    first.onChange(notice => { notices.push(notice) })
    const i1 = forwardsCalls('acquire')[0]!.instanceId

    // bfcache: pagehide ends I1 through the parent, to the handshaken origin.
    fakeWindow().emit('pagehide', { persisted: true })
    const ended = fakeWindow().parentPostMessage.mock.calls.filter(([message]) => (message as { type?: string }).type === 'dsh-cockpit:bridge-instance-ended')
    expect(ended).toEqual([[{ type: 'dsh-cockpit:bridge-instance-ended', instanceId: i1 }, COCKPIT_ORIGIN]])

    // A non-persisted pageshow (first load) changes nothing.
    fakeWindow().emit('pageshow', { persisted: false })
    expect(notices).toEqual([])

    fakeWindow().emit('pageshow', { persisted: true })
    // The old holder is dropped locally and told so; I1 is never used again.
    expect(notices).toEqual([{ devicePort: 3939, state: 'removed' }])
    const second: ForwardHandle = await service.acquire(3939, 'memex-browse:default')
    const i2 = forwardsCalls('acquire')[1]!.instanceId
    expect(i2).not.toBe(i1)
    expect(second.state).toBe('starting')
    await service.release(first)
    expect(forwardsCalls('release')).toEqual([])

    // Dispose also ends the live instance.
    fixture.dispose()
    const endedAfter = fakeWindow().parentPostMessage.mock.calls.filter(([message]) => (message as { type?: string }).type === 'dsh-cockpit:bridge-instance-ended')
    expect(endedAfter.at(-1)).toEqual([{ type: 'dsh-cockpit:bridge-instance-ended', instanceId: i2 }, COCKPIT_ORIGIN])
  })

  it('releases a held forward with the same instance id and holder', async () => {
    const fixture = await loaded()
    configure()
    const service = fixture.service()!
    const handle = await service.acquire(3939, 'memex-browse:default')
    const notices: ForwardNotice[] = []
    handle.onChange(notice => { notices.push(notice) })
    await service.release(handle)
    const [acquired] = forwardsCalls('acquire')
    expect(forwardsCalls('release')).toEqual([{ devicePort: 3939, holder: 'memex-browse:default', instanceId: acquired!.instanceId }])
    expect(notices).toEqual([{ devicePort: 3939, state: 'removed' }])
    // Released handles no longer react to snapshots.
    pushSnapshot(snapshot([{ devicePort: 3939, state: 'ready', localPort: 54321 }]))
    expect(notices).toHaveLength(1)
    fixture.dispose()
  })
})
