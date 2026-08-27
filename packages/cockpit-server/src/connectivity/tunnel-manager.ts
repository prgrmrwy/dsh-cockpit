import type { DeviceConnectionStatus, DeviceState } from '@dsh-cockpit/shared'
import { defaultSpawner, reserveCandidatePort, terminateChild, validateSshAlias, type OwnedProcess, type ProcessSpawner } from './ssh.js'

export interface TunnelRequest {
  readonly deviceId: string
  readonly sshAlias: string
  readonly remoteDshPort: number
}

export interface TunnelHandle {
  readonly deviceId: string
  readonly generation: number
  readonly endpoint: URL
  readonly diagnostic: string
  dispose(): Promise<void>
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
  readonly #active = new Map<string, { generation: number; process: OwnedProcess; abort: AbortController; disposed: boolean }>()
  readonly #generations = new Map<string, number>()
  #shutDown = false

  constructor(options: TunnelManagerOptions) {
    this.#options = {
      readinessProbe: options.readinessProbe,
      sshExecutable: options.sshExecutable ?? '/usr/bin/ssh',
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
    await this.disposeNode(request.deviceId)
    const generation = (this.#generations.get(request.deviceId) ?? 0) + 1
    this.#generations.set(request.deviceId, generation)
    let lastDiagnostic = ''
    for (let attempt = 1; attempt <= this.#options.maxBindAttempts; attempt += 1) {
      const localPort = await reserveCandidatePort()
      if (this.#shutDown) throw new Error('tunnel manager is shut down')
      const process = this.#options.spawn(this.#options.sshExecutable, tunnelArgs(request, localPort, this.#options))
      const abort = new AbortController()
      const active = { generation, process, abort, disposed: false }
      this.#active.set(request.deviceId, active)
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
        this.#options.readinessProbe(endpoint, abort.signal).then(result => ({ kind: 'ready' as const, result })),
      ])
      if (outcome.kind === 'exit') {
        lastDiagnostic = diagnostic()
        this.#active.delete(request.deviceId)
        await this.#terminate(process, 1000)
        if (this.#shutDown) throw new Error('tunnel manager is shut down')
        if (attempt < this.#options.maxBindAttempts) continue
        throw new Error(`OpenSSH exited before DSH readiness: ${truncate(lastDiagnostic, 200)}`)
      }
      if (!outcome.result.ok) {
        await this.#disposeExact(request.deviceId, active)
        throw new Error(`${outcome.result.state}: ${outcome.result.diagnostic}`)
      }
      if (this.#active.get(request.deviceId) !== active || active.disposed) {
        await this.#disposeExact(request.deviceId, active)
        throw new Error('tunnel generation was replaced')
      }
      return {
        deviceId: request.deviceId,
        generation,
        endpoint,
        diagnostic: outcome.result.diagnostic,
        dispose: () => this.#disposeExact(request.deviceId, active),
      }
    }
    throw new Error(`could not bind a loopback port: ${truncate(lastDiagnostic, 200)}`)
  }

  async disposeNode(deviceId: string): Promise<void> {
    const active = this.#active.get(deviceId)
    if (active !== undefined) await this.#disposeExact(deviceId, active)
  }

  /** Terminal cleanup: refuses new tunnels and sweeps any straggler registered
   * mid-sweep by an in-flight connect. */
  async disposeAll(): Promise<void> {
    this.#shutDown = true
    await Promise.all([...this.#active].map(([id, active]) => this.#disposeExact(id, active)))
    await Promise.all([...this.#active].map(([id, active]) => this.#disposeExact(id, active)))
  }

  #disposeExact(deviceId: string, active: { process: OwnedProcess; abort: AbortController; disposed: boolean }): Promise<void> {
    if (active.disposed) return Promise.resolve()
    active.disposed = true
    active.abort.abort(new Error('tunnel disposed'))
    if (this.#active.get(deviceId) === active) this.#active.delete(deviceId)
    return this.#terminate(active.process, 1000)
  }

  #terminate(process: OwnedProcess, graceMs: number): Promise<void> {
    return terminateChild(process, graceMs)
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
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