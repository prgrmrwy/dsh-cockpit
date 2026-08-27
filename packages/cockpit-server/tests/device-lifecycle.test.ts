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

function device(sessions?: readonly { sessionId: string; running: boolean; updatedAt: number; blank: boolean; origin?: string }[]) {
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
      listSessions: async () => sessions ?? [{ sessionId: 's1', running: true, updatedAt: 1, blank: false }],
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

    emit({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'approval', rpcId: 'a-1', resolved: false })
    expect(lifecycle.current().pendingInteractionCount).toBe(1)
    emit({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'approval', rpcId: 'a-1', resolved: true })
    expect(lifecycle.current().pendingInteractionCount).toBe(0)
    // Overflow guard: resolving with no pending stays at zero.
    emit({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'approval', rpcId: 'a-x', resolved: true })
    expect(lifecycle.current().pendingInteractionCount).toBe(0)

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('tracks approval and question per session and pending outranks running', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    // Baseline: one running session → ongoing ×1.
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

    // Two sessions (s1, s2) each get a pending key — approval on s1, two
    // questions on s2. Official per-session reduction: s1 → approval,
    // s2 → question (single status each), counts are per session.
    emit({ type: 'interaction', deviceId: 'd1', sessionId: 's2', kind: 'question', rpcId: 'q-1', resolved: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'warning', kind: 'question', count: 1 },
      { state: 'ongoing', kind: 'running', count: 1 }, // s1 still runs, s2 is pending
    ])
    emit({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'approval', rpcId: 'a-1', resolved: false })
    // BOTH pending sessions are subtracted from running: s1 + s2 awaited,
    // no session remains in the ongoing group.
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'warning', kind: 'approval', count: 1 },
      { state: 'warning', kind: 'question', count: 1 },
    ])
    expect(lifecycle.current().runningSessionCount).toBe(1)
    expect(lifecycle.current().pendingInteractionCount).toBe(2)

    // Resolving the only question on s2 clears its pending slot (sibling
    // waits on other sessions are untouched).
    emit({ type: 'interaction', deviceId: 'd1', sessionId: 's2', kind: 'question', rpcId: 'q-1', resolved: true })
    expect(lifecycle.current().pendingInteractionCount).toBe(1)
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'warning', kind: 'approval', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('arms the green completed reminder on a running→idle edge only', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    // Baseline: sessions already idle at load get NO reminder (official edge
    // semantics — first observation only records the running bit).
    expect(lifecycle.current().sessionStatuses).not.toContainEqual({ state: 'done', kind: 'completed', count: expect.any(Number) })

    // A live running→idle edge arms the green "已完成" reminder.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])
    expect(lifecycle.current().runningSessionCount).toBe(0)

    // Re-running disarms it (official: running deletes the reminder).
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

    // Running→idle again re-arms it.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    // Session removed drops the reminder.
    emit({ type: 'session-removed', deviceId: 'd1', sessionId: 's1' })
    expect(lifecycle.current().sessionStatuses).toEqual([])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('excludes subagent sessions from running, completed and pending counts', async () => {
    // Baseline: one running root (s1), one running subagent (sub-a) and one
    // idle subagent (sub-b) — like a real host with 100+ subagent sessions.
    const { lifecycle, tunnel, emit } = device([
      { sessionId: 's1', running: true, updatedAt: 1, blank: false },
      { sessionId: 'sub-a', running: true, updatedAt: 1, blank: false, origin: 'subagent' },
      { sessionId: 'sub-b', running: false, updatedAt: 1, blank: false, origin: 'subagent' },
    ])
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    // Only the root running session counts; the running subagent does not.
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

    // A subagent running→idle edge must NOT arm the completed reminder.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 'sub-a', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

    // A subagent pending interaction must not count either.
    emit({ type: 'interaction', deviceId: 'd1', sessionId: 'sub-a', kind: 'approval', rpcId: 'sub-a-1', resolved: false })
    expect(lifecycle.current().pendingInteractionCount).toBe(0)
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

    // session-added origin=subagent then a status edge on it stays excluded.
    emit({ type: 'session-added', deviceId: 'd1', sessionId: 'sub-c', origin: 'subagent' })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 'sub-c', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

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
describe('local device lifecycle', () => {
  it('connects directly to the loopback port without a tunnel', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    let tunnelConnectCalled = false
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    // Wrap connect to observe it must NOT be invoked for a local device.
    const original = tunnel.connect.bind(tunnel)
    tunnel.connect = (request => {
      tunnelConnectCalled = true
      return original(request)
    }) as typeof tunnel.connect
    const lifecycle = new DeviceLifecycle({
      record: { ...record(), kind: 'local', sshAlias: undefined },
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
    const facts = lifecycle.current()
    expect(facts.kind).toBe('local')
    expect(facts.state).toBe('CONNECTING')
    await lifecycle.stop()
    expect(tunnelConnectCalled).toBe(false)
    expect(lifecycle.current().endpoint).toBeUndefined()
  })
})
