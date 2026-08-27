import { cleanup, fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { TopBar } from '../src/components/TopBar.jsx'

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'VM A', kind: 'remote', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, outcomeUnknownCount: 0,
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0,
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

  it('renders official session-status groups as "label ×N" chips', () => {
    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY',
        runningSessionCount: 2, pendingInteractionCount: 3,
        sessionStatuses: [
          { state: 'warning', kind: 'approval', count: 2 },
          { state: 'warning', kind: 'question', count: 1 },
          { state: 'ongoing', kind: 'running', count: 2 },
        ],
      }),
      device({ deviceId: 'd2', displayName: 'B', state: 'READY' }),
    ]
    const { getByRole, container } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const tab = getByRole('tab', { name: /A/ })
    expect(tab.className).toContain('attention')
    // Pending interactions keep the attention ring (official warning state).
    const chips = container.querySelectorAll('[data-cockpit-session-statuses="d1"] .session-chip')
    expect(chips).toHaveLength(3)
    expect(chips[0]!.getAttribute('data-session-kind')).toBe('approval')
    expect(chips[0]!.getAttribute('data-session-state')).toBe('warning')
    expect(chips[0]!.textContent).toContain('等待审批')
    expect(chips[0]!.textContent).toContain('×2')
    expect(chips[1]!.textContent).toContain('等待回答')
    expect(chips[2]!.getAttribute('data-session-state')).toBe('ongoing')
    expect(chips[2]!.textContent).toContain('进行中')
    expect(chips[2]!.textContent).toContain('×2')

    // A device without live activity shows no chips at all.
    const quiet = getByRole('tab', { name: /B/ })
    expect(quiet.querySelector('[data-cockpit-session-statuses]')).toBeNull()
  })

  it('keeps the official dot colors for session groups (warning=yellow, ongoing=green)', () => {
    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY',
        sessionStatuses: [
          { state: 'warning', kind: 'approval', count: 1 },
          { state: 'ongoing', kind: 'running', count: 1 },
        ],
      }),
    ]
    const { container } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const chip = (kind: string) => container.querySelector(`[data-session-kind="${kind}"] .dot`)
    expect(chip('approval')!.className).toContain('warn')
    expect(chip('running')!.className).toContain('ok')
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
