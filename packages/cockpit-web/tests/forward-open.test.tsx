import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AdditionalForwardRow, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../src/api/client.js'
import { ForwardList } from '../src/panels/ForwardList.jsx'

/** spec: cockpit-device-shell「设备管理面板呈现并管理每台设备的转发清单」
 * (change forward-fixed-port-open): same-port create, open action, command. */

const apiMock = vi.hoisted(() => ({ createForward: vi.fn(), deleteForward: vi.fn(), resolveForwardUrl: vi.fn() }))
vi.mock('../src/api/client.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/client.js')>()
  return { ...actual, api: apiMock }
})

afterEach(cleanup)
beforeEach(() => { for (const mock of Object.values(apiMock)) mock.mockReset() })

const extra = (devicePort: number, overrides: Partial<AdditionalForwardRow> = {}): AdditionalForwardRow => ({
  kind: 'additional', devicePort, state: 'ready', pinned: true, sameLocalPort: false, workbenchTab: false, holders: [], holderCount: 0,
  createdAt: 0, stateChangedAt: 0, localPort: devicePort + 50_000, pid: 9000 + devicePort, ...overrides,
})

const device = (...rows: AdditionalForwardRow[]): DeviceStatusFacts => ({
  deviceId: 'vm', displayName: '开发虚拟机', kind: 'remote', sshAlias: 'dev-vm', remoteDshPort: 3080, enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, pendingInteractionObservability: 'available',
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0, dshAuthConfigured: false, dshAuthState: 'not-configured',
  dshAuthAutoDiscovery: false, dshAuthGeneration: 0,
  forwards: { rows: [{ kind: 'system', devicePort: 3080, state: 'ready', localPort: 51000, pid: 7001 }, ...rows], additionalCount: rows.length, limit: 8 },
} as DeviceStatusFacts)

const region = () => screen.getByRole('region', { name: '开发虚拟机 转发' })
const rowOf = (port: number | 'system') => region().querySelector(`[data-forward="${port}"]`) as HTMLElement

describe('forward list: same-port and open', () => {
  it('creates a same-port entry with an open path', async () => {
    apiMock.createForward.mockResolvedValue({ devicePort: 3082, state: 'starting' })
    render(<ForwardList device={device()} />)
    fireEvent.change(within(region()).getByLabelText('设备端口'), { target: { value: '3082' } })
    fireEvent.click(within(region()).getByLabelText('本地端口同设备端口'))
    fireEvent.change(within(region()).getByLabelText('打开路径（可选）'), { target: { value: '/dashboard' } })
    fireEvent.click(within(region()).getByRole('button', { name: '添加常驻转发' }))
    await waitFor(() => expect(apiMock.createForward).toHaveBeenCalledWith('vm', 3082, { sameLocalPort: true, workbenchTab: false, openPath: '/dashboard' }))
  })

  it('keeps input and the switch when the local port conflicts', async () => {
    apiMock.createForward.mockRejectedValue(new ApiRequestError('local-port-conflict', 'local-port-conflict', 409))
    render(<ForwardList device={device()} />)
    fireEvent.change(within(region()).getByLabelText('设备端口'), { target: { value: '3082' } })
    fireEvent.click(within(region()).getByLabelText('本地端口同设备端口'))
    fireEvent.click(within(region()).getByRole('button', { name: '添加常驻转发' }))
    await waitFor(() => expect(within(region()).getByRole('alert').textContent).toContain('本地端口已被'))
    expect((within(region()).getByLabelText('设备端口') as HTMLInputElement).value).toBe('3082')
    expect((within(region()).getByLabelText('本地端口同设备端口') as HTMLInputElement).checked).toBe(true)
  })

  it('opens a ready row at its local address without a request; system and unready rows cannot open', () => {
    const openWindow = vi.fn(() => null)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<ForwardList device={device(
      extra(3082, { sameLocalPort: true, localPort: 3082, openPath: '/dashboard' }),
      extra(5432, { state: 'retrying', localPort: undefined, pid: undefined }),
    )} openWindow={openWindow} />)
    expect(within(rowOf('system')).queryByRole('button')).toBeNull()
    expect((within(rowOf(5432)).getByRole('button', { name: '在浏览器打开转发 5432' }) as HTMLButtonElement).disabled).toBe(true)

    const ready = rowOf(3082)
    expect(ready.textContent).toContain('127.0.0.1:3082')
    expect(ready.textContent).toContain('同端口')
    expect(ready.textContent).toContain('/dashboard')
    fireEvent.click(within(ready).getByRole('button', { name: '在浏览器打开转发 3082' }))
    expect(openWindow).toHaveBeenCalledWith('http://127.0.0.1:3082/dashboard')
    expect(apiMock.resolveForwardUrl).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('navigates a blank opener-less window to the URL resolved by the device command', async () => {
    const blank = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    const openWindow = vi.fn(() => blank as unknown as Window)
    apiMock.resolveForwardUrl.mockResolvedValue({ url: 'http://127.0.0.1:3082/?token=t' })
    render(<ForwardList device={device(extra(3082, { localPort: 3082, urlCommand: 'tail -1 sa.log' }))} openWindow={openWindow} />)
    expect(rowOf(3082).textContent).toContain('tail -1 sa.log')
    fireEvent.click(within(rowOf(3082)).getByRole('button', { name: '在浏览器打开转发 3082' }))
    // The blank window opens synchronously, inside the click.
    expect(openWindow).toHaveBeenCalledWith('')
    expect(blank.opener).toBeNull()
    await waitFor(() => expect(blank.location.href).toBe('http://127.0.0.1:3082/?token=t'))
    expect(apiMock.resolveForwardUrl).toHaveBeenCalledWith('vm', 3082)
  })

  it('closes the blank window and explains in place when the command finds no URL', async () => {
    const blank = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    apiMock.resolveForwardUrl.mockRejectedValue(new ApiRequestError('url-command-no-url', 'raw server text', 409))
    render(<ForwardList device={device(extra(3082, { localPort: 3082, urlCommand: 'tail -1 sa.log' }))} openWindow={() => blank as unknown as Window} />)
    fireEvent.click(within(rowOf(3082)).getByRole('button', { name: '在浏览器打开转发 3082' }))
    await waitFor(() => expect(blank.close).toHaveBeenCalled())
    const alert = within(region()).getByRole('alert')
    expect(alert.textContent).toBe('没有在命令输出中找到该端口的地址。')
    expect(alert.textContent).not.toContain('raw server text')
    expect(blank.location.href).toBe('')
  })

  it('enables the tab switch only with same-port and submits it', async () => {
    apiMock.createForward.mockResolvedValue({ devicePort: 3082, state: 'starting' })
    render(<ForwardList device={device(extra(3082, { sameLocalPort: true, workbenchTab: true, localPort: 3082 }))} />)
    expect(rowOf(3082).textContent).toContain('标签页')
    const tabSwitch = within(region()).getByLabelText('在工作台显示为标签页') as HTMLInputElement
    expect(tabSwitch.disabled).toBe(true)
    fireEvent.change(within(region()).getByLabelText('设备端口'), { target: { value: '3082' } })
    fireEvent.click(within(region()).getByLabelText('本地端口同设备端口'))
    expect(tabSwitch.disabled).toBe(false)
    fireEvent.click(tabSwitch)
    fireEvent.click(within(region()).getByRole('button', { name: '添加常驻转发' }))
    await waitFor(() => expect(apiMock.createForward).toHaveBeenCalledWith('vm', 3082, { sameLocalPort: true, workbenchTab: true }))
  })

  it('explains the same-port requirement on a 409', async () => {
    apiMock.createForward.mockRejectedValue(new ApiRequestError('workbench-tab-requires-same-port', 'x', 409))
    render(<ForwardList device={device()} />)
    fireEvent.change(within(region()).getByLabelText('设备端口'), { target: { value: '5432' } })
    fireEvent.click(within(region()).getByRole('button', { name: '添加常驻转发' }))
    await waitFor(() => expect(within(region()).getByRole('alert').textContent).toContain('才能显示为工作台标签页'))
  })

  it('clicking the tab switch text ticks the tab switch, not same-port', () => {
    render(<ForwardList device={device()} />)
    const same = within(region()).getByLabelText('本地端口同设备端口') as HTMLInputElement
    const tab = within(region()).getByLabelText('在工作台显示为标签页') as HTMLInputElement
    fireEvent.click(within(region()).getByText('同设备端口'))
    expect(same.checked).toBe(true)
    fireEvent.click(within(region()).getByText('在工作台显示为标签页'))
    expect(same.checked).toBe(true)
    expect(tab.checked).toBe(true)
    expect(tab.disabled).toBe(false)
  })
})
