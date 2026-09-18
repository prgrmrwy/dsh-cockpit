import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { exchangeDshLaunchToken, parseDshLaunchUrl } from '../src/connectivity/dsh-auth.js'
import { createDeviceProtocol, HttpStatusError, TypertClient, TypertEventStream } from '../src/connectivity/protocol-client.js'

class FakeSocket extends EventEmitter {
  readyState = 1
  readonly sent: string[] = []
  send(value: string): void { this.sent.push(value) }
  close(): void { this.readyState = 3; this.emit('close') }
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
}

const authChallenge = 'dsh web authentication required; reopen the URL printed by dsh web.'
const endpoint = new URL('http://127.0.0.1:3081')
const cookieName = 'dsh-auth-' + createHash('sha256').update(endpoint.host).digest('base64url')
const persistedCookie = { cookie: cookieName + '=persisted', authority: endpoint.host, expiresAt: Date.now() + 60_000 }

function sessionListResponse(init?: RequestInit): Response {
  const rpcId = JSON.parse(String(init?.body)).rpcId
  return response({ type: 'server-response', rpcId, result: { ok: true, value: { items: [] } } })
}

describe('DSH 0.1.2 authentication', () => {
  it('accepts only the official loopback root URL and returns only its token', () => {
    expect(parseDshLaunchUrl('http://127.0.0.1:3081/?token=abcdefghijklmnop', 3081)).toBe('abcdefghijklmnop')
    expect(() => parseDshLaunchUrl('http://example.test:3081/?token=abcdefghijklmnop', 3081)).toThrow('127.0.0.1')
    expect(() => parseDshLaunchUrl('http://127.0.0.1:3082/?token=abcdefghijklmnop', 3081)).toThrow('registered DSH port')
    expect(() => parseDshLaunchUrl('http://127.0.0.1:3081/?token=short&extra=1', 3081)).toThrow('exactly one')
  })

  it('exchanges the launch token without following redirect and extracts only the signed cookie', async () => {
    const fetcher = vi.fn(async () => response('', 303, {
      location: '/',
      'set-cookie': 'dsh-auth-authority=signed; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict',
    })) as unknown as typeof fetch
    await expect(exchangeDshLaunchToken(new URL('http://127.0.0.1:3081'), 'abcdefghijklmnop', { fetch: fetcher }))
      .resolves.toEqual(expect.objectContaining({ cookie: 'dsh-auth-authority=signed', cleanUrl: new URL('http://127.0.0.1:3081/'), authority: '127.0.0.1:3081' }))
    expect(fetcher).toHaveBeenCalledWith(new URL('http://127.0.0.1:3081/?token=abcdefghijklmnop'), expect.objectContaining({ redirect: 'manual' }))
  })
})

describe('protocol classification fixtures', () => {
  it('distinguishes rc.2, unauthenticated typert, authenticated typert, and a generic 401', async () => {
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = vi.fn(async url => {
        if (String(url).endsWith('/api/host.describe')) return response({ type: 'server-response', result: { ok: true, value: {} } })
        throw new Error('unexpected rc2 request')
      }) as unknown as typeof fetch
      await expect(createDeviceProtocol({ endpoint: new URL('http://127.0.0.1:3080'), deviceId: 'rc2' })).resolves.toMatchObject({ kind: 'rc2' })

      globalThis.fetch = vi.fn(async () => response('dsh web authentication required; reopen the URL printed by dsh web.', 401)) as unknown as typeof fetch
      await expect(createDeviceProtocol({ endpoint: new URL('http://127.0.0.1:3081'), deviceId: 'unauthenticated', fetch: globalThis.fetch }))
        .rejects.toThrow('paste the current dsh web startup URL')

      const typertFetch = vi.fn(async (url, init) => {
        const target = String(url)
        if (target.endsWith('/api/host.describe')) return response('dsh web authentication required; reopen the URL printed by dsh web.', 401)
        if (target === 'http://127.0.0.1:3081/') return response('dsh web authentication required; reopen the URL printed by dsh web.', 401)
        if (target.includes('/?token=')) return response('', 303, { location: '/', 'set-cookie': 'dsh-auth-authority=signed; Max-Age=2592000; HttpOnly' })
        if (target.endsWith('/api/session/list')) {
          const rpcId = JSON.parse(String(init?.body)).rpcId
          return response({ type: 'server-response', rpcId, result: { ok: true, value: { items: [] } } })
        }
        throw new Error('unexpected typert request ' + target)
      }) as unknown as typeof fetch
      globalThis.fetch = typertFetch
      await expect(createDeviceProtocol({ endpoint: new URL('http://127.0.0.1:3081'), deviceId: 'authenticated', launchToken: 'abcdefghijklmnop', fetch: typertFetch })).resolves.toMatchObject({ kind: 'typert' })

      globalThis.fetch = vi.fn(async () => response('login required', 401)) as unknown as typeof fetch
      await expect(createDeviceProtocol({ endpoint: new URL('http://127.0.0.1:3999'), deviceId: 'foreign', fetch: globalThis.fetch }))
        .rejects.toThrow('NON_DSH_SERVICE')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reuses an authority-matched unexpired cookie before the stored launch token', async () => {
    const recoverAuth = vi.fn()
    const fetcher = vi.fn(async (url, init) => {
      const target = String(url)
      if (target === new URL('/', endpoint).href) return response(authChallenge, 401)
      if (target.endsWith('/api/session/list')) {
        expect(init?.headers).toEqual(expect.objectContaining({ cookie: persistedCookie.cookie }))
        return sessionListResponse(init)
      }
      throw new Error('unexpected request ' + target)
    }) as unknown as typeof fetch

    const adapter = await createDeviceProtocol({
      endpoint, deviceId: 'cookie-first', persistedCookie, launchToken: 'abcdefghijklmnop', recoverAuth, fetch: fetcher,
    })

    expect(adapter).toMatchObject({ kind: 'typert', auth: persistedCookie })
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('?token='))).toBe(false)
    expect(recoverAuth).not.toHaveBeenCalled()
  })

  it('exchanges the stored token after an expired cookie and returns accepted auth metadata', async () => {
    const recovered = vi.fn()
    const fetcher = vi.fn(async (url, init) => {
      const target = String(url)
      if (target === new URL('/', endpoint).href) return response(authChallenge, 401)
      if (target.includes('/?token=abcdefghijklmnop')) return response('', 303, {
        location: '/', 'set-cookie': cookieName + '=renewed; Max-Age=60; HttpOnly',
      })
      if (target.endsWith('/api/session/list')) return sessionListResponse(init)
      throw new Error('unexpected request ' + target)
    }) as unknown as typeof fetch

    const adapter = await createDeviceProtocol({
      endpoint,
      deviceId: 'stored-token',
      persistedCookie: { ...persistedCookie, expiresAt: Date.now() - 1 },
      launchToken: 'abcdefghijklmnop',
      recoverAuth: recovered,
      fetch: fetcher,
    })

    expect(adapter.auth).toEqual(expect.objectContaining({
      launchToken: 'abcdefghijklmnop', cookie: cookieName + '=renewed', authority: endpoint.host,
    }))
    expect(adapter.auth?.expiresAt).toBeGreaterThan(Date.now())
    expect(recovered).not.toHaveBeenCalled()
  })

  it('invokes recovery only after a cookie or token receives HTTP 401', async () => {
    const recoverAuth = vi.fn(async () => ({ launchToken: 'qrstuvwxyzABCDEF' }))
    const fetcher = vi.fn(async (url, init) => {
      const target = String(url)
      if (target === new URL('/', endpoint).href) return response(authChallenge, 401)
      if (target.endsWith('/api/session/list') && (init?.headers as Record<string, string>).cookie === persistedCookie.cookie) return response('', 401)
      if (target.includes('/?token=abcdefghijklmnop')) return response('', 401)
      if (target.includes('/?token=qrstuvwxyzABCDEF')) return response('', 303, {
        location: '/', 'set-cookie': cookieName + '=recovered; Max-Age=60; HttpOnly',
      })
      if (target.endsWith('/api/session/list')) return sessionListResponse(init)
      throw new Error('unexpected request ' + target)
    }) as unknown as typeof fetch

    const adapter = await createDeviceProtocol({
      endpoint, deviceId: 'recovery', persistedCookie, launchToken: 'abcdefghijklmnop', recoverAuth, fetch: fetcher,
    })

    expect(recoverAuth).toHaveBeenCalledTimes(1)
    expect(adapter.auth).toEqual(expect.objectContaining({ launchToken: 'qrstuvwxyzABCDEF', cookie: cookieName + '=recovered' }))
  })

  it.each([
    ['forbidden', async () => response('', 403)],
    ['network', async () => { throw new Error('socket reset') }],
    ['protocol', async () => response({ unexpected: true })],
  ])('does not invoke recovery for %s cookie probe failures', async (_label, failure) => {
    const recoverAuth = vi.fn()
    const fetcher = vi.fn(async (url, init) => {
      const target = String(url)
      if (target === new URL('/', endpoint).href) return response(authChallenge, 401)
      if (target.endsWith('/api/session/list')) return failure()
      throw new Error('unexpected request ' + target + String(init?.method))
    }) as unknown as typeof fetch

    await expect(createDeviceProtocol({ endpoint, deviceId: 'no-recovery', persistedCookie, recoverAuth, fetch: fetcher })).rejects.toThrow()
    expect(recoverAuth).not.toHaveBeenCalled()
  })

  it('does not invoke recovery for a generic root 401 or token exchange 403/network/protocol failures', async () => {
    const genericRecovery = vi.fn()
    const genericFetch = vi.fn(async () => response('login required', 401)) as unknown as typeof fetch
    await expect(createDeviceProtocol({ endpoint, deviceId: 'generic', recoverAuth: genericRecovery, fetch: genericFetch })).rejects.toThrow('NON_DSH_SERVICE')
    expect(genericRecovery).not.toHaveBeenCalled()

    for (const tokenFailure of [
      async () => response('', 403),
      async () => { throw new Error('socket reset') },
      async () => response('', 200),
    ]) {
      const recoverAuth = vi.fn()
      const fetcher = vi.fn(async url => String(url) === new URL('/', endpoint).href ? response(authChallenge, 401) : tokenFailure()) as unknown as typeof fetch
      await expect(createDeviceProtocol({ endpoint, deviceId: 'token-failure', launchToken: 'abcdefghijklmnop', recoverAuth, fetch: fetcher })).rejects.toThrow()
      expect(recoverAuth).not.toHaveBeenCalled()
    }
  })
})

describe('typert unary and Remote mux', () => {
  it('throws a typed HTTP status error for unary failures', async () => {
    const fetcher = vi.fn(async () => response('', 403)) as unknown as typeof fetch
    const client = new TypertClient(endpoint, 'cookie=value', { workspaceBaseline: vi.fn() } as never, fetcher)
    const error = await client.listSessions().catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(HttpStatusError)
    expect(error).toMatchObject({ status: 403 })
  })

  it('sends session/list with args._request and validates the server envelope', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      expect(request).toEqual({
        type: 'client-request', rpcId: 'cockpit-typert-1', method: 'session/list', payload: { args: { _request: {} } },
      })
      expect(init?.headers).toEqual(expect.objectContaining({ cookie: 'cookie=value' }))
      return response({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { items: [{ sessionId: 's1', running: true, updatedAt: 1, blank: false }] } } })
    }) as unknown as typeof fetch
    const client = new TypertClient(new URL('http://127.0.0.1:3081'), 'cookie=value', { workspaceBaseline: vi.fn() } as never, fetcher)
    await expect(client.listSessions()).resolves.toEqual([{ sessionId: 's1', running: true, updatedAt: 1, blank: false }])
  })

  it('maintains workspace baseline and every increment shape', async () => {
    const socket = new FakeSocket()
    const stream = new TypertEventStream({ endpoint: new URL('http://127.0.0.1:3081'), deviceId: 'd1', cookie: 'cookie=value', createSocket: () => socket as never })
    const events: unknown[] = []
    stream.on('event', event => events.push(event))
    const opened = stream.open()
    socket.emit('open')
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'events', value: { type: 'ready', clientId: 'c1' } }))
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'workspace', value: { type: 'baseline', value: {
      items: [{ workspaceId: 'w1', path: '/one', title: 'One', sessionIds: ['s1'] }], archivedSessionIds: [],
    } } }))
    await opened
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'workspace', value: { type: 'upsert', workspace: { workspaceId: 'w2', path: '/two', title: 'Two', sessionIds: [] } } }))
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'workspace', value: { type: 'order', workspaceIds: ['w2', 'w1'] } }))
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'workspace', value: { type: 'archived', archivedSessionIds: ['s1'] } }))
    await vi.waitFor(async () => expect((await stream.workspaceBaseline()).items.map(item => item.workspaceId)).toEqual(['w2', 'w1']))
    expect(await stream.workspaceBaseline()).toEqual({ items: [
      { workspaceId: 'w2', path: '/two', title: 'Two', sessionIds: [] },
      { workspaceId: 'w1', path: '/one', title: 'One', sessionIds: ['s1'] },
    ], archivedSessionIds: ['s1'] })
    expect(events).toContainEqual({ type: 'archived-sessions-changed', deviceId: 'd1', archivedSessionIds: ['s1'] })
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'workspace', value: { type: 'remove', workspaceId: 'w2' } }))
    await vi.waitFor(async () => expect((await stream.workspaceBaseline()).items.map(item => item.workspaceId)).toEqual(['w1']))
    await stream.dispose()
  })

  it('opens both logical streams, maps events, and immediately replies next to waterfalls', async () => {
    const socket = new FakeSocket()
    const fetcher = vi.fn(async () => response({ type: 'server-response', rpcId: 'cockpit-event-e1', result: { ok: true, value: {} } })) as unknown as typeof fetch
    const stream = new TypertEventStream({ endpoint: new URL('http://127.0.0.1:3081'), deviceId: 'd1', cookie: 'cookie=value', fetch: fetcher, createSocket: () => socket as never })
    const events: unknown[] = []
    stream.on('event', event => events.push(event))
    const opened = stream.open()
    socket.emit('open')
    expect(socket.sent.map(text => JSON.parse(text))).toEqual([
      { type: 'open', streamId: 'events', endpoint: '$events', payload: { args: {} } },
      { type: 'open', streamId: 'workspace', endpoint: 'workspace/follow', payload: { args: {} } },
    ])
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'events', value: { type: 'ready', clientId: 'c1', host: { home: '/tmp' } } }))
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'workspace', value: { type: 'baseline', value: { items: [], archivedSessionIds: [] } } }))
    await opened
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'events', value: { type: 'emit', event: 'api-session/status', args: ['s1', true] } }))
    const waterfall = JSON.stringify({ type: 'item', streamId: 'events', value: { type: 'waterfall', event: 'ui/approval', eventId: 'e1', agentId: 's1', request: {} } })
    socket.emit('message', waterfall)
    socket.emit('message', waterfall)
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'events', value: { type: 'cancel', eventId: 'e1' } }))
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(events).toEqual([{ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true }])
    const init = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'client-request', rpcId: 'cockpit-event-e1', method: '$events/result', payload: { args: { clientId: 'c1', eventId: 'e1', outcome: { kind: 'next' } } },
    })
    await stream.dispose()
  })
})

describe('typert handshake boundedness', () => {
  const options = (socket: FakeSocket, extra: { handshakeTimeoutMs?: number } = {}) => ({
    endpoint: new URL('http://127.0.0.1:3081'),
    deviceId: 'd1',
    cookie: 'cookie=value',
    createSocket: () => socket as never,
    ...extra,
  })

  it('fails a handshake whose socket opens and then drops before the workspace baseline', async () => {
    const socket = new FakeSocket()
    // The deadline sits far outside the test budget, so only the close path can
    // settle this: a missing failure path shows up as a hang, not a late timeout.
    const stream = new TypertEventStream(options(socket, { handshakeTimeoutMs: 60_000 }))
    const opened = stream.open()
    const settled = expect(opened).rejects.toThrow('typert stream closed')
    socket.emit('open')
    socket.close()
    await settled
    await expect(stream.workspaceBaseline()).rejects.toThrow('typert stream closed')
  })

  it('cancels a pending handshake when the connect attempt is aborted', async () => {
    const socket = new FakeSocket()
    const controller = new AbortController()
    const stream = new TypertEventStream(options(socket, { handshakeTimeoutMs: 60_000 }))
    const opened = stream.open(controller.signal)
    const settled = expect(opened).rejects.toThrow('cancelled')
    socket.emit('open')
    controller.abort()
    await settled
    expect(socket.readyState).toBe(3)
  })

  it('opens no socket for an attempt that is already cancelled', async () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeSocket[] = []
      const stream = new TypertEventStream({
        endpoint: new URL('http://127.0.0.1:3081'),
        deviceId: 'd1',
        cookie: 'cookie=value',
        handshakeTimeoutMs: 10_000,
        createSocket: () => { const created = new FakeSocket(); sockets.push(created); return created as never },
      })
      const controller = new AbortController()
      controller.abort()
      await expect(stream.open(controller.signal)).rejects.toThrow('cancelled')
      expect(sockets).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles a pending handshake on dispose and releases the deadline timer', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const stream = new TypertEventStream(options(socket, { handshakeTimeoutMs: 10_000 }))
      const opened = stream.open()
      const settled = expect(opened).rejects.toThrow('disposed')
      socket.emit('open')
      await stream.dispose()
      await settled
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds the handshake when an upgraded socket never produces a baseline', async () => {
    const socket = new FakeSocket()
    const stream = new TypertEventStream(options(socket, { handshakeTimeoutMs: 20 }))
    const opened = stream.open()
    const settled = expect(opened).rejects.toThrow(/handshake timed out after 20ms/)
    socket.emit('open')
    await settled
    expect(socket.readyState).toBe(3)
    await stream.dispose()
  })

  it('does not retroactively fail a completed handshake when the socket drops later', async () => {
    const socket = new FakeSocket()
    const stream = new TypertEventStream(options(socket, { handshakeTimeoutMs: 60_000 }))
    const disconnects: string[] = []
    stream.on('disconnect', () => disconnects.push('disconnect'))
    const opened = stream.open()
    socket.emit('open')
    socket.emit('message', JSON.stringify({ type: 'item', streamId: 'workspace', value: { type: 'baseline', value: { items: [], archivedSessionIds: [] } } }))
    await opened
    expect(await stream.workspaceBaseline()).toEqual({ items: [], archivedSessionIds: [] })
    socket.close()
    await vi.waitFor(() => expect(disconnects).toEqual(['disconnect']))
    // The completed handshake and its baseline survive: the drop belongs to the
    // disconnect → reconnect path.
    expect(await stream.workspaceBaseline()).toEqual({ items: [], archivedSessionIds: [] })
    await stream.dispose()
  })
})
