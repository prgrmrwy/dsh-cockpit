import { describe, expect, it, vi } from 'vitest'
import { WorkbenchLaunchCoordinator } from '../src/connectivity/workbench-launch-coordinator.js'
import { dshCookieName } from '../src/connectivity/dsh-auth.js'
import type { WorkbenchLaunchSnapshot } from '../src/connectivity/workbench-launch.js'

const endpoint = new URL('http://127.0.0.1:51777')
const authority = endpoint.host
const CHALLENGE = 'dsh web authentication required; reopen the URL printed by dsh web.'

const snapshot = (overrides: Partial<WorkbenchLaunchSnapshot> = {}): WorkbenchLaunchSnapshot => ({
  deviceId: 'a',
  authority,
  authGeneration: 1,
  connectionGeneration: 1,
  ...overrides,
})

const challenge = (): Response => new Response(CHALLENGE, { status: 401 })
const rejected = (): Response => new Response('', { status: 401 })
const minted = (token: string): Response => new Response('', {
  status: 303,
  headers: { location: '/', 'set-cookie': `${dshCookieName(authority)}=minted-${token}; Max-Age=2592000; Path=/; HttpOnly` },
})

/** Counts how many times the endpoint was actually contacted, so single-flight
 * and TTL reuse are asserted on REAL request counts, not on intent. */
function countingFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    return await handler(url, init)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('workbench launch coordination', () => {
  it('shares authority-scoped validation while isolating waiter and device cancellation', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const { fetchImpl, calls } = countingFetch(async url => {
      if (!url.includes('?token=')) return challenge()
      await gate
      return minted('current')
    })
    const coordinator = new WorkbenchLaunchCoordinator()
    const launch = (signal?: AbortSignal) => coordinator.launch(snapshot(), endpoint, fetchImpl, {
      token: 'current-token-abcdef',
      discoveryAuthorized: false,
      ...(signal === undefined ? {} : { signal }),
    })

    const first = launch()
    const second = launch()
    // A third caller that navigates away must not take the other two down.
    const controller = new AbortController()
    const abandoning = launch(controller.signal)
    controller.abort(new Error('browser navigated away'))
    release()

    await expect(abandoning).rejects.toThrow('browser navigated away')
    const [a, b] = await Promise.all([first, second])
    expect(a).toMatchObject({ ok: true, url: 'http://127.0.0.1:51777/?token=current-token-abcdef', authGeneration: 1 })
    expect(b).toEqual(a)
    // One shared operation: the exchange happened exactly once.
    expect(calls.filter(url => url.includes('?token='))).toHaveLength(1)

    // A DIFFERENT authority must never share that operation's identity.
    const other = await coordinator.launch(
      snapshot({ authority: '127.0.0.1:51999' }),
      new URL('http://127.0.0.1:51999'),
      fetchImpl,
      { token: 'current-token-abcdef', discoveryAuthorized: false },
    )
    expect(other).toMatchObject({ ok: false, code: 'workbench-unavailable' })
  })

  it('cancels the shared operation only when the device itself goes away', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const { fetchImpl } = countingFetch(async url => {
      if (!url.includes('?token=')) return challenge()
      await gate
      return minted('current')
    })
    const coordinator = new WorkbenchLaunchCoordinator()
    const options = { token: 'current-token-abcdef', discoveryAuthorized: false }

    const pending = coordinator.launch(snapshot(), endpoint, fetchImpl, options)
    const another = coordinator.launch(snapshot(), endpoint, fetchImpl, options)
    coordinator.cancelDevice('a')
    release()

    // Both waiters observe the device-level teardown as "superseded", never as
    // a successful navigation into a device that is gone.
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'workbench-launch-stale' })
    await expect(another).resolves.toMatchObject({ ok: false, code: 'workbench-launch-stale' })
  })

  it('reuses a settled outcome inside the window instead of re-minting a cookie', async () => {
    const { fetchImpl, calls } = countingFetch(async url => url.includes('?token=') ? minted('current') : challenge())
    const coordinator = new WorkbenchLaunchCoordinator({ validationTtlMs: 10_000 })
    const options = { token: 'current-token-abcdef', discoveryAuthorized: false }

    const first = await coordinator.launch(snapshot(), endpoint, fetchImpl, options)
    const second = await coordinator.launch(snapshot(), endpoint, fetchImpl, options)

    expect(first).toMatchObject({ ok: true })
    expect(second).toEqual(first)
    expect(calls.filter(url => url.includes('?token='))).toHaveLength(1)
  })

  it('revalidates once the bounded window has passed', async () => {
    const { fetchImpl, calls } = countingFetch(async url => url.includes('?token=') ? minted('current') : challenge())
    const coordinator = new WorkbenchLaunchCoordinator({ validationTtlMs: 5 })
    const options = { token: 'current-token-abcdef', discoveryAuthorized: false }

    await coordinator.launch(snapshot(), endpoint, fetchImpl, options)
    await new Promise(resolve => setTimeout(resolve, 15))
    await coordinator.launch(snapshot(), endpoint, fetchImpl, options)

    expect(calls.filter(url => url.includes('?token='))).toHaveLength(2)
  })

  it('never treats a non-rejection failure as grounds for reading the DSH log', async () => {
    const cases: Array<[string, (url: string) => Response | Promise<Response>, string]> = [
      ['transport failure', () => { throw new Error('socket reset') }, 'workbench-unavailable'],
      ['non-DSH endpoint', () => new Response('login required', { status: 401 }), 'workbench-unavailable'],
      ['malformed exchange', url => url.includes('?token=') ? new Response('', { status: 200 }) : challenge(), 'workbench-unavailable'],
    ]
    for (const [label, handler, expected] of cases) {
      const { fetchImpl } = countingFetch(async url => await handler(url))
      const discover = vi.fn(async () => 'fresh-token-abcdefg')
      const coordinator = new WorkbenchLaunchCoordinator()
      const outcome = await coordinator.launch(snapshot(), endpoint, fetchImpl, {
        token: 'stale-token-abcdefg',
        discoveryAuthorized: true,
        discover,
      })
      expect(outcome, label).toMatchObject({ ok: false, code: expected })
      expect(discover, `${label} must not read discovery logs`).not.toHaveBeenCalled()
    }
  })

  it('discovers on an official rejection and commits the recovered material once', async () => {
    const { fetchImpl } = countingFetch(url => {
      if (!url.includes('?token=')) return challenge()
      return url.includes('stale-token-abcdefg') ? rejected() : minted('fresh-token-abcdefg')
    })
    const discover = vi.fn(async () => 'fresh-token-abcdefg')
    const commit = vi.fn(async () => 7)
    const coordinator = new WorkbenchLaunchCoordinator()

    const outcome = await coordinator.launch(snapshot({ authGeneration: 6 }), endpoint, fetchImpl, {
      token: 'stale-token-abcdefg',
      discoveryAuthorized: true,
      discover,
      commit,
    })

    expect(outcome).toMatchObject({ ok: true, url: 'http://127.0.0.1:51777/?token=fresh-token-abcdefg', authGeneration: 7 })
    expect(discover).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'a', authGeneration: 6 }),
      'fresh-token-abcdefg',
      expect.objectContaining({ authority }),
    )
  })

  it('refuses to navigate when the recovered material lost the compare-and-swap', async () => {
    const { fetchImpl } = countingFetch(url => {
      if (!url.includes('?token=')) return challenge()
      return url.includes('stale-token-abcdefg') ? rejected() : minted('fresh-token-abcdefg')
    })
    const coordinator = new WorkbenchLaunchCoordinator()

    const outcome = await coordinator.launch(snapshot(), endpoint, fetchImpl, {
      token: 'stale-token-abcdefg',
      discoveryAuthorized: true,
      discover: async () => 'fresh-token-abcdefg',
      commit: async () => undefined,
    })

    expect(outcome).toMatchObject({ ok: false, code: 'workbench-launch-stale' })
  })
})
