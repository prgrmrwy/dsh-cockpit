import type { DeviceConnectionStatus, DeviceState } from '@dsh-cockpit/shared'
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
  #runningSessions = 0
  #pendingInteractions = 0
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
      runningSessionCount: this.#runningSessions,
      pendingInteractionCount: this.#pendingInteractions,
      compatibility: this.#stateExplicit === 'READY' || this.#stateExplicit === 'DEGRADED' ? 'SUPPORTED' : 'INCOMPATIBLE',
      lastUpdatedAt: Date.now(),
      ...(this.#diagnostic === '' ? {} : { diagnostic: this.#diagnostic }),
      ...(this.#endpoint === undefined ? {} : { endpoint: this.#endpoint.toString() }),
    }
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
        await this.#connectOnce()
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

  async #connectOnce(): Promise<void> {
    if (this.#abort.signal.aborted) throw new Error('aborted')
    const handle = await this.#tunnels.connect({
      deviceId: this.deviceId,
      sshAlias: this.#record.sshAlias ?? '',
      remoteDshPort: this.#record.remoteDshPort,
    })
    this.#endpoint = handle.endpoint
    this.#client = await this.#createClient(handle.endpoint)
    const probe = await this.#client.probe()
    if (!probe.ok) {
      this.#setState(probe.state, probe.diagnostic)
      await handle.dispose()
      this.#endpoint = undefined
      return
    }
    // Baseline.
    const sessions = await this.#client.listSessions()
    this.#runningSessions = sessions.filter(s => s.running).length
    this.#pendingInteractions = 0

    this.#stream = this.#createStream(handle.endpoint)
    this.#stream.on('event', event => {
      switch (event.type) {
        case 'session-status':
          if (event.running) this.#runningSessions += 1
          else this.#runningSessions = Math.max(0, this.#runningSessions - 1)
          break
        case 'interaction':
          this.#pendingInteractions += event.resolved ? -1 : 1
          if (this.#pendingInteractions < 0) this.#pendingInteractions = 0
          break
        case 'session-added':
        case 'session-removed':
          // Re-baseline lazily: refresh() reconciles exact counts.
          break
      }
      this.#emitFacts()
    })
    await this.#stream.open()
    this.#setState(probe.state === 'READY' ? 'READY' : 'DEGRADED', probe.diagnostic)
  }

  #waitForDisconnect(): Promise<void> {
    return new Promise(resolve => {
      const onDisconnect = () => {
        this.#stream?.off('disconnect', onDisconnect)
        resolve()
      }
      this.#stream?.on('disconnect', onDisconnect)
    })
  }

  async refresh(): Promise<void> {
    if (this.#client === undefined) return
    try {
      const sessions = await this.#client.listSessions()
      this.#runningSessions = sessions.filter(s => s.running).length
      this.#pendingInteractions = 0
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