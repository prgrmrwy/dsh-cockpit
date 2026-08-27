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
    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r2', method: 'approval/requested', payload: { sessionId: 's1', rpcId: 'a-1' } }))
    sockets[1]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r3', method: 'question/requested', payload: { sessionId: 's1', rpcId: 'q-1' } }))
    sockets[1]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r4', method: 'approval/resolved', payload: { sessionId: 's1', rpcId: 'a-1' } }))
    // Unknown method must be ignored, malformed payload must not throw.
    sockets[0]!.emit('message', JSON.stringify({ type: 'server-request', rpcId: 'r5', method: 'host/workspace-changed', payload: {} }))
    sockets[1]!.emit('message', 'not-json')

    expect(events).toContainEqual({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    expect(events).toContainEqual({ type: 'interaction', deviceId: 'd1', kind: 'approval', rpcId: 'a-1', resolved: false })
    expect(events).toContainEqual({ type: 'interaction', deviceId: 'd1', kind: 'question', rpcId: 'q-1', resolved: false })
    expect(events).toContainEqual({ type: 'interaction', deviceId: 'd1', kind: 'approval', rpcId: 'a-1', resolved: true })
    expect(events.filter(e => e.type === 'workspace-changed')).toEqual([])
    stream.dispose()
  })
})