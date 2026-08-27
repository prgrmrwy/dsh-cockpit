import { useCallback, useRef, useState } from 'react'
import type { DeviceStatusFacts, DeviceState } from '@dsh-cockpit/shared'
import type { PanelName } from '../panels/Panels.jsx'

/** Status dot semantics: direct mapping of the connectivity state to the
 * official stoplight vocabulary. No new states, no animation. */
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

export interface TopBarProps {
  readonly devices: readonly DeviceStatusFacts[]
  readonly currentId: string | undefined
  readonly onSelect: (deviceId: string) => void
  readonly onOpenPanel: (panel: PanelName) => void
  readonly onRefresh: () => void
}

export function TopBar({ devices, currentId, onSelect, onOpenPanel, onRefresh }: TopBarProps) {
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
          const attention = device.pendingInteractionCount > 0
          return (
            <button
              key={device.deviceId}
              role="tab"
              aria-selected={active}
              className={`topbar-device${active ? ' active' : ''}${attention ? ' attention' : ''}`}
              title={device.diagnostic ?? device.displayName}
              onClick={() => onSelect(device.deviceId)}
              onContextMenu={event => openContextMenu(event, device.deviceId)}
              data-federation-node={device.deviceId}
              data-state={device.state}
              data-outcome-unknown={device.outcomeUnknownCount}
            >
              <span className={`dot ${DOT[device.state]}`} aria-hidden="true" />
              <span className="topbar-device-name">{device.displayName}</span>
              {attention && <span className="badge" title={`${device.pendingInteractionCount} 项等待决策`}>{device.pendingInteractionCount}</span>}
              {device.runningSessionCount > 0 && <span className="running-count" title={`${device.runningSessionCount} 个在跑`}>{device.runningSessionCount}</span>}
            </button>
          )
        })}
      </div>
      <div className="topbar-actions">
        <button className="ghost" onClick={onRefresh} title="刷新状态">↻</button>
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