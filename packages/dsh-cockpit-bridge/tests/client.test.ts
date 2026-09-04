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

function fakeCtx(initial = { current: undefined }) {
  const listeners = new Set<() => void>()
  let snapshot: SessionListStateLike = { ...initial }
  let cleanup: (() => void) | undefined
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
    effect: (fn: () => () => void) => { cleanup = fn() },
  }
  return {
    ctx,
    set: (current: string | undefined) => {
      snapshot = { current }
      for (const fn of [...listeners]) fn()
    },
    cleanup: () => { cleanup?.() },
  }
}

async function loadApply(): Promise<(ctx: unknown) => void> {
  const mod = await import('../src/client/index.js')
  return mod.apply as (ctx: unknown) => void
}

function configure(fakeWindow = window as unknown as FakeWindow): void {
  fakeWindow.emitMessage({
    type: 'dsh-cockpit:bridge-config',
    cockpitOrigin: COCKPIT_ORIGIN,
    capability: CAPABILITY,
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
      version: '0.2.1',
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
