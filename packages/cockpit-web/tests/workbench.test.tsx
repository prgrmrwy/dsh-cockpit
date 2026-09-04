import { cleanup, render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { Workbench } from '../src/workbench/Workbench.jsx'

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'VM A', kind: 'remote', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0,
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0, endpoint: 'http://127.0.0.1:51688/',
  ...overrides,
})

describe('workbench', () => {
  it('lazy-creates an iframe only when a device is selected', () => {
    const { container, rerender } = render(<StrictMode><Workbench device={undefined} /></StrictMode>)
    expect(container.querySelector('iframe')).toBeNull()

    rerender(<StrictMode><Workbench device={device()} /></StrictMode>)
    const frame = container.querySelector('iframe[data-workbench-device="d1"]')
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('src')).toBe('http://127.0.0.1:51688/')
    // Chrome 136+ tightened the default allowlist of clipboard-read/write to
    // `self`; the cross-origin workbench iframe must declare them explicitly.
    expect(frame!.getAttribute('allow')).toBe('clipboard-read; clipboard-write')
  })

  it('keeps the iframe alive across device switches', () => {
    const a = device({ deviceId: 'd1', displayName: 'A', endpoint: 'http://127.0.0.1:51000/' })
    const b = device({ deviceId: 'd2', displayName: 'B', endpoint: 'http://127.0.0.1:52000/' })
    const { container, rerender } = render(<StrictMode><Workbench device={a} enabledDeviceIds={['d1', 'd2']} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).not.toBeNull()

    rerender(<StrictMode><Workbench device={b} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d2"]')).not.toBeNull()

    // Switch back: the d1 iframe must still be mounted (kept alive, not recreated).
    rerender(<StrictMode><Workbench device={a} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).not.toBeNull()
    expect(container.querySelectorAll('iframe')).toHaveLength(2)
  })

  it('unmounts a disabled iframe, retains transient disconnects, and recreates it after re-enable', () => {
    const ready = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:51000/' })
    const disconnected = device({ deviceId: 'd1', state: 'CONNECTING', diagnostic: 'reconnecting', endpoint: undefined })
    const { container, rerender } = render(
      <StrictMode><Workbench device={ready} enabledDeviceIds={['d1']} /></StrictMode>,
    )
    const original = container.querySelector('iframe[data-workbench-device="d1"]')
    expect(original).not.toBeNull()

    rerender(<StrictMode><Workbench device={disconnected} enabledDeviceIds={['d1']} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).toBe(original)
    expect(container.querySelector('[data-cockpit-offline="d1"]')).not.toBeNull()

    rerender(<StrictMode><Workbench device={undefined} enabledDeviceIds={[]} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).toBeNull()
    expect(container.querySelector('[data-cockpit-offline="d1"]')).toBeNull()

    const reenabled = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:53000/' })
    rerender(<StrictMode><Workbench device={reenabled} enabledDeviceIds={['d1']} /></StrictMode>)
    const recreated = container.querySelector('iframe[data-workbench-device="d1"]')
    expect(recreated).not.toBeNull()
    expect(recreated).not.toBe(original)
    expect(recreated!.getAttribute('src')).toBe('http://127.0.0.1:53000/')
  })

  it('removes an unselected iframe when its device is deleted', () => {
    const a = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:51000/' })
    const b = device({ deviceId: 'd2', endpoint: 'http://127.0.0.1:52000/' })
    const { container, rerender } = render(
      <StrictMode><Workbench device={a} enabledDeviceIds={['d1', 'd2']} /></StrictMode>,
    )
    rerender(<StrictMode><Workbench device={b} enabledDeviceIds={['d1', 'd2']} /></StrictMode>)
    expect(container.querySelectorAll('iframe')).toHaveLength(2)

    rerender(<StrictMode><Workbench device={b} enabledDeviceIds={['d2']} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).toBeNull()
    expect(container.querySelector('iframe[data-workbench-device="d2"]')).not.toBeNull()
  })

  it('shows a management action instead of a disabled reconnect overlay', () => {
    const onManageDevices = vi.fn()
    const { container } = render(
      <StrictMode><Workbench device={undefined} enabledDeviceIds={[]} onReconnect={vi.fn()} onManageDevices={onManageDevices} /></StrictMode>,
    )
    expect(container.querySelector('[data-cockpit-no-enabled="true"]')).not.toBeNull()
    expect(container.querySelector('[data-cockpit-offline]')).toBeNull()
    expect(container.textContent).toContain('没有已启用设备')
    const button = container.querySelector('button')!
    expect(button.textContent).toBe('打开设备管理')
    button.click()
    expect(onManageDevices).toHaveBeenCalledTimes(1)
  })

  it('notifies the active iframe when it loads and whenever its device tab is reactivated', () => {
    const a = device({ deviceId: 'd1', displayName: 'A', endpoint: 'http://127.0.0.1:51000/' })
    const b = device({ deviceId: 'd2', displayName: 'B', endpoint: 'http://127.0.0.1:52000/' })
    const { container, rerender } = render(<StrictMode><Workbench device={a} enabledDeviceIds={['d1', 'd2']} /></StrictMode>)
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')

    frameA.dispatchEvent(new Event('load'))
    expect(postToA).toHaveBeenLastCalledWith({ type: 'dsh-cockpit:device-activated' }, 'http://127.0.0.1:51000')

    postToA.mockClear()
    rerender(<StrictMode><Workbench device={b} /></StrictMode>)
    expect(postToA).not.toHaveBeenCalled()

    rerender(<StrictMode><Workbench device={a} /></StrictMode>)
    expect(postToA).toHaveBeenCalledTimes(1)
    expect(postToA).toHaveBeenCalledWith({ type: 'dsh-cockpit:device-activated' }, 'http://127.0.0.1:51000')
  })

  it('shows an offline overlay when the device is not READY', () => {
    const offline = device({ state: 'DSH_UNAVAILABLE', diagnostic: 'no dsh at port' })
    const { container } = render(<StrictMode><Workbench device={offline} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).not.toBeNull()
    expect(container.querySelector('[data-cockpit-offline="d1"]')).not.toBeNull()
    expect(container.querySelector('.overlay-diagnostic')?.textContent).toBe('no dsh at port')
  })

  it('removes the offline overlay when the device becomes READY live', () => {
    const offline = device({ deviceId: 'd1', state: 'CONNECTING', diagnostic: 'connecting' })
    const ready = device({ deviceId: 'd1', state: 'READY', diagnostic: 'ok' })
    const { container, rerender } = render(<StrictMode><Workbench device={offline} /></StrictMode>)
    expect(container.querySelector('[data-cockpit-offline="d1"]')).not.toBeNull()
    // A live status push (SSE) updates the device prop with the same id.
    rerender(<StrictMode><Workbench device={ready} /></StrictMode>)
    expect(container.querySelector('[data-cockpit-offline="d1"]')).toBeNull()
  })

  it('shows the connecting overlay (spinner, no failure wording) while CONNECTING', () => {
    const { container } = render(<StrictMode><Workbench device={device({ state: 'CONNECTING', diagnostic: 'connecting' })} /></StrictMode>)
    const overlay = container.querySelector('[data-cockpit-offline="d1"]')
    expect(overlay).not.toBeNull()
    expect(overlay!.getAttribute('data-cockpit-overlay-state')).toBe('CONNECTING')
    expect(container.querySelector('.overlay-spinner')).not.toBeNull()
    expect(container.querySelector('.overlay-title')?.textContent).toBe('正在连接…')
    expect(container.querySelector('.overlay-meta')).not.toBeNull()
  })

  it('refreshes the overlay timestamp when only lastUpdatedAt changes', () => {
    const { container, rerender } = render(
      <StrictMode><Workbench device={device({ state: 'CONNECTING', lastUpdatedAt: 23 * 3600_000 })} /></StrictMode>,
    )
    const before = container.querySelector('.overlay-meta')?.textContent
    rerender(
      <StrictMode><Workbench device={device({ state: 'CONNECTING', lastUpdatedAt: 25 * 3600_000 })} /></StrictMode>,
    )
    const after = container.querySelector('.overlay-meta')?.textContent
    expect(after).not.toBe(before)
  })

  it('requests a bridge capability for the active device and relays it with the real Cockpit origin', async () => {
    const a = device({ deviceId: 'd1', displayName: 'A', endpoint: 'http://127.0.0.1:51000/' })
    const requestBridgeCapability = vi.fn().mockResolvedValue({ capability: 'tok-1', expiresAt: Date.now() + 60_000, protocolVersion: 2 })
    const { container } = render(
      <StrictMode><Workbench device={a} enabledDeviceIds={['d1']} requestBridgeCapability={requestBridgeCapability} /></StrictMode>,
    )
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')

    expect(requestBridgeCapability).toHaveBeenCalledWith('d1')
    await waitFor(() => {
      expect(postToA).toHaveBeenCalledWith(
        { type: 'dsh-cockpit:bridge-config', cockpitOrigin: window.location.origin, capability: 'tok-1' },
        'http://127.0.0.1:51000',
      )
    })
  })

  it('re-requests and re-sends the bridge capability on every activation (device reactivated)', async () => {
    const a = device({ deviceId: 'd1', displayName: 'A', endpoint: 'http://127.0.0.1:51000/' })
    const b = device({ deviceId: 'd2', displayName: 'B', endpoint: 'http://127.0.0.1:52000/' })
    const requestBridgeCapability = vi.fn().mockResolvedValue({ capability: 'tok-1', expiresAt: Date.now() + 60_000, protocolVersion: 2 })
    const { container, rerender } = render(
      <StrictMode><Workbench device={a} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} /></StrictMode>,
    )
    await waitFor(() => expect(requestBridgeCapability).toHaveBeenCalledWith('d1'))
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')
    postToA.mockClear()

    rerender(<StrictMode><Workbench device={b} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} /></StrictMode>)
    rerender(<StrictMode><Workbench device={a} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} /></StrictMode>)

    // Reactivating device A must resend its bridge-config alongside the
    // existing device-activated message (the bridge re-asserts current +
    // retried acks on any activation/config refresh).
    expect(postToA).toHaveBeenCalledWith(
      { type: 'dsh-cockpit:bridge-config', cockpitOrigin: window.location.origin, capability: 'tok-1' },
      'http://127.0.0.1:51000',
    )
    expect(postToA).toHaveBeenCalledWith({ type: 'dsh-cockpit:device-activated' }, 'http://127.0.0.1:51000')
  })

  it('a failed capability request never disturbs the native workbench (bridge stays optional)', async () => {
    const a = device({ deviceId: 'd1', displayName: 'A', endpoint: 'http://127.0.0.1:51000/' })
    const requestBridgeCapability = vi.fn().mockRejectedValue(new Error('cockpit unreachable'))
    const { container } = render(
      <StrictMode><Workbench device={a} enabledDeviceIds={['d1']} requestBridgeCapability={requestBridgeCapability} /></StrictMode>,
    )
    await waitFor(() => expect(requestBridgeCapability).toHaveBeenCalledWith('d1'))
    // The iframe is still mounted and active; no offline overlay appears due
    // to a bridge failure — only connectivity state drives that overlay.
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).not.toBeNull()
    expect(container.querySelector('[data-cockpit-offline="d1"]')).toBeNull()
  })

  it('does not request a bridge capability when no requestBridgeCapability prop is supplied', () => {
    const a = device({ deviceId: 'd1', displayName: 'A', endpoint: 'http://127.0.0.1:51000/' })
    expect(() => render(<StrictMode><Workbench device={a} enabledDeviceIds={['d1']} /></StrictMode>)).not.toThrow()
  })

  it('follows the live tunnel endpoint after a reconnect (new loopback port)', () => {
    const oldPort = device({ state: 'READY', endpoint: 'http://127.0.0.1:51000/' })
    const connecting = device({ state: 'CONNECTING', diagnostic: 'reconnecting', endpoint: undefined })
    const newPort = device({ state: 'READY', diagnostic: 'ok', endpoint: 'http://127.0.0.1:53000/' })
    const { container, rerender } = render(<StrictMode><Workbench device={oldPort} /></StrictMode>)
    const frame = (): Element | null => container.querySelector('iframe[data-workbench-device="d1"]')
    expect(frame()!.getAttribute('src')).toBe('http://127.0.0.1:51000/')

    // Reconnect: CONNECTING without a live endpoint keeps the last URL while
    // the overlay (spinner) hides the stale frame.
    rerender(<StrictMode><Workbench device={connecting} /></StrictMode>)
    expect(frame()!.getAttribute('src')).toBe('http://127.0.0.1:51000/')
    expect(container.querySelector('.overlay-spinner')).not.toBeNull()

    // READY again on a NEW port: the iframe must follow, not keep the dead one.
    rerender(<StrictMode><Workbench device={newPort} /></StrictMode>)
    expect(frame()!.getAttribute('src')).toBe('http://127.0.0.1:53000/')
    expect(container.querySelector('[data-cockpit-offline="d1"]')).toBeNull()
  })

  it('renews the bridge capability before expiry without device switching', async () => {
    vi.useFakeTimers()
    try {
      const a = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:51000/' })
      const requestBridgeCapability = vi.fn()
        .mockImplementationOnce(async () => ({ capability: 'tok-1', expiresAt: Date.now() + 60_000 }))
        .mockImplementationOnce(async () => ({ capability: 'tok-2', expiresAt: Date.now() + 60_000 }))
      const { container } = render(
        <Workbench device={a} enabledDeviceIds={['d1']} requestBridgeCapability={requestBridgeCapability} />,
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(requestBridgeCapability).toHaveBeenCalledTimes(1)
      const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
      const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')
      postToA.mockClear()

      // Renewal fires 15s before the 60s expiry: a fresh capability is issued
      // and the bridge-config handshake is re-sent automatically.
      await vi.advanceTimersByTimeAsync(45_000)
      expect(requestBridgeCapability).toHaveBeenCalledTimes(2)
      expect(postToA).toHaveBeenCalledWith(
        { type: 'dsh-cockpit:bridge-config', cockpitOrigin: window.location.origin, capability: 'tok-2' },
        'http://127.0.0.1:51000',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a failed renewal with bounded backoff', async () => {
    vi.useFakeTimers()
    try {
      const a = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:51000/' })
      const requestBridgeCapability = vi.fn()
        .mockRejectedValueOnce(new Error('cockpit restarting'))
        .mockImplementation(async () => ({ capability: 'tok-2', expiresAt: Date.now() + 60_000 }))
      render(<Workbench device={a} enabledDeviceIds={['d1']} requestBridgeCapability={requestBridgeCapability} />)
      await vi.advanceTimersByTimeAsync(0)
      // Initial issue failed gracefully (bridge stays optional); the retry is
      // scheduled 15s later and succeeds.
      expect(requestBridgeCapability).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(requestBridgeCapability).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the renewal timer when switching devices', async () => {
    vi.useFakeTimers()
    try {
      const a = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:51000/' })
      const b = device({ deviceId: 'd2', endpoint: 'http://127.0.0.1:52000/' })
      const requestBridgeCapability = vi.fn()
        .mockImplementation(async () => ({ capability: 'tok', expiresAt: Date.now() + 60_000 }))
      const { rerender } = render(
        <Workbench device={a} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} />,
      )
      await vi.advanceTimersByTimeAsync(0)
      rerender(<Workbench device={b} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} />)
      await vi.advanceTimersByTimeAsync(0)
      expect(requestBridgeCapability.mock.calls.length).toBe(2)
      // Long past d1's would-be renewal: the timer for the non-current device
      // was cleared on switch, so no third request comes from d1's slot.
      await vi.advanceTimersByTimeAsync(50_000)
      expect(requestBridgeCapability.mock.calls.length).toBe(3)
      expect(requestBridgeCapability.mock.calls.filter(([id]) => id === 'd1')).toHaveLength(1)
      expect(requestBridgeCapability.mock.calls.filter(([id]) => id === 'd2')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renews on a capability-expired signal from its own iframe, throttled within 5s', async () => {
    vi.useFakeTimers()
    try {
      const a = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:51000/' })
      const requestBridgeCapability = vi.fn()
        .mockImplementation(async () => ({ capability: 'tok', expiresAt: Date.now() + 60_000 }))
      const { container } = render(
        <Workbench device={a} enabledDeviceIds={['d1']} requestBridgeCapability={requestBridgeCapability} />,
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(requestBridgeCapability).toHaveBeenCalledTimes(1)
      const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
      const dispatchExpired = (): void => {
        const event = new MessageEvent('message', { data: { type: 'dsh-cockpit:capability-expired' }, origin: 'http://127.0.0.1:51000' })
        Object.defineProperty(event, 'source', { value: frameA.contentWindow })
        window.dispatchEvent(event)
      }
      // Attack/other frames are ignored: a different source or origin does
      // not trigger a renewal.
      const foreign = new MessageEvent('message', { data: { type: 'dsh-cockpit:capability-expired' }, origin: 'http://127.0.0.1:51000' })
      Object.defineProperty(foreign, 'source', { value: {} })
      window.dispatchEvent(foreign)
      await vi.advanceTimersByTimeAsync(0)
      expect(requestBridgeCapability).toHaveBeenCalledTimes(1)
      // Within the 5s throttle window the backstop does not fire; after it,
      // the renewal runs and re-sends the handshake.
      dispatchExpired()
      await vi.advanceTimersByTimeAsync(0)
      expect(requestBridgeCapability).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(6_000)
      dispatchExpired()
      await vi.advanceTimersByTimeAsync(0)
      expect(requestBridgeCapability).toHaveBeenCalledTimes(2)
      // Immediate repeat is throttled again.
      dispatchExpired()
      await vi.advanceTimersByTimeAsync(0)
      expect(requestBridgeCapability).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})