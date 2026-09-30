import { FORWARD_DIAGNOSTIC_MAX, FORWARD_LIMIT, isValidDevicePort, isValidForwardLabel, isValidOpaqueId, type AdditionalForwardRow, type DeviceKind, type ForwardEntryState, type ForwardErrorCode } from '@dsh-cockpit/shared'
import type { TunnelExit } from './tunnel-manager.js'

/** Holder identity (design D3): the triple, never just the label. */
export interface ForwardHolder {
  readonly pageId: string
  readonly instanceId: string
  readonly holder: string
}

/** What the table asks of the process layer for one entry. */
export interface ForwardChannelRequest {
  readonly deviceId: string
  readonly sshAlias: string
  readonly channelId: string
  readonly remoteDshPort: number
  readonly onExit?: (exit: TunnelExit) => void
}

export interface ForwardChannelHandle {
  readonly localPort: number
  readonly pid: number
  dispose(): Promise<void>
}

/** The D2 seam between the table and the ssh children: the table drives
 * processes only through connect, dispose and the post-ready exit callback. */
export interface ForwardChannelConnector {
  connect(request: ForwardChannelRequest): Promise<ForwardChannelHandle>
}

/** A business rejection. Carries a stable code; the table is unchanged. */
export class ForwardRejection extends Error {
  constructor(readonly code: ForwardErrorCode, message: string = code) {
    super(message)
    this.name = 'ForwardRejection'
  }
}

export interface DeviceForwardsOptions {
  readonly deviceId: string
  readonly kind: DeviceKind
  readonly sshAlias?: string
  readonly remoteDshPort: number
  readonly connector: ForwardChannelConnector
  /** Whether the workbench channel is READY/DEGRADED right now. */
  readonly mainAvailable: boolean
  /** Jitter source for self-heal backoff; injectable so tests can pin it. */
  readonly random?: () => number
  readonly now?: () => number
  /** Called whenever the projection may have changed. */
  readonly onChange?: () => void
}

export interface AcquireResult {
  readonly devicePort: number
  readonly state: ForwardEntryState
  readonly localPort?: number
}

interface Entry {
  readonly devicePort: number
  readonly holders: Map<string, ForwardHolder>
  pinned: boolean
  label: string | undefined
  state: ForwardEntryState
  handle: ForwardChannelHandle | undefined
  generation: number
  removed: boolean
  diagnostic: string | undefined
  /** Consecutive failed establishments since the last ready. */
  attempt: number
  retryTimer: ReturnType<typeof setTimeout> | undefined
  readonly createdAt: number
  stateChangedAt: number
}

export const forwardChannelId = (devicePort: number): string => `fwd-${devicePort}`

/** Self-heal backoff (design D5): 1s, doubling, capped at 60s, with ±20%
 * jitter so N entries of one device never retry in lockstep. */
export const FORWARD_RETRY_BASE_MS = 1_000
export const FORWARD_RETRY_MAX_MS = 60_000
const FORWARD_RETRY_JITTER = 0.2

export function forwardRetryDelay(attempt: number, random: () => number): number {
  const base = Math.min(FORWARD_RETRY_MAX_MS, FORWARD_RETRY_BASE_MS * 2 ** Math.min(attempt, 16))
  return Math.round(base * (1 - FORWARD_RETRY_JITTER + 2 * FORWARD_RETRY_JITTER * random()))
}

const holderKey = (holder: ForwardHolder): string => [holder.pageId, holder.instanceId, holder.holder].join('\u0000')

/** One device's additional forwards: desired state plus the live children
 * converging to it (design D1). Every mutation is synchronous, so the cap
 * check and the insert share one critical section; establishment runs in the
 * background and is fenced by a per-entry generation on completion. */
export class DeviceForwards {
  readonly deviceId: string
  readonly #options: DeviceForwardsOptions
  readonly #entries = new Map<number, Entry>()
  readonly #now: () => number
  readonly #random: () => number
  #mainAvailable: boolean
  #terminated = false
  #sshAlias: string
  #remoteDshPort: number

  constructor(options: DeviceForwardsOptions) {
    this.deviceId = options.deviceId
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#random = options.random ?? Math.random
    this.#mainAvailable = options.mainAvailable
    this.#sshAlias = options.sshAlias ?? ''
    this.#remoteDshPort = options.remoteDshPort
  }

  /** The device's SSH alias changed (design D5): every live child still talks
   * to the OLD host, so kill them all and park every entry as `paused`. The
   * table treats the workbench channel as unavailable until the new lifecycle
   * reports READY on the new alias, which rebuilds the entries — so an
   * additional child never runs against a host the workbench is not on. */
  async rehost(sshAlias: string): Promise<void> {
    this.#sshAlias = sshAlias
    this.#mainAvailable = false
    const handles = [...this.#entries.values()].map(entry => {
      this.#clearRetry(entry)
      entry.generation += 1
      const handle = entry.handle
      entry.handle = undefined
      this.#setState(entry, 'paused')
      return handle
    })
    this.#changed()
    await Promise.all(handles.map(handle => handle?.dispose()))
  }

  /** The workbench's remote DSH port changed: later requests for it are
   * `reserved-port`. Existing entries are deliberately left alone (design D1:
   * no conflict rejection on edit). */
  setReservedPort(remoteDshPort: number): void {
    this.#remoteDshPort = remoteDshPort
  }

  /** Follow the workbench channel (READY/DEGRADED = available). While it is
   * down nothing new is spawned — entries needing a (re)build park as
   * `paused` — but live children keep running: a remote `dsh web` restart
   * leaves a database forward perfectly healthy. */
  setMainAvailable(available: boolean): void {
    if (this.#mainAvailable === available) return
    this.#mainAvailable = available
    for (const entry of this.#entries.values()) {
      if (!available && entry.retryTimer !== undefined) {
        this.#clearRetry(entry)
        this.#setState(entry, 'paused')
      } else if (available && entry.state === 'paused') {
        entry.attempt = 0
        this.#start(entry)
      }
    }
    this.#changed()
  }

  acquire(devicePort: number, holder: ForwardHolder): AcquireResult {
    this.#validatePort(devicePort)
    if (!isValidOpaqueId(holder.pageId) || !isValidOpaqueId(holder.instanceId) || !isValidForwardLabel(holder.holder)) {
      throw new ForwardRejection('invalid-holder')
    }
    const entry = this.#ensure(devicePort)
    entry.holders.set(holderKey(holder), holder)
    this.#changed()
    return this.#result(entry)
  }

  /** Mark an entry pinned (creating it when absent). The caller persists the
   * mark FIRST; this only commits it to memory and starts the child. Pinning a
   * held entry just adds the mark. */
  pin(devicePort: number, label?: string): AcquireResult {
    this.checkPin(devicePort, label)
    const entry = this.#ensure(devicePort)
    entry.pinned = true
    if (label !== undefined) entry.label = label
    this.#changed()
    return this.#result(entry)
  }

  /** Every rejection `pin` could raise, without touching anything: the caller
   * runs this BEFORE persisting the mark, so a doomed pin never reaches disk. */
  checkPin(devicePort: number, label?: string): void {
    this.#validatePort(devicePort)
    if (label !== undefined && !isValidForwardLabel(label)) throw new ForwardRejection('invalid-label')
    if (!this.#entries.has(devicePort) && this.#entries.size >= FORWARD_LIMIT) throw new ForwardRejection('forward-limit')
  }

  /** Release one holder. Unknown holders and unknown ports succeed without
   * touching the table; an entry with neither a pin nor a holder is reclaimed. */
  async release(devicePort: number, holder: ForwardHolder): Promise<void> {
    const entry = this.#entries.get(devicePort)
    if (entry === undefined || !entry.holders.delete(holderKey(holder))) return
    if (!entry.pinned && entry.holders.size === 0) {
      await this.#reclaim(entry)
      return
    }
    this.#changed()
  }

  /** Drop every holder of one bridge page instance (instance-ended, D4(a)). */
  async releaseInstance(pageId: string, instanceId: string): Promise<void> {
    await this.#releaseWhere(holder => holder.pageId === pageId && holder.instanceId === instanceId)
  }

  /** Drop every holder owned by one cockpit page (grace expiry, D4(b)).
   * Entries left with neither a pin nor a holder are reclaimed. */
  async releasePage(pageId: string): Promise<void> {
    await this.#releaseWhere(holder => holder.pageId === pageId)
  }

  async #releaseWhere(matches: (holder: ForwardHolder) => boolean): Promise<void> {
    let changed = false
    const reclaimed: Promise<void>[] = []
    for (const entry of [...this.#entries.values()]) {
      for (const [key, holder] of entry.holders) {
        if (!matches(holder)) continue
        entry.holders.delete(key)
        changed = true
      }
      if (!entry.pinned && entry.holders.size === 0) reclaimed.push(this.#reclaim(entry))
    }
    if (changed && reclaimed.length === 0) this.#changed()
    await Promise.all(reclaimed)
  }

  /** Delete an entry outright: pin mark, every holder, and the child. */
  async remove(devicePort: number): Promise<void> {
    const entry = this.#entries.get(devicePort)
    if (entry === undefined) return
    await this.#reclaim(entry)
  }

  /** Cap check and insert in one synchronous section: `starting` entries
   * already occupy a slot, so two racing requests cannot both pass. */
  #ensure(devicePort: number): Entry {
    const existing = this.#entries.get(devicePort)
    if (existing !== undefined) return existing
    if (this.#entries.size >= FORWARD_LIMIT) throw new ForwardRejection('forward-limit')
    const entry = this.#insert(devicePort)
    this.#start(entry)
    return entry
  }

  /** Take an entry out of the table and kill its child. A start still in
   * flight is fenced by `removed` and disposes its own handle on completion. */
  async #reclaim(entry: Entry): Promise<void> {
    this.#entries.delete(entry.devicePort)
    const handle = this.#detach(entry)
    this.#changed()
    await handle?.dispose()
  }

  /** Fence an entry off from every pending continuation (retry timer, start
   * in flight, exit callback) and hand back its live child for disposal. */
  #detach(entry: Entry): ForwardChannelHandle | undefined {
    this.#clearRetry(entry)
    entry.removed = true
    entry.generation += 1
    const handle = entry.handle
    entry.handle = undefined
    return handle
  }

  projection(): AdditionalForwardRow[] {
    return [...this.#entries.values()]
      .sort((left, right) => left.devicePort - right.devicePort)
      .map(entry => {
        const holders = [...entry.holders.values()].map(holder => holder.holder)
        const live = entry.state === 'ready' && entry.handle !== undefined
        return {
          kind: 'additional' as const,
          devicePort: entry.devicePort,
          state: entry.state,
          pinned: entry.pinned,
          ...(entry.label === undefined ? {} : { label: entry.label }),
          holders,
          holderCount: holders.length,
          ...(entry.diagnostic === undefined ? {} : { diagnostic: entry.diagnostic }),
          createdAt: entry.createdAt,
          stateChangedAt: entry.stateChangedAt,
          ...(live ? { localPort: entry.handle!.localPort, pid: entry.handle!.pid } : {}),
        }
      })
  }

  /** Device-level termination: every child dies and nothing restarts. */
  async terminate(): Promise<void> {
    this.#terminated = true
    const handles = [...this.#entries.values()].map(entry => this.#detach(entry))
    this.#entries.clear()
    await Promise.all(handles.map(handle => handle?.dispose()))
    this.#changed()
  }

  /** Rejections happen before anything is touched: no entry, no child. A
   * local device has no table at all, so it is refused whatever the port. */
  #validatePort(devicePort: number): void {
    if (this.#options.kind === 'local') throw new ForwardRejection('local-device')
    if (!isValidDevicePort(devicePort)) throw new ForwardRejection('invalid-port')
    if (devicePort === this.#remoteDshPort) throw new ForwardRejection('reserved-port')
  }

  #insert(devicePort: number): Entry {
    const now = this.#now()
    const entry: Entry = {
      devicePort,
      holders: new Map(),
      pinned: false,
      label: undefined,
      state: 'starting',
      handle: undefined,
      generation: 0,
      removed: false,
      diagnostic: undefined,
      attempt: 0,
      retryTimer: undefined,
      createdAt: now,
      stateChangedAt: now,
    }
    this.#entries.set(devicePort, entry)
    return entry
  }

  #start(entry: Entry): void {
    this.#clearRetry(entry)
    const generation = ++entry.generation
    if (!this.#mainAvailable) {
      this.#setState(entry, 'paused')
      return
    }
    if (entry.state !== 'retrying') this.#setState(entry, 'starting')
    void this.#options.connector.connect({
      deviceId: this.deviceId,
      sshAlias: this.#sshAlias,
      channelId: forwardChannelId(entry.devicePort),
      remoteDshPort: entry.devicePort,
      onExit: exit => { this.#onExit(entry, generation, exit.diagnostic) },
    }).then(handle => {
      if (this.#stale(entry, generation)) {
        void handle.dispose()
        return
      }
      entry.handle = handle
      entry.attempt = 0
      this.#setState(entry, 'ready')
      this.#changed()
    }, (error: unknown) => {
      if (this.#stale(entry, generation)) return
      this.#fail(entry, error instanceof Error ? error.message : String(error))
    })
  }

  /** A ready child died on its own (never our dispose: TunnelManager filters
   * those). Its address is dead, so it leaves the projection at once. */
  #onExit(entry: Entry, generation: number, diagnostic: string): void {
    if (this.#stale(entry, generation)) return
    entry.handle = undefined
    this.#fail(entry, diagnostic)
  }

  #fail(entry: Entry, diagnostic: string): void {
    // ssh stderr is untrusted: bound it before it is stored or projected.
    entry.diagnostic = diagnostic.slice(0, FORWARD_DIAGNOSTIC_MAX)
    if (!this.#mainAvailable) {
      this.#setState(entry, 'paused')
      this.#changed()
      return
    }
    this.#setState(entry, 'retrying')
    const delay = forwardRetryDelay(entry.attempt, this.#random)
    entry.attempt += 1
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = undefined
      if (entry.removed || this.#terminated) return
      this.#start(entry)
    }, delay)
    entry.retryTimer.unref?.()
    this.#changed()
  }

  #clearRetry(entry: Entry): void {
    if (entry.retryTimer === undefined) return
    clearTimeout(entry.retryTimer)
    entry.retryTimer = undefined
  }

  #stale(entry: Entry, generation: number): boolean {
    return this.#terminated || entry.removed || entry.generation !== generation
  }

  #setState(entry: Entry, state: ForwardEntryState): void {
    if (entry.state === state) return
    entry.state = state
    entry.stateChangedAt = this.#now()
  }

  #result(entry: Entry): AcquireResult {
    return entry.state === 'ready' && entry.handle !== undefined
      ? { devicePort: entry.devicePort, state: entry.state, localPort: entry.handle.localPort }
      : { devicePort: entry.devicePort, state: entry.state }
  }

  #changed(): void {
    this.#options.onChange?.()
  }
}
