import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { App } from '../src/main.jsx'

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'VM A', kind: 'remote', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, pendingInteractionObservability: 'available',
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0, endpoint: 'http://127.0.0.1:51688/',
  connectionGeneration: 1,
  ...overrides,
})

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
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

  it('keeps disabled devices in settings, removes their header tab, and re-enables without deleting', async () => {
    window.localStorage.setItem('cockpit:last-device', 'd1')
    const { container, getByRole, getByText } = render(<App />)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const stream = FakeEventSource.instances[0]!
    const vm = device({ remoteDshPort: 3080, dshAuthState: 'not-configured', dshAuthConfigured: false, dshAuthAutoDiscovery: false, dshAuthGeneration: 0 })
    act(() => stream.emit({ device: [vm] }))
    fireEvent.click(getByRole('button', { name: '设备管理' }))
    fireEvent.click(getByRole('button', { name: 'VM A 更多操作' }))
    fireEvent.click(getByRole('menuitem', { name: '禁用VM A' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/api/devices/d1'))).toBe(true))
    act(() => stream.emit({ device: [{ ...vm, enabled: false, state: 'DISABLED', endpoint: undefined }] }))
    expect(container.querySelector('[data-federation-node="d1"]')).toBeNull()
    expect(getByText('已禁用', { selector: '.console-disabled-tag' })).toBeTruthy()
    await waitFor(() => expect(getByRole('button', { name: 'VM A 更多操作' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(getByRole('button', { name: 'VM A 更多操作' }))
    fireEvent.click(getByRole('menuitem', { name: '启用VM A' }))
    await waitFor(() => expect(getByRole('button', { name: 'VM A 更多操作' }).hasAttribute('disabled')).toBe(false))
    act(() => stream.emit({ device: [vm] }))
    await waitFor(() => expect(container.querySelector('[data-federation-node="d1"]')).not.toBeNull())
    expect(getByRole('button', { name: 'VM A，已连接' })).toBeTruthy()
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

  it('keeps the panel the user opened when the next status push arrives', async () => {
    const { container, getByRole } = render(<App />)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const stream = FakeEventSource.instances[0]!
    const vm = device()

    // First visit (no history): the overview opens to guide the user.
    act(() => { stream.emit({ device: [vm] }) })
    await waitFor(() => expect(container.querySelector('[data-cockpit-panel="overview"]')).not.toBeNull())

    // The user closes it and opens device management instead; the next status
    // push must not steal the panel back (spec: 首次使用显示总览, not 每次推送).
    fireEvent.click(container.querySelector('[data-cockpit-panel="overview"] .panel-header button')!)
    expect(container.querySelector('[data-cockpit-panel]')).toBeNull()
    fireEvent.click(getByRole('button', { name: '设备管理' }))
    expect(container.querySelector('[data-cockpit-panel="devices"]')).not.toBeNull()

    act(() => { stream.emit({ device: [{ ...vm, runningSessionCount: 1 }] }) })
    await waitFor(() => expect(container.querySelector('[data-cockpit-panel="devices"]')).not.toBeNull())
    expect(container.querySelector('[data-cockpit-panel="overview"]')).toBeNull()

    // Closing a panel also stays closed across pushes.
    fireEvent.click(container.querySelector('[data-cockpit-panel="devices"] .console-close')!)
    act(() => { stream.emit({ device: [{ ...vm, runningSessionCount: 2 }] }) })
    await waitFor(() => expect(container.querySelector('.cockpit-main')).not.toBeNull())
    expect(container.querySelector('[data-cockpit-panel]')).toBeNull()
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

describe('foreground device report (remind-background-device-completion)', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    fetchMock.mockClear()
    window.localStorage.clear()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  const foregroundBodies = () => fetchMock.mock.calls
    .filter(([input]) => String(input).endsWith('/api/foreground'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { pageId: string; deviceId: string | null })

  it('reports the shown device on change and again on every stream (re)open', async () => {
    const { container } = render(<App />)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const stream = FakeEventSource.instances[0]!
    act(() => { stream.emit({ device: [device({ deviceId: 'd1', order: 0 }), device({ deviceId: 'd2', displayName: 'VM B', order: 1 })] }) })
    await waitFor(() => expect(foregroundBodies().at(-1)?.deviceId).toBe('d1'))
    expect(foregroundBodies()[0]?.pageId).toMatch(/.+/)

    const tab = container.querySelector('[data-federation-node="d2"]') as HTMLElement
    fireEvent.click(tab)
    await waitFor(() => expect(foregroundBodies().at(-1)?.deviceId).toBe('d2'))

    const before = foregroundBodies().length
    act(() => { stream.onopen?.() })
    await waitFor(() => expect(foregroundBodies().length).toBe(before + 1))
    expect(foregroundBodies().at(-1)?.deviceId).toBe('d2')
  })
})

describe('reconnect reloads the current workbench (reload-workbench-on-reconnect)', () => {
  function shell(reconnect: () => Response) {
    const launches: string[] = []
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/reconnect')) return reconnect()
      if (url.endsWith('/workbench-launch')) {
        launches.push(url)
        return { ok: true, json: async () => ({ url: `http://127.0.0.1:51688/?token=t${launches.length}`, authGeneration: 1 }) } as Response
      }
      if (url.endsWith('/api/devices')) return { ok: true, json: async () => ({ device: [] }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    FakeEventSource.instances = []
    window.localStorage.clear()
    window.localStorage.setItem('cockpit:last-device', 'd1')
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('EventSource', FakeEventSource)
    return { fetch, launches }
  }

  async function settledApp() {
    const view = render(<App />)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const stream = FakeEventSource.instances[0]!
    act(() => { stream.emit({ device: [device()] }) })
    // jsdom may fire the iframe load itself; either way end in `unobservable`,
    // the state a network error page leaves the parent in.
    const frame = await waitFor(() => {
      const element = view.container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement | null
      expect(['navigating', 'unobservable']).toContain(element?.getAttribute('data-workbench-phase'))
      return element!
    })
    if (frame.getAttribute('data-workbench-phase') === 'navigating') act(() => { frame.dispatchEvent(new Event('load')) })
    await waitFor(() => expect(frame.getAttribute('data-workbench-phase')).toBe('unobservable'))
    return { ...view, stream, frame }
  }

  it('relaunches the current device once its reconnected connection is ready', async () => {
    const { launches } = shell(() => ({ ok: true, json: async () => ({ reconnecting: true, connectionGeneration: 2 }) } as Response))
    const { getByRole, stream } = await settledApp()
    expect(launches).toHaveLength(1)

    fireEvent.click(getByRole('button', { name: '重连并重新加载当前设备' }))
    act(() => { stream.emit({ device: [device({ state: 'CONNECTING', endpoint: undefined, connectionGeneration: 2 })] }) })
    await act(async () => { await Promise.resolve() })
    expect(launches).toHaveLength(1)
    act(() => { stream.emit({ device: [device({ connectionGeneration: 2 })] }) })
    await waitFor(() => expect(launches).toHaveLength(2))
    act(() => { stream.emit({ device: [device({ connectionGeneration: 2, lastUpdatedAt: 3 })] }) })
    await act(async () => { await Promise.resolve() })
    expect(launches).toHaveLength(2)
  })

  it('does not reload when the reconnect request fails', async () => {
    const { launches } = shell(() => ({ ok: false, status: 404, json: async () => ({ code: 'not-found', message: 'unknown device d1' }) } as Response))
    const { getByRole, stream, container } = await settledApp()

    fireEvent.click(getByRole('button', { name: '重连并重新加载当前设备' }))
    await waitFor(() => expect(container.querySelector('.cockpit-error')?.textContent).toContain('unknown device d1'))
    act(() => { stream.emit({ device: [device({ connectionGeneration: 2 })] }) })
    await act(async () => { await Promise.resolve() })
    expect(launches).toHaveLength(1)
  })
})
