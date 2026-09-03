import type { DeviceState, SessionActivitySummary } from '@dsh-cockpit/shared'
import { DualEventStream, Rc2Client } from './rc2-client.js'
import { TunnelManager } from './tunnel-manager.js'
import type { DeviceRecord } from '@dsh-cockpit/shared'

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
  /** Test seam for the rc.2 client (defaults to a real Rc2Client). */
  readonly createClient?: (endpoint: URL) => Promise<Pick<Rc2Client, 'probe' | 'listSessions'>> | Pick<Rc2Client, 'probe' | 'listSessions'>
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
  readonly #createClient: (endpoint: URL) => Promise<Pick<Rc2Client, 'probe' | 'listSessions'>> | Pick<Rc2Client, 'probe' | 'listSessions'>
  readonly #createStream: (endpoint: URL) => Pick<DualEventStream, 'on' | 'off' | 'open' | 'dispose'>
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
   * prior knowledge is what keeps subagents out of root-session counts. */
  #subagents = new Set<string>()
  /** Per-session pending interactions (official pendingInteractions: session →
   * key → status). A session's display status is a single value — pending
   * outranks running (official sessionStatuses). */
  #pendingBySession = new Map<string, Map<string, 'approval' | 'question'>>()
  #stateExplicit: DeviceState
  #diagnostic = ''
  #endpoint: URL | undefined
  #stream: Pick<DualEventStream, 'on' | 'off' | 'open' | 'dispose'> | undefined
  #client: Pick<Rc2Client, 'probe' | 'listSessions'> | undefined
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
   * Returns connected (stream opened) or false when probe/baseline failed. */
  async #connectRc2(endpoint: URL, onFailure: (() => Promise<void>) | undefined): Promise<boolean> {
    this.#client = await this.#createClient(endpoint)
    const probe = await this.#client.probe()
    if (!probe.ok) {
      this.#setState(probe.state, probe.diagnostic)
      await onFailure?.()
      this.#endpoint = undefined
      return false
    }
    // Baseline: the session.list baseline carries running bits; pending
    // interaction state is event-driven only (official SessionManager keeps
    // pendingInteractions manager-owned exactly the same way), so clear it.
    const sessions = await this.#client.listSessions()
    this.#refreshSubagents(sessions)
    this.#pendingBySession.clear()
    this.#syncSessions(sessions)

    this.#stream = this.#createStream(endpoint)
    this.#stream.on('event', event => {
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
        case 'session-removed':
          this.#sessions.delete(event.sessionId)
          this.#pendingBySession.delete(event.sessionId)
          this.#subagents.delete(event.sessionId)
          this.#archivedSessions.delete(event.sessionId)
          if (this.#bridgeSelection === event.sessionId) this.#bridgeSelection = undefined
          break
      }
      this.#emitFacts()
    })
    await this.#stream.open()
    this.#setState(probe.state === 'READY' ? 'READY' : 'DEGRADED', probe.diagnostic)
    return true
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
    try {
      const sessions = await this.#client.listSessions()
      this.#refreshSubagents(sessions)
      this.#pendingBySession.clear()
      this.#syncSessions(sessions)
      this.#emitFacts()
    } catch {
      // Keep last known facts; disconnect path will surface an error state.
    }
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
