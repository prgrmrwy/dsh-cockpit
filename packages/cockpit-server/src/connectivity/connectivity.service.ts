import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import type { DeviceConnectionStatus, DeviceRecord, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { DeviceRegistry } from '../storage/registry.js'
import { DeviceLifecycle } from './device-lifecycle.js'
import { DeviceEventsService } from './device-events.service.js'
import { TunnelManager } from './tunnel-manager.js'
import { probeSshIdentity, validateSshAlias } from './ssh.js'
import { Rc2Client } from './rc2-client.js'
import { resolveSshExecutable } from '../runtime/config.js'
import { BridgeCapabilityService, BRIDGE_CAPABILITY_PURPOSE } from '../auth/bridge-capability.js'

@Injectable()
export class ConnectivityService implements OnApplicationShutdown {
  readonly #registry: DeviceRegistry
  readonly #tunnels: TunnelManager
  readonly #sshExecutable: string
  readonly #lifecycles = new Map<string, DeviceLifecycle>()
  /** Last successful bridge communication per device. */
  readonly #bridgeSeenAt = new Map<string, number>()
  readonly #bridgeProtocolVersion = new Map<string, number>()
  readonly #bridgeLastSuccessAt = new Map<string, number>()
  readonly #capabilities: BridgeCapabilityService

  constructor(
    @Inject(DeviceRegistry) registry: DeviceRegistry,
    @Inject(DeviceEventsService) private readonly events: DeviceEventsService,
    @Inject(BridgeCapabilityService) capabilities?: BridgeCapabilityService,
  ) {
    this.#registry = registry
    this.#capabilities = capabilities ?? new BridgeCapabilityService()
    this.#sshExecutable = resolveSshExecutable()
    this.#tunnels = new TunnelManager({
      sshExecutable: this.#sshExecutable,
      readinessProbe: async (endpoint, _signal) => {
        const client = new Rc2Client({ endpoint })
        return client.probe()
      },
    })
    void this.#boot()
  }

  async #boot(): Promise<void> {
    const records = await this.#registry.load()
    for (const record of records) this.#attach(record)
  }

  #attach(record: DeviceRecord): void {
    if (this.#lifecycles.has(record.deviceId)) return
    const lifecycle = new DeviceLifecycle({
      record,
      tunnels: this.#tunnels,
      // Any lifecycle state change is pushed to the browser immediately; the
      // REST snapshot stays available for manual refresh.
      onFacts: () => { this.events.publish(this.statuses()) },
      onLocalPort: (deviceId, localPort) => { void this.#persistLocalPort(deviceId, localPort) },
    })
    this.#lifecycles.set(record.deviceId, lifecycle)
    if (record.enabled) lifecycle.start()
  }

  /** Persist the port a device's tunnel actually bound so the next connection
   * reuses it and the workbench origin stays stable. The live record is updated
   * too, so a reconnect within this process benefits without a disk reload.
   *
   * Best effort by design: a stable origin is an optimization, and failing to
   * record it must not disturb a tunnel that is already up. The next successful
   * connection retries the write. */
  async #persistLocalPort(deviceId: string, localPort: number): Promise<void> {
    try {
      await this.#registry.updateLocalPort(deviceId, localPort)
      const records = await this.#registry.load()
      const record = records.find(candidate => candidate.deviceId === deviceId)
      if (record !== undefined) this.#lifecycles.get(deviceId)?.updateRecord(record)
    } catch {
      // Keep the live connection; the port simply stays unstable until a later
      // connection manages to record it.
    }
  }

  async #detach(deviceId: string): Promise<void> {
    const lifecycle = this.#lifecycles.get(deviceId)
    this.#lifecycles.delete(deviceId)
    await lifecycle?.stop()
  }

  /** Live aggregated statuses for all registered devices. */
  statuses(): readonly DeviceStatusFacts[] {
    return [...this.#lifecycles.values()]
      .sort((a, b) => a.current().order - b.current().order || a.deviceId.localeCompare(b.deviceId))
      .map(l => {
        const facts = l.current()
        return {
          deviceId: facts.deviceId,
          displayName: facts.displayName,
          kind: facts.kind,
          ...(facts.sshAlias === undefined ? {} : { sshAlias: facts.sshAlias }),
          remoteDshPort: facts.remoteDshPort,
          enabled: facts.enabled,
          order: facts.order,
          state: facts.state,
          runningSessionCount: facts.runningSessionCount,
          pendingInteractionCount: facts.pendingInteractionCount,
          sessionStatuses: facts.sessionStatuses,
          ...(this.#bridgeSeenAt.has(facts.deviceId)
            ? { bridgeSeenAt: this.#bridgeSeenAt.get(facts.deviceId)! }
            : {}),
          ...(this.#bridgeProtocolVersion.has(facts.deviceId)
            ? { bridgeProtocolVersion: this.#bridgeProtocolVersion.get(facts.deviceId)! }
            : {}),
          ...(this.#bridgeLastSuccessAt.has(facts.deviceId)
            ? { bridgeLastSuccessAt: this.#bridgeLastSuccessAt.get(facts.deviceId)! }
            : {}),
          bridgeHealth: this.#bridgeHealth(facts.deviceId),
          compatibility: facts.compatibility,
          lastUpdatedAt: facts.lastUpdatedAt,
          ...(facts.diagnostic === undefined ? {} : { diagnostic: facts.diagnostic }),
          ...(facts.endpoint === undefined ? {} : { endpoint: facts.endpoint }),
        }
      })
  }

  connectionStatus(deviceId: string): DeviceConnectionStatus | undefined {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) return undefined
    const facts = lifecycle.current()
    return {
      state: facts.state,
      compatibility: facts.compatibility,
      diagnostic: facts.diagnostic ?? '',
      ...(facts.endpoint === undefined ? {} : { endpoint: facts.endpoint }),
      lastUpdatedAt: facts.lastUpdatedAt,
    }
  }

  /** Add a device. A remote device must pass the SSH identity gate before it is
   * persisted; a local device (This Mac) needs no SSH — it targets the loopback
   * DSH port directly. */
  async addDevice(input: {
    displayName: string
    sshAlias?: string
    remoteDshPort: number
    kind?: 'local' | 'remote'
    enabled?: boolean
  }): Promise<DeviceRecord> {
    const kind = input.kind ?? 'remote'
    if (kind === 'remote') {
      if (input.sshAlias === undefined || input.sshAlias === '') throw new Error('SSH alias is required for a remote device')
      const identity = await probeSshIdentity(input.sshAlias, { sshExecutable: this.#sshExecutable })
      if (!identity.ok) throw new Error(`SSH identity verification failed: ${identity.diagnostic}`)
    }
    const records = await this.#registry.load()
    const record: DeviceRecord = {
      deviceId: `device-${randomSuffix()}`,
      displayName: input.displayName,
      kind,
      remoteDshPort: input.remoteDshPort,
      enabled: input.enabled ?? true,
      order: records.length,
      ...(kind === 'remote' ? { sshAlias: input.sshAlias! } : {}),
    }
    const next = [...records, record]
    await this.#registry.save(next)
    this.#attach(record)
    return record
  }

  async updateDevice(deviceId: string, update: {
    displayName?: string
    sshAlias?: string
    remoteDshPort?: number
    enabled?: boolean
    order?: number
  }): Promise<DeviceRecord> {
    const records = await this.#registry.load()
    const index = records.findIndex(r => r.deviceId === deviceId)
    if (index < 0) throw new Error(`unknown device ${deviceId}`)
    const current = records[index]!
    if (current.kind === 'local' && update.sshAlias !== undefined) {
      throw new Error(`local device ${deviceId} does not accept sshAlias`)
    }
    const editsConnection = update.displayName !== undefined || update.sshAlias !== undefined || update.remoteDshPort !== undefined
    if (current.kind === 'remote' && editsConnection) {
      const effectiveAlias = update.sshAlias ?? current.sshAlias
      if (effectiveAlias === undefined || effectiveAlias === '') throw new Error('SSH alias is required for a remote device')
      validateSshAlias(effectiveAlias)
      const identity = await probeSshIdentity(effectiveAlias, { sshExecutable: this.#sshExecutable })
      if (!identity.ok) throw new Error(`SSH identity verification failed: ${identity.diagnostic}`)
    }
    const updated: DeviceRecord = {
      ...current,
      displayName: update.displayName ?? current.displayName,
      ...(update.sshAlias === undefined ? {} : { sshAlias: update.sshAlias }),
      ...(update.remoteDshPort === undefined ? {} : { remoteDshPort: update.remoteDshPort }),
      ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
    }
    const withoutUpdated = records.filter(record => record.deviceId !== deviceId)
    const targetIndex = update.order === undefined
      ? index
      : Math.max(0, Math.min(update.order, withoutUpdated.length))
    const reordered = [...withoutUpdated]
    reordered.splice(targetIndex, 0, updated)
    const normalized = reordered.map((record, order): DeviceRecord => ({ ...record, order }))
    await this.#registry.save(normalized)
    const next = normalized.find(record => record.deviceId === deviceId)!
    if (update.enabled !== undefined && update.enabled !== current.enabled) {
      // stop() is terminal. Replace the lifecycle when the enabled bit flips;
      // reusing an aborted instance would make a later enable a no-op. A
      // disable also invalidates bridge presence: it describes a live page,
      // not a durable device capability.
      await this.#detach(deviceId)
      this.#bridgeSeenAt.delete(deviceId)
       this.#bridgeProtocolVersion.delete(deviceId)
       this.#bridgeLastSuccessAt.delete(deviceId)
       this.#capabilities.revokeDevice(deviceId)
      this.#attach(next)
    }
    for (const record of normalized) this.#lifecycles.get(record.deviceId)?.updateRecord(record)
    this.events.publish(this.statuses())
    return next
  }

  async removeDevice(deviceId: string, confirmed: boolean): Promise<{ removed: boolean; requiresConfirmation: boolean }> {
    const records = await this.#registry.load()
    if (!records.some(r => r.deviceId === deviceId)) throw new Error(`unknown device ${deviceId}`)
    if (!confirmed) return { removed: false, requiresConfirmation: true }
    await this.#detach(deviceId)
    this.#bridgeSeenAt.delete(deviceId)
    this.#bridgeProtocolVersion.delete(deviceId)
    this.#bridgeLastSuccessAt.delete(deviceId)
    this.#capabilities.revokeDevice(deviceId)
    await this.#registry.save(records.filter(r => r.deviceId !== deviceId))
    return { removed: true, requiresConfirmation: false }
  }

  async refreshDevice(deviceId: string): Promise<void> {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    if (!lifecycle.current().enabled) throw new Error(`device ${deviceId} is disabled`)
    await lifecycle.refresh()
  }

  /** Force reconnect of one enabled device only. */
  async reconnectDevice(deviceId: string): Promise<void> {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    if (!lifecycle.current().enabled) throw new Error(`device ${deviceId} is disabled`)
    await lifecycle.reconnect()
  }

  /** Clears all currently-known completion generations on one device. */
  ackCompleted(deviceId: string): void {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    if (!lifecycle.current().enabled) throw new Error(`device ${deviceId} is disabled`)
    lifecycle.clearAllCompleted()
  }

  /** Issues a short-lived bridge capability after the shell (same-origin,
   * cookie-authenticated) has requested it for one of ITS devices. The
   * capability must be bound to the DEVICE's own DSH origin — the origin the
   * bridge plugin will actually present it from — not the caller's origin
   * (the caller here is always the cockpit's own page). The caller's origin
   * is deliberately unused for binding: the cookie/TokenMiddleware gate on
   * this route is what authenticates the caller, exactly like every other
   * device-scoped POST endpoint. */
  issueBridgeCapability(deviceId: string): { capability: string; expiresAt: number; protocolVersion: number } {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    const facts = lifecycle.current()
    if (!facts.enabled || facts.endpoint === undefined) throw new Error(`device ${deviceId} is not connected`)
    const deviceOrigin = new URL(facts.endpoint).origin
    const grant = this.#capabilities.issue({ deviceId, origin: deviceOrigin, purpose: BRIDGE_CAPABILITY_PURPOSE })
    return { capability: grant.token, expiresAt: grant.expiresAt, protocolVersion: 2 }
  }

  /** Validate a bridge capability and return the bound lifecycle. */
  validateBridgeCapability(origin: string, token: string | undefined): DeviceLifecycle {
    const lifecycle = this.#lifecycleByOrigin(origin)
    const grant = this.#capabilities.validate(token, {
      deviceId: lifecycle.deviceId,
      origin,
      purpose: BRIDGE_CAPABILITY_PURPOSE,
    })
    if (grant === undefined) throw new Error('invalid or expired bridge capability')
    return lifecycle
  }

  /** Cross-origin bridge selection snapshot. `undefined` means the DSH page has
   * no selected session (for example after archive). */
  bridgeSessionOpened(origin: string, sessionId: string | undefined, protocolVersion = 1): void {
    const lifecycle = this.#lifecycleByOrigin(origin)
    lifecycle.setBridgeSelection(sessionId)
    this.#recordBridgeSuccess(lifecycle.deviceId, protocolVersion)
  }

  /** Bridge plugin hello records a successful protocol handshake and selected
   * snapshot. */
  bridgeHello(origin: string, version: string, protocolVersion = 1, current?: string): void {
    void version
    const lifecycle = this.#lifecycleByOrigin(origin)
    lifecycle.setBridgeSelection(current)
    this.#recordBridgeSuccess(lifecycle.deviceId, protocolVersion)
  }

  #recordBridgeSuccess(deviceId: string, protocolVersion: number): void {
    const now = Date.now()
    this.#bridgeSeenAt.set(deviceId, now)
    this.#bridgeProtocolVersion.set(deviceId, protocolVersion)
    this.#bridgeLastSuccessAt.set(deviceId, now)
    this.events.publish(this.statuses())
  }

  #bridgeHealth(deviceId: string): 'reliable' | 'legacy' | 'stale' | 'missing' {
    const successAt = this.#bridgeLastSuccessAt.get(deviceId)
    if (successAt === undefined) return 'missing'
    if (Date.now() - successAt > 5 * 60_000) return 'stale'
    return (this.#bridgeProtocolVersion.get(deviceId) ?? 0) >= 2 ? 'reliable' : 'legacy'
  }

  #lifecycleByOrigin(origin: string): DeviceLifecycle {
    let originUrl: URL
    try {
      originUrl = new URL(origin)
    } catch {
      throw new Error(`invalid origin ${origin}`)
    }
    for (const lifecycle of this.#lifecycles.values()) {
      const facts = lifecycle.current()
      if (!facts.enabled) continue
      const endpoint = facts.endpoint
      if (endpoint === undefined) continue
      const endpointUrl = new URL(endpoint)
      if (endpointUrl.origin === originUrl.origin) return lifecycle
    }
    throw new Error(`no cockpit device matches origin ${origin}`)
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.#lifecycles.values()].map(l => l.stop()))
    await this.#tunnels.disposeAll()
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}
