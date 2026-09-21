import type { DeviceConnectionStatus, DeviceState } from '@dsh-cockpit/shared'
import { defaultSpawner, reserveCandidatePort, terminateChild, validateSshAlias, type OwnedProcess, type ProcessSpawner } from './ssh.js'

/** The reserved channel id of a device's workbench tunnel. Every device has at
 * most one; additional channels carry a caller-supplied id. */
export const WORKBENCH_CHANNEL = 'workbench'

export interface TunnelRequest {
  readonly deviceId: string
  readonly sshAlias: string
  /** Which tunnel of this device this request addresses. Defaults to the
   * workbench channel, so existing callers keep their exact behavior. Channels
   * are tracked independently: opening one never replaces another. */
  readonly channelId?: string
  readonly remoteDshPort: number
  /** Previously used local forward port for this device. Reusing it keeps the
   * workbench iframe origin (`http://127.0.0.1:<localPort>`) stable, so the
   * device's own DSH web client keeps its origin-scoped browser storage across
   * reconnects. Advisory only: an unavailable port falls back to a fresh one. */
  readonly preferredLocalPort?: number
}

export interface TunnelHandle {
  readonly deviceId: string
  readonly channelId: string
  readonly generation: number
  readonly endpoint: URL
  /** Local forward port actually bound by this tunnel; persist it as the next
   * connection's preferred port. */
  readonly localPort: number
  readonly diagnostic: string
  dispose(): Promise<void>
}

export interface TunnelManagerLogger {
  warn(message: string): void
}

export interface TunnelManagerOptions {
  readonly sshExecutable?: string
  readonly spawn?: ProcessSpawner
  readonly maxBindAttempts?: number
  readonly maxStderrBytes?: number
  readonly readinessProbe: (endpoint: URL, signal: AbortSignal) => Promise<{ ok: boolean; state: DeviceState; diagnostic: string }>
  readonly connectTimeoutSeconds?: number
  readonly serverAliveIntervalSeconds?: number
  readonly serverAliveCountMax?: number
  /** Optional sink for operational warnings (port drift, etc.). Omitted in
   * tests, where the manager stays silent and assertions read return values. */
  readonly logger?: TunnelManagerLogger
}

/** Attribution of an OpenSSH early exit: does its stderr indicate the local
 * forward port could not be bound, as opposed to a link/auth/readiness
 * failure? The default is deliberately conservative — anything not clearly a
 * port-bind failure returns false, so a stable origin is abandoned only on
 * strong evidence. stderr is untrusted input (remote-influenced banners can
 * land here), so the result is used ONLY to choose a local loopback port
 * number; it never enters argv or affects host-key checking. */
export function isPortBindFailure(stderr: string, port: number): boolean {
  const text = stderr.toLowerCase()
  const addressInUse = /bind \[[^\]]+\]:(\d+): address already in use/.exec(text)
  if (addressInUse) return Number(addressInUse[1]) === port
  const cannotListen = /cannot listen to port: (\d+)/.exec(text)
  if (cannotListen) return Number(cannotListen[1]) === port
  // Emitted under ExitOnForwardFailure=yes when local-forward setup fails; it
  // carries no port but is unambiguously a forwarding-bind failure.
  if (text.includes('could not request local forwarding')) return true
  return false
}

function tunnelArgs(request: TunnelRequest, localPort: number, options: Required<Pick<TunnelManagerOptions, 'connectTimeoutSeconds' | 'serverAliveIntervalSeconds' | 'serverAliveCountMax'>>): string[] {
  const remotePort = request.remoteDshPort
  return [
    '-N', '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', `ConnectTimeout=${options.connectTimeoutSeconds}`,
    '-o', `ServerAliveInterval=${options.serverAliveIntervalSeconds}`,
    '-o', `ServerAliveCountMax=${options.serverAliveCountMax}`,
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    '--', validateSshAlias(request.sshAlias),
  ]
}

/** Tracked tunnel guard: cleanup must be terminal. Once `disposeAll` runs, no
 * new tunnel may be spawned and an in-flight connect cannot leave an orphan. */
export class TunnelManager {
  readonly #options: Required<Pick<TunnelManagerOptions, 'spawn' | 'sshExecutable' | 'maxBindAttempts' | 'maxStderrBytes' | 'connectTimeoutSeconds' | 'serverAliveIntervalSeconds' | 'serverAliveCountMax'>> & Pick<TunnelManagerOptions, 'readinessProbe'>
  readonly #logger: TunnelManagerLogger | undefined
  /** Keyed by device AND channel: one device may hold its workbench tunnel plus
   * additional channels at the same time, so a second channel must never evict
   * the first. */
  readonly #active = new Map<string, { deviceId: string; channelId: string; generation: number; process: OwnedProcess; abort: AbortController; disposed: boolean }>()
  readonly #generations = new Map<string, number>()
  #shutDown = false

  constructor(options: TunnelManagerOptions) {
    this.#logger = options.logger
    this.#options = {
      readinessProbe: options.readinessProbe,
      sshExecutable: options.sshExecutable ?? 'ssh',
      spawn: options.spawn ?? defaultSpawner,
      maxBindAttempts: options.maxBindAttempts ?? 3,
      maxStderrBytes: options.maxStderrBytes ?? 8192,
      connectTimeoutSeconds: options.connectTimeoutSeconds ?? 5,
      serverAliveIntervalSeconds: options.serverAliveIntervalSeconds ?? 15,
      serverAliveCountMax: options.serverAliveCountMax ?? 3,
    }
  }

  async connect(request: TunnelRequest): Promise<TunnelHandle> {
    validateSshAlias(request.sshAlias)
    if (this.#shutDown) throw new Error('tunnel manager is shut down')
    const channelId = request.channelId ?? WORKBENCH_CHANNEL
    const key = channelKey(request.deviceId, channelId)
    // Replace only the SAME channel of this device. Other channels are
    // independent resources and must survive.
    await this.#disposeKey(key)
    const generation = (this.#generations.get(key) ?? 0) + 1
    this.#generations.set(key, generation)
    const persistedPort = sanitizePort(request.preferredLocalPort)
    // Once we have strong evidence the persisted port is unavailable, we stop
    // offering it for the rest of THIS connect — a single latch, never revived
    // by a later attempt's attribution. A link/auth/readiness failure leaves it
    // set, so one transient blip does not permanently drift the device origin.
    let abandonPreferred = false
    let lastDiagnostic = ''
    for (let attempt = 1; attempt <= this.#options.maxBindAttempts; attempt += 1) {
      const preferred = abandonPreferred ? undefined : persistedPort
      const reserved = await reserveCandidatePort(preferred)
      const localPort = reserved.port
      // Deterministic signal: our own listen on the preferred port failed. This
      // is the TOCTOU/occupied case the spec authorizes dropping the port for.
      if (reserved.preferredRejected) abandonPreferred = true
      if (this.#shutDown) throw new Error('tunnel manager is shut down')
      const process = this.#options.spawn(this.#options.sshExecutable, tunnelArgs(request, localPort, this.#options))
      const abort = new AbortController()
      const active = { deviceId: request.deviceId, channelId, generation, process, abort, disposed: false }
      this.#active.set(key, active)
      const chunks: Buffer[] = []
      let bytes = 0
      process.stderr.on('data', (chunk: Buffer) => {
        const remaining = this.#options.maxStderrBytes - bytes
        if (remaining <= 0) return
        chunks.push(chunk.subarray(0, remaining))
        bytes += Math.min(chunk.byteLength, remaining)
      })
      const diagnostic = () => Buffer.concat(chunks).toString('utf8').trim()
      const endpoint = new URL(`http://127.0.0.1:${localPort}`)
      const outcome = await Promise.race([
        process.exited.then(exit => ({ kind: 'exit' as const, exit })),
        this.#probeWithRetry(endpoint, abort.signal).then(result => ({ kind: 'ready' as const, result })),
      ])
      if (outcome.kind === 'exit') {
        lastDiagnostic = diagnostic()
        // Only a port-bind failure justifies abandoning the persisted port for
        // the remaining attempts. Anything else (link, auth, readiness) — and
        // any stderr we cannot classify — keeps the persisted port so a link
        // blip does not permanently drift the origin.
        if (persistedPort !== undefined && !abandonPreferred && localPort === persistedPort && isPortBindFailure(lastDiagnostic, localPort)) {
          abandonPreferred = true
        }
        this.#active.delete(key)
        await this.#terminate(process, 1000)
        if (this.#shutDown) throw new Error('tunnel manager is shut down')
        if (attempt < this.#options.maxBindAttempts) continue
        throw new Error(`OpenSSH exited before DSH readiness: ${truncate(lastDiagnostic, 200)}`)
      }
      if (!outcome.result.ok) {
        await this.#disposeExact(key, active)
        throw new Error(`${outcome.result.state}: ${outcome.result.diagnostic}`)
      }
      if (this.#active.get(key) !== active || active.disposed) {
        await this.#disposeExact(key, active)
        throw new Error('tunnel generation was replaced')
      }
      if (persistedPort !== undefined && localPort !== persistedPort) {
        this.#logger?.warn(`tunnel local port drift: device=${request.deviceId} channel=${channelId} from=${persistedPort} to=${localPort} reason=${abandonPreferred ? 'preferred-port-unavailable' : 'unknown'}`)
      }
      return {
        deviceId: request.deviceId,
        channelId,
        generation,
        endpoint,
        localPort,
        diagnostic: outcome.result.diagnostic,
        dispose: () => this.#disposeExact(key, active),
      }
    }
    throw new Error(`could not bind a loopback port: ${truncate(lastDiagnostic, 200)}`)
  }

  /** Dispose EVERY channel of one device. Device-scoped lifecycle events
   * (disable, delete, reconnect) own all of that device's tunnels, so leaving
   * an additional channel behind would outlive its device. */
  async disposeNode(deviceId: string): Promise<void> {
    const owned = [...this.#active].filter(([, active]) => active.deviceId === deviceId)
    await Promise.all(owned.map(([key, active]) => this.#disposeExact(key, active)))
  }

  /** Dispose one specific channel, leaving the device's other channels alone. */
  async disposeChannel(deviceId: string, channelId: string): Promise<void> {
    await this.#disposeKey(channelKey(deviceId, channelId))
  }

  async #disposeKey(key: string): Promise<void> {
    const active = this.#active.get(key)
    if (active !== undefined) await this.#disposeExact(key, active)
  }

  /** Terminal cleanup: refuses new tunnels and sweeps any straggler registered
   * mid-sweep by an in-flight connect. */
  async disposeAll(): Promise<void> {
    this.#shutDown = true
    await Promise.all([...this.#active].map(([key, active]) => this.#disposeExact(key, active)))
    await Promise.all([...this.#active].map(([key, active]) => this.#disposeExact(key, active)))
  }

  /** SSH tunnel binds are not atomic with connection readiness: retry briefly
   * before declaring the endpoint dead. */
  async #probeWithRetry(endpoint: URL, signal: AbortSignal): Promise<{ ok: boolean; state: DeviceState; diagnostic: string }> {
    let last: { ok: boolean; state: DeviceState; diagnostic: string } | undefined
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (signal.aborted) return { ok: false, state: 'DSH_UNAVAILABLE', diagnostic: 'probe aborted' }
      last = await this.#options.readinessProbe(endpoint, signal)
      if (last.ok) return last
      await new Promise(r => setTimeout(r, 500))
    }
    return last ?? { ok: false, state: 'DSH_UNAVAILABLE', diagnostic: 'probe failed' }
  }

  #disposeExact(key: string, active: { process: OwnedProcess; abort: AbortController; disposed: boolean }): Promise<void> {
    if (active.disposed) return Promise.resolve()
    active.disposed = true
    active.abort.abort(new Error('tunnel disposed'))
    if (this.#active.get(key) === active) this.#active.delete(key)
    return this.#terminate(active.process, 1000)
  }

  #terminate(process: OwnedProcess, graceMs: number): Promise<void> {
    return terminateChild(process, graceMs)
  }
}

/** Composite key: a device may hold several independently tracked channels.
 * NUL is not valid in either component, so the join is unambiguous. */
function channelKey(deviceId: string, channelId: string): string {
  return `${deviceId}\u0000${channelId}`
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** An out-of-range or non-integer preferred port degrades to OS assignment;
 * it is never spliced into the `-L` argument. */
function sanitizePort(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value < 1 || value > 65535) return undefined
  return value
}

/** SDK-friendly helper for status mapping (kept separate for reuse in tests). */
export function connectionStatus(state: DeviceState, diagnostic: string, endpoint?: URL): DeviceConnectionStatus {
  return {
    state,
    compatibility: state === 'READY' || state === 'DEGRADED' ? 'SUPPORTED' : 'INCOMPATIBLE',
    diagnostic,
    ...(endpoint === undefined ? {} : { endpoint: endpoint.toString() }),
    lastUpdatedAt: Date.now(),
  }
}
