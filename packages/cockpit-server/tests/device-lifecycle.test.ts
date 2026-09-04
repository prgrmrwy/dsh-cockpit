import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { DeviceRecord } from '@dsh-cockpit/shared'
import { DeviceLifecycle } from '../src/connectivity/device-lifecycle.js'
import { reserveCandidatePort } from '../src/connectivity/ssh.js'
import { TunnelManager } from '../src/connectivity/tunnel-manager.js'

class FakeProcess {
  pid = 7
  stderr = new Readable({ read() {} })
  exited = new Promise<never>(() => {})
  kill(sig?: string): boolean { void sig; return true }
}

/** Flood count for the buffer-cap test: comfortably past EVENT_BUFFER_CAP. */
const EVENT_BUFFER_FLOOD = 2_005

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

function device(
  sessions?: readonly { sessionId: string; running: boolean; updatedAt: number; blank: boolean; origin?: string }[],
  overrides: Partial<DeviceRecord> = {},
) {
  const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
  const tunnel = new TunnelManager({
    spawn: () => new FakeProcess() as never,
    readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
  })
  const lifecycle = new DeviceLifecycle({
    record: record(overrides),
    tunnels: tunnel,
    createClient: async () => ({
      probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
      listSessions: async () => sessions ?? [{ sessionId: 's1', running: true, updatedAt: 1, blank: false }],
      listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
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

  it('keeps a disabled instance inert with stable DISABLED facts', async () => {
    const { lifecycle, tunnel } = device(undefined, { enabled: false })
    let tunnelConnectCalled = false
    const original = tunnel.connect.bind(tunnel)
    tunnel.connect = (request => {
      tunnelConnectCalled = true
      return original(request)
    }) as typeof tunnel.connect

    lifecycle.start()
    await lifecycle.refresh()
    await lifecycle.reconnect()

    expect(lifecycle.current()).toEqual(expect.objectContaining({
      enabled: false,
      state: 'DISABLED',
      runningSessionCount: 0,
      pendingInteractionCount: 0,
      sessionStatuses: [],
    }))
    expect(lifecycle.current().endpoint).toBeUndefined()
    expect(tunnelConnectCalled).toBe(false)
    await lifecycle.stop()
    await tunnel.disposeAll()
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

  it('clearCompletedSession() clears only the selected session and keeps re-arm', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    // Arm two independent completion edges (s1, s3).
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's3', running: true })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's3', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 2 },
    ])

    // Opening s1 (bridge) clears exactly its reminder.
    ;(lifecycle as unknown as { clearCompletedSession(id: string): void }).clearCompletedSession('s1')
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    // Unknown session id is a no-op (no crash, no state change).
    ;(lifecycle as unknown as { clearCompletedSession(id: string): void }).clearCompletedSession('nope')
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    // Re-running s1 and finishing again re-arms it (prevRunning preserved).
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 2 },
    ])

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

  it('coalesces concurrent manual reconnects into one replacement loop and tunnel', async () => {
    let connectCount = 0
    let activeTunnels = 0
    let maxActiveTunnels = 0
    let activeDispose: (() => Promise<void>) | undefined
    const tunnels = {
      connect: async () => {
        connectCount += 1
        activeTunnels += 1
        maxActiveTunnels = Math.max(maxActiveTunnels, activeTunnels)
        let disposed = false
        const dispose = async () => {
          if (disposed) return
          disposed = true
          activeTunnels -= 1
          if (activeDispose === dispose) activeDispose = undefined
        }
        activeDispose = dispose
        return {
          deviceId: 'd1', generation: connectCount,
          endpoint: new URL(`http://127.0.0.1:${40_000 + connectCount}`),
          diagnostic: 'ok', dispose,
        }
      },
      disposeNode: async () => { await activeDispose?.() },
    } as unknown as TunnelManager
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: async () => [],
        listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
      }),
      createStream: () => {
        const handlers = new Map<string, (...args: unknown[]) => void>()
        return {
          on: (name: string, fn: (...args: unknown[]) => void) => { handlers.set(name, fn) },
          off: (name: string) => { handlers.delete(name) },
          open: async () => {},
          dispose: () => { handlers.clear() },
        }
      },
      onFacts: () => {},
    })

    lifecycle.start()
    for (let i = 0; i < 100 && lifecycle.current().state !== 'READY'; i++) await new Promise(r => setTimeout(r, 5))
    expect(connectCount).toBe(1)

    await Promise.all([lifecycle.reconnect(), lifecycle.reconnect(), lifecycle.reconnect()])
    for (let i = 0; i < 100 && lifecycle.current().state !== 'READY'; i++) await new Promise(r => setTimeout(r, 5))

    expect(connectCount).toBe(2)
    expect(maxActiveTunnels).toBe(1)
    expect(activeTunnels).toBe(1)
    await lifecycle.stop()
    expect(activeTunnels).toBe(0)
  })

  it('stop() clears live connection and aggregate facts', async () => {
    const { lifecycle, emit } = device()
    lifecycle.start()
    for (let i = 0; i < 100 && lifecycle.current().state !== 'READY'; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'interaction', deviceId: 'd1', sessionId: 's1', kind: 'approval', rpcId: 'a-1', resolved: false })
    expect(lifecycle.current().endpoint).toBeDefined()
    expect(lifecycle.current().runningSessionCount).toBe(1)

    await lifecycle.stop()

    expect(lifecycle.current().endpoint).toBeUndefined()
    expect(lifecycle.current().runningSessionCount).toBe(0)
    expect(lifecycle.current().pendingInteractionCount).toBe(0)
    expect(lifecycle.current().sessionStatuses).toEqual([])
  })
})
describe('reliable completion reminders: ack/edge ordering, archive, and manual clear', () => {
  it('ack-before-edge: opening a session before its running→idle edge suppresses that generation only', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    // Bridge reports the session as opened (selected) WHILE it is still
    // running — before the completion edge arrives.
    ;(lifecycle as unknown as { setBridgeSelection(id: string | undefined): void }).setBridgeSelection('s1')
    // The completion edge now arrives late: must NOT produce a reminder.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([])

    // A brand-new run-and-finish cycle on the SAME session (after selection
    // moves elsewhere) must still be able to arm a fresh reminder — the old
    // ack must not suppress a future, unrelated generation.
    ;(lifecycle as unknown as { setBridgeSelection(id: string | undefined): void }).setBridgeSelection(undefined)
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('edge-before-ack: a late bridge ack for the same generation clears the reminder', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])
    // The bridge ack for that same generation arrives after the edge.
    ;(lifecycle as unknown as { clearCompleted(id: string): void }).clearCompleted('s1')
    expect(lifecycle.current().sessionStatuses).toEqual([])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a session currently reported as selected by the bridge never shows as unread while selected', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    ;(lifecycle as unknown as { setBridgeSelection(id: string | undefined): void }).setBridgeSelection('s1')
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('archiving a session clears its current reminder without affecting others', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's3', running: true })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's3', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 2 },
    ])

    emit({ type: 'archived-sessions-changed', deviceId: 'd1', archivedSessionIds: ['s1'] })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('restoring an idle archived session does not manufacture a new completion edge', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    // s1 finishes, was already acked (bridge opened it), then archived.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    ;(lifecycle as unknown as { clearCompleted(id: string): void }).clearCompleted('s1')
    expect(lifecycle.current().sessionStatuses).toEqual([])
    emit({ type: 'archived-sessions-changed', deviceId: 'd1', archivedSessionIds: ['s1'] })
    expect(lifecycle.current().sessionStatuses).toEqual([])

    // Restore (archived set no longer contains s1) without any new
    // running→idle edge on it: must remain read, no phantom reminder.
    emit({ type: 'archived-sessions-changed', deviceId: 'd1', archivedSessionIds: [] })
    expect(lifecycle.current().sessionStatuses).toEqual([])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('archiving an unread session and restoring it keeps it read (no re-arm without a new run)', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])
    // Archive alone (without a prior explicit ack) must still clear the
    // reminder — archive is itself an explicit disposition (design.md D4).
    emit({ type: 'archived-sessions-changed', deviceId: 'd1', archivedSessionIds: ['s1'] })
    expect(lifecycle.current().sessionStatuses).toEqual([])
    emit({ type: 'archived-sessions-changed', deviceId: 'd1', archivedSessionIds: [] })
    expect(lifecycle.current().sessionStatuses).toEqual([])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a session temporarily absent from a baseline refresh is not treated as deleted or archived', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    let listCall = 0
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels: tunnel,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: async () => {
          listCall += 1
          // First call (connect baseline): s1 running. Second call (manual
          // refresh): s1 is transiently absent from the list — e.g. a
          // momentary host/session-list gap — NOT reported as idle or gone.
          return listCall === 1 ? [{ sessionId: 's1', running: true, updatedAt: 1, blank: false }] : []
        },
        listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
      }),
      createStream: () => ({
        on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
        off: () => {},
        open: async () => {},
        dispose: () => {},
      }),
      onFacts: () => {},
    })
    const emit = (event: { type: string; [key: string]: unknown }) => handlers.get('event')?.(event)
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])
    // A subsequent baseline refresh that happens not to include s1 (e.g. a
    // transient host/session-list gap) must not clear or duplicate its
    // reminder — a list absence alone is never a deletion fact.
    await lifecycle.refresh()
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a live detach (session-removed) clears reminders but keeps run lineage for reappearance', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])
    // The user opened s1 (ack gen 1), then the session detached from the live
    // registry (dispose) — treated as live detach, not permanent deletion.
    ;(lifecycle as unknown as { setBridgeSelection(id: string | undefined): void }).setBridgeSelection('s1')
    emit({ type: 'session-removed', deviceId: 'd1', sessionId: 's1' })
    expect(lifecycle.current().sessionStatuses).toEqual([])
    expect(lifecycle.current().runningSessionCount).toBe(0)
    // Reappearance as idle (cold persisted sessions are re-listed) must NOT
    // manufacture a reminder or open a fresh generation.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([])
    // A genuinely new run after detach starts a new generation; the old
    // selection ack belongs to the old generation and must not suppress it.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a subagent detach keeps its classification so later status frames stay excluded', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'session-added', deviceId: 'd1', sessionId: 'sa', origin: 'subagent' })
    emit({ type: 'session-removed', deviceId: 'd1', sessionId: 'sa' })
    // Even after the subagent detached, its status frames must not enter root
    // running/completed counts.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 'sa', running: true })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 'sa', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a completion edge landing while the baseline RPC is in flight is not lost (blind window)', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    let listCalled = false
    let resolveList: ((sessions: { sessionId: string; running: boolean; updatedAt: number; blank: boolean }[]) => void) | undefined
    const sessionsPromise = new Promise<{ sessionId: string; running: boolean; updatedAt: number; blank: boolean }[]>(resolve => {
      resolveList = resolve
    })
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels: tunnel,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: () => {
          listCalled = true
          return sessionsPromise
        },
        listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
      }),
      createStream: () => ({
        on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
        off: () => {},
        open: async () => {},
        dispose: () => {},
      }),
      onFacts: () => {},
    })
    const emit = (event: { type: string; [key: string]: unknown }) => handlers.get('event')?.(event)
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    // The streams are opened BEFORE the baseline RPC; wait until the RPC is
    // actually in flight, then let the completion edge arrive during it.
    for (let i = 0; i < 200 && !listCalled; i++) await new Promise(r => setTimeout(r, 5))
    expect(listCalled).toBe(true)
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    // The snapshot was captured BEFORE the completion (the session was still
    // running at that moment); the false edge only shows up on the stream.
    resolveList!([{ sessionId: 's1', running: true, updatedAt: 1, blank: false }])
    for (let i = 0; i < 100 && lifecycle.current().state !== 'READY'; i++) await new Promise(r => setTimeout(r, 5))
    expect(lifecycle.current().state).toBe('READY')
    // The buffered true→false edge was replayed over the running baseline: the
    // reminder must be armed (not lost in the baseline→stream gap).
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a stale refresh baseline cannot roll back a newer in-flight event', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    let listCall = 0
    let resolveList: ((sessions: { sessionId: string; running: boolean; updatedAt: number; blank: boolean }[]) => void) | undefined
    let pending: Promise<{ sessionId: string; running: boolean; updatedAt: number; blank: boolean }[]> | undefined
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels: tunnel,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: () => {
          listCall += 1
          if (listCall === 1) return Promise.resolve([{ sessionId: 's1', running: true, updatedAt: 1, blank: false }])
          // Manual refresh: a DELAYED response whose snapshot is already
          // stale (says idle) while the live wire says s1 started running.
          pending = new Promise(resolve => { resolveList = resolve })
          return pending
        },
        listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
      }),
      createStream: () => ({
        on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
        off: () => {},
        open: async () => {},
        dispose: () => {},
      }),
      onFacts: () => {},
    })
    const emit = (event: { type: string; [key: string]: unknown }) => handlers.get('event')?.(event)
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    void lifecycle.refresh()
    for (let i = 0; i < 200 && pending === undefined; i++) await new Promise(r => setTimeout(r, 5))
    // The newer event arrives while the snapshot RPC is still in flight.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    resolveList!([{ sessionId: 's1', running: false, updatedAt: 3, blank: false }])
    for (let i = 0; i < 100 && listCall < 2; i++) await new Promise(r => setTimeout(r, 5))
    // The stale "idle" snapshot must not roll the session back: the newer
    // running=true event wins, and no false completion edge is manufactured.
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a refresh re-baselines the archive set (reconnecting after archive changes)', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    let archiveCalls = 0
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels: tunnel,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: async () => [{ sessionId: 's1', running: false, updatedAt: 2, blank: false }],
        listWorkspaces: async () => {
          archiveCalls += 1
          // Connect: nothing archived. Refresh (reconnect): s1 got archived
          // while we were away — workspace.list is the reconcile baseline.
          return archiveCalls === 1
            ? { items: [], archivedSessionIds: [] }
            : { items: [], archivedSessionIds: ['s1'] }
        },
      }),
      createStream: () => ({
        on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
        off: () => {},
        open: async () => {},
        dispose: () => {},
      }),
      onFacts: () => {},
    })
    const emit = (event: { type: string; [key: string]: unknown }) => handlers.get('event')?.(event)
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().state !== 'READY'; i++) await new Promise(r => setTimeout(r, 5))
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])
    // Reconnect baseline reports s1 archived: the reminder must clear and the
    // session must leave the counts (archived = disposed of in the UI).
    await lifecycle.refresh()
    expect(lifecycle.current().sessionStatuses).toEqual([])
    // Restoring the session (not archived anymore) must NOT re-light the old
    // reminder without a genuinely new run.
    await lifecycle.refresh()
    expect(lifecycle.current().sessionStatuses).toEqual([])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('an archive event arriving during the baseline RPC is not rolled back by the stale snapshot', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    let resolveList: ((value: { items: { workspaceId: string }[]; archivedSessionIds: string[] }) => void) | undefined
    let pending: Promise<{ items: { workspaceId: string }[]; archivedSessionIds: string[] }> | undefined
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels: tunnel,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: async () => [{ sessionId: 's1', running: true, updatedAt: 1, blank: false }],
        listWorkspaces: () => {
          if (pending !== undefined) return pending
          pending = new Promise(resolve => { resolveList = resolve })
          return pending
        },
      }),
      createStream: () => ({
        on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
        off: () => {},
        open: async () => {},
        dispose: () => {},
      }),
      onFacts: () => {},
    })
    const emit = (event: { type: string; [key: string]: unknown }) => handlers.get('event')?.(event)
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().state !== 'READY'; i++) await new Promise(r => setTimeout(r, 5))
    // Refresh whose workspace.list response is delayed; while in flight the
    // NEWER archived-sessions-changed event arrives.
    void lifecycle.refresh()
    for (let i = 0; i < 200 && pending === undefined; i++) await new Promise(r => setTimeout(r, 5))
    emit({ type: 'archived-sessions-changed', deviceId: 'd1', archivedSessionIds: ['s1'] })
    resolveList!({ items: [], archivedSessionIds: [] })
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 0; i++) await new Promise(r => setTimeout(r, 5))
    // The buffered event (newer) wins over the stale baseline: s1 is archived,
    // so its running bit must not count.
    expect(lifecycle.current().runningSessionCount).toBe(0)
    expect(lifecycle.current().sessionStatuses).toEqual([])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a hung baseline aborts reconciliation and the connect attempt retries', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels: tunnel,
      baselineTimeoutMs: 60,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: () => new Promise(() => {}),
        listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
      }),
      createStream: () => ({
        on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
        off: () => {},
        open: async () => {},
        dispose: () => {},
      }),
      onFacts: () => {},
    })
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    // The baseline never resolves; the 60ms timeout aborts reconciliation and
    // the generation is torn down, so the device stays in CONNECTING.
    await new Promise(r => setTimeout(r, 200))
    expect(lifecycle.current().state).toBe('CONNECTING')
    expect(lifecycle.current().runningSessionCount).toBe(0)

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a recovery baseline works through an event buffer over the cap without dropping the tail', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    let resolveList: ((sessions: { sessionId: string; running: boolean; updatedAt: number; blank: boolean }[]) => void) | undefined
    const sessionsPromise = new Promise<{ sessionId: string; running: boolean; updatedAt: number; blank: boolean }[]>(resolve => {
      resolveList = resolve
    })
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels: tunnel,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: () => sessionsPromise,
        listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
      }),
      createStream: () => ({
        on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
        off: () => {},
        open: async () => {},
        dispose: () => {},
      }),
      onFacts: () => {},
    })
    const emit = (event: { type: string; [key: string]: unknown }) => handlers.get('event')?.(event)
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 200 && resolveList === undefined; i++) await new Promise(r => setTimeout(r, 5))
    // Wait until the stream handler is registered AND the baseline RPC is in
    // flight — only then do the emitted events reach the buffer.
    for (let i = 0; i < 200 && handlers.get('event') === undefined; i++) await new Promise(r => setTimeout(r, 5))
    expect(handlers.get('event')).toBeDefined()
    // Flood the buffer far past its cap while the baseline hangs; the tail
    // must survive and the reconciliation must still converge.
    for (let index = 0; index < EVENT_BUFFER_FLOOD; index += 1) {
      emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    }
    resolveList!([{ sessionId: 's1', running: false, updatedAt: 2, blank: false }])
    for (let i = 0; i < 100 && lifecycle.current().state !== 'READY'; i++) await new Promise(r => setTimeout(r, 5))
    // After replay (base idle + buffered running) the session is running.
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('clearAllCompleted() acknowledges every current generation and is idempotent, including in-flight edges', async () => {
    const { lifecycle, tunnel, emit } = device()
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's3', running: true })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
      { state: 'done', kind: 'completed', count: 1 },
    ])

    // Clear-all while s3 is still running (an edge for its generation is "in
    // flight" conceptually) must pre-acknowledge that generation so the
    // eventual idle frame does not resurrect a reminder for work already
    // cleared by the manual fallback.
    ;(lifecycle as unknown as { clearAllCompleted(): void }).clearAllCompleted()
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'ongoing', kind: 'running', count: 1 },
    ])
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's3', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([])

    // Idempotent: calling again with nothing outstanding changes nothing and
    // does not throw.
    expect(() => (lifecycle as unknown as { clearAllCompleted(): void }).clearAllCompleted()).not.toThrow()
    expect(lifecycle.current().sessionStatuses).toEqual([])

    // A subsequent genuinely new run-and-finish cycle still arms a reminder.
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: true })
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
  })

  it('a reconnect baseline reporting the same idle state preserves the still-unread reminder', async () => {
    const handlers = new Map<string, (event: { type: string; [key: string]: unknown }) => void>()
    const tunnel = new TunnelManager({
      spawn: () => new FakeProcess() as never,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    let listCall = 0
    const lifecycle = new DeviceLifecycle({
      record: record(),
      tunnels: tunnel,
      createClient: async () => ({
        probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
        listSessions: async () => {
          listCall += 1
          // First call (connect baseline): s1 running. A later reconnect
          // baseline (simulated here via refresh) reports s1 idle — matching
          // the in-memory idle state already set by the live completion edge
          // below, i.e. NOT a fresh false→true run edge.
          return listCall === 1
            ? [{ sessionId: 's1', running: true, updatedAt: 1, blank: false }]
            : [{ sessionId: 's1', running: false, updatedAt: 2, blank: false }]
        },
        listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
      }),
      createStream: () => ({
        on: (name: string, fn: (event: { type: string; [key: string]: unknown }) => void) => { handlers.set(name, fn) },
        off: () => {},
        open: async () => {},
        dispose: () => {},
      }),
      onFacts: () => {},
    })
    const emit = (event: { type: string; [key: string]: unknown }) => handlers.get('event')?.(event)
    const task = (lifecycle as { start(): void }).start() as unknown as Promise<void>
    for (let i = 0; i < 100 && lifecycle.current().runningSessionCount !== 1; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    emit({ type: 'session-status', deviceId: 'd1', sessionId: 's1', running: false })
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])
    // A reconnect-driven refresh baseline that reports s1 as still idle must
    // not clear or duplicate the still-unread reminder for the same generation.
    await lifecycle.refresh()
    expect(lifecycle.current().sessionStatuses).toEqual([
      { state: 'done', kind: 'completed', count: 1 },
    ])

    await lifecycle.stop()
    await task
    await tunnel.disposeAll()
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
        listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
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

  it('never reports a forward port to persist', async () => {
    const reported: [string, number][] = []
    const { lifecycle, tunnel } = portReportingDevice(reported, { kind: 'local', sshAlias: undefined })
    lifecycle.start()
    for (let i = 0; i < 100 && lifecycle.current().state !== 'READY'; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    expect(lifecycle.current().endpoint).toBe('http://127.0.0.1:3080/')
    expect(reported).toEqual([])
    await lifecycle.stop()
    await tunnel.disposeAll()
  })
})

/** Lifecycle wired with a port-reporting callback and a fake ssh spawner. */
function portReportingDevice(reported: [string, number][], overrides: Partial<DeviceRecord> = {}) {
  const tunnel = new TunnelManager({
    spawn: () => new FakeProcess() as never,
    readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
  })
  const lifecycle = new DeviceLifecycle({
    record: record(overrides),
    tunnels: tunnel,
    createClient: async () => ({
      probe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
      listSessions: async () => [],
      listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
    }),
    createStream: () => ({ on: () => {}, off: () => {}, open: async () => {}, dispose: () => {} }),
    onFacts: () => {},
    onLocalPort: (deviceId, localPort) => { reported.push([deviceId, localPort]) },
  })
  return { lifecycle, tunnel }
}

describe('device lifecycle local port persistence', () => {
  it('reports the bound port on a first connection so it can be persisted', async () => {
    const reported: [string, number][] = []
    const { lifecycle, tunnel } = portReportingDevice(reported)
    lifecycle.start()
    for (let i = 0; i < 200 && reported.length === 0; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    expect(reported).toHaveLength(1)
    expect(reported[0]![0]).toBe('d1')
    expect(lifecycle.current().endpoint).toBe(`http://127.0.0.1:${reported[0]![1]}/`)
    await lifecycle.stop()
    await tunnel.disposeAll()
  })

  it('passes the persisted port through and reports nothing when it is reused unchanged', async () => {
    const persisted = await reserveCandidatePort()
    const reported: [string, number][] = []
    const { lifecycle, tunnel } = portReportingDevice(reported, { localPort: persisted })
    lifecycle.start()
    for (let i = 0; i < 200 && lifecycle.current().state !== 'READY'; i++) {
      await new Promise(r => setTimeout(r, 5))
    }
    // Origin matches the persisted port, so the device's DSH web storage carries over.
    expect(lifecycle.current().endpoint).toBe(`http://127.0.0.1:${persisted}/`)
    // Nothing changed, so no registry write is requested.
    expect(reported).toEqual([])
    await lifecycle.stop()
    await tunnel.disposeAll()
  })
})
