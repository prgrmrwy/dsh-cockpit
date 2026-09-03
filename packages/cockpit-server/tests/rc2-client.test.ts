import { describe, expect, it } from 'vitest'

// The frame-to-event conversion is the contract that matters; test it through
// a fake socket without a real WebSocket server.
import { EventEmitter } from 'node:events'
import { DualEventStream } from '../src/connectivity/rc2-client.js'

class FakeSocket extends EventEmitter {
  readyState = 1
  closed = false
  close(): void { this.closed = true }
}

describe('dual event stream conversion', () => {
  it('converts official mux/host methods into cockpit events', async () => {
    const sockets: FakeSocket[] = []
    const stream = new DualEventStream({
      endpoint: new URL('http://127.0.0.1:49152'),
      deviceId: 'd1',
      createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s as never },
    })
    const events: Array<{ type: string }> = []
    stream.on('event', e => events.push(e))
    const open = stream.open()
    for (const socket of sockets) socket.emit('open')
    await open

    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r1', method: 'host/session-status', payload: { sessionId: 's1', running: true } }))
    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r2', method: 'approval/requested', payload: { sessionId: 's1', approvalId: 'a-1', toolName: 'Bash' } }))
    sockets[1]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r3', method: 'question/requested', payload: { sessionId: 's1', questions: [{ id: 'q1', prompt: 'ok?' }] } }))
    sockets[1]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r5', method: 'approval/resolved', payload: { sessionId: 's1', approvalId: 'a-1', outcome: 'allowed-once' } }))
    sockets[1]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r6', method: 'question/resolved', payload: { sessionId: 's1', questionRpcId: 'r3', outcome: 'answered' } }))
    // Unknown method must be ignored, malformed payload must not throw.
    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r7', method: 'host/workspace-changed', payload: {} }))
    sockets[1]!.emit('message', 'not-json')

    expect(events).toContainEqual({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    expect(events).toContainEqual({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'approval', rpcId: 'a-1', resolved: false })
    expect(events).toContainEqual({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'question', rpcId: 'r3', resolved: false })
    expect(events).toContainEqual({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'approval', rpcId: 'a-1', resolved: true })
    // question/resolved echoes the envelope rpcId back (official questionRpcId).
    expect(events).toContainEqual({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'question', rpcId: 'r3', resolved: true })
    expect(events.filter(e => e.type === 'workspace-changed')).toEqual([])

    // session-added must surface the subagent origin marker (baseline priors
    // keep origin-less host/session-status frames correctly filtered).
    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r8', method: 'host/session-added', payload: { sessionId: 'sub-1', blank: false, origin: 'subagent' } }))
    expect(events).toContainEqual({ type: 'session-added', deviceId: 'd1', sessionId: 'sub-1', origin: 'subagent' })

    // host/archived-sessions-changed carries the full authoritative set, and
    // is distinct from host/session-removed (permanent deletion).
    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r9', method: 'host/archived-sessions-changed', payload: { archivedSessionIds: ['s1', 's2'] } }))
    expect(events).toContainEqual({ type: 'archived-sessions-changed', deviceId: 'd1', archivedSessionIds: ['s1', 's2'] })
    // A malformed payload (non-array / non-string entries) must be ignored,
    // not throw and not emit a bogus event.
    const before = events.length
    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r10', method: 'host/archived-sessions-changed', payload: { archivedSessionIds: 'not-an-array' } }))
    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r11', method: 'host/archived-sessions-changed', payload: { archivedSessionIds: [1, 2] } }))
    expect(events).toHaveLength(before)

    sockets[1]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r12', method: 'host/session-removed', payload: { sessionId: 's1' } }))
    expect(events).toContainEqual({ type: 'session-removed', deviceId: 'd1', sessionId: 's1' })
    stream.dispose()
  })
})