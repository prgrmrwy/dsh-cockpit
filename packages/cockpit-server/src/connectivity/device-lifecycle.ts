import type { DeviceState, SessionActivitySummary } from '@dsh-cockpit/shared'
import { DualEventStream, Rc2Client } from './rc2-client.js'
import { TunnelManager } from './tunnel-manager.js'
import type { DeviceRecord } from '@dsh-cockpit/shared'

export interface LiveDeviceFacts {
  readonly deviceId: string
  readonly displayName: string
  readonly kind: DeviceRecord['kind']
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
  readonly #reconnectDelay: (attempt: number) => number
  readonly #createClient: (endpoint: URL) => Promise<Pick<Rc2Client, 'probe' | 'listSessions'>> | Pick<Rc2Client, 'probe' | 'listSessions'>
  readonly #createStream: (endpoint: URL) => Pick<DualEventStream, 'on' | 'off' | 'open' | 'dispose'>
  readonly #abort = new AbortController()
  /** Sessions whose current running bit is true (session.list baseline +
   * live session-status frames). Pending sessions stay in this set — the
   * official row shows them as warning (pending outranks running).
   * Subagent sessions are excluded: official rows filter origin !== 'subagent'
   * and fold their activity into the parent's subagent count. */
  #running = new Set<string>()
  /** Subagent session ids learned from the baseline (session.list origin) and
   * session-added frames; host/session-status carries no origin field, so this
   * prior knowledge is what keeps subagents out of root-session counts. */
  #subagents = new Set<string>()
  /** Per-session pending interactions (official pendingInteractions: session →
   * key → status). A session's display status is a single value — pending
   * outranks running (official sessionStatuses). */
  #pendingBySession = new Map<string, Map<string, 'approval' | 'question'>>()
  /** Last-observed running bit per session (official SessionManager
   * prevRunning). First observation only records the bit; the true→false edge
   * here arms the green "completed" reminder. */
  #prevRunning = new Map<string, boolean>()
  /** Sessions that finished running — the official green "done" reminder
   * (completedNotifications); cleared on re-run and session-removed. */
  #completed = new Set<string>()
  #stateExplicit: DeviceState = 'CONNECTING'
  #diagnostic = ''
  #endpoint: URL | undefined
  #stream: Pick<DualEventStream, 'on' | 'off' | 'open' | 'dispose'> | undefined
  #client: Pick<Rc2Client, 'probe' | 'listSessions'> | undefined
  #task: Promise<void> | undefined
  #stopped = false

  constructor(options: DeviceLifecycleOptions) {
    this.deviceId = options.record.deviceId
    this.#record = options.record
    this.#tunnels = options.tunnels
    this.#onFacts = options.onFacts
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
      enabled: this.#record.enabled,
      order: this.#record.order,
      state: this.#stateExplicit,
      runningSessionCount: this.#running.size,
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
    const runningNotPending = [...this.#running].filter(id => !pendingSessions.has(id)).length
    if (runningNotPending > 0) groups.push({ state: 'ongoing', kind: 'running', count: runningNotPending })
    const completedNotPending = [...this.#completed].filter(id => !pendingSessions.has(id))
    if (completedNotPending.length > 0) groups.push({ state: 'done', kind: 'completed', count: completedNotPending.length })
    return groups
  }

  /** Official completed-notification edge semantics over a full session list
   * (baseline/refresh): first observation only records the running bit —
   * sessions already idle at load get no reminder. A running→idle edge arms
   * the reminder; running again disarms it; a session that disappeared drops
   * both. */
  #syncCompleted(sessions: readonly { sessionId: string; running: boolean; origin?: string }[]): void {
    const seen = new Set<string>()
    for (const s of sessions) {
      if (s.origin === 'subagent') {
        // Subagents never contribute to root-session completion reminders.
        this.#subagents.add(s.sessionId)
        continue
      }
      seen.add(s.sessionId)
      const prev = this.#prevRunning.get(s.sessionId)
      if (prev === undefined) {
        this.#prevRunning.set(s.sessionId, s.running)
        continue
      }
      if (prev && !s.running) this.#completed.add(s.sessionId)
      else if (s.running) this.#completed.delete(s.sessionId)
      this.#prevRunning.set(s.sessionId, s.running)
    }
    for (const id of this.#prevRunning.keys()) if (!seen.has(id)) this.#prevRunning.delete(id)
    for (const id of this.#completed) if (!seen.has(id)) this.#completed.delete(id)
  }

  /** Incremental edge from a single live session-status frame. */
  #observeRunning(sessionId: string, running: boolean): void {
    const prev = this.#prevRunning.get(sessionId)
    if (prev === undefined) {
      this.#prevRunning.set(sessionId, running)
      return
    }
    if (prev && !running) this.#completed.add(sessionId)
    else if (running) this.#completed.delete(sessionId)
    this.#prevRunning.set(sessionId, running)
  }

  /** Replace the running set from a full session list baseline; subagents are
   * tracked separately and excluded from root-session counts. */
  #refreshRunning(sessions: readonly { sessionId: string; running: boolean; origin?: string }[]): void {
    this.#running.clear()
    this.#subagents.clear()
    for (const s of sessions) {
      if (s.origin === 'subagent') {
        this.#subagents.add(s.sessionId)
        continue
      }
      if (s.running) this.#running.add(s.sessionId)
    }
  }

  /** Exclude subagent sessions from root-session status sets. */
  #pruneSubagents(): void {
    for (const id of this.#subagents) {
      this.#running.delete(id)
      this.#completed.delete(id)
      this.#prevRunning.delete(id)
      this.#pendingBySession.delete(id)
    }
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

  /** Clear exactly one session's completion reminder (the official select
   * semantics: opening a session dismisses only that session's green dot).
   * prevRunning is kept — the next true→false edge must still re-arm. */
  clearCompletedSession(sessionId: string): void {
    if (!this.#completed.delete(sessionId)) return
    this.#emitFacts()
  }

  start(): void {
    if (this.#task !== undefined) return
    this.#task = this.#run()
  }

  updateRecord(record: DeviceRecord): void {
    this.#record = record
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#abort.abort(new Error('device stopped'))
    await this.#stream?.dispose()
    await this.#tunnels.disposeNode(this.deviceId)
  }

  /** Force a reconnect of this single device: tear down the current attempt and
   * restart the connect loop. Connected devices are untouched. */
  async reconnect(): Promise<void> {
    if (this.#stopped) return
    await this.#stream?.dispose()
    await this.#tunnels.disposeNode(this.deviceId)
    this.#stream = undefined
    this.#endpoint = undefined
    this.#setState('CONNECTING', 'manual reconnect')
    this.#restartLoop()
  }

  #restartLoop(): void {
    const previous = this.#task
    this.#task = this.#run()
    void previous?.catch(() => {})
  }

  async #run(): Promise<void> {
    let attempt = 0
    while (!this.#abort.signal.aborted && !this.#stopped) {
      if (!this.#record.enabled) {
        this.#setState('CONNECTING', 'device disabled')
        attempt = 0
        await this.#delay(500)
        continue
      }
      try {
        const connected = await this.#connectOnce()
        if (!connected) {
          // Probe/baseline failed: the stream never opened, so waiting on a
          // disconnect would hang forever. Retry with backoff immediately.
          const delay = this.#reconnectDelay(attempt)
          attempt += 1
          this.#setState('CONNECTING', `reconnecting in ${delay}ms`)
          await this.#delay(delay)
          continue
        }
        attempt = 0
        // Stay connected until the stream drops; then reconnect with backoff.
        await this.#waitForDisconnect()
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        this.#setState(message.includes('shut down') ? 'TUNNEL_ERROR' : 'SSH_UNREACHABLE', message)
      }
      const delay = this.#reconnectDelay(attempt)
      attempt += 1
      await this.#delay(delay)
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
    })
    this.#endpoint = handle.endpoint
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
    this.#refreshRunning(sessions)
    this.#pendingBySession.clear()
    this.#syncCompleted(sessions)

    this.#stream = this.#createStream(endpoint)
    this.#stream.on('event', event => {
      switch (event.type) {
        case 'session-status':
          // host/session-status carries no origin; a session known as a
          // subagent (baseline origin or session-added) must not contribute to
          // root-session counts.
          if (this.#subagents.has(event.sessionId)) break
          this.#observeRunning(event.sessionId, event.running)
          if (event.running) this.#running.add(event.sessionId)
          else this.#running.delete(event.sessionId)
          break
        case 'interaction': {
          if (this.#subagents.has(event.sessionId)) break
          this.#trackInteraction(event.sessionId, event.rpcId, event.kind, event.resolved)
          break
        }
        case 'session-added':
          // session-added carries the origin marker; remember subagents so the
          // origin-less status frames stay excluded.
          if (event.origin === 'subagent') {
            this.#subagents.add(event.sessionId)
            this.#pruneSubagents()
          }
          break
        case 'session-removed':
          this.#prevRunning.delete(event.sessionId)
          this.#completed.delete(event.sessionId)
          this.#pendingBySession.delete(event.sessionId)
          this.#running.delete(event.sessionId)
          this.#subagents.delete(event.sessionId)
          break
      }
      this.#emitFacts()
    })
    await this.#stream.open()
    this.#setState(probe.state === 'READY' ? 'READY' : 'DEGRADED', probe.diagnostic)
    return true
  }

  #waitForDisconnect(): Promise<void> {
    return new Promise(resolve => {
      const onDisconnect = () => {
        this.#stream?.off('disconnect', onDisconnect)
        // The tunnel died: surface the transition immediately instead of
        // pretending the device is still live while reconnect runs.
        this.#setState('CONNECTING', 'event stream disconnected, reconnecting')
        resolve()
      }
      this.#stream?.on('disconnect', onDisconnect)
    })
  }

  async refresh(): Promise<void> {
    if (this.#client === undefined) return
    try {
      const sessions = await this.#client.listSessions()
      this.#refreshRunning(sessions)
      this.#pendingBySession.clear()
      this.#syncCompleted(sessions)
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

  #delay(ms: number): Promise<void> {
    if (this.#abort.signal.aborted) return Promise.resolve()
    return new Promise(resolve => {
      const timer = setTimeout(done, ms)
      function done(): void {
        clearTimeout(timer)
        resolve()
      }
      this.#abort.signal.addEventListener('abort', done, { once: true })
    })
  }
}