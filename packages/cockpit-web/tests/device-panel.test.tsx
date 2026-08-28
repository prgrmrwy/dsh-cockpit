import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevicePanel } from '../src/panels/Panels.jsx'

const apiMock = vi.hoisted(() => ({
  addDevice: vi.fn(),
  updateDevice: vi.fn(),
  removeDevice: vi.fn(),
}))

vi.mock('../src/api/client.js', () => ({ api: apiMock }))

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'remote-1',
  displayName: '开发虚拟机',
  kind: 'remote',
  sshAlias: 'dev-vm',
  remoteDshPort: 3080,
  enabled: true,
  order: 0,
  state: 'READY',
  runningSessionCount: 0,
  pendingInteractionCount: 0,
  sessionStatuses: [],
  compatibility: 'SUPPORTED',
  lastUpdatedAt: 0,
  ...overrides,
} as DeviceStatusFacts)

function renderPanel(
  devices: readonly DeviceStatusFacts[] = [],
  onChanged = vi.fn(),
  confirmDelete?: (device: DeviceStatusFacts) => boolean,
) {
  return {
    onChanged,
    ...render(
      <DevicePanel
        devices={devices}
        onClose={vi.fn()}
        onChanged={onChanged}
        {...(confirmDelete === undefined ? {} : { confirmDelete })}
      />,
    ),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('DevicePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.addDevice.mockResolvedValue({ deviceId: 'new-device' })
    apiMock.updateDevice.mockResolvedValue({ deviceId: 'remote-1' })
    apiMock.removeDevice.mockResolvedValue({ removed: true, requiresConfirmation: false })
  })

  it('shows a device summary and human-readable device facts', () => {
    renderPanel([
      device(),
      device({
        deviceId: 'local-1', displayName: '本机 DSH', kind: 'local', sshAlias: undefined,
        remoteDshPort: 4090, order: 1, state: 'CONNECTING', diagnostic: '正在探测服务',
      }),
      device({
        deviceId: 'broken-1', displayName: '测试机', order: 2, enabled: false,
        state: 'DISABLED', diagnostic: 'device disabled', sshAlias: 'broken-vm',
      }),
    ])

    expect(screen.getByText('设备总数')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('1', { selector: '[data-summary="ready"] strong' })).toBeTruthy()
    expect(screen.getByText('1', { selector: '[data-summary="attention"] strong' })).toBeTruthy()
    expect(screen.getByText('1', { selector: '[data-summary="disabled"] strong' })).toBeTruthy()

    const remoteRow = screen.getByRole('listitem', { name: /开发虚拟机/ })
    expect(within(remoteRow).getByText('SSH 远端')).toBeTruthy()
    expect(within(remoteRow).getByText('已连接')).toBeTruthy()
    expect(within(remoteRow).getByText('dev-vm:3080')).toBeTruthy()
    expect(within(remoteRow).getByText('remote-1')).toBeTruthy()

    const localRow = screen.getByRole('listitem', { name: /本机 DSH/ })
    expect(within(localRow).getByText('本机')).toBeTruthy()
    expect(within(localRow).getByText('正在连接')).toBeTruthy()
    expect(within(localRow).getByText('127.0.0.1:4090')).toBeTruthy()
    expect(within(localRow).getByText('正在探测服务')).toBeTruthy()

    const brokenRow = screen.getByRole('listitem', { name: /测试机/ })
    expect(within(brokenRow).getByText('已禁用')).toBeTruthy()
    expect(within(brokenRow).getByText('device disabled')).toBeTruthy()
  })

  it('shows an empty state that points to the add form', () => {
    renderPanel()

    expect(screen.getByText('还没有设备')).toBeTruthy()
    const link = screen.getByRole('link', { name: '添加第一台设备' })
    expect(link.getAttribute('href')).toBe('#device-form')
    expect(screen.getByRole('heading', { name: '添加设备' })).toBeTruthy()
  })

  it('switches add fields, retains a failed draft, and exposes the busy state', async () => {
    const pending = deferred<{ deviceId: string }>()
    apiMock.addDevice.mockReturnValueOnce(pending.promise)
    const { onChanged } = renderPanel()

    fireEvent.change(screen.getByLabelText('显示名'), { target: { value: '新设备' } })
    fireEvent.change(screen.getByLabelText('SSH 别名'), { target: { value: 'new-vm' } })
    fireEvent.change(screen.getByLabelText('DSH 端口'), { target: { value: '4090' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并添加' }))

    expect(apiMock.addDevice).toHaveBeenCalledWith({
      displayName: '新设备', kind: 'remote', sshAlias: 'new-vm', remoteDshPort: 4090, enabled: true,
    })
    expect(screen.getByRole('button', { name: '验证中…' }).hasAttribute('disabled')).toBe(true)
    const formFields = (screen.getByLabelText('显示名') as HTMLInputElement).closest('fieldset')
    expect(formFields?.classList.contains('device-form-fields')).toBe(true)
    expect(formFields?.disabled).toBe(true)

    pending.reject(new Error('SSH 验证失败'))
    expect((await screen.findByRole('alert')).textContent).toContain('SSH 验证失败')
    expect((screen.getByLabelText('显示名') as HTMLInputElement).value).toBe('新设备')
    expect((screen.getByLabelText('SSH 别名') as HTMLInputElement).value).toBe('new-vm')
    expect((screen.getByLabelText('DSH 端口') as HTMLInputElement).value).toBe('4090')
    expect(onChanged).not.toHaveBeenCalled()

    const typeGroup = screen.getByRole('radiogroup', { name: '类型' })
    fireEvent.click(within(typeGroup).getByRole('radio', { name: '本机' }))
    expect(within(typeGroup).getByRole('radio', { name: '本机' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByLabelText('SSH 别名')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '验证并添加' }))
    await waitFor(() => expect(apiMock.addDevice).toHaveBeenLastCalledWith({
      displayName: '新设备', kind: 'local', remoteDshPort: 4090, enabled: true,
    }))
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('显示名') as HTMLInputElement).value).toBe('')
  })

  it('prefills the shared edit form, retains failures, saves, and cancels back to add mode', async () => {
    const onChanged = vi.fn()
    renderPanel([device({ enabled: false })], onChanged)

    fireEvent.click(screen.getByRole('button', { name: '编辑开发虚拟机' }))
    expect(screen.getByRole('heading', { name: '编辑设备' })).toBeTruthy()
    expect((screen.getByLabelText('显示名') as HTMLInputElement).value).toBe('开发虚拟机')
    const typeGroup = screen.getByRole('radiogroup', { name: '类型' })
    const remoteType = within(typeGroup).getByRole('radio', { name: 'SSH 远端' }) as HTMLButtonElement
    const localType = within(typeGroup).getByRole('radio', { name: '本机' }) as HTMLButtonElement
    expect(remoteType.getAttribute('aria-checked')).toBe('true')
    expect(remoteType.disabled).toBe(true)
    expect(localType.disabled).toBe(true)
    expect((screen.getByLabelText('SSH 别名') as HTMLInputElement).value).toBe('dev-vm')
    expect((screen.getByLabelText('DSH 端口') as HTMLInputElement).value).toBe('3080')
    expect((screen.getByLabelText('启用设备') as HTMLInputElement).checked).toBe(false)

    fireEvent.change(screen.getByLabelText('显示名'), { target: { value: '改名后的设备' } })
    fireEvent.change(screen.getByLabelText('SSH 别名'), { target: { value: 'bad-vm' } })
    apiMock.updateDevice.mockRejectedValueOnce(new Error('免密验证失败'))
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    expect((await screen.findByRole('alert')).textContent).toContain('免密验证失败')
    expect((screen.getByLabelText('显示名') as HTMLInputElement).value).toBe('改名后的设备')
    expect((screen.getByLabelText('SSH 别名') as HTMLInputElement).value).toBe('bad-vm')

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(apiMock.updateDevice).toHaveBeenLastCalledWith('remote-1', {
      displayName: '改名后的设备', sshAlias: 'bad-vm', remoteDshPort: 3080, enabled: false,
    }))
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: '添加设备' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '编辑开发虚拟机' }))
    fireEvent.change(screen.getByLabelText('显示名'), { target: { value: '未保存草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    expect(screen.getByRole('heading', { name: '添加设备' })).toBeTruthy()
    expect((screen.getByLabelText('显示名') as HTMLInputElement).value).toBe('')
  })

  it('enables and disables devices with accessible device-specific controls', async () => {
    const onChanged = vi.fn()
    renderPanel([device(), device({ deviceId: 'off', displayName: '已停用', enabled: false, order: 1 })], onChanged)

    fireEvent.click(screen.getByRole('button', { name: '禁用开发虚拟机' }))
    await waitFor(() => expect(apiMock.updateDevice).toHaveBeenCalledWith('remote-1', { enabled: false }))
    fireEvent.click(screen.getByRole('button', { name: '启用已停用' }))
    await waitFor(() => expect(apiMock.updateDevice).toHaveBeenCalledWith('off', { enabled: true }))
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('sends no delete request at all when the user declines the confirmation', async () => {
    const confirmDelete = vi.fn().mockReturnValue(false)
    const onChanged = vi.fn()
    renderPanel([device()], onChanged, confirmDelete)

    fireEvent.click(screen.getByRole('button', { name: '删除开发虚拟机' }))

    await waitFor(() => expect(confirmDelete).toHaveBeenCalledTimes(1))
    expect(confirmDelete.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ deviceId: 'remote-1' }))
    expect(apiMock.removeDevice).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('listitem', { name: /开发虚拟机/ })).toBeTruthy()
  })

  it('deletes with confirmed: true once the user accepts the confirmation', async () => {
    const confirmDelete = vi.fn().mockReturnValue(true)
    const onChanged = vi.fn()
    renderPanel([device()], onChanged, confirmDelete)

    fireEvent.click(screen.getByRole('button', { name: '删除开发虚拟机' }))

    await waitFor(() => expect(apiMock.removeDevice).toHaveBeenCalledWith({ deviceId: 'remote-1', confirmed: true }))
    expect(apiMock.removeDevice).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('defaults to the browser confirmation and names the device being deleted', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPanel([device()])

    fireEvent.click(screen.getByRole('button', { name: '删除开发虚拟机' }))

    await waitFor(() => expect(apiMock.removeDevice).toHaveBeenCalledWith({ deviceId: 'remote-1', confirmed: true }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0]?.[0])).toContain('开发虚拟机')

    confirm.mockRestore()
  })

  it('keeps a failed delete visible as a row-scoped error', async () => {
    const confirmDelete = vi.fn().mockReturnValue(true)
    apiMock.removeDevice.mockRejectedValueOnce(new Error('设备仍在连接中'))
    const onChanged = vi.fn()
    renderPanel([device()], onChanged, confirmDelete)

    fireEvent.click(screen.getByRole('button', { name: '删除开发虚拟机' }))

    const row = screen.getByRole('listitem', { name: /开发虚拟机/ })
    expect((await within(row).findByRole('alert')).textContent).toContain('设备仍在连接中')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('disables boundary reorder controls and sends one target order for a move', async () => {
    const devices = [
      device({ deviceId: 'first', displayName: '第一台', order: 0 }),
      device({ deviceId: 'middle', displayName: '第二台', order: 1 }),
      device({ deviceId: 'last', displayName: '第三台', order: 2 }),
    ]
    const onChanged = vi.fn()
    renderPanel(devices, onChanged)

    expect(screen.getByRole('button', { name: '上移第一台' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '下移第三台' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '上移第二台' }))
    await waitFor(() => expect(apiMock.updateDevice).toHaveBeenCalledWith('middle', { order: 0 }))
    expect(apiMock.updateDevice).toHaveBeenCalledTimes(1)

    apiMock.updateDevice.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '下移第二台' }))
    await waitFor(() => expect(apiMock.updateDevice).toHaveBeenCalledWith('middle', { order: 2 }))
    expect(apiMock.updateDevice).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledTimes(2)
  })
})
