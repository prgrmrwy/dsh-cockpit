import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { App } from '../src/main.jsx'

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'VM A', kind: 'remote', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, pendingInteractionObservability: 'available',
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0, endpoint: 'http://127.0.0.1:51688/',
  ...overrides,
})

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  close(): void { this.readyState = 2 }
  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>)
  }
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.endsWith('/api/bootstrap')) return { ok: true, json: async () => ({ ok: true }) } as Response
  if (url.endsWith('/api/devices')) return { ok: true, json: async () => ({ device: [] }) } as Response
  return { ok: true, json: async () => ({}) } as Response
})

describe('app live status', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    fetchMock.mockClear()
    window.localStorage.clear()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  it('updates the UI from SSE pushes without a manual refresh', async () => {
    const { container } = render(<App />)
    // Boot (bootstrap + baseline list) must settle before we push, so the
    // baseline cannot clobber a later stream frame.
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1)
      expect(container.querySelector('.cockpit-main')).not.toBeNull()
    })

    const stream = FakeEventSource.instances[0]!
    act(() => { stream.emit({ device: [device({ state: 'CONNECTING', diagnostic: 'connecting' })] }) })

    // The topbar shows the device with a busy dot and the workbench shows the
    // in-progress overlay — driven purely by the push, no refresh involved.
    await waitFor(() => {
      expect(container.querySelector('[data-federation-node="d1"]')?.getAttribute('data-state')).toBe('CONNECTING')
    })
    expect(container.querySelector('.overlay-spinner')).not.toBeNull()
    expect(container.querySelector('.overlay-title')?.textContent).toBe('正在连接…')

    // Server pushes the READY transition: overlay must clear live.
    act(() => { stream.emit({ device: [device({ state: 'READY', diagnostic: 'ok' })] }) })
    await waitFor(() => {
      expect(container.querySelector('[data-cockpit-offline="d1"]')).toBeNull()
    })
    expect(container.querySelector('[data-federation-node="d1"]')?.getAttribute('data-state')).toBe('READY')
  })

  it('ignores a disabled last-used device and falls back when the current device is disabled live', async () => {
    window.localStorage.setItem('cockpit:last-device', 'disabled')
    const { container } = render(<App />)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const stream = FakeEventSource.instances[0]!
    const enabledA = device({ deviceId: 'enabled-a', displayName: 'Enabled A', order: 0 })
    const enabledB = device({ deviceId: 'enabled-b', displayName: 'Enabled B', order: 1, endpoint: 'http://127.0.0.1:51689/' })
    const disabled = device({ deviceId: 'disabled', displayName: 'Disabled', enabled: false, state: 'DISABLED', order: 2, endpoint: undefined })

    act(() => { stream.emit({ device: [enabledA, enabledB, disabled] }) })
    await waitFor(() => {
      expect(container.querySelector('[data-federation-node="enabled-a"]')?.getAttribute('aria-selected')).toBe('true')
    })
    expect(container.querySelector('[data-federation-node="disabled"]')).toBeNull()
    expect(window.localStorage.getItem('cockpit:last-device')).toBe('disabled')

    fireEvent.click(container.querySelector('[data-federation-node="enabled-b"]')!)
    expect(window.localStorage.getItem('cockpit:last-device')).toBe('enabled-b')
    act(() => { stream.emit({ device: [enabledA, { ...enabledB, enabled: false, state: 'DISABLED', endpoint: undefined }, disabled] }) })
    await waitFor(() => {
      expect(container.querySelector('[data-federation-node="enabled-a"]')?.getAttribute('aria-selected')).toBe('true')
    })
    expect(container.querySelector('[data-federation-node="enabled-b"]')).toBeNull()
  })

  it('shows a management recovery action when every registered device is disabled', async () => {
    const { container, getByRole } = render(<App />)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => {
      FakeEventSource.instances[0]!.emit({
        device: [device({ enabled: false, state: 'DISABLED', endpoint: undefined })],
      })
    })

    await waitFor(() => expect(container.querySelector('[data-cockpit-no-enabled="true"]')).not.toBeNull())
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(container.textContent).toContain('没有已启用设备')
    fireEvent.click(getByRole('button', { name: '打开设备管理' }))
    expect(container.querySelector('[data-cockpit-panel="devices"]')).not.toBeNull()
  })

  it('tolerates malformed stream frames', async () => {
    const { container } = render(<App />)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const stream = FakeEventSource.instances[0]!
    act(() => { stream.emit('not-json') })
    act(() => { stream.emit({ device: 'wrong-shape' }) })
    act(() => { stream.emit({ device: [device()] }) })
    await waitFor(() => {
      expect(container.querySelector('[data-federation-node="d1"]')).not.toBeNull()
    })
  })
})
