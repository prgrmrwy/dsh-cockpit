import { describe, expect, it } from 'vitest'
import { BRIDGE_CAPABILITY_PURPOSE, BridgeCapabilityService } from '../src/auth/bridge-capability.js'

const ORIGIN = 'http://127.0.0.1:4317'
const OTHER_ORIGIN = 'http://127.0.0.1:4318'

describe('BridgeCapabilityService', () => {
  it('issues a token that validates for the exact device and origin it was bound to', () => {
    const service = new BridgeCapabilityService()
    const issued = service.issue({ deviceId: 'd1', origin: ORIGIN })
    expect(issued.token).toBeTruthy()
    expect(issued.expiresAt).toBeGreaterThan(issued.issuedAt)

    const grant = service.validate(issued.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })
    expect(grant).toEqual(expect.objectContaining({ deviceId: 'd1', origin: ORIGIN }))
  })

  it('rejects a forged/unknown token', () => {
    const service = new BridgeCapabilityService()
    service.issue({ deviceId: 'd1', origin: ORIGIN })
    expect(service.validate('not-a-real-token', { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
    expect(service.validate(undefined, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
    expect(service.validate('', { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
  })

  it('rejects an expired token', () => {
    let now = 1_000_000
    const service = new BridgeCapabilityService({ ttlMs: 1_000, now: () => now })
    const issued = service.issue({ deviceId: 'd1', origin: ORIGIN })
    now += 1_001
    expect(service.validate(issued.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
  })

  it('rejects a token presented for the wrong device', () => {
    const service = new BridgeCapabilityService()
    const issued = service.issue({ deviceId: 'd1', origin: ORIGIN })
    expect(service.validate(issued.token, { deviceId: 'd2', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
  })

  it('rejects a token presented from a different origin than it was bound to', () => {
    const service = new BridgeCapabilityService()
    const issued = service.issue({ deviceId: 'd1', origin: ORIGIN })
    expect(service.validate(issued.token, { deviceId: 'd1', origin: OTHER_ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
  })

  it('rejects a token used for a different purpose', () => {
    const service = new BridgeCapabilityService()
    const issued = service.issue({ deviceId: 'd1', origin: ORIGIN })
    expect(service.validate(issued.token, { deviceId: 'd1', origin: ORIGIN, purpose: 'other-purpose' as never })).toBeUndefined()
  })

  it('normalizes an origin with different casing/trailing slash to the same bound value', () => {
    const service = new BridgeCapabilityService()
    const issued = service.issue({ deviceId: 'd1', origin: `${ORIGIN}/` })
    expect(service.validate(issued.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeDefined()
  })

  it('rejects an origin carrying a path, query or fragment as invalid', () => {
    const service = new BridgeCapabilityService()
    expect(() => service.issue({ deviceId: 'd1', origin: `${ORIGIN}/some/path` })).toThrow()
    expect(() => service.issue({ deviceId: 'd1', origin: `${ORIGIN}/?x=1` })).toThrow()
  })

  it('revokeDevice invalidates every outstanding token for that device only', () => {
    const service = new BridgeCapabilityService()
    const a = service.issue({ deviceId: 'd1', origin: ORIGIN })
    const b = service.issue({ deviceId: 'd2', origin: ORIGIN })
    service.revokeDevice('d1')
    expect(service.validate(a.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
    expect(service.validate(b.token, { deviceId: 'd2', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeDefined()
  })

  it('consume validates and atomically revokes a one-shot token', () => {
    const service = new BridgeCapabilityService()
    const issued = service.issue({ deviceId: 'd1', origin: ORIGIN })
    const first = service.consume(issued.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })
    expect(first).toBeDefined()
    const second = service.consume(issued.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })
    expect(second).toBeUndefined()
  })

  it('a disabled/re-attached device (revoked) cannot present a stale capability after re-enable', () => {
    const service = new BridgeCapabilityService()
    const issued = service.issue({ deviceId: 'd1', origin: ORIGIN })
    // Device gets disabled: connectivity.service revokes its capabilities.
    service.revokeDevice('d1')
    // A fresh capability for the re-enabled device is unaffected.
    const reissued = service.issue({ deviceId: 'd1', origin: ORIGIN })
    expect(service.validate(issued.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
    expect(service.validate(reissued.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeDefined()
  })

  it('evicts the oldest grant once the configured capacity is exceeded', () => {
    let now = 0
    const service = new BridgeCapabilityService({ maxEntries: 2, now: () => now })
    const first = service.issue({ deviceId: 'd1', origin: ORIGIN })
    now += 1
    service.issue({ deviceId: 'd2', origin: ORIGIN })
    now += 1
    service.issue({ deviceId: 'd3', origin: ORIGIN })
    expect(service.validate(first.token, { deviceId: 'd1', origin: ORIGIN, purpose: BRIDGE_CAPABILITY_PURPOSE })).toBeUndefined()
  })
})
