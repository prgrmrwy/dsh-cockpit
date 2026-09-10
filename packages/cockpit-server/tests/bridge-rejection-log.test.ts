import { describe, expect, it, vi } from 'vitest'
import { Logger } from '@nestjs/common'
import { DevicesController } from '../src/devices/devices.controller.js'
import { BRIDGE_CAPABILITY_HEADER } from '../src/auth/bridge-capability.js'
import {
  BRIDGE_REJECTION_WARN_THRESHOLD,
  BRIDGE_REJECTION_WINDOW_MS,
  BridgeRejectionLog,
  classifyBridgeRejection,
} from '../src/connectivity/bridge-rejection-log.js'

const T0 = 1_800_000_000_000

describe('classifyBridgeRejection', () => {
  it('classifies the capability error thrown by validateBridgeCapability', () => {
    expect(classifyBridgeRejection('invalid or expired bridge capability')).toBe('capability')
  })

  it('classifies the origin-mismatch error thrown while resolving a lifecycle', () => {
    expect(classifyBridgeRejection('no cockpit device matches origin http://127.0.0.1:62595')).toBe('unknown-origin')
  })

  it('falls back to a definite class for unrecognized text', () => {
    expect(classifyBridgeRejection('something entirely new')).toBe('other')
    expect(classifyBridgeRejection('')).toBe('other')
  })
})

describe('BridgeRejectionLog grading', () => {
  it('keeps a routine self-healing rejection at debug level', () => {
    const log = new BridgeRejectionLog()
    const decision = log.record('d1', 'invalid or expired bridge capability', T0)
    expect(decision.level).toBe('debug')
    expect(decision.class).toBe('capability')
    expect(decision.count).toBe(1)
  })

  it('aggregates repeats by device and class instead of escalating per rejection', () => {
    const log = new BridgeRejectionLog()
    const seen: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const d = log.record('d1', 'no cockpit device matches origin http://127.0.0.1:62595', T0 + i)
      seen.push(d.count)
      expect(d.level).toBe('debug')
    }
    // One running count per device+class, not one log line per rejection.
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  it('tracks the two classes independently for the same device', () => {
    const log = new BridgeRejectionLog()
    log.record('d1', 'invalid or expired bridge capability', T0)
    const other = log.record('d1', 'no cockpit device matches origin http://127.0.0.1:62595', T0 + 1)
    expect(other.class).toBe('unknown-origin')
    expect(other.count).toBe(1)
  })

  it('escalates once when a device is repeatedly rejected with no successful report', () => {
    const log = new BridgeRejectionLog()
    let warns = 0
    for (let i = 0; i < BRIDGE_REJECTION_WARN_THRESHOLD + 5; i += 1) {
      if (log.record('d1', 'invalid or expired bridge capability', T0 + i).level === 'warn') warns += 1
    }
    // One alert per episode, not one per rejection past the threshold.
    expect(warns).toBe(1)
  })

  it('reports the window count on the alert so the episode is measurable', () => {
    const log = new BridgeRejectionLog()
    let alert: { level: string; count: number } | undefined
    for (let i = 0; i < BRIDGE_REJECTION_WARN_THRESHOLD; i += 1) {
      const d = log.record('d1', 'invalid or expired bridge capability', T0 + i)
      if (d.level === 'warn') alert = d
    }
    expect(alert?.count).toBe(BRIDGE_REJECTION_WARN_THRESHOLD)
  })

  it('does not escalate a device that reported successfully inside the window', () => {
    const log = new BridgeRejectionLog()
    // A device that is alive: it keeps reporting even while some callbacks are
    // rejected (this is exactly the healthy-but-noisy shape observed in practice).
    for (let i = 0; i < BRIDGE_REJECTION_WARN_THRESHOLD * 3; i += 1) {
      const d = log.record('d1', 'invalid or expired bridge capability', T0 + i)
      expect(d.level).toBe('debug')
      if (i % 5 === 0) log.recordSuccess('d1', T0 + i)
    }
  })

  it('a success resets the counter so stale rejections cannot accumulate', () => {
    const log = new BridgeRejectionLog()
    for (let i = 0; i < BRIDGE_REJECTION_WARN_THRESHOLD - 1; i += 1) log.record('d1', 'invalid or expired bridge capability', T0 + i)
    log.recordSuccess('d1', T0 + 100)
    const after = log.record('d1', 'invalid or expired bridge capability', T0 + 101)
    expect(after.count).toBe(1)
    expect(after.level).toBe('debug')
  })

  it('starts a fresh window once the previous one has elapsed', () => {
    const log = new BridgeRejectionLog()
    for (let i = 0; i < BRIDGE_REJECTION_WARN_THRESHOLD - 1; i += 1) log.record('d1', 'invalid or expired bridge capability', T0 + i)
    const later = log.record('d1', 'invalid or expired bridge capability', T0 + BRIDGE_REJECTION_WINDOW_MS + 1)
    expect(later.count).toBe(1)
  })

  it('forgets a device when it goes away', () => {
    const log = new BridgeRejectionLog()
    log.record('d1', 'invalid or expired bridge capability', T0)
    log.forget('d1')
    expect(log.record('d1', 'invalid or expired bridge capability', T0 + 1).count).toBe(1)
  })

  it('grades devices independently', () => {
    const log = new BridgeRejectionLog()
    for (let i = 0; i < BRIDGE_REJECTION_WARN_THRESHOLD; i += 1) log.record('d1', 'invalid or expired bridge capability', T0 + i)
    // d2 has its own budget; d1 escalating must not implicate it.
    expect(log.record('d2', 'invalid or expired bridge capability', T0).level).toBe('debug')
  })
})

/** The grading path must be invisible to the rejection contract. */
describe('controller bridge rejection logging', () => {
  const request = (headers: Record<string, string | string[] | undefined> = {}) => ({ headers }) as never

  function controllerWith(reason: string, verdict: { level: 'debug' | 'warn'; count: number; class: string }) {
    const validateBridgeCapability = vi.fn(() => { throw new Error(reason) })
    const gradeBridgeRejection = vi.fn(() => verdict)
    const controller = new DevicesController({
      validateBridgeCapability,
      resolveBridgeDeviceId: () => 'device-1',
      gradeBridgeRejection,
      bridgeSessionOpened: vi.fn(),
    } as never, {} as never)
    return { controller, gradeBridgeRejection }
  }

  it('logs a routine rejection at debug with device/origin/reason/class/count', async () => {
    const { controller } = controllerWith('invalid or expired bridge capability', { level: 'debug', count: 3, class: 'capability' })
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      await expect(controller.bridgeSessionOpened(
        request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'stale' }),
        { sessionId: 's1', protocolVersion: 2 },
      )).rejects.toMatchObject({ status: 400 })

      expect(warnSpy).not.toHaveBeenCalled()
      const logged = debugSpy.mock.calls.map(call => String(call[0])).join('\n')
      expect(logged).toContain('device=device-1')
      expect(logged).toContain('origin=http://127.0.0.1:4317')
      expect(logged).toContain('protocolVersion=2')
      expect(logged).toContain('reason=invalid or expired bridge capability')
      expect(logged).toContain('class=capability')
      expect(logged).toContain('count=3')
    } finally {
      debugSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('logs a self-healing failure at warn with the episode count', async () => {
    const { controller } = controllerWith('invalid or expired bridge capability', { level: 'warn', count: 20, class: 'capability' })
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      await expect(controller.bridgeSessionOpened(
        request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'stale' }),
        { sessionId: 's1' },
      )).rejects.toMatchObject({ status: 400 })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const message = String(warnSpy.mock.calls[0]![0])
      expect(message).toContain('self-healing failed')
      expect(message).toContain('device=device-1')
      expect(message).toContain('class=capability')
      expect(message).toContain('count=20')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('rejects with the same status and error code regardless of grading', async () => {
    const { controller } = controllerWith('invalid or expired bridge capability', { level: 'warn', count: 99, class: 'capability' })
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      // The response body is what plugins switch on; grading must not touch it.
      await expect(controller.bridgeSessionOpened(
        request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'stale' }),
        { sessionId: 's1' },
      )).rejects.toMatchObject({
        status: 400,
        response: { code: 'bridge-capability-invalid' },
      })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('keeps the original rejection when grading itself is unavailable', async () => {
    // Reduced dependency surface: no grading methods on the service at all.
    const validateBridgeCapability = vi.fn(() => { throw new Error('invalid or expired bridge capability') })
    const controller = new DevicesController({ validateBridgeCapability, bridgeSessionOpened: vi.fn() } as never, {} as never)
    await expect(controller.bridgeSessionOpened(
      request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'stale' }),
      { sessionId: 's1' },
    )).rejects.toMatchObject({ status: 400, response: { code: 'bridge-capability-invalid' } })
  })
})
