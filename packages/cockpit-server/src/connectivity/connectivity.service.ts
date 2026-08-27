import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import type { DeviceConnectionStatus, DeviceRecord, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { DeviceRegistry } from '../storage/registry.js'
import { DeviceLifecycle } from './device-lifecycle.js'
import { TunnelManager } from './tunnel-manager.js'
import { probeSshIdentity, validateSshAlias } from './ssh.js'
import { Rc2Client } from './rc2-client.js'

@Injectable()
export class ConnectivityService implements OnApplicationShutdown {
  readonly #registry: DeviceRegistry
  readonly #tunnels: TunnelManager
  readonly #lifecycles = new Map<string, DeviceLifecycle>()

  constructor(@Inject(DeviceRegistry) registry: DeviceRegistry) {
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
      onFacts: () => { /* live facts consumed via statuses() */ },
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

  /** Add a device: identity gate first, then persist and attach. */
  async addDevice(input: {
    displayName: string
    sshAlias: string
    remoteDshPort: number
    enabled?: boolean
  }): Promise<DeviceRecord> {
    validateSshAlias(input.sshAlias)
    const identity = await probeSshIdentity(input.sshAlias)
    if (!identity.ok) throw new Error(`SSH identity verification failed: ${identity.diagnostic}`)
    const records = await this.#registry.load()
    const deviceId = `device-${randomSuffix()}`
    const record: DeviceRecord = {
      deviceId,
      displayName: input.displayName,
      kind: 'remote',
      sshAlias: input.sshAlias,
      remoteDshPort: input.remoteDshPort,
      enabled: input.enabled ?? true,
      order: records.length,
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

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.#lifecycles.values()].map(l => l.stop()))
    await this.#tunnels.disposeAll()
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}