import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

/** Per-device counts the chime compares between frames. */
export interface ChimeCounts { readonly waiting: number; readonly completed: number }
export interface ChimeResult { readonly next: Map<string, ChimeCounts>; readonly knock: boolean; readonly ding: boolean }

/** Derive "should we knock / ding" from two consecutive device snapshots.
 *
 * Only enabled READY devices are tracked. A device missing from `prev` (page
 * first frame, newly added, or just back to READY after a gap) is a baseline:
 * its existing waiting/unread counts are not news. Only increases chime. */
export function detectChimes(prev: ReadonlyMap<string, ChimeCounts> | undefined, devices: readonly DeviceStatusFacts[]): ChimeResult {
  const next = new Map<string, ChimeCounts>()
  let knock = false
  let ding = false
  for (const device of devices) {
    if (!device.enabled || device.state !== 'READY') continue
    let waiting = 0
    let completed = 0
    for (const status of device.sessionStatuses) {
      if (status.kind === 'approval' || status.kind === 'question') waiting += status.count
      else if (status.kind === 'completed') completed += status.count
    }
    next.set(device.deviceId, { waiting, completed })
    const before = prev?.get(device.deviceId)
    if (before === undefined) continue
    if (waiting > before.waiting) knock = true
    if (completed > before.completed) ding = true
  }
  return { next, knock, ding }
}

const PREF_KEY = 'cockpit:chime'

/** Local-only preference; default on. */
export function isChimeEnabled(): boolean {
  try { return window.localStorage.getItem(PREF_KEY) !== 'off' } catch { return true }
}

export function setChimeEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(PREF_KEY)
    else window.localStorage.setItem(PREF_KEY, 'off')
  } catch { /* storage unavailable: keep default */ }
}

const THROTTLE_MS = 1000
const DING_AFTER_KNOCK_MS = 400

/** One decaying tone: osc → gain → destination. */
function tone(ctx: AudioContext, opts: { type: OscillatorType; freq: number; endFreq?: number; at: number; attack: number; decay: number; peak: number }): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = opts.type
  osc.frequency.setValueAtTime(opts.freq, opts.at)
  if (opts.endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, opts.at + opts.decay)
  gain.gain.setValueAtTime(0.0001, opts.at)
  gain.gain.linearRampToValueAtTime(opts.peak, opts.at + opts.attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.attack + opts.decay)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(opts.at)
  osc.stop(opts.at + opts.attack + opts.decay + 0.05)
}

/** 「叮~」: bright single note with a soft octave overtone and a short tail. */
function ding(ctx: AudioContext): void {
  const t = ctx.currentTime
  tone(ctx, { type: 'sine', freq: 1320, at: t, attack: 0.005, decay: 0.7, peak: 0.25 })
  tone(ctx, { type: 'sine', freq: 2640, at: t, attack: 0.005, decay: 0.35, peak: 0.06 })
}

/** 「咚咚」: two short, low knocks with a pitch drop for a woody thud. */
function knock(ctx: AudioContext): void {
  const t = ctx.currentTime
  for (const offset of [0, 0.16]) {
    tone(ctx, { type: 'triangle', freq: 180, endFreq: 90, at: t + offset, attack: 0.003, decay: 0.09, peak: 0.5 })
    tone(ctx, { type: 'sine', freq: 420, endFreq: 200, at: t + offset, attack: 0.002, decay: 0.03, peak: 0.15 })
  }
}

export interface ChimePlayer {
  play(result: { knock: boolean; ding: boolean }): void
  /** Create/resume the AudioContext; call from a user gesture. */
  unlock(): void
}

/** Player with a lazily created shared AudioContext and per-kind throttling.
 * Any audio failure (no Web Audio, autoplay policy) is swallowed silently. */
export function createChimePlayer(makeContext: () => AudioContext = () => new AudioContext()): ChimePlayer {
  let ctx: AudioContext | undefined
  const last = { knock: -Infinity, ding: -Infinity }

  const context = (): AudioContext | undefined => {
    try {
      ctx ??= makeContext()
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
      return ctx
    } catch { return undefined }
  }

  const fire = (kind: 'knock' | 'ding'): void => {
    const now = Date.now()
    if (now - last[kind] < THROTTLE_MS) return
    last[kind] = now
    const audio = context()
    if (audio === undefined) return
    try { (kind === 'knock' ? knock : ding)(audio) } catch { /* silent */ }
  }

  return {
    unlock() { context() },
    play(result) {
      if (!isChimeEnabled()) return
      if (result.knock) fire('knock')
      if (result.ding) {
        if (result.knock) setTimeout(() => fire('ding'), DING_AFTER_KNOCK_MS)
        else fire('ding')
      }
    },
  }
}

/** Unlock audio on the first user gesture so later chimes are allowed. */
export function installChimeUnlock(player: { unlock(): void }): () => void {
  const handler = () => { player.unlock(); remove() }
  const remove = () => {
    window.removeEventListener('pointerdown', handler)
    window.removeEventListener('keydown', handler)
  }
  window.addEventListener('pointerdown', handler)
  window.addEventListener('keydown', handler)
  return remove
}
