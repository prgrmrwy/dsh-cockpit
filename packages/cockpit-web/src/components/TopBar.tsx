import { useCallback, useRef, useState } from 'react'
import type { DeviceStatusFacts, DeviceState, SessionActivityKind, SessionActivityState } from '@dsh-cockpit/shared'
import type { PanelName } from '../panels/Panels.jsx'
import { StateDot } from './StateDot.jsx'

/** Status dot semantics: direct mapping of the connectivity state to the
 * official stoplight vocabulary. No new states; CONNECTING additionally
 * pulses (CSS) so the in-progress transition is visible without a refresh. */
const DOT: Record<DeviceState, string> = {
  READY: 'ok',
  DEGRADED: 'warn',
  CONNECTING: 'busy',
  SSH_UNREACHABLE: 'error',
  TUNNEL_ERROR: 'error',
  DSH_UNAVAILABLE: 'error',
  NON_DSH_SERVICE: 'error',
  INCOMPATIBLE: 'error',
}

/** Official label vocabulary (dsh-client-ui-workspace i18n: status.running →
 * 进行中, status.waitingApproval → 等待审批, status.waitingAnswer → 等待回答,
 * status.completed → 已完成). Hover titles only; the tab itself is icon + count. */
const ACTIVITY_LABEL: Record<SessionActivityKind, string> = {
  running: '进行中',
  approval: '等待审批',
  question: '等待回答',
  completed: '已完成',
}

/** The official StateDot state for each cockpit activity group. */
const ACTIVITY_STATE: Record<SessionActivityKind, SessionActivityState> = {
  running: 'ongoing',
  approval: 'warning',
  question: 'warning',
  completed: 'done',
}

export interface TopBarProps {
  readonly devices: readonly DeviceStatusFacts[]
  readonly currentId: string | undefined
  readonly onSelect: (deviceId: string) => void
  readonly onOpenPanel: (panel: PanelName) => void
  readonly onRefresh: () => void
  readonly onRefreshLabel?: string
  /** Clears this device's green completion reminders (mark as read). */
  readonly onAckCompleted?: (deviceId: string) => void
}

export function TopBar({ devices, currentId, onSelect, onOpenPanel, onRefresh, onRefreshLabel, onAckCompleted }: TopBarProps) {
  const [menuFor, setMenuFor] = useState<string | undefined>()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | undefined>()
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  const openContextMenu = useCallback((event: React.MouseEvent, deviceId: string) => {
    event.preventDefault()
    setMenuFor(deviceId)
    setMenuAt({ x: event.clientX, y: event.clientY })
  }, [])

  const closeMenu = useCallback(() => { setMenuFor(undefined); setMenuAt(undefined) }, [])

  return (
    <header className="topbar" data-cockpit-topbar="true">
      <div className="topbar-devices" role="tablist">
        {devices.map(device => {
          const active = device.deviceId === currentId
          return (
            <button
              key={device.deviceId}
              role="tab"
              aria-selected={active}
              className={`topbar-device${active ? ' active' : ''}`}
              title={device.diagnostic ?? device.displayName}
              onClick={() => onSelect(device.deviceId)}
              onContextMenu={event => openContextMenu(event, device.deviceId)}
              data-federation-node={device.deviceId}
              data-state={device.state}
              data-outcome-unknown={device.outcomeUnknownCount}
            >
              <span className={`dot ${DOT[device.state]}`} aria-hidden="true" />
              <span className="topbar-device-name">{device.displayName}</span>
              {device.bridgeSeenAt !== undefined && (
                <span
                  className="bridge-mark"
                  title={`桥接已连接 @ ${new Date(device.bridgeSeenAt).toLocaleTimeString()}`}
                  aria-label="桥接已连接"
                >⛓</span>
              )}
              {device.sessionStatuses.length > 0 && (
                <span className="topbar-sessions" data-cockpit-session-statuses={device.deviceId}>
                  {device.sessionStatuses.map(status => {
                    // The green completion reminder is interactive: clicking it
                    // marks the reminder as read (official clear-on-select is
                    // browser-local and not observable from the event stream).
                    const clickable = status.kind === 'completed' && onAckCompleted !== undefined
                    return (
                      <span
                        key={status.kind}
                        className={`session-chip${clickable ? ' clickable' : ''}`}
                        data-session-kind={status.kind}
                        data-session-state={status.state}
                        title={clickable ? `点击标记已读：${ACTIVITY_LABEL[status.kind]} ×${status.count}` : `${ACTIVITY_LABEL[status.kind]} ×${status.count}`}
                        onClick={clickable ? () => onAckCompleted(device.deviceId) : undefined}
                      >
                        <StateDot state={ACTIVITY_STATE[status.kind]} size={10} />
                        <span className="session-chip-count">×{status.count}</span>
                      </span>
                    )
                  })}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="topbar-actions">
        <button className="ghost" onClick={onRefresh} title={onRefreshLabel ?? '刷新状态'}>↻</button>
        <button className="ghost" onClick={() => onOpenPanel('devices')} title="设备管理">☰</button>
      </div>

      {menuFor !== undefined && menuAt !== undefined && (
        <div
          className="context-menu"
          style={{ left: menuAt.x, top: menuAt.y }}
          onMouseLeave={closeMenu}
          role="menu"
          data-cockpit-context-menu={menuFor}
        >
          <button role="menuitem" onClick={() => { onRefresh(); closeMenu() }}>刷新状态</button>
          <button role="menuitem" onClick={() => { onOpenPanel('overview'); closeMenu() }}>查看状态</button>
          <button role="menuitem" onClick={() => { onOpenPanel('devices'); closeMenu() }}>编辑</button>
        </div>
      )}
    </header>
  )
}