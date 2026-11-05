import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdditionalForwardRow, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { ApiRequestError } from '../src/api/client.js'
import { ForwardTabs } from '../src/workbench/ForwardTabs.jsx'
import { Workbench } from '../src/workbench/Workbench.jsx'

/** spec: cockpit-workbench (change forward-workbench-tab) — forward tabs. */

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const tabRow = (overrides: Partial<AdditionalForwardRow> = {}): AdditionalForwardRow => ({
  kind: 'additional', devicePort: 3082, state: 'ready', pinned: true, sameLocalPort: true, workbenchTab: true,
  holders: [], holderCount: 0, createdAt: 0, stateChangedAt: 0, localPort: 3082, pid: 9100, ...overrides,
})

const device = (row: AdditionalForwardRow | undefined, overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'A', kind: 'remote', sshAlias: 'vm-a', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, pendingInteractionObservability: 'available',
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0, endpoint: 'http://127.0.0.1:51000/',
  dshAuthConfigured: true, dshAuthState: 'ready', dshAuthAutoDiscovery: false, dshAuthGeneration: 1, connectionGeneration: 1,
  forwards: { rows: [{ kind: 'system', devicePort: 3080, state: 'ready', localPort: 51000, pid: 7001 }, ...(row === undefined ? [] : [row])], additionalCount: row === undefined ? 0 : 1, limit: 8 },
  ...overrides,
} as DeviceStatusFacts)

const tabFrame = (container: HTMLElement) => container.querySelector('iframe[data-forward-tab="d1:3082"]') as HTMLIFrameElement | null

describe('forward tabs', () => {
  it('creates the frame on first show, navigates once, and keeps it across hide/show', async () => {
    const resolveUrl = vi.fn()
    const a = device(tabRow({ openPath: '/dashboard' }))
    const { container, rerender } = render(<ForwardTabs devices={[a]} activeKey={undefined} resolveUrl={resolveUrl} />)
    expect(tabFrame(container)).toBeNull()

    rerender(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={resolveUrl} />)
    await waitFor(() => expect(tabFrame(container)?.getAttribute('src')).toBe('http://127.0.0.1:3082/dashboard'))
    const frame = tabFrame(container)!
    // No command: the local address, no request.
    expect(resolveUrl).not.toHaveBeenCalled()

    rerender(<ForwardTabs devices={[a]} activeKey={undefined} resolveUrl={resolveUrl} />)
    rerender(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={resolveUrl} />)
    expect(tabFrame(container)).toBe(frame)
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:3082/dashboard')
  })

  it('resolves a command URL once, keeps the token out of React state, and reloads into the same frame', async () => {
    const resolveUrl = vi.fn()
      .mockResolvedValueOnce({ url: 'http://127.0.0.1:3082/?token=TOKEN1' })
      .mockResolvedValueOnce({ url: 'http://127.0.0.1:3082/?token=TOKEN2' })
    const consoleLog = vi.spyOn(console, 'log')
    const a = device(tabRow({ urlCommand: 'tail -1 sa.log' }))
    const { container, rerender } = render(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={resolveUrl} />)
    await waitFor(() => expect(tabFrame(container)?.getAttribute('src')).toBe('http://127.0.0.1:3082/?token=TOKEN1'))
    const frame = tabFrame(container)!
    rerender(<ForwardTabs devices={[a]} activeKey={undefined} resolveUrl={resolveUrl} />)
    rerender(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={resolveUrl} />)
    expect(resolveUrl).toHaveBeenCalledTimes(1)
    expect(resolveUrl).toHaveBeenCalledWith('d1', 3082)
    // React state carries phases only: no data attribute or text holds the token.
    expect(frame.getAttribute('data-forward-tab-phase')).not.toContain('TOKEN')
    expect(container.textContent).not.toContain('TOKEN')
    expect(consoleLog).not.toHaveBeenCalled()

    rerender(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={resolveUrl} reloadRequest={{ key: 'd1:3082', nonce: 1 }} />)
    await waitFor(() => expect(frame.getAttribute('src')).toBe('http://127.0.0.1:3082/?token=TOKEN2'))
    expect(tabFrame(container)).toBe(frame)
    expect(resolveUrl).toHaveBeenCalledTimes(2)
  })

  it('shows only the diagnostic while not ready, then creates the frame once ready', async () => {
    const a = device(tabRow({ state: 'retrying', localPort: undefined, pid: undefined, diagnostic: 'local port 127.0.0.1:3082 is in use' }))
    const { container, rerender, getByText } = render(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={vi.fn()} />)
    expect(getByText('重试中')).toBeTruthy()
    expect(getByText('local port 127.0.0.1:3082 is in use')).toBeTruthy()
    expect(tabFrame(container)).toBeNull()
    const ready = device(tabRow())
    rerender(<ForwardTabs devices={[ready]} activeKey="d1:3082" resolveUrl={vi.fn()} />)
    await waitFor(() => expect(tabFrame(container)?.getAttribute('src')).toBe('http://127.0.0.1:3082/'))
  })

  it('shows a fixed message and retries on demand when resolution fails', async () => {
    const resolveUrl = vi.fn()
      .mockRejectedValueOnce(new ApiRequestError('url-command-no-url', 'raw server text', 409))
      .mockResolvedValueOnce({ url: 'http://127.0.0.1:3082/?token=T' })
    const a = device(tabRow({ urlCommand: 'tail -1 sa.log' }))
    const { container, findByText, getByRole } = render(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={resolveUrl} />)
    expect(await findByText('没有在命令输出中找到该端口的地址。')).toBeTruthy()
    expect(container.textContent).not.toContain('raw server text')
    expect(tabFrame(container)?.getAttribute('src')).toBeNull()
    fireEvent.click(getByRole('button', { name: '重试' }))
    await waitFor(() => expect(tabFrame(container)?.getAttribute('src')).toBe('http://127.0.0.1:3082/?token=T'))
    expect(resolveUrl).toHaveBeenCalledTimes(2)
  })

  it('destroys the frame when the tab mark is cleared or the device is disabled', async () => {
    const a = device(tabRow())
    const { container, rerender } = render(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={vi.fn()} />)
    await waitFor(() => expect(tabFrame(container)).not.toBeNull())
    rerender(<ForwardTabs devices={[device(tabRow({ workbenchTab: false }))]} activeKey={undefined} resolveUrl={vi.fn()} />)
    expect(tabFrame(container)).toBeNull()

    rerender(<ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={vi.fn()} />)
    await waitFor(() => expect(tabFrame(container)).not.toBeNull())
    rerender(<ForwardTabs devices={[{ ...a, enabled: false, state: 'DISABLED' }]} activeKey={undefined} resolveUrl={vi.fn()} />)
    expect(tabFrame(container)).toBeNull()
  })
})

/** design D4: the tab frame never takes part in the bridge handshake. */
describe('forward tabs and the bridge', () => {
  function bridgeMessage(type: string, source: unknown, origin: string): void {
    const event = new MessageEvent('message', { data: { type, instanceId: 'inst-1111111111111111' }, origin })
    Object.defineProperty(event, 'source', { value: source })
    act(() => { window.dispatchEvent(event) })
  }

  it('configures only the device workbench frame and ignores bridge messages from the tab', async () => {
    const a = device(tabRow())
    const requestBridgeCapability = vi.fn().mockImplementation(async () => ({ capability: 'cap', expiresAt: Date.now() + 60_000 }))
    const releaseForwardInstance = vi.fn().mockResolvedValue({ released: true })
    const { container } = render(<>
      <Workbench device={a} devices={[a]} enabledDeviceIds={['d1']} requestBridgeCapability={requestBridgeCapability} releaseForwardInstance={releaseForwardInstance} />
      <ForwardTabs devices={[a]} activeKey="d1:3082" resolveUrl={vi.fn()} />
    </>)
    // Both frames exist right after the first commit, before the capability
    // resolves: spy now so the initial handshake is observed.
    const workbench = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const tab = tabFrame(container)!
    const postToWorkbench = vi.spyOn(workbench.contentWindow!, 'postMessage')
    const postToTab = vi.spyOn(tab.contentWindow!, 'postMessage')
    await waitFor(() => expect(postToWorkbench.mock.calls.some(([message]) => (message as { type?: string }).type === 'dsh-cockpit:bridge-config')).toBe(true))
    expect(postToTab).not.toHaveBeenCalled()
    const capabilityCalls = requestBridgeCapability.mock.calls.length

    // From the tab: a capability-expired and an instance-ended, live and gone.
    await new Promise(resolve => setTimeout(resolve, 20))
    bridgeMessage('dsh-cockpit:capability-expired', tab.contentWindow, 'http://127.0.0.1:3082')
    bridgeMessage('dsh-cockpit:bridge-instance-ended', tab.contentWindow, 'http://127.0.0.1:3082')
    bridgeMessage('dsh-cockpit:bridge-instance-ended', null, 'http://127.0.0.1:3082')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(requestBridgeCapability.mock.calls.length).toBe(capabilityCalls)
    expect(releaseForwardInstance).not.toHaveBeenCalled()
    expect(postToTab).not.toHaveBeenCalled()
  })
})
