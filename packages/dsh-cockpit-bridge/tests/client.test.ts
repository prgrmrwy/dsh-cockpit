import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SessionListStateLike { current: string | undefined }

const COCKPIT_ORIGIN = 'http://127.0.0.1:4317'
const CAPABILITY = 'short-lived-capability'
const ok = (status = 200): Pick<Response, 'ok' | 'status'> => ({ ok: status >= 200 && status < 300, status })
const failResponse = (status: number, code?: string): Pick<Response, 'ok' | 'status' | 'json'> => ({
  ok: false,
  status,
  json: async () => (code === undefined ? {} : { code }),
})

class FakeWindow {
  readonly parentPostMessage = vi.fn()
  readonly open = vi.fn()
  readonly parent: unknown = { postMessage: (...args: unknown[]) => { this.parentPostMessage(...args) } }
  readonly listeners = new Set<(event: MessageEvent) => void>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.listeners.add(listener as (event: MessageEvent) => void)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.listeners.delete(listener as (event: MessageEvent) => void)
  }

  emitMessage(data: unknown, source: unknown = this.parent, origin = COCKPIT_ORIGIN): void {
    for (const listener of [...this.listeners]) listener({ data, source, origin } as MessageEvent)
  }
}

function fakeCtx(initial = { current: undefined }, initialPending?: ReadonlyMap<string, { sessionId: string; kind: 'approval' | 'question'; key: string }>) {
  const listeners = new Set<() => void>()
  let snapshot: SessionListStateLike = { ...initial }
  let pending = initialPending
  const pendingListeners = new Set<() => void>()
  let cleanup: (() => void) | undefined
  const services = new Map<string, unknown>()
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
      },
    },
    ...(pending === undefined ? {} : { uiSession: { pendingInteractions: {
      getSnapshot: () => pending as ReadonlyMap<string, { sessionId: string; kind: 'approval' | 'question'; key: string }>,
      subscribe: (fn: () => void) => { pendingListeners.add(fn); return () => { pendingListeners.delete(fn) } },
    } } }),
    provide: (name: string, value: unknown) => { services.set(name, value); return () => { services.delete(name) } },
    // No `slots` service here: the optional settings section never mounts.
    inject: () => {},
    effect: (fn: () => () => void) => { cleanup = fn() },
  }
  return {
    ctx,
    set: (current: string | undefined) => {
      snapshot = { current }
      for (const fn of [...listeners]) fn()
    },
    setPending: (next: ReadonlyMap<string, { sessionId: string; kind: 'approval' | 'question'; key: string }>) => {
      pending = next
      for (const fn of [...pendingListeners]) fn()
    },
    getService: <T>(name: string): T | undefined => services.get(name) as T | undefined,
    cleanup: () => { cleanup?.(); services.clear() },
  }
}

async function loadApply(): Promise<(ctx: unknown) => void> {
  const mod = await import('../src/client/index.js')
  return mod.apply as (ctx: unknown) => void
}

function configure(fakeWindow = window as unknown as FakeWindow, sshAlias?: string): void {
  fakeWindow.emitMessage({
    type: 'dsh-cockpit:bridge-config',
    cockpitOrigin: COCKPIT_ORIGIN,
    capability: CAPABILITY,
    ...(sshAlias === undefined ? {} : { sshAlias }),
  })
}

function callsFor(path: string): Array<[string, RequestInit]> {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path)) as Array<[string, RequestInit]>
}

function bodiesFor(path: string): Array<Record<string, unknown>> {
  return callsFor(path).map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>)
}

const fetchMock = vi.fn()

describe('cockpit bridge client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', new FakeWindow())
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports the session the DSH UI has open, not the first retained one', async () => {
    // 0.2.0 keeps `retainedBy.mainView` as a retention COUNT, so several
    // sessions can carry it and list order cannot identify the open session.
    // The official UI exposes that binding as `uiSession.adapter.current`; a
    // wrong guess acknowledges a completion the user never saw, which is
    // exactly how the cockpit loses its 「已完成」 reminder.
    const fixture = fakeCtx({ current: 'A' }, new Map())
    const retained = Object.fromEntries(['A', 'B'].map(id => [id, { id, retainedBy: { mainView: 1 } }]))
    Object.assign(fixture.ctx.sessions.list, { getSnapshot: () => ({ byId: retained }) })
    const bindingListeners = new Set<() => void>()
    let binding: string | undefined = 'B'
    const pending = fixture.ctx.uiSession!.pendingInteractions
    Object.assign(fixture.ctx, { uiSession: { pendingInteractions: pending, adapter: { current: {
      getSnapshot: () => ({ key: binding }),
      subscribe: (fn: () => void) => { bindingListeners.add(fn); return () => { bindingListeners.delete(fn) } },
    } } } })

    const apply = await loadApply()
    apply(fixture.ctx)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    // Both the hello and the acknowledgement must name the open session (B),
    // never the first retained row (A).
    expect(bodiesFor('/api/bridge/hello')[0]?.current).toBe('B')
    expect(bodiesFor('/api/bridge/session-opened').map(row => row.current)).toEqual(['B'])

    // Switching the open session in the DSH UI is reported even when the
    // retention set and the list order do not change at all.
    binding = 'A'
    for (const fn of [...bindingListeners]) fn()
    await vi.advanceTimersByTimeAsync(250)
    expect(bodiesFor('/api/bridge/session-opened').map(row => row.current)).toEqual(['B', 'A'])

    // Closing the session reports "no selection" instead of a stale id.
    binding = undefined
    for (const fn of [...bindingListeners]) fn()
    await vi.advanceTimersByTimeAsync(250)
    expect(bodiesFor('/api/bridge/session-opened').map(row => row.current)).toEqual(['B', 'A', null])
    fixture.cleanup()
  })

  it('supports 0.2.0 retained mainView and sessionStatus without leaking interaction content', async () => {
    const fixture = fakeCtx({ current: 'A' }, new Map())
    const snapshot = fixture.ctx.sessions.list.getSnapshot
    Object.assign(fixture.ctx.sessions.list, { getSnapshot: () => ({
      current: 'stale-legacy',
      byId: Object.fromEntries(['A', 'B'].map(id => [id, { id, retainedBy: { mainView: snapshot().current === id ? 1 : 0 } }])),
    }) })
    const oldPending = fixture.ctx.uiSession!.pendingInteractions
    Object.assign(fixture.ctx, { uiSession: { sessionStatus: {
      getSnapshot: () => new Map([...oldPending.getSnapshot()].map(([id, pendingInteraction]) => [id, { running: false, pendingInteraction }])),
      subscribe: oldPending.subscribe,
    } } })
    const apply = await loadApply()
    expect(() => apply(fixture.ctx)).not.toThrow()
    configure()
    await vi.advanceTimersByTimeAsync(0)
    expect(bodiesFor('/api/bridge/hello')[0]?.current).toBe('A')
    fixture.set('B'); fixture.set(undefined)
    await vi.advanceTimersByTimeAsync(250)
    expect(bodiesFor('/api/bridge/session-opened').map(row => row.current)).toEqual(['A', 'B', null])
    fixture.setPending(new Map([['B', { sessionId: 'B', kind: 'question', key: 'q1', secretText: 'DO_NOT_SEND' } as never]]))
    await vi.advanceTimersByTimeAsync(250)
    expect(bodiesFor('/api/bridge/pending-snapshot').at(-1)?.items).toEqual([{ sessionId: 'B', kind: 'question', key: 'q1' }])
    fixture.setPending(new Map([['B', { sessionId: 'B', kind: 'approval', key: 'a1' }]]))
    await vi.advanceTimersByTimeAsync(250)
    expect(bodiesFor('/api/bridge/pending-snapshot').at(-1)?.items).toEqual([{ sessionId: 'B', kind: 'approval', key: 'a1' }])
    fixture.setPending(new Map())
    await vi.advanceTimersByTimeAsync(250)
    expect(bodiesFor('/api/bridge/pending-snapshot').at(-1)?.items).toEqual([])
    fixture.cleanup()
    const count = fetchMock.mock.calls.length
    fixture.set('A'); fixture.setPending(new Map([['B', { sessionId: 'B', kind: 'question', key: 'q2' }]]))
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock.mock.calls).toHaveLength(count)
  })

  it.each([{}, { pendingInteractions: {} }, { sessionStatus: { getSnapshot: () => new Map() } }])('does not claim a pending seam when its observable is missing: %j', async uiSession => {
    const fixture = fakeCtx({ current: 'A' })
    Object.assign(fixture.ctx, { uiSession })
    const apply = await loadApply()
    expect(() => apply(fixture.ctx)).not.toThrow()
    configure(); await vi.advanceTimersByTimeAsync(0)
    expect(bodiesFor('/api/bridge/hello')).toHaveLength(1)
    expect(bodiesFor('/api/bridge/pending-snapshot')).toHaveLength(0)
    fixture.cleanup()
  })

  it('does not publish a fabricated empty snapshot for an invalid pending source', async () => {
    const fixture = fakeCtx({ current: 'A' })
    Object.assign(fixture.ctx, { uiSession: { sessionStatus: { getSnapshot: () => null, subscribe: () => () => {} } } })
    const apply = await loadApply()
    expect(() => apply(fixture.ctx)).not.toThrow()
    configure(); await vi.advanceTimersByTimeAsync(1000)
    expect(bodiesFor('/api/bridge/pending-snapshot')).toHaveLength(0)
    fixture.cleanup()
  })

  it('does not read inactive services when a pending hello completes after disposal', async () => {
    const fixture = fakeCtx({ current: 'A' })
    const apply = await loadApply(); apply(fixture.ctx)
    let finish!: (response: Pick<Response, 'ok' | 'status'>) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    configure(); await vi.advanceTimersByTimeAsync(0)
    fixture.cleanup()
    const inactiveRead = vi.fn(() => { throw Error('inactive context') })
    fixture.ctx.sessions.list.getSnapshot = inactiveRead
    finish(ok()); await vi.advanceTimersByTimeAsync(0)
    expect(inactiveRead).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resends a pending update that arrives during an in-flight snapshot', async () => {
    const fixture = fakeCtx({ current: 'A' }, new Map([['A', { sessionId: 'A', kind: 'question', key: 'first' }]]))
    const apply = await loadApply(); apply(fixture.ctx)
    let finish!: (response: Pick<Response, 'ok' | 'status'>) => void
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/pending-snapshot') && !finish) return new Promise(resolve => { finish = resolve })
      return ok()
    })
    configure(); await vi.advanceTimersByTimeAsync(0)
    fixture.setPending(new Map())
    await vi.advanceTimersByTimeAsync(250)
    finish(ok()); await vi.advanceTimersByTimeAsync(0)
    expect(bodiesFor('/api/bridge/pending-snapshot').map(row => row.items)).toEqual([
      [{ sessionId: 'A', kind: 'question', key: 'first' }], [],
    ])
    fixture.cleanup()
  })

  it('cleans list subscription when pending subscription rejects initialization', async () => {
    const fixture = fakeCtx({ current: 'A' }, new Map())
    const release = vi.fn()
    fixture.ctx.sessions.list.subscribe = () => release
    fixture.ctx.uiSession!.pendingInteractions.subscribe = () => { throw new Error('subscribe failed') }
    const listeners = (window as unknown as FakeWindow).listeners
    const before = listeners.size
    const apply = await loadApply()
    expect(() => apply(fixture.ctx)).not.toThrow()
    expect(release).toHaveBeenCalledOnce()
    // 0.6 adds an independent forwards page-instance effect that owns its own
    // window listeners; only the status effect's message listener must be absent.
    const fakeWindow = window as unknown as FakeWindow
    fakeWindow.emitMessage({ type: 'dsh-cockpit:bridge-config', cockpitOrigin: COCKPIT_ORIGIN, capability: CAPABILITY })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/bridge/hello'), expect.anything())
    // Exactly the forwards page-instance listener; the status listener was never added.
    expect(listeners.size).toBe(before + 1)
  })

  it('waits for an authenticated parent config and uses its dynamic origin', async () => {
    const { ctx } = fakeCtx({ current: 'already-open' })
    const apply = await loadApply()
    apply(ctx as unknown)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchMock).not.toHaveBeenCalled()

    const fakeWindow = window as unknown as FakeWindow
    const message = {
      type: 'dsh-cockpit:bridge-config',
      cockpitOrigin: COCKPIT_ORIGIN,
      capability: CAPABILITY,
    }
    fakeWindow.emitMessage(message, {})
    fakeWindow.emitMessage(message, fakeWindow.parent, 'http://attacker.test')
    fakeWindow.emitMessage({ ...message, cockpitOrigin: `${COCKPIT_ORIGIN}/path` })
    fakeWindow.emitMessage({ ...message, cockpitOrigin: 'https://127.0.0.1:4317' }, fakeWindow.parent, 'https://127.0.0.1:4317')
    fakeWindow.emitMessage({ ...message, cockpitOrigin: 'http://localhost:4317' }, fakeWindow.parent, 'http://localhost:4317')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()

    configure(fakeWindow)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [helloUrl, helloInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(helloUrl).toBe(`${COCKPIT_ORIGIN}/api/bridge/hello`)
    expect(helloInit.credentials).toBeUndefined()
    expect(helloInit.headers).toEqual({
      'content-type': 'application/json',
      'x-dsh-cockpit-bridge-capability': CAPABILITY,
    })
    expect(JSON.parse(String(helloInit.body))).toEqual({
      version: '0.6.2',
      protocolVersion: 2,
      current: 'already-open',
    })
    expect(bodiesFor('/api/bridge/session-opened')).toEqual([{
      protocolVersion: 2,
      sessionId: 'already-open',
      current: 'already-open',
    }])
  })

  it('pins the first validated cockpit origin while allowing capability rotation', async () => {
    const { ctx } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()

    const fakeWindow = window as unknown as FakeWindow
    fakeWindow.emitMessage({
      type: 'dsh-cockpit:bridge-config',
      cockpitOrigin: 'http://127.0.0.1:9999',
      capability: 'attacker-capability',
    }, fakeWindow.parent, 'http://127.0.0.1:9999')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()

    fakeWindow.emitMessage({
      type: 'dsh-cockpit:bridge-config',
      cockpitOrigin: COCKPIT_ORIGIN,
      capability: 'rotated-capability',
    })
    await vi.advanceTimersByTimeAsync(0)
    // A pure renewal must NOT restart the hello/re-assert current: it only
    // rotates the credential. The bridge stays silent until real activation.
    expect(fetchMock).not.toHaveBeenCalled()

    fakeWindow.emitMessage({ type: 'dsh-cockpit:device-activated' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${COCKPIT_ORIGIN}/api/bridge/hello`)
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({
      'x-dsh-cockpit-bridge-capability': 'rotated-capability',
    })
  })

  it('captures rapid A/B/C selections and delivers every distinct id', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()

    set('a')
    set('b')
    set('c')
    await vi.advanceTimersByTimeAsync(249)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(bodiesFor('/api/bridge/session-opened')).toEqual([
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
      { protocolVersion: 2, sessionId: 'b', current: 'b' },
      { protocolVersion: 2, sessionId: 'c', current: 'c' },
    ])
  })

  it('keeps the captured id when archive clears current before flush', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()

    set('a')
    set(undefined)
    await vi.advanceTimersByTimeAsync(250)

    expect(bodiesFor('/api/bridge/session-opened')).toEqual([
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
      { protocolVersion: 2, current: null },
    ])
  })

  it('selection cleared resets the same-value latch so restored id reports again', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()

    set('a')
    await vi.advanceTimersByTimeAsync(250)
    set('a')
    await vi.advanceTimersByTimeAsync(250)
    set(undefined)
    await vi.advanceTimersByTimeAsync(250)
    set('a')
    await vi.advanceTimersByTimeAsync(250)

    expect(bodiesFor('/api/bridge/session-opened')).toEqual([
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
      { protocolVersion: 2, current: null },
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
    ])
  })

  it('keeps non-2xx acknowledgements and retries an unchanged current', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(ok(503)).mockResolvedValue(ok())

    set('a')
    await vi.advanceTimersByTimeAsync(250)
    expect(callsFor('/api/bridge/session-opened')).toHaveLength(1)
    set('a')
    await vi.advanceTimersByTimeAsync(250)

    expect(bodiesFor('/api/bridge/session-opened')).toEqual([
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
    ])
  })

  it('retains 401 without bootstrap or cookies and retries after a new config hello', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(ok(401)).mockResolvedValue(ok())

    set('a')
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('credentials')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/bootstrap'))).toBe(false)

    configure()
    await vi.advanceTimersByTimeAsync(0)
    expect(callsFor('/api/bridge/hello')).toHaveLength(1)
    expect(callsFor('/api/bridge/session-opened')).toHaveLength(2)
  })

  it('a capability-invalid 400 signals the parent and keeps the ack retryable until renewal', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(failResponse(400, 'bridge-capability-invalid')).mockResolvedValue(ok())

    set('a')
    await vi.advanceTimersByTimeAsync(250)
    expect(callsFor('/api/bridge/session-opened')).toHaveLength(1)
    // The bridge tells the parent that the capability died and keeps the ack.
    const fakeWindow = window as unknown as FakeWindow
    expect(fakeWindow.parentPostMessage).toHaveBeenCalledWith(
      { type: 'dsh-cockpit:capability-expired' },
      COCKPIT_ORIGIN,
    )
    // The parent renews: a fresh config resets hello and the retried ack is
    // only removed after an explicit success.
    configure()
    await vi.advanceTimersByTimeAsync(0)
    expect(callsFor('/api/bridge/hello')).toHaveLength(1)
    expect(bodiesFor('/api/bridge/session-opened')).toEqual([
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
    ])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(callsFor('/api/bridge/session-opened')).toHaveLength(2)
  })

  it('an unrecognized 400 does not claim a capability problem', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(failResponse(400, 'bad-request')).mockResolvedValue(ok())

    set('a')
    await vi.advanceTimersByTimeAsync(250)
    const fakeWindow = window as unknown as FakeWindow
    expect(fakeWindow.parentPostMessage).not.toHaveBeenCalled()
    // Still retried (bounded backoff), same as any other non-2xx.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(bodiesFor('/api/bridge/session-opened')).toHaveLength(2)
  })

  it('a pure renewal config refreshes the capability without re-asserting the current selection', async () => {
    // Regression for "green dot blinked and cleared by itself": a periodic
    // capability renewal must NOT restart the hello, which would re-assert
    // the still-open current id and wrongly acknowledge a completion the
    // user never saw. Only a real activation re-asserts.
    const { ctx, set } = fakeCtx({ current: 'a' })
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    // Initial handshake: hello + re-assert of the already-open session.
    expect(callsFor('/api/bridge/hello')).toHaveLength(1)
    expect(callsFor('/api/bridge/session-opened')).toHaveLength(1)
    fetchMock.mockClear()

    // Renewal: same origin, fresh capability — no hello, no session-opened.
    configure()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses single-flight bounded exponential retry for network failures', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()
    fetchMock.mockRejectedValue(new Error('offline'))

    set('a')
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Repeated failures cap at 30 seconds rather than growing without bound.
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000 + 16_000 + 30_000)
    const atCap = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(29_999)
    expect(fetchMock).toHaveBeenCalledTimes(atCap)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(atCap + 1)
  })

  it('times out a stuck request and retries without blocking the DSH page', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })).mockResolvedValue(ok())

    expect(() => { set('a') }).not.toThrow()
    await vi.advanceTimersByTimeAsync(250 + 10_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodiesFor('/api/bridge/session-opened').at(-1)).toMatchObject({ sessionId: 'a' })
  })

  it('activation refreshes hello and reasserts the current selection', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    set('a')
    await vi.advanceTimersByTimeAsync(250)
    fetchMock.mockClear()

    const fakeWindow = window as unknown as FakeWindow
    fakeWindow.emitMessage({ type: 'dsh-cockpit:device-activated' }, {})
    fakeWindow.emitMessage({ type: 'dsh-cockpit:device-activated' }, fakeWindow.parent, 'http://attacker.test')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()

    fakeWindow.emitMessage({ type: 'dsh-cockpit:device-activated' })
    await vi.advanceTimersByTimeAsync(0)
    expect(callsFor('/api/bridge/hello')).toHaveLength(1)
    expect(bodiesFor('/api/bridge/session-opened')).toEqual([
      { protocolVersion: 2, sessionId: 'a', current: 'a' },
    ])
  })

  it('bounds outbox capacity while preserving current and recent selections', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(ok(503))

    for (let index = 0; index < 40; index += 1) set(`s${index}`)
    await vi.advanceTimersByTimeAsync(250)
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(ok())
    ;(window as unknown as FakeWindow).emitMessage({ type: 'dsh-cockpit:device-activated' })
    await vi.advanceTimersByTimeAsync(0)

    const delivered = bodiesFor('/api/bridge/session-opened').map(body => body.sessionId)
    expect(delivered).toHaveLength(32)
    expect(delivered).toContain('s39')
    expect(delivered).toContain('s38')
    expect(delivered).not.toContain('s0')
    expect(delivered).not.toContain('s7')
  })

  it('expires stale non-current entries but preserves a freshly reasserted current', async () => {
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(ok(503))

    set('stale')
    set('current')
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(ok())
    ;(window as unknown as FakeWindow).emitMessage({ type: 'dsh-cockpit:device-activated' })
    await vi.advanceTimersByTimeAsync(0)

    expect(bodiesFor('/api/bridge/session-opened')).toEqual([
      { protocolVersion: 2, sessionId: 'current', current: 'current' },
    ])
  })

  it('publishes complete minimal pending snapshots on hello and changes', async () => {
    const first = new Map([
      ['question:q1', { sessionId: 's2', kind: 'question' as const, key: 'question:q1' }],
      ['approval:a1', { sessionId: 's1', kind: 'approval' as const, key: 'approval:a1' }],
    ])
    const fixture = fakeCtx({ current: undefined }, first)
    const apply = await loadApply()
    apply(fixture.ctx as unknown)
    configure()
    await vi.advanceTimersByTimeAsync(0)

    expect(bodiesFor('/api/bridge/pending-snapshot')).toEqual([{
      protocolVersion: 3,
      seamVersion: 1,
      items: [
        { sessionId: 's1', kind: 'approval', key: 'approval:a1' },
        { sessionId: 's2', kind: 'question', key: 'question:q1' },
      ],
    }])

    fixture.setPending(new Map())
    await vi.advanceTimersByTimeAsync(250)
    expect(bodiesFor('/api/bridge/pending-snapshot').at(-1)).toEqual({ protocolVersion: 3, seamVersion: 1, items: [] })
    fixture.cleanup()
  })

  it('provides a stable consumer-agnostic editor service and opens with the latest valid alias', async () => {
    const fixture = fakeCtx()
    const apply = await loadApply()
    apply(fixture.ctx as unknown)
    type EditorOpen = { open(path: string): void }
    const service = fixture.getService<EditorOpen>('cockpitBridge.editorOpen')
    expect(service).toBeDefined()
    expect(() => service!.open('/work/project')).toThrow('unavailable')

    const fakeWindow = window as unknown as FakeWindow
    configure(fakeWindow, 'vm-a')
    await vi.advanceTimersByTimeAsync(0)
    service!.open('/work/My Project')
    expect(fakeWindow.open).toHaveBeenCalledWith(
      'vscode://vscode-remote/ssh-remote+vm-a/work/My%20Project?windowId=_blank',
      '_blank',
    )

    fakeWindow.open.mockClear()
    configure(fakeWindow, 'vm-b')
    await vi.advanceTimersByTimeAsync(0)
    service!.open('/work/next')
    expect(fakeWindow.open).toHaveBeenCalledWith(
      'vscode://vscode-remote/ssh-remote+vm-b/work/next?windowId=_blank',
      '_blank',
    )
    fixture.cleanup()
    expect(fixture.getService('cockpitBridge.editorOpen')).toBeUndefined()
  })

  it('rejects invalid aliases and paths without opening a URI', async () => {
    const fixture = fakeCtx()
    const apply = await loadApply()
    apply(fixture.ctx as unknown)
    const service = fixture.getService<{ open(path: string): void }>('cockpitBridge.editorOpen')!
    const fakeWindow = window as unknown as FakeWindow

    configure(fakeWindow, 'user@host')
    await vi.advanceTimersByTimeAsync(0)
    expect(() => service.open('/work/project')).toThrow('unavailable')
    expect(fakeWindow.open).not.toHaveBeenCalled()

    configure(fakeWindow, 'vm-a')
    await vi.advanceTimersByTimeAsync(0)
    expect(() => service.open('relative/path')).toThrow('invalid editor path')
    expect(() => service.open('/work/../secret')).toThrow('invalid editor path')
    expect(() => service.open('C:\work\..\secret')).toThrow('invalid editor path')
    expect(fakeWindow.open).not.toHaveBeenCalled()
  })

  it('swallows persistent bridge failures and cleanup cancels pending work', async () => {
    fetchMock.mockRejectedValue(new Error('cockpit unavailable'))
    const { ctx, set, cleanup } = fakeCtx()
    const apply = await loadApply()
    expect(() => { apply(ctx as unknown) }).not.toThrow()
    expect(() => { configure() }).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    expect(() => { set('a') }).not.toThrow()
    await vi.advanceTimersByTimeAsync(250)
    const callsBeforeCleanup = fetchMock.mock.calls.length
    cleanup()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeCleanup)
  })
})
