import { cleanup, fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { TopBar } from '../src/components/TopBar.jsx'

afterEach(cleanup)

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'VM A', kind: 'remote', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0,
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

  it('does not render disabled device tabs', () => {
    const devices = [
      device({ deviceId: 'd1', displayName: 'Enabled' }),
      device({ deviceId: 'd2', displayName: 'Disabled', enabled: false, state: 'DISABLED' }),
    ]
    const { getAllByRole, queryByRole } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    expect(getAllByRole('tab')).toHaveLength(1)
    expect(queryByRole('tab', { name: /Disabled/ })).toBeNull()
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

    // done → green dot (official success-primary). The completed chip is the
    // one interactive status control (clear this device's reminders), so its
    // title communicates the action rather than the passive status label the
    // other (decorative) chips use.
    const completed = container.querySelector('[data-session-kind="completed"] .dsh-state-dot')!
    expect(completed.getAttribute('data-state')).toBe('done')
    expect(container.querySelector('[data-session-kind="completed"]')!.getAttribute('title')).toBe('清除该设备完成提醒 ×1')

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

  it('shows the bridge mark when the device DSH runs dsh-cockpit-bridge, faint hint otherwise', () => {
    const devices = [
      device({ deviceId: 'd1', displayName: 'A', state: 'READY', bridgeSeenAt: 1787849999000 }),
      device({ deviceId: 'd2', displayName: 'B', state: 'READY' }),
      device({ deviceId: 'd3', displayName: 'C', state: 'SSH_UNREACHABLE' }),
    ]
    const { getByRole } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    // Plugin present: the connected bridge mark, no hint.
    const tabA = getByRole('tab', { name: /A/ })
    expect(tabA.querySelector('.bridge-mark')).not.toBeNull()
    expect(tabA.querySelector('.bridge-hint')).toBeNull()
    // Plugin absent while connected: faint hint, hover points at the README
    // installation section on GitHub.
    const tabB = getByRole('tab', { name: /B/ })
    expect(tabB.querySelector('.bridge-mark')).toBeNull()
    const hint = tabB.querySelector('.bridge-hint') as HTMLElement
    expect(hint).not.toBeNull()
    expect(hint.title).toContain('github.com/prgrmrwy/dsh-cockpit')
    expect(hint.title).toContain('桥接插件')
    // Not connected: no hint — plugin status is unknown, don't guess.
    expect(getByRole('tab', { name: /C/ }).querySelector('.bridge-hint')).toBeNull()
  })

  it('distinguishes the two bridge states by icon shape, not only by color', () => {
    const devices = [
      device({ deviceId: 'd1', displayName: 'A', state: 'READY', bridgeSeenAt: 1787849999000 }),
      device({ deviceId: 'd2', displayName: 'B', state: 'READY' }),
      device({ deviceId: 'd3', displayName: 'C', state: 'SSH_UNREACHABLE' }),
    ]
    const { container, getByRole } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )

    const tabA = getByRole('tab', { name: /A/ })
    const tabB = getByRole('tab', { name: /B/ })

    // A closed chain for the linked device, a broken one for the unlinked device.
    expect(tabA.querySelector('svg[data-bridge-icon="connected"]')).not.toBeNull()
    expect(tabA.querySelector('svg[data-bridge-icon="disconnected"]')).toBeNull()
    expect(tabB.querySelector('svg[data-bridge-icon="disconnected"]')).not.toBeNull()
    expect(tabB.querySelector('svg[data-bridge-icon="connected"]')).toBeNull()

    // The emoji glyph that used to read as a pause sign is gone.
    expect(container.textContent).not.toContain('⛓')

    // Unknown plugin state renders no icon at all.
    expect(getByRole('tab', { name: /C/ }).querySelector('svg[data-bridge-icon]')).toBeNull()

    // Both variants share one box, so switching states cannot shift the tab.
    const a = tabA.querySelector('svg[data-bridge-icon]') as SVGSVGElement
    const b = tabB.querySelector('svg[data-bridge-icon]') as SVGSVGElement
    expect(b.getAttribute('viewBox')).toBe(a.getAttribute('viewBox'))
    expect(b.getAttribute('width')).toBe(a.getAttribute('width'))
    expect(b.getAttribute('height')).toBe(a.getAttribute('height'))

    // The labelled wrapper keeps owning the accessible name.
    expect(tabA.querySelector('.bridge-mark')?.getAttribute('aria-label')).toBe('桥接已连接')
    expect(tabB.querySelector('.bridge-hint')?.getAttribute('aria-label')).toBe('未检测到桥接插件')
    expect(tabB.querySelector('.bridge-hint')?.getAttribute('data-bridge-hint')).toBe('missing')
  })

  it('gives the completed status its own accessible clear control, while other chips stay non-interactive', () => {
    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY',
        sessionStatuses: [
          { state: 'warning', kind: 'approval', count: 1 },
          { state: 'ongoing', kind: 'running', count: 1 },
          { state: 'done', kind: 'completed', count: 2 },
        ],
      }),
    ]
    const { container, getByRole } = render(
      <StrictMode><TopBar devices={devices} currentId="d1" onSelect={() => {}} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const completed = container.querySelector('[data-session-kind="completed"]') as HTMLElement
    const approval = container.querySelector('[data-session-kind="approval"]') as HTMLElement
    const running = container.querySelector('[data-session-kind="running"]') as HTMLElement
    // Approval/question/running remain plain, non-interactive spans.
    expect(approval.tagName).toBe('SPAN')
    expect(running.tagName).toBe('SPAN')
    // Completed is a real button with an accessible name naming the action —
    // it must be independently reachable via getByRole, distinct from the tab.
    expect(completed.tagName).toBe('BUTTON')
    const clearButton = getByRole('button', { name: '清除 A 的完成提醒' })
    expect(clearButton).toBe(completed)
  })

  it('activating the completed control clears via the ack callback without selecting the device', () => {
    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY',
        sessionStatuses: [{ state: 'done', kind: 'completed', count: 1 }],
      }),
    ]
    const selected: string[] = []
    const acked: string[] = []
    const { getByRole } = render(
      <StrictMode>
        <TopBar
          devices={devices} currentId="d2"
          onSelect={id => selected.push(id)} onOpenPanel={() => {}} onRefresh={() => {}}
          onAckCompleted={id => { acked.push(id) }}
        />
      </StrictMode>,
    )
    fireEvent.click(getByRole('button', { name: '清除 A 的完成提醒' }))
    expect(acked).toEqual(['d1'])
    // Clicking the nested clear button must not also select (switch to) the
    // device tab it lives inside — mouse click does not bubble to the tab.
    expect(selected).toEqual([])
  })

  it('the completed control is independently keyboard-operable and does not bubble to the tab', () => {
    const devices = [
      device({
        deviceId: 'd1', displayName: 'A', state: 'READY',
        sessionStatuses: [{ state: 'done', kind: 'completed', count: 1 }],
      }),
    ]
    const selected: string[] = []
    const acked: string[] = []
    const { getByRole } = render(
      <StrictMode>
        <TopBar
          devices={devices} currentId="d2"
          onSelect={id => selected.push(id)} onOpenPanel={() => {}} onRefresh={() => {}}
          onAckCompleted={id => { acked.push(id) }}
        />
      </StrictMode>,
    )
    const clearButton = getByRole('button', { name: '清除 A 的完成提醒' })
    // A native <button> activates on Enter/Space by firing a click event; the
    // handler stops propagation on that click regardless of input method.
    fireEvent.click(clearButton)
    expect(acked).toEqual(['d1'])
    expect(selected).toEqual([])
  })

  it('pressing Enter/Space on the tab itself still selects the device', () => {
    const devices = [device({ deviceId: 'd1', displayName: 'A', state: 'READY' })]
    const selected: string[] = []
    const { getByRole } = render(
      <StrictMode><TopBar devices={devices} currentId="d2" onSelect={id => selected.push(id)} onOpenPanel={() => {}} onRefresh={() => {}} /></StrictMode>,
    )
    const tab = getByRole('tab', { name: /A/ })
    fireEvent.keyDown(tab, { key: 'Enter' })
    fireEvent.keyDown(tab, { key: ' ' })
    expect(selected).toEqual(['d1', 'd1'])
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
