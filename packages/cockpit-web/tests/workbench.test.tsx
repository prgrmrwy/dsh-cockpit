import { cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { Workbench } from '../src/workbench/Workbench.jsx'

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'VM A', kind: 'remote', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, outcomeUnknownCount: 0,
  compatibility: 'SUPPORTED', lastUpdatedAt: 0, endpoint: 'http://127.0.0.1:51688/',
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
  })

  it('keeps the iframe alive across device switches', () => {
    const a = device({ deviceId: 'd1', displayName: 'A', endpoint: 'http://127.0.0.1:51000/' })
    const b = device({ deviceId: 'd2', displayName: 'B', endpoint: 'http://127.0.0.1:52000/' })
    const { container, rerender } = render(<StrictMode><Workbench device={a} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).not.toBeNull()

    rerender(<StrictMode><Workbench device={b} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d2"]')).not.toBeNull()

    // Switch back: the d1 iframe must still be mounted (kept alive, not recreated).
    rerender(<StrictMode><Workbench device={a} /></StrictMode>)
    expect(container.querySelector('iframe[data-workbench-device="d1"]')).not.toBeNull()
    expect(container.querySelectorAll('iframe')).toHaveLength(2)
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
})