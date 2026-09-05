import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { OverviewPanel } from '../src/panels/Panels.jsx'

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'VM A', kind: 'remote', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, pendingInteractionObservability: 'available',
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0,
  ...overrides,
})

describe('OverviewPanel', () => {
  it('keeps disabled devices visible but prevents selecting their workbench', () => {
    const onSelect = vi.fn()
    render(
      <OverviewPanel
        devices={[
          device({ deviceId: 'enabled', displayName: 'Enabled' }),
          device({ deviceId: 'disabled', displayName: 'Disabled', enabled: false, state: 'DISABLED' }),
        ]}
        onClose={() => {}}
        onSelect={onSelect}
      />,
    )

    const disabledRow = screen.getByText('Disabled').closest('li')!
    expect(within(disabledRow).getByText('已禁用')).toBeTruthy()
    const disabledButton = within(disabledRow).getByRole('button', { name: 'Disabled（已禁用）' })
    expect(disabledButton.hasAttribute('disabled')).toBe(true)
    fireEvent.click(disabledButton)
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }))
    expect(onSelect).toHaveBeenCalledWith('enabled')
  })
})
