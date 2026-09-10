/** Bridge-rejection log grading.
 *
 * Bridge callbacks that fail capability/origin validation are the NORMAL,
 * self-healing path: the plugin asks the parent for a fresh capability and
 * re-posts its retained outbox entry, and per Workbench the backstop exists
 * precisely for hidden iframes whose timers are throttled. Logging every such
 * rejection at WARN is what this module exists to stop — measured on a real
 * install, 885 of 1636 log lines (54%) were WARN and ~all of them were this
 * self-healing path, which destroys the level's meaning and buries the one
 * event that genuinely needs a human: self-healing having STOPPED.
 *
 * So: grade by classification, aggregate repeats, and escalate to WARN only
 * when a device is being rejected repeatedly AND has no successful bridge
 * report to show for it. See openspec/changes/grade-bridge-rejection-logs.
 */

/** Why a bridge callback was rejected. Both classes are self-healing. */
export type BridgeRejectionClass = 'capability' | 'unknown-origin' | 'other'

/** Classify a rejection from the error message the connectivity layer throws.
 *
 * Reads existing messages rather than changing them: `validateBridgeCapability`
 * throws `invalid or expired bridge capability`, and origin matching (via
 * `#lifecycleByOrigin`) throws `no cockpit device matches origin <origin>`.
 * Unknown text degrades to `other` and is treated as self-healing — the same
 * conservative direction the tunnel attribution work uses. */
export function classifyBridgeRejection(reason: string): BridgeRejectionClass {
  if (reason.includes('bridge capability')) return 'capability'
  if (reason.includes('no cockpit device matches origin')) return 'unknown-origin'
  return 'other'
}

/** Aggregation window. Minute-scale so one device switch (which produces a
 * short burst of rejections) reads as a single episode rather than many. */
export const BRIDGE_REJECTION_WINDOW_MS = 10 * 60_000

/** Escalation threshold within one window. Conservative on purpose: the two
 * error costs are asymmetric. Missing a "self-healing stopped" episode still
 * has the top-bar bridge indicator and the manual-clear fallback; a spurious
 * WARN re-trains the reader to ignore the level, which is the defect being
 * fixed. Observed healthy devices never approach this many rejections inside
 * one window. */
export const BRIDGE_REJECTION_WARN_THRESHOLD = 20

/** How recently a device must have reported successfully for its rejections to
 * count as "still healthy". Equal to the window: any success inside the
 * current window is evidence the bridge link still works, so a device that was
 * switched away from (its renewal timer is cleared deliberately) does not
 * escalate merely because its capability lapsed while nobody used it. */
export const BRIDGE_REJECTION_SUCCESS_GRACE_MS = BRIDGE_REJECTION_WINDOW_MS

export interface BridgeRejectionDecision {
  /** WARN only for a genuine self-healing failure; otherwise debug. */
  readonly level: 'debug' | 'warn'
  /** Rejections counted in this window for this device+class, including this one. */
  readonly count: number
  readonly class: BridgeRejectionClass
}

interface Entry {
  windowStartedAt: number
  readonly counts: Map<BridgeRejectionClass, number>
  lastSuccessAt: number
  /** Set once a WARN has been emitted for the current window, so one episode
   * produces one alert rather than one per rejection. */
  warned: boolean
}

/** Per-device rejection bookkeeping. Bounded by enabled devices × the three
 * classes, and cleared when a device goes away. */
export class BridgeRejectionLog {
  readonly #entries = new Map<string, Entry>()

  /** Record one rejection and decide how it should be logged. */
  record(deviceId: string, reason: string, now: number): BridgeRejectionDecision {
    const rejectionClass = classifyBridgeRejection(reason)
    const entry = this.#entry(deviceId, now)

    // A success inside the grace period means the bridge is working; start the
    // window over so stale rejections cannot accumulate toward an alert.
    if (entry.lastSuccessAt !== 0 && now - entry.lastSuccessAt <= BRIDGE_REJECTION_SUCCESS_GRACE_MS) {
      this.#reset(entry, now)
    } else if (now - entry.windowStartedAt >= BRIDGE_REJECTION_WINDOW_MS) {
      this.#reset(entry, now)
    }

    const count = (entry.counts.get(rejectionClass) ?? 0) + 1
    entry.counts.set(rejectionClass, count)

    // Escalate once per window, and only when nothing has reported successfully.
    const healthy = entry.lastSuccessAt !== 0 && now - entry.lastSuccessAt <= BRIDGE_REJECTION_SUCCESS_GRACE_MS
    const escalate = !healthy && !entry.warned && count >= BRIDGE_REJECTION_WARN_THRESHOLD
    if (escalate) entry.warned = true

    return { level: escalate ? 'warn' : 'debug', count, class: rejectionClass }
  }

  /** A successful bridge report proves the device self-healed. */
  recordSuccess(deviceId: string, now: number): void {
    const entry = this.#entries.get(deviceId)
    if (entry === undefined) {
      this.#entries.set(deviceId, {
        windowStartedAt: now,
        counts: new Map(),
        lastSuccessAt: now,
        warned: false,
      })
      return
    }
    entry.lastSuccessAt = now
    this.#reset(entry, now)
  }

  /** Drop a device's bookkeeping when it is removed or disabled. */
  forget(deviceId: string): void {
    this.#entries.delete(deviceId)
  }

  #entry(deviceId: string, now: number): Entry {
    const existing = this.#entries.get(deviceId)
    if (existing !== undefined) return existing
    const created: Entry = { windowStartedAt: now, counts: new Map(), lastSuccessAt: 0, warned: false }
    this.#entries.set(deviceId, created)
    return created
  }

  #reset(entry: Entry, now: number): void {
    entry.windowStartedAt = now
    entry.counts.clear()
    entry.warned = false
  }
}
