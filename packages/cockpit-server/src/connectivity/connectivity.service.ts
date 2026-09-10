import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common'
import type { DeviceConnectionStatus, DeviceRecord, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { DeviceRegistry } from '../storage/registry.js'
import { DeviceLifecycle } from './device-lifecycle.js'
import { DeviceEventsService } from './device-events.service.js'
import { TunnelManager } from './tunnel-manager.js'
import { probeSshIdentity, validateSshAlias } from './ssh.js'
import { probeDshCarrier } from './protocol-client.js'
import { dshIframeLaunchUrl, parseDshLaunchUrl } from './dsh-auth.js'
import { discoverLocalDshLaunchToken, discoverRemoteDshLaunchToken } from './dsh-auth-discovery.js'
import { resolveSshExecutable } from '../runtime/config.js'
import { BridgeCapabilityService, BRIDGE_CAPABILITY_PURPOSE } from '../auth/bridge-capability.js'
import { BridgeRejectionLog, type BridgeRejectionDecision } from './bridge-rejection-log.js'

@Injectable()
export class ConnectivityService implements OnApplicationShutdown {
  readonly #registry: DeviceRegistry
  readonly #logger = new Logger(ConnectivityService.name)
  readonly #tunnels: TunnelManager
  readonly #sshExecutable: string
  readonly #lifecycles = new Map<string, DeviceLifecycle>()
  /** Last bridge hello per device (dsh-cockpit-bridge plugin heartbeats). */
  readonly #bridgeSeenAt = new Map<string, number>()
  /** Per-device bridge rejection grading (see bridge-rejection-log.ts). */
  readonly #bridgeRejections = new BridgeRejectionLog()
  readonly #capabilities: BridgeCapabilityService
  readonly #authDiscoveryInFlight = new Map<string, Promise<string | undefined>>()
  readonly #authDiscoveryAttemptedAt = new Map<string, number>()

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
      readinessProbe: probeDshCarrier,
      logger: { warn: message => this.#logger.warn(message) },
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
      recoverAuth: async (current, signal) => this.#discoverAuth(current, signal),
      onAuthAccepted: async (deviceId, expectedGeneration, accepted) => {
        const current = (await this.#registry.load()).find(candidate => candidate.deviceId === deviceId)
        if (current === undefined) return undefined
        const previous = current.dshAuth
        const launchToken = accepted.launchToken ?? previous?.launchToken ?? current.dshLaunchToken
        const unchanged = previous?.serverCookie === accepted.cookie
          && previous.cookieAuthority === accepted.authority
          && previous.cookieExpiresAt === accepted.expiresAt
          && previous.launchToken === launchToken
        if (unchanged) return current
        const auth = {
          version: 1 as const,
          ...(launchToken === undefined ? {} : { launchToken }),
          serverCookie: accepted.cookie,
          cookieAuthority: accepted.authority,
          cookieExpiresAt: accepted.expiresAt,
          autoDiscovery: previous?.autoDiscovery ?? 'disabled' as const,
          updatedAt: Date.now(),
          generation: expectedGeneration + 1,
        }
        const committed = await this.#registry.commitRecoveredAuth(deviceId, expectedGeneration, auth)
        if (committed !== undefined) this.events.publish(this.statuses())
        return committed
      },
    })
    this.#lifecycles.set(record.deviceId, lifecycle)
    if (record.enabled) lifecycle.start()
  }

  async #discoverAuth(record: DeviceRecord, signal: AbortSignal): Promise<string | undefined> {
    const key = [record.deviceId, record.dshAuth?.generation ?? 0, record.sshAlias ?? 'local', record.remoteDshPort].join('\u0000')
    const existing = this.#authDiscoveryInFlight.get(key)
    if (existing !== undefined) return existing
    const last = this.#authDiscoveryAttemptedAt.get(key) ?? 0
    if (Date.now() - last < 15_000) return undefined
    this.#authDiscoveryAttemptedAt.set(key, Date.now())
    const task = (async () => {
      const result = record.kind === 'local'
        ? await discoverLocalDshLaunchToken(record.remoteDshPort, { signal })
        : await discoverRemoteDshLaunchToken(record.sshAlias ?? '', record.remoteDshPort, { sshExecutable: this.#sshExecutable, signal })
      return result.ok ? result.token : undefined
    })()
    this.#authDiscoveryInFlight.set(key, task)
    try {
      return await task
    } finally {
      if (this.#authDiscoveryInFlight.get(key) === task) this.#authDiscoveryInFlight.delete(key)
    }
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
    } catch (cause) {
      // Keep the live connection; the port simply stays unstable until a later
      // connection manages to record it.
      const reason = cause instanceof Error ? cause.message : String(cause)
      this.#logger.warn(`local port persist failed: device=${deviceId} port=${localPort} reason=${reason}`)
    }
  }

  async #detach(deviceId: string): Promise<void> {
    const lifecycle = this.#lifecycles.get(deviceId)
    this.#lifecycles.delete(deviceId)
    await lifecycle?.stop()
    this.#bridgeRejections.forget(deviceId)
    const prefix = `${deviceId}\u0000`
    for (const key of this.#authDiscoveryAttemptedAt.keys()) if (key.startsWith(prefix)) this.#authDiscoveryAttemptedAt.delete(key)
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
          pendingInteractionObservability: facts.pendingInteractionObservability,
          sessionStatuses: facts.sessionStatuses,
          ...(this.#bridgeSeenAt.has(facts.deviceId)
            ? { bridgeSeenAt: this.#bridgeSeenAt.get(facts.deviceId)! }
            : {}),
          compatibility: facts.compatibility,
          lastUpdatedAt: facts.lastUpdatedAt,
          ...(facts.diagnostic === undefined ? {} : { diagnostic: facts.diagnostic }),
          ...(facts.endpoint === undefined ? {} : { endpoint: facts.endpoint }),
          dshAuthConfigured: facts.dshAuthConfigured,
          dshAuthState: facts.dshAuthState,
          dshAuthAutoDiscovery: facts.dshAuthAutoDiscovery,
          dshAuthGeneration: facts.dshAuthGeneration,
          ...(facts.dshAuthExpiresAt === undefined ? {} : { dshAuthExpiresAt: facts.dshAuthExpiresAt }),
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
    dshLaunchUrl?: string
    dshAuthAutoDiscovery?: boolean
  }): Promise<DeviceRecord> {
    const kind = input.kind ?? 'remote'
    if (kind === 'remote') {
      if (input.sshAlias === undefined || input.sshAlias === '') throw new Error('SSH alias is required for a remote device')
      const identity = await probeSshIdentity(input.sshAlias, { sshExecutable: this.#sshExecutable })
      if (!identity.ok) throw new Error(`SSH identity verification failed: ${identity.diagnostic}`)
    }
    const launchToken = input.dshLaunchUrl === undefined ? undefined : parseDshLaunchUrl(input.dshLaunchUrl, input.remoteDshPort)
    const recordBase = {
      deviceId: `device-${randomSuffix()}`,
      displayName: input.displayName,
      kind,
      remoteDshPort: input.remoteDshPort,
      enabled: input.enabled ?? true,
      ...(kind === 'remote' ? { sshAlias: input.sshAlias! } : {}),
      ...(launchToken === undefined ? {} : { dshLaunchToken: launchToken }),
      dshAuth: {
        version: 1 as const,
        ...(launchToken === undefined ? {} : { launchToken }),
        autoDiscovery: input.dshAuthAutoDiscovery === true ? 'ohmydsh-log' as const : 'disabled' as const,
        updatedAt: Date.now(),
        generation: launchToken === undefined ? 0 : 1,
      },
    }
    let record!: DeviceRecord
    await this.#registry.mutateDevices(records => {
      record = { ...recordBase, order: records.length }
      return [...records, record]
    })
    this.#attach(record)
    return redactDeviceRecord(record)
  }

  async updateDevice(deviceId: string, update: {
    displayName?: string
    sshAlias?: string
    remoteDshPort?: number
    enabled?: boolean
    order?: number
    dshLaunchUrl?: string
    clearDshLaunchToken?: boolean
    dshAuthAutoDiscovery?: boolean
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
    if (update.dshLaunchUrl !== undefined && update.clearDshLaunchToken === true) throw new Error('cannot set and clear DSH launch token together')
    let committedPrevious = current
    let authChanged = false
    let discoveryChanged = false
    const normalized = await this.#registry.mutateDevices(latestRecords => {
      const latestIndex = latestRecords.findIndex(record => record.deviceId === deviceId)
      if (latestIndex < 0) throw new Error(`unknown device ${deviceId}`)
      const latest = latestRecords[latestIndex]!
      committedPrevious = latest
      const effectivePort = update.remoteDshPort ?? latest.remoteDshPort
      const previousAuth = latest.dshAuth ?? {
        version: 1 as const,
        ...(latest.dshLaunchToken === undefined ? {} : { launchToken: latest.dshLaunchToken }),
        autoDiscovery: 'disabled' as const,
        updatedAt: 0,
        generation: latest.dshLaunchToken === undefined ? 0 : 1,
      }
      const launchToken = update.dshLaunchUrl === undefined ? previousAuth.launchToken : parseDshLaunchUrl(update.dshLaunchUrl, effectivePort)
      authChanged = update.dshLaunchUrl !== undefined || update.clearDshLaunchToken === true
      discoveryChanged = update.dshAuthAutoDiscovery !== undefined
        && update.dshAuthAutoDiscovery !== (previousAuth.autoDiscovery === 'ohmydsh-log')
      const { dshAuth: _priorAuth, ...currentWithoutAuth } = latest
      const nextAuth = {
        version: 1 as const,
        ...(update.clearDshLaunchToken === true || launchToken === undefined ? {} : { launchToken }),
        ...(!authChanged && previousAuth.serverCookie !== undefined ? {
          serverCookie: previousAuth.serverCookie,
          cookieAuthority: previousAuth.cookieAuthority!,
          cookieExpiresAt: previousAuth.cookieExpiresAt!,
        } : {}),
        autoDiscovery: update.dshAuthAutoDiscovery === undefined
          ? previousAuth.autoDiscovery
          : update.dshAuthAutoDiscovery ? 'ohmydsh-log' as const : 'disabled' as const,
        updatedAt: authChanged || discoveryChanged ? Date.now() : previousAuth.updatedAt,
        generation: previousAuth.generation + (authChanged || discoveryChanged ? 1 : 0),
      }
      const updated: DeviceRecord = {
        ...currentWithoutAuth,
        displayName: update.displayName ?? latest.displayName,
        ...(update.sshAlias === undefined ? {} : { sshAlias: update.sshAlias }),
        ...(update.remoteDshPort === undefined ? {} : { remoteDshPort: update.remoteDshPort }),
        ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
        ...(nextAuth.launchToken === undefined ? {} : { dshLaunchToken: nextAuth.launchToken }),
        dshAuth: nextAuth,
      }
      const withoutUpdated = latestRecords.filter(record => record.deviceId !== deviceId)
      const targetIndex = update.order === undefined
        ? latestIndex
        : Math.max(0, Math.min(update.order, withoutUpdated.length))
      const reordered = [...withoutUpdated]
      reordered.splice(targetIndex, 0, updated)
      return reordered.map((record, order): DeviceRecord => ({ ...record, order }))
    })
    const next = normalized.find(record => record.deviceId === deviceId)!
    if ((update.enabled !== undefined && update.enabled !== committedPrevious.enabled) || authChanged || discoveryChanged) {
      // stop() is terminal. Replace the lifecycle when the enabled bit flips;
      // reusing an aborted instance would make a later enable a no-op. A
      // disable also invalidates bridge presence: it describes a live page,
      // not a durable device capability.
      await this.#detach(deviceId)
      this.#bridgeSeenAt.delete(deviceId)
      this.#capabilities.revokeDevice(deviceId)
      this.#attach(next)
    }
    for (const record of normalized) this.#lifecycles.get(record.deviceId)?.updateRecord(record)
    this.events.publish(this.statuses())
    return redactDeviceRecord(next)
  }

  async removeDevice(deviceId: string, confirmed: boolean): Promise<{ removed: boolean; requiresConfirmation: boolean }> {
    const records = await this.#registry.load()
    if (!records.some(r => r.deviceId === deviceId)) throw new Error(`unknown device ${deviceId}`)
    if (!confirmed) return { removed: false, requiresConfirmation: true }
    await this.#detach(deviceId)
    this.#bridgeSeenAt.delete(deviceId)
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

  /** Returns a one-shot tokenized iframe URL without exposing it in status. */
  async workbenchLaunch(deviceId: string): Promise<{ url: string; authGeneration: number }> {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    const facts = lifecycle.current()
    if (facts.endpoint === undefined) throw new Error(`device ${deviceId} is not connected`)
    if (lifecycle.protocolKind() === 'rc2') return { url: facts.endpoint, authGeneration: facts.dshAuthGeneration }
    const record = (await this.#registry.load()).find(candidate => candidate.deviceId === deviceId)
    const url = dshIframeLaunchUrl(new URL(facts.endpoint), record?.dshAuth?.launchToken ?? record?.dshLaunchToken)
    if (url === undefined) throw new Error('DSH authentication required; paste the current dsh web startup URL')
    return { url, authGeneration: record?.dshAuth?.generation ?? facts.dshAuthGeneration }
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

  /** Grade a rejected bridge callback so routine self-healing does not drown
   * the log at WARN. `deviceId` is undefined when no enabled device matches the
   * origin; those are aggregated under a stable synthetic key so one stale
   * page cannot flood the log either. Returns how the caller should log it. */
  gradeBridgeRejection(origin: string, reason: string): BridgeRejectionDecision {
    const deviceId = this.resolveBridgeDeviceId(origin) ?? `unknown-origin:${origin}`
    return this.#bridgeRejections.record(deviceId, reason, Date.now())
  }

  /** Best-effort device id for a bridge request origin, used only for
   * rejection diagnostics — undefined when no enabled device matches. */
  resolveBridgeDeviceId(origin: string): string | undefined {
    try {
      return this.#lifecycleByOrigin(origin).deviceId
    } catch {
      return undefined
    }
  }

  /** Cross-origin bridge selection snapshot. `undefined` means the DSH page has
   * no selected session (for example after archive). `protocolVersion` is
   * accepted (and used by the lifecycle-level ack/edge convergence) but is
   * deliberately not surfaced as top-bar UI state — see #bridgeSeenAt. */
  bridgeSessionOpened(origin: string, sessionId: string | undefined, protocolVersion = 1): void {
    void protocolVersion
    const lifecycle = this.#lifecycleByOrigin(origin)
    lifecycle.setBridgeSelection(sessionId)
    this.#recordBridgeSuccess(lifecycle.deviceId)
  }

  /** Replace the typert bridge's complete pending snapshot. */
  bridgePendingSnapshot(origin: string, items: readonly { sessionId: string; kind: 'approval' | 'question'; key: string }[], protocolVersion: number): void {
    if (protocolVersion < 3) throw new Error('pending snapshot protocol unsupported')
    const lifecycle = this.#lifecycleByOrigin(origin)
    lifecycle.setBridgePendingSnapshot(items)
    this.#recordBridgeSuccess(lifecycle.deviceId)
  }

  /** Bridge plugin hello: records that the device's DSH web client runs the
   * plugin, and stamps the last-seen time (surfaces as bridgeSeenAt in the
   * status pushed to the browser). */
  bridgeHello(origin: string, version: string, protocolVersion = 1, current?: string): void {
    void version
    void protocolVersion
    const lifecycle = this.#lifecycleByOrigin(origin)
    lifecycle.setBridgeSelection(current)
    this.#recordBridgeSuccess(lifecycle.deviceId)
  }

  #recordBridgeSuccess(deviceId: string): void {
    this.#bridgeSeenAt.set(deviceId, Date.now())
    // A successful report proves the bridge self-healed, so any rejection
    // counters for this device must not keep accumulating toward an alert.
    this.#bridgeRejections.recordSuccess(deviceId, Date.now())
    this.events.publish(this.statuses())
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

function redactDeviceRecord(record: DeviceRecord): DeviceRecord {
  const { dshLaunchToken: _legacy, dshAuth: _auth, ...publicRecord } = record
  return publicRecord
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}
