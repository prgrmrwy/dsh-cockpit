import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AdditionalForwardRow, DeviceForwardsProjection, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevicePanel } from '../src/panels/Panels.jsx'

const apiMock = vi.hoisted(() => ({
  addDevice: vi.fn(),
  updateDevice: vi.fn(),
  removeDevice: vi.fn(),
  createForward: vi.fn(),
  deleteForward: vi.fn(),
}))

vi.mock('../src/api/client.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/client.js')>()
  return { ...actual, api: apiMock }
})

afterEach(cleanup)
beforeEach(() => {
  for (const mock of Object.values(apiMock)) mock.mockReset()
})

const extra = (devicePort: number, overrides: Partial<AdditionalForwardRow> = {}): AdditionalForwardRow => ({
  kind: 'additional', devicePort, state: 'ready', pinned: false, holders: [], holderCount: 0,
  createdAt: 0, stateChangedAt: 0, localPort: devicePort + 50_000, pid: 9000 + devicePort, ...overrides,
})

const table = (...rows: AdditionalForwardRow[]): DeviceForwardsProjection => ({
  rows: [{ kind: 'system', devicePort: 3080, state: 'ready', localPort: 51000, pid: 7001 }, ...rows],
  additionalCount: rows.length,
  limit: 8,
})

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'vm', displayName: '开发虚拟机', kind: 'remote', sshAlias: 'dev-vm', remoteDshPort: 3080, enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, pendingInteractionObservability: 'available',
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0, dshAuthConfigured: false, dshAuthState: 'not-configured',
  dshAuthAutoDiscovery: false, dshAuthGeneration: 0,
  forwards: table(
    extra(5432, { pinned: true, label: 'db' }),
    extra(3939, { holders: ['memex-browse:default'], holderCount: 1 }),
  ),
  ...overrides,
} as DeviceStatusFacts)

function panel(devices: readonly DeviceStatusFacts[], confirmDeleteForward?: (message: string) => boolean) {
  return render(
    <DevicePanel
      devices={devices}
      onClose={vi.fn()}
      onChanged={vi.fn()}
      {...(confirmDeleteForward === undefined ? {} : { confirmDeleteForward })}
    />,
  )
}

const forwards = () => screen.getByRole('region', { name: '开发虚拟机 转发' })
const row = (port: number | 'system') => forwards().querySelector(`[data-forward="${port}"]`) as HTMLElement | null

describe('device panel forwards list', () => {
  it('lists system, pinned and held rows and updates to retrying with a diagnostic', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { rerender } = panel([device()])
    expect(within(forwards()).getByText('2 / 8')).toBeTruthy()

    const system = row('system')!
    expect(system.textContent).toContain('3080')
    expect(system.textContent).toContain('127.0.0.1:51000')
    expect(system.textContent).toContain('pid 7001')
    expect(within(system).queryByRole('button')).toBeNull()

    const pinned = row(5432)!
    expect(pinned.textContent).toContain('常驻')
    expect(pinned.textContent).toContain('就绪')
    expect(pinned.textContent).toContain('pid 14432')
    expect(pinned.textContent).toContain('db')

    const held = row(3939)!
    expect(held.textContent).toContain('持有者 1')
    expect(held.textContent).toContain('memex-browse:default')

    // The next status push: 3939's child exited and it is retrying.
    const diagnostic = '<b>ssh: connect to host vm port 22</b>'
    rerender(
      <DevicePanel
        devices={[device({ forwards: table(extra(5432, { pinned: true, label: 'db' }), extra(3939, { holders: ['memex-browse:default'], holderCount: 1, state: 'retrying', diagnostic, localPort: undefined, pid: undefined })) })]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    const retrying = row(3939)!
    expect(retrying.textContent).toContain('重试中')
    // Plain text only: the markup is shown literally, never parsed.
    expect(retrying.textContent).toContain(diagnostic)
    expect(retrying.querySelector('b')).toBeNull()
    expect(retrying.textContent).not.toContain('127.0.0.1:')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('creates a pinned 6379 redis entry and shows 3 / 8', async () => {
    apiMock.createForward.mockResolvedValue({ devicePort: 6379, state: 'starting' })
    const { rerender } = panel([device()])
    fireEvent.change(within(forwards()).getByLabelText('设备端口'), { target: { value: '6379' } })
    fireEvent.change(within(forwards()).getByLabelText('标签（可选）'), { target: { value: 'redis' } })
    fireEvent.click(within(forwards()).getByRole('button', { name: '添加常驻转发' }))
    await waitFor(() => expect(apiMock.createForward).toHaveBeenCalledWith('vm', 6379, 'redis'))

    const next = device({ forwards: table(extra(5432, { pinned: true, label: 'db' }), extra(3939, { holders: ['memex-browse:default'], holderCount: 1 }), extra(6379, { pinned: true, label: 'redis', state: 'starting', localPort: undefined, pid: undefined })) })
    rerender(<DevicePanel devices={[next]} onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(row(6379)?.textContent).toContain('常驻')
    expect(within(forwards()).getByText('3 / 8')).toBeTruthy()
    // A successful submit clears the form.
    expect((within(forwards()).getByLabelText('设备端口') as HTMLInputElement).value).toBe('')
  })

  it('keeps 6379 in the input and shows the limit message on forward-limit', async () => {
    const { ApiRequestError } = await import('../src/api/client.js')
    apiMock.createForward.mockRejectedValue(new ApiRequestError('forward-limit', 'forward-limit', 409))
    const full = device({ forwards: table(...[1, 2, 3, 4, 5, 6, 7, 8].map(offset => extra(6000 + offset, { pinned: true }))) })
    panel([full])
    expect(within(forwards()).getByText('8 / 8')).toBeTruthy()
    fireEvent.change(within(forwards()).getByLabelText('设备端口'), { target: { value: '6379' } })
    fireEvent.click(within(forwards()).getByRole('button', { name: '添加常驻转发' }))
    expect(await within(forwards()).findByRole('alert')).toHaveProperty('textContent', '已达到附加转发上限（8 条）。')
    expect((within(forwards()).getByLabelText('设备端口') as HTMLInputElement).value).toBe('6379')
    expect(forwards().querySelectorAll('[data-forward]')).toHaveLength(9)
  })

  it('does not send delete when the holder confirmation is cancelled', async () => {
    const confirm = vi.fn(() => false)
    panel([device()], confirm)
    fireEvent.click(within(row(3939)!).getByRole('button', { name: '删除转发 3939' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 个持有者'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(apiMock.deleteForward).not.toHaveBeenCalled()
    expect(row(3939)?.textContent).toContain('就绪')

    // No holders: no confirmation step.
    apiMock.deleteForward.mockResolvedValue({ removed: true })
    fireEvent.click(within(row(5432)!).getByRole('button', { name: '删除转发 5432' }))
    await waitFor(() => expect(apiMock.deleteForward).toHaveBeenCalledWith('vm', 5432))
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('shows no-forward text and no controls for a local device', () => {
    panel([device({ deviceId: 'local', displayName: '开发虚拟机', kind: 'local', sshAlias: undefined, forwards: undefined })])
    expect(within(forwards()).getByText('本机设备无需转发')).toBeTruthy()
    expect(within(forwards()).queryByRole('button')).toBeNull()
    expect(within(forwards()).queryByRole('textbox')).toBeNull()
  })
})
