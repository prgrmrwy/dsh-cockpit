import { Inject, Injectable, Logger, Optional, OnApplicationShutdown } from '@nestjs/common'
import { FORWARD_LIMIT, isValidOpaqueId, type DeviceConnectionStatus, type DeviceForwardsProjection, type DeviceRecord, type DeviceStatusFacts } from '@dsh-cockpit/shared'
import { DeviceRegistry } from '../storage/registry.js'
import { DeviceLifecycle, type DeviceLifecycleOptions } from './device-lifecycle.js'
import { DeviceEventsService } from './device-events.service.js'
import { DeviceForwards, ForwardRejection, type AcquireResult, type ForwardHolder } from './forward-table.js'
import { TunnelManager, WORKBENCH_CHANNEL } from './tunnel-manager.js'
import { probeSshIdentity, validateSshAlias } from './ssh.js'
import { probeDshCarrier } from './protocol-client.js'
import { parseDshLaunchUrl } from './dsh-auth.js'
import { discoverLocalDshLaunchToken, discoverRemoteDshLaunchToken } from './dsh-auth-discovery.js'
import { WorkbenchLaunchError, type WorkbenchLaunchSnapshot } from './workbench-launch.js'
import { WorkbenchLaunchCoordinator } from './workbench-launch-coordinator.js'
import { resolveSshExecutable } from '../runtime/config.js'
import { BridgeCapabilityService, BRIDGE_CAPABILITY_PURPOSE, type BridgeCapabilityGrant } from '../auth/bridge-capability.js'
import { BridgeRejectionLog, type BridgeRejectionDecision } from './bridge-rejection-log.js'

/** Body of a bridge forwards request; every field is validated downstream. */
export interface BridgeForwardBody {
  readonly devicePort?: unknown
  readonly holder?: unknown
  readonly instanceId?: unknown
}

/** Per-device cap on additional forwards. */
const MAX_PUBLISHABLE_CHANNELS = 8

/** Optional collaborators for ConnectivityService.
 *
 * Everything here is optional BY DESIGN: production resolves the capability
 * service from the module and constructs the rest itself, while tests inject a
 * fake protocol factory, a fetch that drives token validation, or a coordinator
 * with a short window. They live in one parameter object so Nest has exactly one
 * dependency to resolve (and one it can skip). */
export interface ConnectivityServiceSeams {
  readonly capabilities?: BridgeCapabilityService
  readonly fetch?: typeof fetch
  readonly launchCoordinator?: WorkbenchLaunchCoordinator
  readonly createProtocol?: DeviceLifecycleOptions['createProtocol']
  /** Pre-built tunnel manager (tests drive fake ssh children through it). */
  readonly tunnels?: TunnelManager
}

@Injectable()
export class ConnectivityService implements OnApplicationShutdown {
  readonly #registry: DeviceRegistry
  readonly #logger = new Logger(ConnectivityService.name)
  readonly #tunnels: TunnelManager
  readonly #sshExecutable: string
  readonly #lifecycles = new Map<string, DeviceLifecycle>()
  /** deviceId -> channelId -> device-side loopback port declared publishable. */
  readonly #publishablePorts = new Map<string, Map<string, number>>()
  /** device+channel -> the live forward delivered for it. */
  readonly #publishedChannels = new Map<string, { url: string; localPort: number }>()
  /** Per-device forward tables (design D1). Owned by the device, not by any
   * one lifecycle instance: replacing the workbench connection keeps them. */
  readonly #forwards = new Map<string, DeviceForwards>()
  /** Per cockpit page: bridge instance ids that already ended (D4(e)). */
  readonly #endedInstances = new Map<string, Set<string>>()
  /** Last bridge hello per device (dsh-cockpit-bridge plugin heartbeats). */
  readonly #bridgeSeenAt = new Map<string, number>()
  /** Per-device bridge rejection grading (see bridge-rejection-log.ts). */
  readonly #bridgeRejections = new BridgeRejectionLog()
  readonly #capabilities: BridgeCapabilityService
  readonly #authDiscoveryInFlight = new Map<string, Promise<string | undefined>>()
  readonly #authDiscoveryAttemptedAt = new Map<string, number>()
  /** Bounded validation/discovery coordination for browser workbench launch. */
  readonly #launchCoordinator: WorkbenchLaunchCoordinator
  /** Optional fetch seam: workbench validation must be drivable in tests. */
  readonly #fetchImpl: typeof fetch | undefined
  /** Protocol-factory seam, mirroring DeviceLifecycle's own option: a typert
   * fixture needs a real handshake otherwise, which a unit test cannot host. */
  readonly #createProtocol: DeviceLifecycleOptions['createProtocol']

  constructor(
    @Inject(DeviceRegistry) registry: DeviceRegistry,
    @Inject(DeviceEventsService) private readonly events: DeviceEventsService,
    // ONE optional parameter object, for two reasons:
    //  - Nest DI only sees the DECORATED parameters. An undecorated fourth
    //    parameter (or a `@Inject()` token that resolves to bare `Object`) fails
    //    resolution at boot — a failure unit tests cannot catch, because they
    //    construct this service directly.
    //  - The genuinely-optional test seams therefore have to travel inside the
    //    parameter that Nest already knows how to omit.
    @Optional() seams: ConnectivityServiceSeams = {},
  ) {
    this.#registry = registry
    this.#capabilities = seams.capabilities ?? new BridgeCapabilityService()
    events.onPageExpired(pageId => { void this.#reclaimPage(pageId) })
    this.#sshExecutable = resolveSshExecutable()
    this.#fetchImpl = seams.fetch
    this.#createProtocol = seams.createProtocol
    this.#launchCoordinator = seams.launchCoordinator ?? new WorkbenchLaunchCoordinator({ logger: this.#logger })
    this.#tunnels = seams.tunnels ?? new TunnelManager({
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
      ...(this.#createProtocol === undefined ? {} : { createProtocol: this.#createProtocol }),
      // Any lifecycle state change is pushed to the browser immediately; the
      // REST snapshot stays available for manual refresh.
      onFacts: facts => {
        // Only the device's CURRENT lifecycle drives its forwards; a replaced
        // one may still emit while it winds down.
        if (this.#lifecycles.get(facts.deviceId) === lifecycle) {
          this.#forwards.get(facts.deviceId)?.setMainAvailable(facts.state === 'READY' || facts.state === 'DEGRADED')
        }
        this.events.publish(this.statuses())
      },
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
    this.#attachForwards(record)
    if (record.enabled) lifecycle.start()
  }

  /** Create the device's forward table once; later lifecycle replacements
   * reuse it. A local device gets one too, so every request is refused
   * uniformly with `local-device`. */
  #attachForwards(record: DeviceRecord): void {
    if (this.#forwards.has(record.deviceId)) return
    const table = new DeviceForwards({
      deviceId: record.deviceId,
      kind: record.kind,
      ...(record.sshAlias === undefined ? {} : { sshAlias: record.sshAlias }),
      remoteDshPort: record.remoteDshPort,
      connector: this.#tunnels,
      mainAvailable: false,
      onChange: () => { this.events.publish(this.statuses()) },
    })
    this.#forwards.set(record.deviceId, table)
    // Only pinned marks survive a restart or a re-enable (design D3); they
    // park as `paused` until the workbench channel is READY.
    for (const pinned of record.forwards ?? []) {
      try {
        table.pin(pinned.devicePort, pinned.label)
      } catch (cause) {
        const code = cause instanceof ForwardRejection ? cause.code : String(cause)
        this.#logger.warn(`pinned forward not restored: device=${record.deviceId} port=${pinned.devicePort} reason=${code}`)
      }
    }
  }

  /** The device's forward table, or a stable rejection when it has none. */
  #forwardTable(deviceId: string): DeviceForwards {
    const table = this.#forwards.get(deviceId)
    if (table === undefined) throw new ForwardRejection('device-unavailable')
    return table
  }

  /** Bridge acquire as the endpoint runs it (design D7 check order): the
   * capability is checked from its grant ALONE — never via the origin's
   * lifecycle — so a garbage token cannot probe which origins are online.
   * The holder's page comes from the grant, never from the body (D4(b)). */
  acquireBridgeForward(origin: string, token: string | undefined, body: BridgeForwardBody): AcquireResult {
    const grant = this.#forwardGrant(origin, token)
    const lifecycle = this.#lifecycles.get(grant.deviceId)
    if (lifecycle?.current().endpoint === undefined) throw new ForwardRejection('device-unavailable')
    const holder = { pageId: grant.pageId, instanceId: body.instanceId as string, holder: body.holder as string }
    if (this.#endedInstances.get(holder.pageId)?.has(holder.instanceId) === true) throw new ForwardRejection('invalid-holder')
    const result = this.acquireForward(grant.deviceId, body.devicePort as number, holder)
    // A page with no live stream connection is reclaimed like a closed one.
    this.events.armPageGrace(holder.pageId)
    return result
  }

  /** Bridge release: located by the grant's device, not the origin, so a
   * holder can still let go while the workbench channel is down. */
  async releaseBridgeForward(origin: string, token: string | undefined, body: BridgeForwardBody): Promise<void> {
    const grant = this.#forwardGrant(origin, token)
    if (typeof body.devicePort !== 'number' || typeof body.holder !== 'string' || typeof body.instanceId !== 'string') return
    await this.releaseForward(grant.deviceId, body.devicePort, { pageId: grant.pageId, instanceId: body.instanceId, holder: body.holder })
  }

  /** A grant for the forwards endpoints: it must exist, be unexpired, match
   * the request origin, and name a page. */
  #forwardGrant(origin: string, token: string | undefined): BridgeCapabilityGrant & { readonly pageId: string } {
    let grant: BridgeCapabilityGrant | undefined
    try {
      grant = this.#capabilities.validate(token, { origin, purpose: BRIDGE_CAPABILITY_PURPOSE })
    } catch {
      grant = undefined
    }
    if (grant?.pageId === undefined || !isValidOpaqueId(grant.pageId)) throw new Error('invalid or expired bridge capability')
    return grant as BridgeCapabilityGrant & { readonly pageId: string }
  }

  /** Cockpit parent page: a bridge instance on this device ended (design
   * D4(a)). Its holders go, and the instance is recorded as ended for the
   * page so an acquire of the same instance still in flight is refused
   * (D4(e)). The set never expires by time; page grace expiry clears it. */
  async releaseForwardInstance(deviceId: string, pageId: string, instanceId: string): Promise<void> {
    if (!isValidOpaqueId(pageId) || !isValidOpaqueId(instanceId)) throw new ForwardRejection('invalid-holder')
    let ended = this.#endedInstances.get(pageId)
    if (ended === undefined) {
      ended = new Set()
      this.#endedInstances.set(pageId, ended)
    }
    ended.add(instanceId)
    // A page that never connected must still be cleaned up eventually.
    this.events.armPageGrace(pageId)
    await this.#forwards.get(deviceId)?.releaseInstance(pageId, instanceId)
  }

  /** Grace expiry for a cockpit page (design D4(b)): every holder that page
   * owns, on every device, goes, and so does its ended-instance set. */
  async #reclaimPage(pageId: string): Promise<void> {
    this.#endedInstances.delete(pageId)
    await Promise.all([...this.#forwards.values()].map(table => table.releasePage(pageId)))
  }

  /** Bridge acquire (design D3): create or reuse a held entry. */
  acquireForward(deviceId: string, devicePort: number, holder: ForwardHolder): AcquireResult {
    // A disabled device keeps its table only to show pinned marks (paused);
    // it never takes new holders, so nothing can start while disabled.
    if (this.#lifecycles.get(deviceId)?.current().enabled !== true) throw new ForwardRejection('device-unavailable')
    return this.#forwardTable(deviceId).acquire(devicePort, holder)
  }

  /** Cockpit panel: create a pinned entry (or pin a held one). Disk first
   * (design D3): the mark is written through `mutateDevice`, and only after
   * that succeeds does memory change and a child start. */
  async pinForward(deviceId: string, devicePort: number, label?: string): Promise<AcquireResult> {
    const table = this.#forwardTable(deviceId)
    table.checkPin(devicePort, label)
    const committed = await this.#registry.mutateDevice(deviceId, current => {
      const existing = current.forwards ?? []
      const previous = existing.find(entry => entry.devicePort === devicePort)
      const nextLabel = label ?? previous?.label
      if (previous !== undefined && previous.label === nextLabel) return current
      const mark = nextLabel === undefined ? { devicePort } : { devicePort, label: nextLabel }
      return { ...current, forwards: [...existing.filter(entry => entry.devicePort !== devicePort), mark] }
    })
    if (committed === undefined) throw new ForwardRejection('device-unavailable')
    if (this.#forwards.get(deviceId) !== table) throw new ForwardRejection('device-unavailable')
    return table.pin(devicePort, label)
  }

  /** Cockpit panel: delete an entry — pin mark, every holder, the child.
   * Disk first (design D3): if the mark cannot be removed from the registry
   * the request fails and memory, holders and the child are untouched.
   * Idempotent for unknown devices and ports. */
  async removeForward(deviceId: string, devicePort: number): Promise<void> {
    const table = this.#forwards.get(deviceId)
    const persisted = (await this.#registry.load()).find(record => record.deviceId === deviceId)?.forwards ?? []
    if (persisted.some(entry => entry.devicePort === devicePort)) {
      await this.#registry.mutateDevice(deviceId, current => {
        const existing = current.forwards ?? []
        if (!existing.some(entry => entry.devicePort === devicePort)) return current
        const { forwards: _forwards, ...rest } = current
        const kept = existing.filter(entry => entry.devicePort !== devicePort)
        return kept.length === 0 ? rest : { ...rest, forwards: kept }
      })
    }
    await table?.remove(devicePort)
  }

  /** Release one holder; idempotent. */
  async releaseForward(deviceId: string, devicePort: number, holder: ForwardHolder): Promise<void> {
    await this.#forwards.get(deviceId)?.release(devicePort, holder)
  }

  /** Projection for the status stream: remote devices only. */
  #forwardProjection(deviceId: string, lifecycle: DeviceLifecycle): DeviceForwardsProjection | undefined {
    const table = this.#forwards.get(deviceId)
    if (table === undefined || lifecycle.current().kind === 'local') return undefined
    const additional = table.projection()
    return { rows: [lifecycle.workbenchForward(), ...additional], additionalCount: additional.length, limit: FORWARD_LIMIT }
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

  /** Replace the device's connection lifecycle WITHOUT touching its
   * additional forwards (design D1). The lifecycle only ever owns the
   * workbench channel; forwards belong to the device and outlive any one
   * lifecycle instance — manual reconnects, auth/launch-URL updates and
   * auto-recovery toggles all come through here. */
  async #replaceLifecycle(deviceId: string): Promise<void> {
    const lifecycle = this.#lifecycles.get(deviceId)
    this.#lifecycles.delete(deviceId)
    // A replaced lifecycle must not leave a validation operation running:
    // this is the ONLY owner allowed to abort shared work (see the coordinator).
    this.#launchCoordinator.cancelDevice(deviceId)
    await lifecycle?.stop()
    this.#bridgeRejections.forget(deviceId)
    const prefix = `${deviceId}\u0000`
    for (const key of this.#authDiscoveryAttemptedAt.keys()) if (key.startsWith(prefix)) this.#authDiscoveryAttemptedAt.delete(key)
  }

  /** Device-level termination (disable, delete): the lifecycle goes AND every
   * additional forward of the device is killed, so nothing outlives its
   * device. */
  async #terminateDevice(deviceId: string): Promise<void> {
    await this.#replaceLifecycle(deviceId)
    // Holders are memory-only and die with the table; pinned marks stay in
    // the registry and are rebuilt when the device is attached again.
    const table = this.#forwards.get(deviceId)
    this.#forwards.delete(deviceId)
    await table?.terminate()
    await this.releasePublishedPorts(deviceId)
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
          ...forwardsField(this.#forwardProjection(facts.deviceId, l)),
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
    const enabledFlipped = update.enabled !== undefined && update.enabled !== committedPrevious.enabled
    // An alias edit must move the workbench AND the additional forwards to
    // the new host together (design D5), so it replaces the lifecycle too.
    const aliasChanged = next.sshAlias !== committedPrevious.sshAlias
    if (next.remoteDshPort !== committedPrevious.remoteDshPort) this.#forwards.get(deviceId)?.setReservedPort(next.remoteDshPort)
    if (enabledFlipped || authChanged || discoveryChanged || aliasChanged) {
      // stop() is terminal. Replace the lifecycle when the enabled bit flips;
      // reusing an aborted instance would make a later enable a no-op. A
      // disable also invalidates bridge presence: it describes a live page,
      // not a durable device capability. Only an enabled flip is device-level
      // termination; an auth or recovery-setting change merely replaces the
      // workbench connection and leaves additional forwards running.
      if (enabledFlipped) await this.#terminateDevice(deviceId)
      else await this.#replaceLifecycle(deviceId)
      if (!enabledFlipped && aliasChanged) await this.#forwards.get(deviceId)?.rehost(next.sshAlias ?? '')
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
    await this.#terminateDevice(deviceId)
    this.#bridgeSeenAt.delete(deviceId)
    this.#capabilities.revokeDevice(deviceId)
    // Filter against the LATEST records: a load-then-save would drop any write
    // that landed while the device was being torn down.
    await this.#registry.mutateDevices(latest => latest.filter(r => r.deviceId !== deviceId))
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

  /** Returns a short-lived tokenized iframe URL.
   *
   * For typert, a stored launch token is only handed to the browser after the
   * CURRENT endpoint has strictly validated it: DSH restarts replace the token
   * while the persisted server cookie stays valid, so an unvalidated token is
   * exactly what produced the raw `dsh web authentication required` page in a
   * fresh browser. When the token is stale AND the device has explicitly
   * authorized ohmydsh recovery, the same bounded, read-only discovery used for
   * connection recovery supplies the current token, which is then validated and
   * committed behind the auth-generation/compare-and-swap fence.
   *
   * Nothing here relays a DSH cookie to the browser: the target DSH sets its own
   * authority-bound cookie during the iframe's own exchange. */
  async workbenchLaunch(deviceId: string, signal?: AbortSignal): Promise<{ url: string; authGeneration: number }> {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    const facts = lifecycle.current()
    if (!facts.enabled) throw new Error(`device ${deviceId} is disabled`)
    if (facts.endpoint === undefined) throw new WorkbenchLaunchError('workbench-unavailable', 'device is not connected')
    if (facts.state !== 'READY' && facts.state !== 'DEGRADED') {
      throw new WorkbenchLaunchError('workbench-unavailable', 'device is not ready')
    }
    const endpoint = new URL(facts.endpoint)
    // rc.2 needs no browser-side authentication at all: loading the clean
    // endpoint IS the workbench.
    if (lifecycle.protocolKind() === 'rc2') return { url: endpoint.toString(), authGeneration: facts.dshAuthGeneration }

    const record = (await this.#registry.load()).find(candidate => candidate.deviceId === deviceId)
    if (record === undefined) throw new Error(`unknown device ${deviceId}`)
    const snapshot: WorkbenchLaunchSnapshot = {
      deviceId,
      authority: endpoint.host,
      authGeneration: record.dshAuth?.generation ?? facts.dshAuthGeneration,
      connectionGeneration: lifecycle.connectionGeneration(),
    }
    const launchToken = record.dshAuth?.launchToken ?? record.dshLaunchToken
    const discoveryAuthorized = record.dshAuth?.autoDiscovery === 'ohmydsh-log' && record.enabled
    const outcome = await this.#launchCoordinator.launch(snapshot, endpoint, this.#doFetch(), {
      ...(launchToken === undefined ? {} : { token: launchToken }),
      discoveryAuthorized,
      ...(discoveryAuthorized ? { discover: async () => await this.#discoverAuth(record, signal ?? new AbortController().signal) } : {}),
      commit: async (target, token, session) => await this.#commitDiscoveredWorkbenchAuth(target, token, session),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!outcome.ok) throw new WorkbenchLaunchError(outcome.code, outcome.message)
    this.#requireCurrentLaunch(snapshot, endpoint)
    return { url: outcome.url, authGeneration: outcome.authGeneration }
  }

  /** Post-async fence: a launch result belongs only to the exact tuple that
   * asked for it. Endpoint drift, a superseded connection generation or a
   * device that stopped being ready discards the result instead of navigating
   * the browser to a URL from a previous life. */
  #requireCurrentLaunch(snapshot: WorkbenchLaunchSnapshot, endpoint: URL): void {
    const lifecycle = this.#lifecycles.get(snapshot.deviceId)
    if (lifecycle === undefined) throw new WorkbenchLaunchError('workbench-launch-stale', 'workbench launch superseded')
    const facts = lifecycle.current()
    if (facts.endpoint === undefined || new URL(facts.endpoint).host !== endpoint.host) {
      throw new WorkbenchLaunchError('workbench-launch-stale', 'workbench launch superseded')
    }
    if (lifecycle.connectionGeneration() !== snapshot.connectionGeneration) {
      throw new WorkbenchLaunchError('workbench-launch-stale', 'workbench launch superseded')
    }
    if (facts.state !== 'READY' && facts.state !== 'DEGRADED') {
      throw new WorkbenchLaunchError('workbench-launch-stale', 'workbench launch superseded')
    }
  }

  async #commitDiscoveredWorkbenchAuth(
    snapshot: WorkbenchLaunchSnapshot,
    launchToken: string,
    session: { readonly cookie: string; readonly expiresAt: number },
  ): Promise<number | undefined> {
    const auth = {
      version: 1 as const,
      launchToken,
      serverCookie: session.cookie,
      cookieAuthority: snapshot.authority,
      cookieExpiresAt: session.expiresAt,
      autoDiscovery: 'ohmydsh-log' as const,
      updatedAt: Date.now(),
      generation: snapshot.authGeneration + 1,
    }
    const committed = await this.#registry.commitRecoveredAuth(snapshot.deviceId, snapshot.authGeneration, auth, true)
    if (committed === undefined) return undefined
    this.#lifecycles.get(snapshot.deviceId)?.updateRecord(committed)
    this.events.publish(this.statuses())
    return committed.dshAuth?.generation ?? auth.generation
  }

  /** The fetch used for workbench validation. Kept as a seam so tests can drive
   * the DSH exchange without a live endpoint. */
  #doFetch(): typeof fetch { return this.#fetchImpl ?? fetch }

  /** Issues a short-lived bridge capability after the shell (same-origin,
   * cookie-authenticated) has requested it for one of ITS devices. The
   * capability must be bound to the DEVICE's own DSH origin — the origin the
   * bridge plugin will actually present it from — not the caller's origin
   * (the caller here is always the cockpit's own page). The caller's origin
   * is deliberately unused for binding: the cookie/TokenMiddleware gate on
   * this route is what authenticates the caller, exactly like every other
   * device-scoped POST endpoint. */
  issueBridgeCapability(deviceId: string, pageId: string): { capability: string; expiresAt: number; protocolVersion: number } {
    if (!isValidOpaqueId(pageId)) throw new Error('invalid page id')
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    const facts = lifecycle.current()
    if (!facts.enabled || facts.endpoint === undefined) throw new Error(`device ${deviceId} is not connected`)
    const deviceOrigin = new URL(facts.endpoint).origin
    const grant = this.#capabilities.issue({ deviceId, origin: deviceOrigin, purpose: BRIDGE_CAPABILITY_PURPOSE, pageId })
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

  /** Register a device-side loopback port as publishable.
   *
   * Resolving the device from the request `Origin` is what keeps a
   * registration from ever naming another device: the caller cannot choose
   * which device it registers for. The registry is in-memory and per device —
   * a publishable port is a fact about the CURRENT run of that device's DSH,
   * so it must not outlive a restart.
   */
  registerPublishablePort(origin: string, channelId: string, devicePort: number): void {
    const lifecycle = this.#lifecycleByOrigin(origin)
    if (!isPublishableChannelId(channelId)) throw new Error('invalid channel id')
    if (!Number.isInteger(devicePort) || devicePort < 1 || devicePort > 65535) throw new Error('invalid device port')
    let ports = this.#publishablePorts.get(lifecycle.deviceId)
    if (ports === undefined) {
      ports = new Map()
      this.#publishablePorts.set(lifecycle.deviceId, ports)
    }
    // The cap bounds ssh child processes per device; it is one of the three
    // structural limits the capability relies on (see the change's design D4).
    if (!ports.has(channelId) && ports.size >= MAX_PUBLISHABLE_CHANNELS) {
      throw new Error(`too many publishable channels (max ${MAX_PUBLISHABLE_CHANNELS})`)
    }
    ports.set(channelId, devicePort)
    this.#recordBridgeSuccess(lifecycle.deviceId)
  }

  /** Publish a previously registered port and return its host-side URL.
   *
   * Idempotent per channel: an existing live forward is reused rather than
   * replaced, so repeated clicks do not churn ssh processes. A local device
   * needs no forward at all and is refused with a stable reason so the
   * consumer falls back to its own loopback address. */
  async publishPort(origin: string, channelId: string): Promise<{ url: string; localPort: number }> {
    const lifecycle = this.#lifecycleByOrigin(origin)
    const facts = lifecycle.current()
    if (facts.kind !== 'remote' || facts.sshAlias === undefined) throw new Error('local device needs no port forward')
    const devicePort = this.#publishablePorts.get(lifecycle.deviceId)?.get(channelId)
    if (devicePort === undefined) throw new Error(`port for channel ${channelId} is not registered`)

    const existing = this.#publishedChannels.get(publishKey(lifecycle.deviceId, channelId))
    if (existing !== undefined) return { url: existing.url, localPort: existing.localPort }

    const handle = await this.#tunnels.connect({
      deviceId: lifecycle.deviceId,
      sshAlias: facts.sshAlias,
      channelId,
      remoteDshPort: devicePort,
    })
    const published = { url: handle.endpoint.origin, localPort: handle.localPort }
    this.#publishedChannels.set(publishKey(lifecycle.deviceId, channelId), published)
    this.#recordBridgeSuccess(lifecycle.deviceId)
    return published
  }

  /** Drop every published channel of one device. Called from the device's own
   * lifecycle transitions so a forward never outlives its device. */
  async releasePublishedPorts(deviceId: string): Promise<void> {
    this.#publishablePorts.delete(deviceId)
    for (const key of [...this.#publishedChannels.keys()]) {
      if (key.startsWith(`${deviceId}\u0000`)) this.#publishedChannels.delete(key)
    }
    await this.#tunnels.disposeNode(deviceId)
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
    const tables = [...this.#forwards.values()]
    this.#forwards.clear()
    await Promise.all(tables.map(table => table.terminate()))
    for (const deviceId of this.#lifecycles.keys()) this.#launchCoordinator.cancelDevice(deviceId)
    await Promise.all([...this.#lifecycles.values()].map(l => l.stop()))
    this.#publishablePorts.clear()
    this.#publishedChannels.clear()
    await this.#tunnels.disposeAll()
  }
}

function forwardsField(projection: DeviceForwardsProjection | undefined): { forwards?: DeviceForwardsProjection } {
  return projection === undefined ? {} : { forwards: projection }
}

function redactDeviceRecord(record: DeviceRecord): DeviceRecord {
  const { dshLaunchToken: _legacy, dshAuth: _auth, ...publicRecord } = record
  return publicRecord
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Channel ids appear in a composite tunnel key and in diagnostics; keep them
 * to a conservative, NUL-free shape. */
function isPublishableChannelId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) && value !== WORKBENCH_CHANNEL
}

function publishKey(deviceId: string, channelId: string): string {
  return `${deviceId}\u0000${channelId}`
}
