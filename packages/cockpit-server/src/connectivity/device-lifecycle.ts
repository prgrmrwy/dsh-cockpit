import { Logger } from '@nestjs/common'
import type { CockpitEvent, DeviceState, SessionActivitySummary } from '@dsh-cockpit/shared'
import { DualEventStream, Rc2Client } from './rc2-client.js'
import { TunnelManager } from './tunnel-manager.js'
import type { DeviceRecord } from '@dsh-cockpit/shared'

/** Completion-coordination retention ceiling: one entry per session id ever
 * observed. Live detach keeps entries for lineage continuity, so the map is
 * pruned back to this bound with conservative eviction rules (see
 * #pruneSessions). */
const SESSION_RETENTION_MAX = 2_000
/** While a baseline reconciliation is in flight, stream events are buffered
 * instead of applied; this caps the buffer against pathological floods. */
const EVENT_BUFFER_CAP = 2_000

export interface LiveDeviceFacts {
  readonly deviceId: string
  readonly displayName: string
  readonly kind: DeviceRecord['kind']
  readonly sshAlias?: string
  readonly remoteDshPort: number
  readonly enabled: boolean
  readonly order: number
  readonly state: DeviceState
  readonly runningSessionCount: number
  readonly pendingInteractionCount: number
  readonly sessionStatuses: readonly SessionActivitySummary[]
  readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
  readonly lastUpdatedAt: number
  readonly diagnostic?: string
  readonly endpoint?: string
}

/** One device's connection lifecycle. Owns exactly one tunnel generation and
 * one pair of event streams at a time; cleanup is terminal. */
export interface DeviceLifecycleOptions {
  readonly record: DeviceRecord
  readonly tunnels: TunnelManager
  readonly sshExecutable?: string
  readonly reconnectDelay?: (attempt: number) => number
  readonly onFacts: (facts: LiveDeviceFacts) => void
  /** Reports the local forward port a remote tunnel actually bound, so the
   * owner can persist it as this device's stable port. */
  readonly onLocalPort?: (deviceId: string, localPort: number) => void
  /** Bounded wait for baseline RPCs during reconciliation. On expiry the
   * connect attempt is abandoned (backoff retry) or refresh keeps its last
   * facts; buffered events are still applied before returning. */
  readonly baselineTimeoutMs?: number
  /** Test seam for the rc.2 client (defaults to a real Rc2Client). */
  readonly createClient?: (endpoint: URL) => Promise<Pick<Rc2Client, 'probe' | 'listSessions' | 'listWorkspaces'>> | Pick<Rc2Client, 'probe' | 'listSessions' | 'listWorkspaces'>
  /** Test seam for the dual event stream (defaults to a real DualEventStream). */
  readonly createStream?: (endpoint: URL) => Pick<DualEventStream, 'on' | 'off' | 'open' | 'dispose'>
}

export class DeviceLifecycle {
  readonly deviceId: string
  #record: DeviceRecord
  readonly #tunnels: TunnelManager
  readonly #onFacts: (facts: LiveDeviceFacts) => void
  readonly #onLocalPort: ((deviceId: string, localPort: number) => void) | undefined
  readonly #reconnectDelay: (attempt: number) => number
  readonly #baselineTimeoutMs: number
  readonly #createClient: (endpoint: URL) => Promise<Pick<Rc2Client, 'probe' | 'listSessions' | 'listWorkspaces'>> | Pick<Rc2Client, 'probe' | 'listSessions' | 'listWorkspaces'>
  readonly #createStream: (endpoint: URL) => Pick<DualEventStream, 'on' | 'off' | 'open' | 'dispose'>
  readonly #log = new Logger(DeviceLifecycle.name)
  readonly #abort = new AbortController()
  #runAbort: AbortController | undefined
  #reconnectTask: Promise<void> | undefined
  /** Volatile completion coordination for one root-session generation. A
   * false→true edge starts a generation; an acknowledgement belongs only to
   * that generation, so it cannot suppress a later run. Unobserved entries are
   * allowed when a bridge acknowledgement beats the first status frame. */
  #sessions = new Map<string, {
    observed: boolean
    running: boolean
    generation: number
    acknowledgedGeneration: number | undefined
    completedGeneration: number | undefined
  }>()
  /** Current bridge selection. Selection is independent from the event stream
   * and therefore must participate in completion-edge convergence. */
  #bridgeSelection: string | undefined
  /** Latest complete archive snapshot. Archive is reversible and therefore
   * never deletes generation state; session-removed is the deletion fact. */
  #archivedSessions = new Set<string>()
  /** Subagent session ids learned from the baseline (session.list origin) and
   * session-added frames; host/session-status carries no origin field, so this
   * prior knowledge is what keeps subagents out of root-session counts. Live
   * detach (session-removed) KEEPS this knowledge. */
  #subagents = new Set<string>()
  /** Per-session pending interactions (official pendingInteractions: session →
   * key → status). A session's display status is a single value — pending
   * outranks running (official sessionStatuses). */
  #pendingBySession = new Map<string, Map<string, 'approval' | 'question'>>()
  /** True while a baseline reconciliation is in flight: stream events are
   * queued to #eventBuffer and never applied directly, so a stale snapshot
   * cannot roll back newer wire facts. This is the single write gate for all
   * stream events. */
  #buffering = false
  #eventBuffer: CockpitEvent[] = []
  /** Reconcile single-flight: connect, reconnect and manual refresh share one
   * routine and must not interleave. */
  #reconciling = false
  /** Session ids present in the most recent successful baseline; entries
   * absent from it and otherwise inactive become retention-eviction
   * candidates. */
  #lastBaselineSeen = new Set<string>()
  #stateExplicit: DeviceState
  #diagnostic = ''
  #endpoint: URL | undefined
  #stream: Pick<DualEventStream, 'on' | 'off' | 'open' | 'dispose'> | undefined
  #client: Pick<Rc2Client, 'probe' | 'listSessions' | 'listWorkspaces'> | undefined
  #task: Promise<void> | undefined
  #stopped = false

  constructor(options: DeviceLifecycleOptions) {
    this.deviceId = options.record.deviceId
    this.#record = options.record
    this.#stateExplicit = options.record.enabled ? 'CONNECTING' : 'DISABLED'
    this.#diagnostic = options.record.enabled ? '' : 'device disabled'
    this.#tunnels = options.tunnels
    this.#onFacts = options.onFacts
    this.#onLocalPort = options.onLocalPort
    this.#reconnectDelay = options.reconnectDelay ?? (attempt => Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)))
    this.#baselineTimeoutMs = options.baselineTimeoutMs ?? 5_000
    this.#createClient = options.createClient ?? (async endpoint => new Rc2Client({ endpoint }))
    this.#createStream = options.createStream ?? (endpoint => new DualEventStream({ endpoint, deviceId: this.deviceId }))
  }

  /** Facts currently aggregated for this device. */
  current(): LiveDeviceFacts {
    return {
      deviceId: this.deviceId,
      displayName: this.#record.displayName,
      kind: this.#record.kind,
      ...(this.#record.sshAlias === undefined ? {} : { sshAlias: this.#record.sshAlias }),
      remoteDshPort: this.#record.remoteDshPort,
      enabled: this.#record.enabled,
      order: this.#record.order,
      state: this.#stateExplicit,
      runningSessionCount: this.#runningSessionIds().size,
      pendingInteractionCount: this.#totalPendingKeys(),
      sessionStatuses: this.#sessionStatuses(),
      compatibility: this.#stateExplicit === 'READY' || this.#stateExplicit === 'DEGRADED' ? 'SUPPORTED' : 'INCOMPATIBLE',
      lastUpdatedAt: Date.now(),
      ...(this.#diagnostic === '' ? {} : { diagnostic: this.#diagnostic }),
      ...(this.#endpoint === undefined ? {} : { endpoint: this.#endpoint.toString() }),
    }
  }

  /** Official session-row status groups, non-zero only, ordered by official
   * priority — mirrors dsh-client-ui-workspace sessionStatuses: a pending
   * interaction outranks running (an awaiting-decision session is shown as
   * warning, never as ongoing), then running, then completed. Per session at
   * most one pending state is surfaced (official buildListSnapshot reduction:
   * a non-approval status wins over approval), so counts are per session. */
  #sessionStatuses(): readonly SessionActivitySummary[] {
    const pendingByKind = new Map<'approval' | 'question', Set<string>>()
    for (const [sessionId, interactions] of this.#pendingBySession) {
      if (interactions.size === 0) continue
      const statuses = [...interactions.values()]
      const kind = (statuses.find(status => status !== 'approval') ?? statuses[0]) as 'approval' | 'question'
      const sessions = pendingByKind.get(kind) ?? new Set<string>()
      sessions.add(sessionId)
      pendingByKind.set(kind, sessions)
    }
    const pendingSessions = new Set<string>()
    const groups: SessionActivitySummary[] = []
    for (const kind of ['approval', 'question'] as const) {
      const sessions = pendingByKind.get(kind)
      if (sessions === undefined || sessions.size === 0) continue
      for (const id of sessions) pendingSessions.add(id)
      groups.push({ state: 'warning', kind, count: sessions.size })
    }
    // Sessions whose session.list running bit is true but that are awaiting
    // human decision must NOT be counted as ongoing (official priority).
    const runningNotPending = [...this.#runningSessionIds()].filter(id => !pendingSessions.has(id)).length
    if (runningNotPending > 0) groups.push({ state: 'ongoing', kind: 'running', count: runningNotPending })
    const completedNotPending = [...this.#completedSessionIds()].filter(id => !pendingSessions.has(id))
    if (completedNotPending.length > 0) groups.push({ state: 'done', kind: 'completed', count: completedNotPending.length })
    return groups
  }

  #runningSessionIds(): Set<string> {
    const ids = new Set<string>()
    for (const [id, state] of this.#sessions) {
      if (state.observed && state.running && !this.#subagents.has(id) && !this.#archivedSessions.has(id)) ids.add(id)
    }
    return ids
  }

  #completedSessionIds(): Set<string> {
    const ids = new Set<string>()
    for (const [id, state] of this.#sessions) {
      if (state.completedGeneration === state.generation && !this.#subagents.has(id) && !this.#archivedSessions.has(id)) ids.add(id)
    }
    return ids
  }

  #sessionState(sessionId: string): {
    observed: boolean
    running: boolean
    generation: number
    acknowledgedGeneration: number | undefined
    completedGeneration: number | undefined
  } {
    let state = this.#sessions.get(sessionId)
    if (state === undefined) {
      state = { observed: false, running: false, generation: 0, acknowledgedGeneration: undefined, completedGeneration: undefined }
      this.#sessions.set(sessionId, state)
    }
    return state
  }

  /** Apply a full baseline without treating absence as removal. Only an
   * authoritative session-removed frame may erase generation/ack state. */
  #syncSessions(sessions: readonly { sessionId: string; running: boolean; origin?: string }[]): void {
    for (const s of sessions) {
      if (s.origin === 'subagent') {
        this.#subagents.add(s.sessionId)
        this.#pruneSubagent(s.sessionId)
        continue
      }
      this.#observeRunning(s.sessionId, s.running)
    }
  }

  /** Incremental or baseline running observation. First observation establishes
   * a baseline only. A subsequent false→true edge starts a fresh generation;
   * true→false completes it unless that generation was acknowledged or is
   * currently selected. */
  #observeRunning(sessionId: string, running: boolean): void {
    const state = this.#sessionState(sessionId)
    if (!state.observed) {
      state.observed = true
      state.running = running
      return
    }
    if (!state.running && running) {
      state.generation += 1
      state.running = true
      state.acknowledgedGeneration = undefined
      state.completedGeneration = undefined
      return
    }
    if (state.running && !running) {
      state.running = false
      const acknowledged = state.acknowledgedGeneration === state.generation
        || this.#bridgeSelection === sessionId
        || this.#archivedSessions.has(sessionId)
      state.completedGeneration = acknowledged ? undefined : state.generation
    }
  }

  /** Replace subagent knowledge from a full list while preserving root-session
   * generation state for entries temporarily absent from that list. */
  #refreshSubagents(sessions: readonly { sessionId: string; origin?: string }[]): void {
    for (const s of sessions) {
      if (s.origin !== 'subagent') continue
      this.#subagents.add(s.sessionId)
      this.#pruneSubagent(s.sessionId)
    }
  }

  #pruneSubagent(sessionId: string): void {
    this.#sessions.delete(sessionId)
    this.#pendingBySession.delete(sessionId)
    if (this.#bridgeSelection === sessionId) this.#bridgeSelection = undefined
    this.#archivedSessions.delete(sessionId)
  }

  /** Official trackPending/resolvePending semantics per session: add or settle
   * one stable pending-interaction key without disturbing sibling waits. */
  #trackInteraction(sessionId: string, key: string, kind: 'approval' | 'question', resolved: boolean): void {
    let interactions = this.#pendingBySession.get(sessionId)
    if (interactions === undefined) {
      interactions = new Map()
      this.#pendingBySession.set(sessionId, interactions)
    }
    if (resolved) {
      interactions.delete(key)
      if (interactions.size === 0) this.#pendingBySession.delete(sessionId)
      return
    }
    if (!interactions.has(key)) interactions.set(key, kind)
  }

  /** Total outstanding pending keys (sum of per-session interaction maps). */
  #totalPendingKeys(): number {
    let total = 0
    for (const interactions of this.#pendingBySession.values()) total += interactions.size
    return total
  }

  /** Record the bridge's selected-session snapshot. Selecting a session also
   * acknowledges its current generation, allowing ack-before-edge and
   * edge-before-ack to converge. Passing undefined clears only the selected
   * snapshot; it does not revoke an acknowledgement already made. */
  setBridgeSelection(sessionId: string | undefined): void {
    const selectionChanged = this.#bridgeSelection !== sessionId
    this.#bridgeSelection = sessionId
    if (sessionId === undefined || this.#subagents.has(sessionId)) {
      if (selectionChanged) this.#emitFacts()
      return
    }
    const state = this.#sessionState(sessionId)
    const hadCompleted = state.completedGeneration === state.generation
    state.acknowledgedGeneration = state.generation
    state.completedGeneration = undefined
    if (selectionChanged || hadCompleted) this.#emitFacts()
  }

  /** Acknowledge exactly one session's current generation without changing the
   * selected snapshot. This is the per-session bridge ack API. */
  clearCompleted(sessionId: string): void {
    if (this.#subagents.has(sessionId)) return
    const state = this.#sessionState(sessionId)
    const hadCompleted = state.completedGeneration === state.generation
    const newlyAcknowledged = state.acknowledgedGeneration !== state.generation
    state.acknowledgedGeneration = state.generation
    state.completedGeneration = undefined
    if (hadCompleted || newlyAcknowledged) this.#emitFacts()
  }

  /** Acknowledge every known root-session generation, including generations
   * whose completion edge is still in flight. */
  clearAllCompleted(): void {
    let changed = false
    for (const [sessionId, state] of this.#sessions) {
      if (this.#subagents.has(sessionId)) continue
      if (state.acknowledgedGeneration !== state.generation || state.completedGeneration !== undefined) changed = true
      state.acknowledgedGeneration = state.generation
      state.completedGeneration = undefined
    }
    if (changed) this.#emitFacts()
  }

  /** Backward-compatible name used by the legacy bridge service. */
  clearCompletedSession(sessionId: string): void {
    this.clearCompleted(sessionId)
  }

  start(): void {
    if (!this.#record.enabled || this.#stopped || this.#task !== undefined) return
    this.#task = this.#run()
  }

  updateRecord(record: DeviceRecord): void {
    this.#record = record
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#abort.abort(new Error('device stopped'))
    this.#runAbort?.abort(new Error('device stopped'))
    await this.#stream?.dispose()
    await this.#tunnels.disposeNode(this.deviceId)
    await this.#task?.catch(() => {})
    this.#stream = undefined
    this.#client = undefined
    this.#endpoint = undefined
    this.#sessions.clear()
    this.#subagents.clear()
    this.#pendingBySession.clear()
    this.#archivedSessions.clear()
    this.#bridgeSelection = undefined
    if (!this.#record.enabled) this.#setState('DISABLED', 'device disabled')
  }

  /** Force a reconnect of this single device: tear down the current attempt and
   * replace the connect loop exactly once. Concurrent reconnect requests share
   * the same replacement so stale loops cannot race for the tunnel generation. */
  async reconnect(): Promise<void> {
    if (this.#stopped || !this.#record.enabled) return
    if (this.#reconnectTask !== undefined) return this.#reconnectTask
    this.#reconnectTask = this.#replaceLoop()
    try {
      await this.#reconnectTask
    } finally {
      this.#reconnectTask = undefined
    }
  }

  async #replaceLoop(): Promise<void> {
    this.#runAbort?.abort(new Error('manual reconnect'))
    await this.#stream?.dispose()
    await this.#tunnels.disposeNode(this.deviceId)
    await this.#task?.catch(() => {})
    if (this.#stopped || !this.#record.enabled) return
    this.#stream = undefined
    this.#client = undefined
    this.#endpoint = undefined
    this.#setState('CONNECTING', 'manual reconnect')
    this.#task = this.#run()
  }

  async #run(): Promise<void> {
    const runAbort = new AbortController()
    this.#runAbort = runAbort
    let attempt = 0
    try {
      while (!this.#abort.signal.aborted && !runAbort.signal.aborted && !this.#stopped) {
        if (!this.#record.enabled) {
          this.#setState('DISABLED', 'device disabled')
          return
        }
        try {
          const connected = await this.#connectOnce()
          if (!connected) {
            // Probe/baseline failed: the stream never opened, so waiting on a
            // disconnect would hang forever. Retry with backoff immediately.
            const delay = this.#reconnectDelay(attempt)
            attempt += 1
            this.#setState('CONNECTING', `reconnecting in ${delay}ms`)
            await this.#delay(delay, runAbort.signal)
            continue
          }
          attempt = 0
          // Stay connected until the stream drops; then reconnect with backoff.
          await this.#waitForDisconnect(runAbort.signal)
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          this.#setState(message.includes('shut down') ? 'TUNNEL_ERROR' : 'SSH_UNREACHABLE', message)
        }
        const delay = this.#reconnectDelay(attempt)
        attempt += 1
        await this.#delay(delay, runAbort.signal)
      }
    } finally {
      if (this.#runAbort === runAbort) this.#runAbort = undefined
    }
  }

  /** Returns true when the device is connected (stream open); false when the
   * probe/baseline failed and the caller should retry with backoff instead of
   * waiting for a disconnect that will never arrive. */
  async #connectOnce(): Promise<boolean> {
    if (this.#abort.signal.aborted) throw new Error('aborted')
    if (this.#record.kind === 'local') {
      // This Mac: no tunnel. The DSH runs on the machine itself, so we target
      // the loopback port directly. Everything else (probe, baseline, streams)
      // is identical to a remote device.
      this.#endpoint = new URL(`http://127.0.0.1:${this.#record.remoteDshPort}`)
      return this.#connectRc2(this.#endpoint, undefined)
    }
    const handle = await this.#tunnels.connect({
      deviceId: this.deviceId,
      sshAlias: this.#record.sshAlias ?? '',
      remoteDshPort: this.#record.remoteDshPort,
      // Reuse the last known port so the workbench iframe origin stays stable
      // and the device's DSH web client keeps its origin-scoped storage.
      ...(this.#record.localPort === undefined ? {} : { preferredLocalPort: this.#record.localPort }),
    })
    this.#endpoint = handle.endpoint
    if (handle.localPort !== this.#record.localPort) this.#onLocalPort?.(this.deviceId, handle.localPort)
    return this.#connectRc2(handle.endpoint, async () => { await handle.dispose() })
  }

  /** Shared probe/baseline/stream wiring for local and remote endpoints.
   * Returns connected (stream opened) or false when probe/baseline failed.
   *
   * Ordering matters: the event streams are opened BEFORE any baseline RPC.
   * events.host does not replay state on open (upstream), so an edge that
   * happens while session.list/workspace.list are in flight would otherwise
   * be lost forever. With subscribe-first, those edges are buffered and
   * replayed after the baseline in arrival order. */
  async #connectRc2(endpoint: URL, onFailure: (() => Promise<void>) | undefined): Promise<boolean> {
    this.#client = await this.#createClient(endpoint)
    const probe = await this.#client.probe()
    if (!probe.ok) {
      this.#setState(probe.state, probe.diagnostic)
      await onFailure?.()
      this.#endpoint = undefined
      return false
    }
    this.#stream = this.#createStream(endpoint)
    this.#stream.on('event', event => this.#onStreamEvent(event))
    this.#buffering = true
    try {
      await this.#stream.open()
    } catch (cause) {
      this.#buffering = false
      const message = cause instanceof Error ? cause.message : String(cause)
      this.#log.warn(`${this.deviceId}: event stream open failed: ${message}`)
      await onFailure?.()
      this.#stream.dispose()
      this.#stream = undefined
      this.#endpoint = undefined
      return false
    }
    const reconciled = await this.#reconcileBaseline()
    if (reconciled !== 'ok') {
      // Baseline RPC failed/timed out. The buffered events were already
      // applied by the reconcile routine's unwind, but without a session
      // baseline the aggregation cannot be trusted: tear the generation down
      // and let the connect loop retry (events lost during a failed
      // connection are a documented protocol limitation, same as a drop).
      await this.#stream.dispose()
      this.#stream = undefined
      await onFailure?.()
      this.#endpoint = undefined
      return false
    }
    this.#setState(probe.state === 'READY' ? 'READY' : 'DEGRADED', probe.diagnostic)
    return true
  }

  /** Single wire gate for every stream event. While a baseline reconciliation
   * is in flight events are queued (bounded), never applied directly; the
   * reconcile routine replays them in arrival order AFTER the baseline, so a
   * stale snapshot can neither roll back newer events nor manufacture wrong
   * edges. */
  #onStreamEvent(event: CockpitEvent): void {
    if (this.#buffering) {
      if (this.#eventBuffer.length >= EVENT_BUFFER_CAP) this.#eventBuffer.shift()
      this.#eventBuffer.push(event)
      return
    }
    this.#applyEvent(event)
  }

  /** Apply one buffered or live event to the volatile aggregation state. */
  #applyEvent(event: CockpitEvent): void {
    switch (event.type) {
      case 'session-status':
        // host/session-status carries no origin; a session known as a
        // subagent (baseline origin or session-added) must not contribute to
        // root-session counts.
        if (this.#subagents.has(event.sessionId)) break
        this.#observeRunning(event.sessionId, event.running)
        break
      case 'interaction': {
        if (this.#subagents.has(event.sessionId)) break
        this.#trackInteraction(event.sessionId, event.rpcId, event.kind, event.resolved)
        break
      }
      case 'session-added':
        // session-added carries the origin marker; remember subagents so the
        // origin-less status frames stay excluded.
        if (event.origin === 'subagent' && event.sessionId !== undefined) {
          this.#subagents.add(event.sessionId)
          this.#pruneSubagent(event.sessionId)
        }
        break
      case 'archived-sessions-changed': {
        const nextArchived = new Set<string>(event.archivedSessionIds)
        for (const sessionId of nextArchived) {
          if (this.#subagents.has(sessionId)) continue
          const state = this.#sessions.get(sessionId)
          if (state !== undefined) {
            state.acknowledgedGeneration = state.generation
            state.completedGeneration = undefined
          }
          this.#pendingBySession.delete(sessionId)
          if (this.#bridgeSelection === sessionId) this.#bridgeSelection = undefined
        }
        this.#archivedSessions = nextArchived
        break
      }
      case 'session-removed': {
        // Live detach, NOT permanent deletion: drop the reminder and remove
        // the session from every count surface, but retain its generation/ack
        // lineage and the subagent classification, so a later reappearance
        // continues the same run identity and subagent status frames stay
        // excluded from root counts (session.list re-lists detached
        // persisted sessions as cold idle).
        const state = this.#sessions.get(event.sessionId)
        if (state !== undefined) {
          state.running = false
          state.completedGeneration = undefined
        }
        this.#pendingBySession.delete(event.sessionId)
        this.#archivedSessions.delete(event.sessionId)
        if (this.#bridgeSelection === event.sessionId) this.#bridgeSelection = undefined
        break
      }
    }
    this.#emitFacts()
  }

  /** One reconciliation routine shared by connect, reconnect and manual
   * refresh: buffer events, fetch both baselines (session + archive),
   * apply them, replay the buffer in order, then resume direct application.
   * Returns 'ok' | 'failed' | 'skipped' (another reconcile is in flight). */
  async #reconcileBaseline(): Promise<'ok' | 'failed' | 'skipped'> {
    if (this.#reconciling || this.#client === undefined) return 'skipped'
    this.#reconciling = true
    this.#buffering = true
    this.#eventBuffer = []
    let baseline: {
      sessions: { ok: true; value: Awaited<ReturnType<Rc2Client['listSessions']>> } | { ok: false; reason: unknown }
      workspace: { ok: true; value: Awaited<ReturnType<Rc2Client['listWorkspaces']>> } | { ok: false; reason: unknown }
    }
    try {
      baseline = await this.#fetchBaselines()
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      this.#log.warn(`${this.deviceId}: baseline fetch aborted: ${reason}`)
      return 'failed'
    }
    try {
      if (!baseline.sessions.ok) {
        const reason = baseline.sessions.reason instanceof Error ? baseline.sessions.reason.message : String(baseline.sessions.reason)
        this.#log.warn(`${this.deviceId}: session.list baseline failed: ${reason}`)
        return 'failed'
      }
      const sessions = baseline.sessions.value
      if (baseline.workspace.ok) {
        // Archive baseline: workspace.list is the reconnect baseline for the
        // archive set (events.host never replays it). In-flight
        // archived-sessions-changed events were buffered and replay below, so
        // they win over this (older) snapshot by construction.
        this.#archivedSessions = new Set(baseline.workspace.value.archivedSessionIds)
      } else {
        // Compatible devices without workspace.list: keep the archive set
        // event-driven (current behavior) and record the reason.
        const reason = baseline.workspace.reason instanceof Error ? baseline.workspace.reason.message : String(baseline.workspace.reason)
        this.#log.warn(`${this.deviceId}: workspace.list unavailable, archive baseline stays event-driven: ${reason}`)
      }
      this.#lastBaselineSeen = new Set(sessions.map(s => s.sessionId))
      this.#refreshSubagents(sessions)
      this.#pendingBySession.clear()
      this.#syncSessions(sessions)
      this.#replayBuffer()
      this.#pruneSessions()
      return 'ok'
    } finally {
      // Even on failure the buffered events are real wire facts: apply them
      // instead of dropping them (refresh keeps last facts when the baseline
      // itself failed).
      this.#applyEventBuffer()
      this.#buffering = false
      this.#eventBuffer = []
      this.#reconciling = false
    }
  }

  #applyEventBuffer(): void {
    for (const event of this.#eventBuffer.splice(0)) this.#applyEvent(event)
  }

  #replayBuffer(): void {
    // Replay is synchronous: no stream message can interleave, so the
    // buffered order is preserved exactly.
    this.#applyEventBuffer()
  }

  /** Fetch session.list + workspace.list in parallel under one bounded
   * timeout. Each result is normalized to { ok, value | reason } so a missing
   * workspace.list degrades without failing the connection. */
  async #fetchBaselines(): Promise<{
    sessions: { ok: true; value: Awaited<ReturnType<Rc2Client['listSessions']>> } | { ok: false; reason: unknown }
    workspace: { ok: true; value: Awaited<ReturnType<Rc2Client['listWorkspaces']>> } | { ok: false; reason: unknown }
  }> {
    const client = this.#client!
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`baseline timed out after ${this.#baselineTimeoutMs}ms`)), this.#baselineTimeoutMs)
      timer.unref?.()
    })
    try {
      const [sessions, workspace] = await Promise.race([
        Promise.allSettled([client.listSessions(), client.listWorkspaces()]),
        timeout,
      ]) as [
        PromiseSettledResult<Awaited<ReturnType<Rc2Client['listSessions']>>>,
        PromiseSettledResult<Awaited<ReturnType<Rc2Client['listWorkspaces']>>>,
      ]
      return {
        sessions: sessions.status === 'fulfilled'
          ? { ok: true, value: sessions.value }
          : { ok: false, reason: sessions.reason },
        workspace: workspace.status === 'fulfilled'
          ? { ok: true, value: workspace.value }
          : { ok: false, reason: workspace.reason },
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** Bounded retention for #sessions: live detach keeps entries for lineage,
   * so evict the least-recently-observed inactive entries once the cap is
   * exceeded. Eviction is conservative — never a running session, a session
   * with an unread completion reminder, the current bridge selection, an
   * archived session, a subagent, or a session present in the latest
   * baseline. */
  #pruneSessions(): void {
    if (this.#sessions.size <= SESSION_RETENTION_MAX) return
    const candidates: string[] = []
    for (const [sessionId, state] of this.#sessions) {
      if (state.running) continue
      if (state.completedGeneration === state.generation) continue
      if (this.#bridgeSelection === sessionId) continue
      if (this.#archivedSessions.has(sessionId)) continue
      if (this.#lastBaselineSeen.has(sessionId)) continue
      if (this.#subagents.has(sessionId)) continue
      candidates.push(sessionId)
    }
    // Insertion order approximates least-recently-observed.
    for (const sessionId of candidates) {
      if (this.#sessions.size <= SESSION_RETENTION_MAX) break
      this.#sessions.delete(sessionId)
    }
  }

  #waitForDisconnect(signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const stream = this.#stream
      const done = () => {
        stream?.off('disconnect', onDisconnect)
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      const onDisconnect = () => {
        // The tunnel died: surface the transition immediately instead of
        // pretending the device is still live while reconnect runs.
        this.#setState('CONNECTING', 'event stream disconnected, reconnecting')
        done()
      }
      const onAbort = () => { done() }
      if (signal.aborted) return done()
      stream?.on('disconnect', onDisconnect)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  async refresh(): Promise<void> {
    if (!this.#record.enabled || this.#stopped || this.#client === undefined) return
    // Shared reconciliation: buffered events are never dropped and stale
    // snapshots never roll back newer wire facts. On failure keep last known
    // facts; the disconnect path will surface an error state if the streams
    // actually died.
    await this.#reconcileBaseline().catch(cause => {
      this.#log.warn(`${this.deviceId}: refresh reconciliation failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
    this.#emitFacts()
  }

  #setState(state: DeviceState, diagnostic: string): void {
    this.#stateExplicit = state
    this.#diagnostic = diagnostic
    this.#emitFacts()
  }

  #emitFacts(): void {
    this.#onFacts(this.current())
  }

  #delay(ms: number, runSignal: AbortSignal): Promise<void> {
    if (this.#abort.signal.aborted || runSignal.aborted) return Promise.resolve()
    return new Promise(resolve => {
      const timer = setTimeout(done, ms)
      const lifecycleSignal = this.#abort.signal
      function done(): void {
        clearTimeout(timer)
        lifecycleSignal.removeEventListener('abort', done)
        runSignal.removeEventListener('abort', done)
        resolve()
      }
      lifecycleSignal.addEventListener('abort', done, { once: true })
      runSignal.addEventListener('abort', done, { once: true })
    })
  }
}
