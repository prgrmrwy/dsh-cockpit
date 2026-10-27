import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStatusFacts, SessionActivitySummary } from '@dsh-cockpit/shared'
import { createChimePlayer, detectChimes, isChimeEnabled, setChimeEnabled } from '../src/chime.js'

function device(id: string, statuses: Partial<Record<'approval' | 'question' | 'completed', number>>, extra: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts {
  const sessionStatuses: SessionActivitySummary[] = []
  for (const [kind, count] of Object.entries(statuses)) {
    sessionStatuses.push({ kind: kind as SessionActivitySummary['kind'], state: kind === 'completed' ? 'done' : 'warning', count })
  }
  return {
    deviceId: id, displayName: id, kind: 'local', remoteDshPort: 3080, enabled: true, order: 0,
    state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0,
    pendingInteractionObservability: 'available', sessionStatuses, ...extra,
  } as DeviceStatusFacts
}

describe('detectChimes', () => {
  it('first frame only records a baseline', () => {
    const r = detectChimes(undefined, [device('a', { completed: 2, approval: 1 })])
    expect(r.ding).toBe(false)
    expect(r.knock).toBe(false)
    expect(r.next.get('a')).toEqual({ waiting: 1, completed: 2 })
  })

  it('a newly appearing device is a baseline', () => {
    const first = detectChimes(undefined, [device('a', {})])
    const r = detectChimes(first.next, [device('a', {}), device('b', { completed: 1, question: 1 })])
    expect(r).toMatchObject({ ding: false, knock: false })
  })

  it('completed increase dings, waiting increase knocks', () => {
    const first = detectChimes(undefined, [device('a', {})])
    expect(detectChimes(first.next, [device('a', { completed: 1 })])).toMatchObject({ ding: true, knock: false })
    expect(detectChimes(first.next, [device('a', { approval: 1 })])).toMatchObject({ ding: false, knock: true })
    expect(detectChimes(first.next, [device('a', { question: 1 })])).toMatchObject({ ding: false, knock: true })
  })

  it('decrease or no change stays silent', () => {
    const first = detectChimes(undefined, [device('a', { completed: 2, approval: 1 })])
    expect(detectChimes(first.next, [device('a', { completed: 1 })])).toMatchObject({ ding: false, knock: false })
    expect(detectChimes(first.next, [device('a', { completed: 2, approval: 1 })])).toMatchObject({ ding: false, knock: false })
  })

  it('ignores disabled devices and rebaselines after a non-READY gap', () => {
    const first = detectChimes(undefined, [device('a', {}), device('b', {})])
    const r1 = detectChimes(first.next, [device('a', { completed: 1 }, { enabled: false }), device('b', {}, { state: 'CONNECTING' } as Partial<DeviceStatusFacts>)])
    expect(r1).toMatchObject({ ding: false, knock: false })
    const r2 = detectChimes(r1.next, [device('a', {}), device('b', { completed: 3, approval: 1 })])
    expect(r2).toMatchObject({ ding: false, knock: false })
    const r3 = detectChimes(r2.next, [device('a', {}), device('b', { completed: 4, approval: 1 })])
    expect(r3).toMatchObject({ ding: true, knock: false })
  })

  it('several devices increasing at once report a single flag', () => {
    const first = detectChimes(undefined, [device('a', {}), device('b', {})])
    const r = detectChimes(first.next, [device('a', { completed: 1 }), device('b', { completed: 1 })])
    expect(r.ding).toBe(true)
  })
})

describe('chime player', () => {
  let tones: { kind: string }[]
  class FakeContext {
    currentTime = 0
    state = 'running'
    destination = {}
    resume = vi.fn(async () => undefined)
    createOscillator() {
      const osc = { type: '', frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(() => undefined), start: vi.fn(() => { tones.push({ kind: osc.type }) }), stop: vi.fn() }
      return osc
    }
    createGain() {
      return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(() => undefined) }
    }
  }

  beforeEach(() => {
    tones = []
    window.localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers() })

  it('is enabled by default and persists off locally', () => {
    expect(isChimeEnabled()).toBe(true)
    setChimeEnabled(false)
    expect(isChimeEnabled()).toBe(false)
    expect(window.localStorage.getItem('cockpit:chime')).toBe('off')
    setChimeEnabled(true)
    expect(isChimeEnabled()).toBe(true)
  })

  it('plays nothing when disabled', () => {
    setChimeEnabled(false)
    const player = createChimePlayer(() => new FakeContext() as unknown as AudioContext)
    player.play({ ding: true, knock: true })
    vi.runAllTimers()
    expect(tones).toHaveLength(0)
  })

  it('throttles the same kind within the window but not across kinds', () => {
    const player = createChimePlayer(() => new FakeContext() as unknown as AudioContext)
    player.play({ ding: true, knock: false })
    const afterFirst = tones.length
    expect(afterFirst).toBeGreaterThan(0)
    player.play({ ding: true, knock: false })
    expect(tones.length).toBe(afterFirst)
    player.play({ ding: false, knock: true })
    expect(tones.length).toBeGreaterThan(afterFirst)
    vi.advanceTimersByTime(1100)
    const before = tones.length
    player.play({ ding: true, knock: false })
    expect(tones.length).toBeGreaterThan(before)
  })

  it('swallows audio failures silently', () => {
    const player = createChimePlayer(() => { throw new Error('no audio') })
    expect(() => player.play({ ding: true, knock: true })).not.toThrow()
    vi.runAllTimers()
  })
})
