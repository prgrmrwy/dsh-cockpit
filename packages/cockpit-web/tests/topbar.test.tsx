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

  it('renders official StateDot icons (no text labels) with "×N" counts', () => {
    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY',
        runningSessionCount: 2, pendingInteractionCount: 3,
        sessionStatuses: [
          { state: 'warning', kind: 'approval', count: 2 },
          { state: 'warning', kind: 'question', count: 1 },
          { state: 'ongoing', kind: 'running', count: 2 },
          { state: 'done', kind: 'completed', count: 1 },
        ],
      }),
      device({ deviceId: 'd2', displayName: 'B', state: 'READY' }),
    ]
    const { getByRole, container } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const tab = getByRole('tab', { name: /A/ })
    expect(tab.className).toContain('active')

    const chips = container.querySelectorAll('[data-cockpit-session-statuses="d1"] .session-chip')
    expect(chips).toHaveLength(4)

    // ongoing → the official chase pixel matrix (SVG), no text inside the chip.
    const running = container.querySelector('[data-session-kind="running"]')!
    expect(running.querySelector('svg.dsh-state-dot-matrix')).not.toBeNull()
    expect(running.textContent).toBe('×2') // count only, no label text
    expect(running.getAttribute('title')).toBe('进行中 ×2')

    // warning groups → amber dot (official warn-primary), count preserved.
    const approval = container.querySelector('[data-session-kind="approval"] .dsh-state-dot')!
    expect(approval.getAttribute('data-state')).toBe('warning')
    expect(approval.className).toContain('dsh-state-dot')
    expect(container.querySelector('[data-session-kind="approval"]')!.textContent).toBe('×2')

    // done → green dot (official success-primary).
    const completed = container.querySelector('[data-session-kind="completed"] .dsh-state-dot')!
    expect(completed.getAttribute('data-state')).toBe('done')
    expect(container.querySelector('[data-session-kind="completed"]')!.getAttribute('title')).toBe('已完成 ×1')

    // A device without live activity shows no chips at all.
    const quiet = getByRole('tab', { name: /B/ })
    expect(quiet.querySelector('[data-cockpit-session-statuses]')).toBeNull()
  })

  it('keeps the official dot colors for session groups (warning=amber, done=green)', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    // Vitest runs with the package dir as cwd, so the source CSS resolves
    // from there (import.meta.url has an http scheme under vitest).
    const css = await readFile(resolve('src/components/state-dot.css'), 'utf8')
    // Official theme tokens (dsh-client-ui-theme): warn=amber-500 #f59e0b,
    // done=green-500 #22c55e, ongoing=deepseek-450 #5686fe.
    expect(css).toContain("[data-state='warning'] { color: #f59e0b; }")
    expect(css).toContain("[data-state='done'] { color: #22c55e; }")
    expect(css).toContain('color: #5686fe;')

    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY',
        sessionStatuses: [
          { state: 'warning', kind: 'approval', count: 1 },
          { state: 'done', kind: 'completed', count: 1 },
        ],
      }),
    ]
    const { container } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const dot = (kind: string) => container.querySelector(`[data-session-kind="${kind}"] .dsh-state-dot`)
    expect(dot('approval')!.getAttribute('data-state')).toBe('warning')
    expect(dot('completed')!.getAttribute('data-state')).toBe('done')
  })

  it('does not outline a tab whose device has pending interactions', () => {
    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY', pendingInteractionCount: 2,
        sessionStatuses: [{ state: 'warning', kind: 'approval', count: 2 }],
      }),
      device({ deviceId: 'd2', displayName: 'B', state: 'READY' }),
    ]
    const { getByRole } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const tab = getByRole('tab', { name: /A/ })
    // No outline/attention class: pending state is shown by the amber chip,
    // and switching tabs must not leave a stale border behind.
    expect(tab.className).not.toContain('attention')
    expect(getComputedStyle(tab).outlineStyle).toBe('none')
  })

  it('clicking the completed chip acknowledges the reminders (mark as read)', () => {
    const acked: string[] = []
    const pending: string[] = []
    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY',
        sessionStatuses: [
          { state: 'warning', kind: 'approval', count: 1 },
          { state: 'done', kind: 'completed', count: 2 },
        ],
      }),
    ]
    const { container } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={p => pending.push(p)} onRefresh={() => {}} onAckCompleted={id => acked.push(id)} /></StrictMode>,
    )
    const completed = container.querySelector('[data-session-kind="completed"]') as HTMLElement
    // Only the completed chip is interactive (mark-as-read); warning chips are not.
    expect(completed.className).toContain('clickable')
    expect(container.querySelector('[data-session-kind="approval"]')!.className).not.toContain('clickable')
    fireEvent.click(completed)
    expect(acked).toEqual(['d1'])
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
