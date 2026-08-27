import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The plugin imports the ClientContext TYPE only; the runtime module is not
// loaded at test time, so we exercise apply() directly with a fake ctx.
interface SessionListStateLike { current: string | undefined }

function fakeCtx(initial = { current: undefined }) {
  const listeners = new Set<() => void>()
  let snapshot: SessionListStateLike = { ...initial }
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
    effect: (fn: () => () => void) => { fn() }, // run immediately, ignore cleanup
  }
  return {
    ctx,
    set: (current: string | undefined) => {
      snapshot = { current }
      for (const fn of [...listeners]) fn()
    },
  }
}

async function loadApply(): Promise<(ctx: unknown) => void> {
  const mod = await import('../src/client/index.js')
  return mod.apply as (ctx: unknown) => void
}

describe('cockpit bridge client', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals() })

  it('sends a startup hello (with version) before watching selections', async () => {
    fetchMock.mockResolvedValue({ status: 200 })
    const { ctx } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    await new Promise(r => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:3090/api/bridge/hello')
    expect(JSON.parse(String(init.body))).toMatchObject({ version: expect.any(String) })
  })

  it('reports the opened session id to the cockpit', async () => {
    fetchMock.mockResolvedValue({ status: 200 })
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    await new Promise(r => setTimeout(r, 0)) // hello consumed
    fetchMock.mockClear()
    set('session-a')
    await new Promise(r => setTimeout(r, 300))
    set('session-b')
    await new Promise(r => setTimeout(r, 300))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:3090/api/bridge/session-opened')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 'session-a' })
    expect(fetchMock.mock.calls[1]![1]!.body).toBe(JSON.stringify({ sessionId: 'session-b' }))
  })

  it('debounces rapid selection changes into one report', async () => {
    fetchMock.mockResolvedValue({ status: 200 })
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    await new Promise(r => setTimeout(r, 0))
    fetchMock.mockClear()
    set('a')
    set('b')
    set('c')
    await new Promise(r => setTimeout(r, 300))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1]!.body).toBe(JSON.stringify({ sessionId: 'c' }))
  })

  it('does not re-report the same selection', async () => {
    fetchMock.mockResolvedValue({ status: 200 })
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    await new Promise(r => setTimeout(r, 0))
    fetchMock.mockClear()
    set('a')
    await new Promise(r => setTimeout(r, 300))
    set('a') // list refresh with the same current
    await new Promise(r => setTimeout(r, 300))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('bootstraps on 401 then retries, and survives a dead cockpit', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 200 }) // hello
      .mockResolvedValueOnce({ status: 401 })  // session-opened → 401
      .mockResolvedValueOnce({ status: 200 })  // bootstrap
      .mockResolvedValueOnce({ status: 200 })  // retried session-opened
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    await new Promise(r => setTimeout(r, 0))
    set('a')
    await new Promise(r => setTimeout(r, 300))
    // hello + 401 → bootstrap → retried POST; a later change when cockpit is
    // gone must resolve quietly.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[2]![0]).toBe('http://127.0.0.1:3090/api/bootstrap')
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    set('b')
    await new Promise(r => setTimeout(r, 300))
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
