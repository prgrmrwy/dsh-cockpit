/**
 * `cockpitBridge.forwards` (device-forward-registry D4(a), D7).
 *
 * A consumer asks for a device port by holder label; the cockpit answers with
 * the entry's state at once and delivers the address later through the
 * snapshot the parent page pushes. Holders belong to a one-shot page instance
 * id: a new id on every effect start and on a bfcache restore, and once an id
 * is ended (pagehide / dispose) it is never used again.
 */
import {
  BRIDGE_INSTANCE_ENDED_MESSAGE,
  FORWARDS_SNAPSHOT_MESSAGE,
  FORWARDS_UNAVAILABLE,
  isValidDevicePort,
  isValidForwardLabel,
  type CockpitForwardsService,
  type ForwardAddress,
  type ForwardEntryState,
  type ForwardHandle,
  type ForwardNotice,
  type ForwardsError,
  type ForwardsSnapshot,
} from '@dsh-cockpit/shared'

export interface ForwardsConfig {
  readonly cockpitOrigin: string
  readonly capability: string
}

export interface ForwardsDeps {
  /** Latest parent-supplied config, or undefined before the handshake. */
  readonly config: () => ForwardsConfig | undefined
  /** Ask the parent for a fresh capability; resolves once one arrived. */
  readonly renew: (stale: ForwardsConfig) => Promise<ForwardsConfig | undefined>
  readonly send: (path: string, body: object, config: ForwardsConfig) => Promise<Response>
}

class SeamError extends Error implements ForwardsError {
  constructor(readonly code: ForwardsError['code'], message: string = code) {
    super(message)
    this.name = 'CockpitForwardsError'
  }
}

interface HolderRecord {
  readonly devicePort: number
  readonly holder: string
  state: ForwardEntryState | 'removed'
  address: ForwardAddress | undefined
  /** Whether a snapshot has shown the entry since this holder acquired it.
   * Absence only means "removed" after that: an older snapshot still in
   * flight when the acquire returned must not drop a brand-new holder. */
  seen: boolean
  readonly listeners: Set<(notice: ForwardNotice) => void>
  readonly handle: ForwardHandle
}

const recordKey = (devicePort: number, holder: string) => `${devicePort}\u0000${holder}`

function newInstanceId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function addressFor(port: number): ForwardAddress {
  return { host: '127.0.0.1', port, url: `http://127.0.0.1:${port}` }
}

function isSnapshot(value: unknown): value is ForwardsSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ForwardsSnapshot>
  return Array.isArray(candidate.rows)
    && candidate.rows.every(row => typeof row === 'object' && row !== null && isValidDevicePort((row as { devicePort?: unknown }).devicePort))
    && typeof candidate.additionalCount === 'number'
    && typeof candidate.limit === 'number'
}

export interface ForwardsBinding {
  readonly service: CockpitForwardsService
  /** Effect start: a fresh instance id. */
  startInstance(): void
  /** pagehide / dispose: tell the parent this instance ended. */
  endInstance(): void
  /** Persisted pageshow: switch to a fresh id, dropping the old holders. */
  restoreInstance(): void
  /** Effect dispose: end and forget everything under the current id. */
  stopInstance(): void
  /** Returns true when the message was a forwards snapshot (valid or not). */
  handleMessage(event: MessageEvent): boolean
  /** Latest accepted snapshot, without the handshake check of `list()`. */
  snapshot(): ForwardsSnapshot | undefined
}

export function createForwards(deps: ForwardsDeps): ForwardsBinding {
  let instanceId: string | undefined
  let ended = false
  let snapshot: ForwardsSnapshot | undefined
  const records = new Map<string, HolderRecord>()
  const snapshotListeners = new Set<(value: ForwardsSnapshot) => void>()

  const unavailable = () => new SeamError(FORWARDS_UNAVAILABLE, 'cockpit forwards are unavailable')

  const notify = (record: HolderRecord, notice: ForwardNotice): void => {
    for (const listener of [...record.listeners]) {
      try {
        listener(notice)
      } catch {
        // A consumer's listener must never break the bridge or other holders.
      }
    }
  }

  const drop = (record: HolderRecord): void => {
    records.delete(recordKey(record.devicePort, record.holder))
    record.state = 'removed'
    record.address = undefined
    notify(record, { devicePort: record.devicePort, state: 'removed' })
  }

  const dropAll = (): void => {
    for (const record of [...records.values()]) drop(record)
  }

  /** One capability-bearing request. 400/401 renew once (the capability is
   * short-lived and a click can come long after load); 409 is a business
   * answer and is surfaced with its code, never renewed or retried. */
  const request = async (path: string, body: object): Promise<unknown> => {
    const active = deps.config()
    if (active === undefined) throw unavailable()
    let response = await deps.send(path, body, active)
    if (response.status === 401 || response.status === 400) {
      const renewed = await deps.renew(active)
      if (renewed !== undefined) response = await deps.send(path, body, renewed)
    }
    if (response.status === 409) {
      let code: unknown
      try { code = (await response.json() as { code?: unknown }).code } catch { code = undefined }
      throw new SeamError(typeof code === 'string' ? code as ForwardsError['code'] : 'request-failed')
    }
    if (!response.ok) throw new SeamError('request-failed', `cockpit forwards request rejected (${response.status})`)
    return await response.json()
  }

  /** The instance id to act under; a used-up id is replaced first. */
  const liveInstance = (): string => {
    if (deps.config() === undefined || instanceId === undefined) throw unavailable()
    if (ended) rotate()
    return instanceId
  }

  const rotate = (): void => {
    dropAll()
    instanceId = newInstanceId()
    ended = false
  }

  const apply = (record: HolderRecord, state: ForwardEntryState, localPort: number | undefined, diagnostic?: string): void => {
    const address = state === 'ready' && localPort !== undefined ? addressFor(localPort) : undefined
    if (record.state === state && record.address?.port === address?.port) return
    record.state = state
    record.address = address
    notify(record, {
      devicePort: record.devicePort,
      state,
      ...(address === undefined ? {} : { address }),
      ...(diagnostic === undefined ? {} : { diagnostic }),
    })
  }

  const onSnapshot = (next: ForwardsSnapshot): void => {
    snapshot = next
    for (const record of [...records.values()]) {
      const row = next.rows.find(candidate => candidate.kind === 'additional' && candidate.devicePort === record.devicePort)
      if (row === undefined || row.kind !== 'additional') {
        if (record.seen) drop(record)
        continue
      }
      record.seen = true
      apply(record, row.state, row.localPort, row.diagnostic)
    }
    for (const listener of [...snapshotListeners]) {
      try { listener(next) } catch { /* consumer bug stays contained */ }
    }
  }

  const service: CockpitForwardsService = {
    acquire(devicePort: number, holder: string): Promise<ForwardHandle> {
      const instance = liveInstance()
      if (!isValidDevicePort(devicePort)) return Promise.reject(new SeamError('invalid-port'))
      if (!isValidForwardLabel(holder)) return Promise.reject(new SeamError('invalid-holder'))
      return (async () => {
        const result = await request('/api/bridge/forwards/acquire', { devicePort, holder, instanceId: instance }) as { state?: unknown; localPort?: unknown }
        if (instance !== instanceId) throw unavailable()
        const key = recordKey(devicePort, holder)
        let record = records.get(key)
        if (record === undefined) {
          const created: HolderRecord = {
            devicePort,
            holder,
            state: 'starting',
            address: undefined,
            seen: false,
            listeners: new Set(),
            handle: {
              devicePort,
              holder,
              get state() { return created.state },
              get address() { return created.address },
              onChange(listener) {
                created.listeners.add(listener)
                return () => { created.listeners.delete(listener) }
              },
            },
          }
          record = created
          records.set(key, record)
        }
        const state = result?.state
        if (state === 'starting' || state === 'ready' || state === 'retrying' || state === 'paused') {
          record.state = state
          record.address = state === 'ready' && typeof result.localPort === 'number' ? addressFor(result.localPort) : undefined
        }
        return record.handle
      })()
    },

    async release(handle: ForwardHandle): Promise<void> {
      const record = records.get(recordKey(handle.devicePort, handle.holder))
      // Already gone (removed, rotated, released): nothing to say, and an
      // ended instance id is never sent again.
      if (record === undefined || record.handle !== handle || instanceId === undefined || ended) return
      const instance = instanceId
      drop(record)
      await request('/api/bridge/forwards/release', { devicePort: handle.devicePort, holder: handle.holder, instanceId: instance })
    },

    list(): ForwardsSnapshot | undefined {
      if (deps.config() === undefined) throw unavailable()
      return snapshot
    },

    subscribe(listener: (value: ForwardsSnapshot) => void): () => void {
      snapshotListeners.add(listener)
      return () => { snapshotListeners.delete(listener) }
    },
  }

  return {
    service,
    startInstance(): void {
      instanceId = newInstanceId()
      ended = false
    },
    endInstance(): void {
      const active = deps.config()
      if (instanceId === undefined || ended) return
      ended = true
      if (active === undefined) return
      try {
        window.parent.postMessage({ type: BRIDGE_INSTANCE_ENDED_MESSAGE, instanceId }, active.cockpitOrigin)
      } catch {
        // Parent gone: its page-grace reclaim covers these holders.
      }
    },
    restoreInstance(): void {
      rotate()
    },
    stopInstance(): void {
      this.endInstance()
      dropAll()
      instanceId = undefined
    },
    snapshot(): ForwardsSnapshot | undefined {
      return snapshot
    },
    handleMessage(event: MessageEvent): boolean {
      const data = event.data as { type?: unknown; snapshot?: unknown } | null
      if (typeof data !== 'object' || data === null || data.type !== FORWARDS_SNAPSHOT_MESSAGE) return false
      const active = deps.config()
      if (active === undefined || event.source !== window.parent || event.origin !== active.cockpitOrigin) return true
      if (isSnapshot(data.snapshot)) onSnapshot(data.snapshot)
      return true
    },
  }
}
