import { describe, expect, it, vi } from 'vitest'
import { DevicesController } from '../src/devices/devices.controller.js'
import { BRIDGE_CAPABILITY_HEADER } from '../src/auth/bridge-capability.js'

const request = (headers: Record<string, string | string[] | undefined> = {}) => ({ headers }) as never

describe('device update request validation', () => {
  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects non-integer order %s', async order => {
    const updateDevice = vi.fn()
    const controller = new DevicesController({ updateDevice } as never, {} as never)

    await expect(controller.update('device-1', { order } as never)).rejects.toMatchObject({ status: 400 })
    expect(updateDevice).not.toHaveBeenCalled()
  })

  it('accepts an integer target order', async () => {
    const updateDevice = vi.fn().mockResolvedValue(undefined)
    const controller = new DevicesController({ updateDevice } as never, {} as never)

    await expect(controller.update('device-1', { order: -2 } as never)).resolves.toEqual({ deviceId: 'device-1' })
    expect(updateDevice).toHaveBeenCalledWith('device-1', { order: -2 })
  })
})

describe('device-level completion ack endpoint', () => {
  it('acknowledges via the connectivity service and reports success', async () => {
    const ackCompleted = vi.fn()
    const controller = new DevicesController({ ackCompleted } as never, {} as never)
    await expect(controller.ackCompleted('device-1')).resolves.toEqual({ acked: true })
    expect(ackCompleted).toHaveBeenCalledWith('device-1')
  })

  it('surfaces an unknown device as a 404', async () => {
    const ackCompleted = vi.fn(() => { throw new Error('unknown device device-1') })
    const controller = new DevicesController({ ackCompleted } as never, {} as never)
    await expect(controller.ackCompleted('device-1')).rejects.toMatchObject({ status: 404 })
  })
})

describe('bridge capability endpoint', () => {
  it('is a same-origin, device-scoped call with no Origin-header requirement of its own (TokenMiddleware cookie-gates it like other /api/devices routes)', async () => {
    const issueBridgeCapability = vi.fn().mockReturnValue({ capability: 'tok', expiresAt: 1, protocolVersion: 2 })
    const controller = new DevicesController({ issueBridgeCapability } as never, {} as never)

    const result = await controller.bridgeCapability('device-1')
    expect(result).toEqual({ capability: 'tok', expiresAt: 1, protocolVersion: 2 })
    // The capability is bound to the DEVICE's own origin inside the service
    // (from its live endpoint), not to this caller's origin — so the
    // controller must not forward an Origin header as a binding origin here.
    expect(issueBridgeCapability).toHaveBeenCalledWith('device-1')
  })

  it('surfaces an unconnected device as a 400, not a leaked internal error', async () => {
    const issueBridgeCapability = vi.fn(() => { throw new Error('device device-1 is not connected') })
    const controller = new DevicesController({ issueBridgeCapability } as never, {} as never)
    await expect(controller.bridgeCapability('device-1')).rejects.toMatchObject({ status: 400 })
  })
})

describe('bridge session-opened / hello endpoints', () => {
  it('validates the capability header before accepting a selection snapshot', async () => {
    const validateBridgeCapability = vi.fn()
    const bridgeSessionOpened = vi.fn()
    const controller = new DevicesController({ validateBridgeCapability, bridgeSessionOpened } as never, {} as never)

    const headers = { origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'tok' }
    await expect(controller.bridgeSessionOpened(request(headers), { sessionId: 's1', protocolVersion: 2 }))
      .resolves.toEqual({ opened: true, accepted: true })
    expect(validateBridgeCapability).toHaveBeenCalledWith('http://127.0.0.1:4317', 'tok')
    expect(bridgeSessionOpened).toHaveBeenCalledWith('http://127.0.0.1:4317', 's1', 2)
  })

  it('rejects a forged capability without ever reaching the lifecycle', async () => {
    const validateBridgeCapability = vi.fn(() => { throw new Error('invalid or expired bridge capability') })
    const bridgeSessionOpened = vi.fn()
    const controller = new DevicesController({ validateBridgeCapability, bridgeSessionOpened } as never, {} as never)

    await expect(controller.bridgeSessionOpened(
      request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'forged' }),
      { sessionId: 's1' },
    )).rejects.toMatchObject({ status: 400 })
    expect(bridgeSessionOpened).not.toHaveBeenCalled()
  })

  it('accepts a request with no capability header at all as the legacy path (already gated by TokenMiddleware\'s cookie check to reach here)', async () => {
    const validateBridgeCapability = vi.fn()
    const bridgeSessionOpened = vi.fn()
    const controller = new DevicesController({ validateBridgeCapability, bridgeSessionOpened } as never, {} as never)

    // No BRIDGE_CAPABILITY_HEADER at all — a pre-upgrade plugin using the old
    // cookie-based flow. This must NOT be rejected: TokenMiddleware already
    // required the persistent cookie for any request without this header.
    await expect(controller.bridgeSessionOpened(
      request({ origin: 'http://127.0.0.1:4317' }),
      { sessionId: 's1' },
    )).resolves.toEqual({ opened: true, accepted: true })
    expect(validateBridgeCapability).not.toHaveBeenCalled()
    expect(bridgeSessionOpened).toHaveBeenCalledWith('http://127.0.0.1:4317', 's1', 1)
  })

  it('accepts an explicit null current as a cleared selection (archive-before-flush)', async () => {
    const validateBridgeCapability = vi.fn()
    const bridgeSessionOpened = vi.fn()
    const controller = new DevicesController({ validateBridgeCapability, bridgeSessionOpened } as never, {} as never)

    await expect(controller.bridgeSessionOpened(
      request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'tok' }),
      { current: null, protocolVersion: 2 },
    )).resolves.toEqual({ opened: true, accepted: true })
    expect(bridgeSessionOpened).toHaveBeenCalledWith('http://127.0.0.1:4317', undefined, 2)
  })

  it('rejects an empty-string sessionId as invalid rather than silently clearing', async () => {
    const validateBridgeCapability = vi.fn()
    const bridgeSessionOpened = vi.fn()
    const controller = new DevicesController({ validateBridgeCapability, bridgeSessionOpened } as never, {} as never)

    await expect(controller.bridgeSessionOpened(
      request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'tok' }),
      { sessionId: '' },
    )).rejects.toMatchObject({ status: 400 })
    expect(bridgeSessionOpened).not.toHaveBeenCalled()
  })

  it('hello records protocol version and current selection after capability validation', async () => {
    const validateBridgeCapability = vi.fn()
    const bridgeHello = vi.fn()
    const controller = new DevicesController({ validateBridgeCapability, bridgeHello } as never, {} as never)

    await expect(controller.bridgeHello(
      request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'tok' }),
      { version: '0.2.0', protocolVersion: 2, current: 's1' },
    )).resolves.toEqual({ helloed: true, accepted: true })
    expect(validateBridgeCapability).toHaveBeenCalledWith('http://127.0.0.1:4317', 'tok')
    expect(bridgeHello).toHaveBeenCalledWith('http://127.0.0.1:4317', '0.2.0', 2, 's1')
  })

  it('an unrecognized protocolVersion defaults to legacy (1) rather than rejecting the request', async () => {
    const validateBridgeCapability = vi.fn()
    const bridgeHello = vi.fn()
    const controller = new DevicesController({ validateBridgeCapability, bridgeHello } as never, {} as never)

    await controller.bridgeHello(
      request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'tok' }),
      { version: 'old-plugin' },
    )
    expect(bridgeHello).toHaveBeenCalledWith('http://127.0.0.1:4317', 'old-plugin', 1, undefined)
  })

  it('hello rejects a forged capability but accepts a request with no header (legacy path)', async () => {
    const validateBridgeCapability = vi.fn(() => { throw new Error('invalid or expired bridge capability') })
    const bridgeHello = vi.fn()
    const controller = new DevicesController({ validateBridgeCapability, bridgeHello } as never, {} as never)

    await expect(controller.bridgeHello(
      request({ origin: 'http://127.0.0.1:4317', [BRIDGE_CAPABILITY_HEADER]: 'forged' }),
      { version: '0.2.0' },
    )).rejects.toMatchObject({ status: 400 })
    expect(bridgeHello).not.toHaveBeenCalled()

    validateBridgeCapability.mockClear()
    await expect(controller.bridgeHello(
      request({ origin: 'http://127.0.0.1:4317' }),
      { version: 'legacy-plugin' },
    )).resolves.toEqual({ helloed: true, accepted: true })
    expect(validateBridgeCapability).not.toHaveBeenCalled()
    expect(bridgeHello).toHaveBeenCalledWith('http://127.0.0.1:4317', 'legacy-plugin', 1, undefined)
  })
})
