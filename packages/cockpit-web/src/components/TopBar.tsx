import { useCallback, useRef, useState } from 'react'
import type { DeviceStatusFacts, DeviceState, SessionActivityKind, SessionActivityState } from '@dsh-cockpit/shared'
import type { PanelName } from '../panels/Panels.jsx'
import { StateDot } from './StateDot.jsx'
import { BridgeIcon } from './BridgeIcon.jsx'

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

type BridgeHealth = 'reliable' | 'legacy' | 'stale' | 'missing'

/** Protocol version at which the bridge's session-open acknowledgement is
 * lossless (bounded outbox + retry) rather than best-effort (trailing
 * debounce, no retry). See design.md D8. */
const RELIABLE_BRIDGE_PROTOCOL = 2
/** A device whose most recent successful bridge contact is older than this is
 * "stale": the icon must stop implying live, precise clearing. No periodic
 * network polling is introduced to compute this — it is a pure time check
 * against facts the server already pushes over SSE. */
const BRIDGE_ACTIVE_FOR_MS = 5 * 60_000

/** Derives bridge health from server-reported facts. An explicit
 * `bridgeHealth` (future/alternate servers) always wins; otherwise this is
 * derived from the most recent successful contact time and protocol version,
 * falling back to the legacy `bridgeSeenAt` field for older servers so a
 * mixed-version deployment still renders a sensible connected/missing state. */
function bridgeHealth(device: DeviceStatusFacts, now: number): BridgeHealth {
  if (device.bridgeHealth !== undefined) return device.bridgeHealth
  const lastSuccessAt = device.bridgeLastSuccessAt ?? device.bridgeSeenAt
  if (lastSuccessAt === undefined) return 'missing'
  if (now - lastSuccessAt > BRIDGE_ACTIVE_FOR_MS) return 'stale'
  return (device.bridgeProtocolVersion ?? 0) >= RELIABLE_BRIDGE_PROTOCOL ? 'reliable' : 'legacy'
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

  const now = Date.now()

  return (
    <header className="topbar" data-cockpit-topbar="true">
      <div className="topbar-devices" role="tablist">
        {devices.filter(device => device.enabled).map(device => {
          const active = device.deviceId === currentId
          const health = bridgeHealth(device, now)
          return (
            <div
              key={device.deviceId}
              role="tab"
              tabIndex={0}
              aria-selected={active}
              className={`topbar-device${active ? ' active' : ''}`}
              title={device.diagnostic ?? device.displayName}
              onClick={() => onSelect(device.deviceId)}
              onKeyDown={event => selectOnKey(event, device.deviceId)}
              onContextMenu={event => openContextMenu(event, device.deviceId)}
              data-federation-node={device.deviceId}
              data-state={device.state}
            >
              <span className={`dot ${DOT[device.state]}`} aria-hidden="true" />
              <span className="topbar-device-name">{device.displayName}</span>
              {health === 'reliable' || health === 'legacy' ? (
                <span
                  className="bridge-mark"
                  data-bridge-health={health}
                  title={health === 'reliable'
                    ? `桥接已连接 @ ${new Date(device.bridgeLastSuccessAt ?? device.bridgeSeenAt!).toLocaleTimeString()}`
                    : `桥接已连接（旧版协议 @ ${new Date(device.bridgeLastSuccessAt ?? device.bridgeSeenAt!).toLocaleTimeString()}，无法保证按会话精确清除，可使用完成图标人工清除）`}
                  aria-label="桥接已连接"
                ><BridgeIcon variant="connected" /></span>
              ) : health === 'stale' ? (
                <span
                  className="bridge-hint"
                  data-bridge-hint="stale"
                  title={`桥接连接已过期（最近一次成功通信 @ ${new Date(device.bridgeLastSuccessAt ?? device.bridgeSeenAt!).toLocaleTimeString()}），完成绿点可能不会按会话自动清除，可使用完成图标人工清除`}
                  aria-label="桥接连接已过期"
                ><BridgeIcon variant="disconnected" /></span>
              ) : (device.state === 'READY' || device.state === 'DEGRADED') && (
                <span
                  className="bridge-hint"
                  data-bridge-hint="missing"
                  title={`未检测到桥接插件（完成绿点不会按会话清除）。安装介绍：${BRIDGE_DOC_URL}`}
                  aria-label="未检测到桥接插件"
                ><BridgeIcon variant="disconnected" /></span>
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
            </div>
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
