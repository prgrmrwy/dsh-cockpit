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

  it('reports the opened session id to the cockpit', async () => {
    fetchMock.mockResolvedValue({ status: 200 })
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
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
    set('a')
    await new Promise(r => setTimeout(r, 300))
    set('a') // list refresh with the same current
    await new Promise(r => setTimeout(r, 300))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('bootstraps on 401 then retries, and survives a dead cockpit', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({ status: 200 })
    const { ctx, set } = fakeCtx()
    const apply = await loadApply()
    apply(ctx as unknown)
    set('a')
    await new Promise(r => setTimeout(r, 300))
    // 401 → bootstrap → retried POST; a later change when cockpit is gone
    // must resolve quietly.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]![0]).toBe('http://127.0.0.1:3090/api/bootstrap')
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    set('b')
    await new Promise(r => setTimeout(r, 300))
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
