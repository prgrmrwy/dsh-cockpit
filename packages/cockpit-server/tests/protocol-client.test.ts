import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { exchangeDshLaunchToken, parseDshLaunchUrl } from '../src/connectivity/dsh-auth.js'
import { createDeviceProtocol, TypertClient, TypertEventStream } from '../src/connectivity/protocol-client.js'

class FakeSocket extends EventEmitter {
  readyState = 1
  readonly sent: string[] = []
  send(value: string): void { this.sent.push(value) }
  close(): void { this.readyState = 3; this.emit('close') }
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
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
      .resolves.toEqual({ cookie: 'dsh-auth-authority=signed', cleanUrl: new URL('http://127.0.0.1:3081/') })
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
        if (target.includes('/?token=')) return response('', 303, { location: '/', 'set-cookie': 'dsh-auth-authority=signed; HttpOnly' })
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
})

describe('typert unary and Remote mux', () => {
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
