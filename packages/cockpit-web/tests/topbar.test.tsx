import { cleanup, fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { TopBar } from '../src/components/TopBar.jsx'

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'VM A', kind: 'remote', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, outcomeUnknownCount: 0,
  compatibility: 'SUPPORTED', lastUpdatedAt: 0,
  ...overrides,
})

describe('top bar', () => {
  it('renders each device with the official status dot and selects on click', () => {
    const devices = [
      device({ deviceId: 'd1', displayName: 'VM A', state: 'READY' }),
      device({ deviceId: 'd2', displayName: 'VM B', state: 'TUNNEL_ERROR' }),
    ]
    const selected: string[] = []
    const panel: string[] = []
    const { getByRole, getAllByRole } = render(
      <StrictMode>
        <TopBar devices={devices} currentId="d1" onSelect={id => selected.push(id)} onOpenPanel={p => panel.push(p)} onRefresh={() => {}} />
      </StrictMode>,
    )
    const tabs = getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(getByRole('tab', { name: /VM A/ }).getAttribute('data-state')).toBe('READY')
    expect(getByRole('tab', { name: /VM B/ }).getAttribute('data-state')).toBe('TUNNEL_ERROR')
    tabs[1]!.click()
    expect(selected).toEqual(['d2'])
  })

  it('renders attention badge only for pending interactions', () => {
    const devices = [
      device({ deviceId: 'd1', displayName: 'A', state: 'READY', pendingInteractionCount: 2 }),
      device({ deviceId: 'd2', displayName: 'B', state: 'READY', pendingInteractionCount: 0 }),
    ]
    const { getByRole } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const attention = getByRole('tab', { name: /A/ })
    expect(attention.className).toContain('attention')
    const badge = attention.querySelector('.badge')
    expect(badge?.textContent).toBe('2')
  })

  it('opens the context menu on right click', () => {
    const devices = [device({ deviceId: 'd1', displayName: 'A' })]
    const { container } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const tab = container.querySelector('[role="tab"]') as HTMLElement
    fireEvent.contextMenu(tab, { clientX: 10, clientY: 10 })
    expect(container.querySelector('[data-cockpit-context-menu]')).not.toBeNull()
  })
})