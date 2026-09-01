import { cleanup, render } from '@testing-library/react'
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
})