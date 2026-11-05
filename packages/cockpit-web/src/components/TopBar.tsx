import { useCallback, useRef, useState } from 'react'
import type { DeviceStatusFacts, DeviceState, SessionActivityKind, SessionActivityState } from '@dsh-cockpit/shared'
import type { PanelName } from '../panels/Panels.jsx'
import { StateDot } from './StateDot.jsx'
import { BridgeIcon } from './BridgeIcon.jsx'
import type { ForwardTab } from '../workbench/forward-tabs-model.js'
import { STATE_TEXT } from '../panels/ForwardList.jsx'

/** Status dot semantics: direct mapping of the connectivity state to the
 * official stoplight vocabulary. No new states; CONNECTING additionally
 * pulses (CSS) so the in-progress transition is visible without a refresh. */
const DOT: Record<DeviceState, string> = {
  DISABLED: 'disabled',
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

/** README「桥接插件（可选）」章节的 GitHub 锚点：未装插件的设备 hover 提示指向它。 */
const BRIDGE_DOC_URL = 'https://github.com/prgrmrwy/dsh-cockpit#桥接插件可选与-dsh-的通信'

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
  /** Clears this device's current completion generations without selecting it. */
  readonly onAckCompleted?: (deviceId: string) => void | Promise<void>
  /** Forward tabs of the CURRENT device (change forward-workbench-tab). */
  readonly tabs?: readonly ForwardTab[]
  readonly activeTabKey?: string | undefined
  readonly onSelectTab?: (key: string) => void
  readonly onReloadTab?: (key: string) => void
}

/** Forward-tab dot: ready is ok; anything else carries its text too. */
const TAB_DOT = { ready: 'ok', starting: 'busy', retrying: 'warn', paused: 'disabled' } as const

export function TopBar({ devices, currentId, onSelect, onOpenPanel, onRefresh, onRefreshLabel, onAckCompleted, tabs = [], activeTabKey, onSelectTab, onReloadTab }: TopBarProps) {
  const [menuFor, setMenuFor] = useState<string | undefined>()
  const [tabMenu, setTabMenu] = useState<{ key: string; x: number; y: number } | undefined>()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | undefined>()
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  const openContextMenu = useCallback((event: React.MouseEvent, deviceId: string) => {
    event.preventDefault()
    setTabMenu(undefined)
    setMenuFor(deviceId)
    setMenuAt({ x: event.clientX, y: event.clientY })
  }, [])

  const closeMenu = useCallback(() => { setMenuFor(undefined); setMenuAt(undefined); setTabMenu(undefined) }, [])

  // The device tab used to be a single native <button role="tab">. That is no
  // longer possible: the completed-status chip now needs its own independent
  // interactive control (clear this device's reminders) inside the same
  // visual tab, and HTML forbids a <button> inside a <button>. The tab root is
  // therefore a div with role="tab" plus explicit keyboard handling
  // (Enter/Space selects, matching native button semantics), while the
  // completed chip is a real sibling <button> that stops propagation so it
  // can never trigger the tab's own select/switch behavior.
  const selectOnKey = useCallback((event: React.KeyboardEvent, deviceId: string) => {
    if (event.target !== event.currentTarget) return // let the nested clear button handle its own key
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(deviceId)
    }
  }, [onSelect])

  const clearCompleted = useCallback((event: React.MouseEvent | React.KeyboardEvent, deviceId: string) => {
    event.stopPropagation()
    void onAckCompleted?.(deviceId)
  }, [onAckCompleted])

  return (
    <header className="topbar" data-cockpit-topbar="true">
      <div className="topbar-devices" role="tablist">
        {devices.filter(device => device.enabled).map(device => {
          const active = device.deviceId === currentId
          const deviceTabs = active ? tabs : []
          return [
            <div
              key={device.deviceId}
              role="tab"
              tabIndex={0}
              // One selected tab per tablist: on a forward tab the device item
              // is current but not the shown view.
              aria-selected={active && activeTabKey === undefined}
              className={`topbar-device${active && activeTabKey === undefined ? ' active' : ''}`}
              title={device.diagnostic ?? device.displayName}
              onClick={() => onSelect(device.deviceId)}
              onKeyDown={event => selectOnKey(event, device.deviceId)}
              onContextMenu={event => openContextMenu(event, device.deviceId)}
              data-federation-node={device.deviceId}
              data-state={device.state}
            >
              <span className={`dot ${DOT[device.state]}`} aria-hidden="true" />
              <span className="topbar-device-name">{device.displayName}</span>
              {device.bridgeSeenAt !== undefined ? (
                <span
                  className="bridge-mark"
                  title={`桥接已连接 @ ${new Date(device.bridgeSeenAt).toLocaleTimeString()}`}
                  aria-label="桥接已连接"
                ><BridgeIcon variant="connected" /></span>
              ) : (device.state === 'READY' || device.state === 'DEGRADED') && (
                <span
                  className="bridge-hint"
                  data-bridge-hint="missing"
                  title={`未检测到桥接插件（完成绿点不会按会话清除）。安装介绍：${BRIDGE_DOC_URL}`}
                  aria-label="未检测到桥接插件"
                ><BridgeIcon variant="disconnected" /></span>
              )}
              {device.pendingInteractionObservability === 'unavailable' && (
                <span className="bridge-hint" data-pending-observability="unavailable" title="等待决策状态不可观测" aria-label="等待决策状态不可观测">?</span>
              )}
              {device.sessionStatuses.length > 0 && (
                <span className="topbar-sessions" data-cockpit-session-statuses={device.deviceId}>
                  {device.sessionStatuses.map(status => (
                    status.kind === 'completed' ? (
                      <button
                        key={status.kind}
                        type="button"
                        className="session-chip session-chip-clear"
                        data-session-kind={status.kind}
                        data-session-state={status.state}
                        title={`清除该设备完成提醒 ×${status.count}`}
                        aria-label={`清除 ${device.displayName} 的完成提醒`}
                        onClick={event => clearCompleted(event, device.deviceId)}
                      >
                        <StateDot state={ACTIVITY_STATE[status.kind]} size={10} />
                        <span className="session-chip-count">×{status.count}</span>
                      </button>
                    ) : (
                      <span
                        key={status.kind}
                        className="session-chip"
                        data-session-kind={status.kind}
                        data-session-state={status.state}
                        title={`${ACTIVITY_LABEL[status.kind]} ×${status.count}`}
                      >
                        <StateDot state={ACTIVITY_STATE[status.kind]} size={10} />
                        <span className="session-chip-count">×{status.count}</span>
                      </span>
                    )
                  ))}
                </span>
              )}
            </div>,
            ...deviceTabs.map(tab => {
              const selected = tab.key === activeTabKey
              const stateText = STATE_TEXT[tab.row.state]
              return (
                <div
                  key={tab.key}
                  role="tab"
                  tabIndex={0}
                  aria-selected={selected}
                  className={`topbar-device topbar-forward-tab${selected ? ' active' : ''}`}
                  title={tab.row.state === 'ready' ? tab.name : `${tab.name}（${stateText}）`}
                  onClick={() => onSelectTab?.(tab.key)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectTab?.(tab.key) }
                  }}
                  onContextMenu={event => { event.preventDefault(); setMenuFor(undefined); setTabMenu({ key: tab.key, x: event.clientX, y: event.clientY }) }}
                  data-forward-tab-item={tab.key}
                  data-forward-tab-state={tab.row.state}
                >
                  <span className={`dot ${TAB_DOT[tab.row.state]}`} aria-hidden="true" />
                  <span className="topbar-forward-tab-name">{tab.name}</span>
                  {tab.row.state !== 'ready' && <span className="topbar-forward-tab-state">{stateText}</span>}
                </div>
              )
            }),
          ]
        })}
      </div>
      <div className="topbar-actions">
        <button className="ghost" onClick={onRefresh} title={onRefreshLabel ?? '刷新状态'} aria-label={onRefreshLabel ?? '刷新状态'}>↻</button>
        <button className="ghost" onClick={() => onOpenPanel('devices')} title="设备管理" aria-label="设备管理">☰</button>
      </div>

      {menuFor !== undefined && menuAt !== undefined && (
        <div
          className="context-menu"
          style={{ left: menuAt.x, top: menuAt.y }}
          onMouseLeave={closeMenu}
          role="menu"
          data-cockpit-context-menu={menuFor}
        >
          <button role="menuitem" onClick={() => { onRefresh(); closeMenu() }}>{onRefreshLabel ?? '刷新状态'}</button>
          <button role="menuitem" onClick={() => { onOpenPanel('overview'); closeMenu() }}>查看状态</button>
          <button role="menuitem" onClick={() => { onOpenPanel('devices'); closeMenu() }}>编辑</button>
        </div>
      )}
      {tabMenu !== undefined && (
        <div
          className="context-menu"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onMouseLeave={closeMenu}
          role="menu"
          data-cockpit-tab-menu={tabMenu.key}
        >
          <button role="menuitem" onClick={() => { onReloadTab?.(tabMenu.key); closeMenu() }}>重新加载</button>
        </div>
      )}
    </header>
  )
}
