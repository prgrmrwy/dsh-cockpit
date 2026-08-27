import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import type { DeviceConnectionStatus, DeviceRecord, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { DeviceRegistry } from '../storage/registry.js'
import { DeviceLifecycle } from './device-lifecycle.js'
import { DeviceEventsService } from './device-events.service.js'
import { TunnelManager } from './tunnel-manager.js'
import { probeSshIdentity, validateSshAlias } from './ssh.js'
import { Rc2Client } from './rc2-client.js'

@Injectable()
export class ConnectivityService implements OnApplicationShutdown {
  readonly #registry: DeviceRegistry
  readonly #tunnels: TunnelManager
  readonly #lifecycles = new Map<string, DeviceLifecycle>()

  constructor(
    @Inject(DeviceRegistry) registry: DeviceRegistry,
    @Inject(DeviceEventsService) private readonly events: DeviceEventsService,
  ) {
    this.#registry = registry
    this.#tunnels = new TunnelManager({
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
    })
    this.#lifecycles.set(record.deviceId, lifecycle)
    if (record.enabled) lifecycle.start()
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
          enabled: facts.enabled,
          order: facts.order,
          state: facts.state,
          runningSessionCount: facts.runningSessionCount,
          pendingInteractionCount: facts.pendingInteractionCount,
          outcomeUnknownCount: 0,
          sessionStatuses: facts.sessionStatuses,
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
      const identity = await probeSshIdentity(input.sshAlias)
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
  }): Promise<DeviceRecord> {
    const records = await this.#registry.load()
    const index = records.findIndex(r => r.deviceId === deviceId)
    if (index < 0) throw new Error(`unknown device ${deviceId}`)
    const current = records[index]!
    if (update.sshAlias !== undefined && update.sshAlias !== current.sshAlias) {
      validateSshAlias(update.sshAlias)
      const identity = await probeSshIdentity(update.sshAlias)
      if (!identity.ok) throw new Error(`SSH identity verification failed: ${identity.diagnostic}`)
    }
    const next: DeviceRecord = {
      ...current,
      displayName: update.displayName ?? current.displayName,
      ...(update.sshAlias === undefined ? {} : { sshAlias: update.sshAlias }),
      ...(update.remoteDshPort === undefined ? {} : { remoteDshPort: update.remoteDshPort }),
      ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
    }
    await this.#registry.save(records.map((r, i) => i === index ? next : r))
    const lifecycle = this.#lifecycles.get(deviceId)
    lifecycle?.updateRecord(next)
    if (update.enabled === true) lifecycle?.start()
    if (update.enabled === false) void lifecycle?.stop()
    return next
  }

  async removeDevice(deviceId: string, confirmed: boolean): Promise<{ removed: boolean; requiresConfirmation: boolean }> {
    const records = await this.#registry.load()
    if (!records.some(r => r.deviceId === deviceId)) throw new Error(`unknown device ${deviceId}`)
    if (!confirmed) return { removed: false, requiresConfirmation: true }
    await this.#detach(deviceId)
    await this.#registry.save(records.filter(r => r.deviceId !== deviceId))
    return { removed: true, requiresConfirmation: false }
  }

  async refreshDevice(deviceId: string): Promise<void> {
    await this.#lifecycles.get(deviceId)?.refresh()
  }

  /** Force reconnect of one device only. */
  async reconnectDevice(deviceId: string): Promise<void> {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    await lifecycle.reconnect()
  }

  /** Mark one device's completion reminders as read (green done dots cleared;
   * the official clear-on-select is not observable from the event stream). */
  ackCompletedDevice(deviceId: string): void {
    const lifecycle = this.#lifecycles.get(deviceId)
    if (lifecycle === undefined) throw new Error(`unknown device ${deviceId}`)
    lifecycle.clearCompleted()
  }

  /** Cross-origin bridge from the device's own DSH web client (a cockpit
   * plugin reports "the user just opened session X"). Matches the device by
   * the request's Origin header against live endpoints, then clears exactly
   * that session's completion reminder. */
  bridgeSessionOpened(origin: string, sessionId: string): void {
    let originUrl: URL
    try {
      originUrl = new URL(origin)
    } catch {
      throw new Error(`invalid origin ${origin}`)
    }
    for (const lifecycle of this.#lifecycles.values()) {
      const endpoint = lifecycle.current().endpoint
      if (endpoint === undefined) continue
      const endpointUrl = new URL(endpoint)
      if (endpointUrl.origin === originUrl.origin) {
        lifecycle.clearCompletedSession(sessionId)
        return
      }
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