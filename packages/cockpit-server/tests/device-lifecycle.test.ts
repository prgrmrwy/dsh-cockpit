import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { DeviceRecord } from '@dsh-cockpit/shared'
import { DeviceLifecycle } from '../src/connectivity/device-lifecycle.js'
import { TunnelManager } from '../src/connectivity/tunnel-manager.js'

class FakeProcess {
  pid = 7
  stderr = new Readable({ read() {} })
  exited = new Promise<never>(() => {})
  kill(sig?: string): boolean { void sig; return true }
}

const record = (overrides: Partial<DeviceRecord> = {}): DeviceRecord => ({
  deviceId: 'd1',
  displayName: 'VM A',
  kind: 'remote',
  sshAlias: 'vm-a',
  remoteDshPort: 3080,
  enabled: true,
  order: 0,
  ...overrides,
})

function device() {
  const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
  const tunnel = new TunnelManager({
    spawn: () => new FakeProcess() as never,
    readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
  })
  const lifecycle = new DeviceLifecycle({
    record: record(),
    tunnels: tunnel,
    createClient: async () => ({
      probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
      listSessions: async () => [{ sessionId: 's1', running: true, updatedAt: 1, blank: false }],
    }),
    createStream: () => ({
      on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
      off: () => {},
      open: async () => {},
      dispose: () => {},
    }),
    onFacts: () => {},
  })
  return {
    lifecycle,
    tunnel,
    emit: (event: { type: string; [key: string]: unknown }) => handlers.get('event')?.(event),
  }
}

describe('device lifecycle', () => {
  it('bare instance reports CONNECTING until a connection runs', () => {
    const { lifecycle } = device()
    expect(lifecycle.current().state).toBe('CONNECTING')
    void lifecycle.stop()
  })

  it('aggregates baseline and events once connected', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    // Give the connect loop time to install the baseline + stream handlers.
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    expect(lifecycle.current().runningSessionCount).toBe(1)
    expect(lifecycle.current().state).toBe('READY')

    emit({ type: 'interaction', deviceId: 'd1', kind: 'approval', rpcId: 'a-1', resolved: false })
    expect(lifecycle.current().pendingInteractionCount).toBe(1)
    emit({ type: 'interaction', deviceId: 'd1', kind: 'approval', rpcId: 'a-1', resolved: true })
    expect(lifecycle.current().pendingInteractionCount).toBe(0)
    // Overflow guard: resolving with no pending stays at zero.
    emit({ type: 'interaction', deviceId: 'd1', kind: 'approval', rpcId: 'a-x', resolved: true })
    expect(lifecycle.current().pendingInteractionCount).toBe(0)

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('stop() reports CONNECTING afterwards', async () => {
    const { lifecycle } = device()
    await lifecycle.stop()
    expect(lifecycle.current().state).toBe('CONNECTING')
  })
})