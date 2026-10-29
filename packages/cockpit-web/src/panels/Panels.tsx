import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { STATE_LABELS, stateTone } from './console/deviceForm.js'
export { DevicePanel } from './console/DeviceConsole.js'
export type PanelName = 'devices' | 'overview' | 'settings'
export interface PanelProps { readonly onClose: () => void }

export function OverviewPanel({ devices, onClose, onSelect }: PanelProps & {
  readonly devices: readonly DeviceStatusFacts[]
  readonly onSelect: (deviceId: string) => void
}) {
  return (
    <div className="panel" role="dialog" aria-modal="true" data-cockpit-panel="overview">
      <header className="panel-header">
        <h2>设备总览</h2>
        <button className="ghost" onClick={onClose}>✕</button>
      </header>
      {devices.length === 0 ? (
        <div className="panel-empty">
          <p>还没有设备。请先在「设备管理」中添加。</p>
        </div>
      ) : (
        <ul className="panel-list">
          {devices.map(device => (
            <li
              key={device.deviceId}
              className="panel-row"
              data-device={device.deviceId}
              data-enabled={String(device.enabled)}
            >
              <span className={`dot ${device.enabled ? stateTone(device.state) : 'disabled'}`} aria-hidden="true" data-state={device.state} />
              <button
                className="panel-row-name"
                onClick={() => onSelect(device.deviceId)}
                disabled={!device.enabled}
                aria-label={device.enabled ? device.displayName : `${device.displayName}（已禁用）`}
              >{device.displayName}</button>
              <span className="panel-row-state">
                {!device.enabled
                  ? '已禁用'
                  : device.pendingInteractionObservability === 'unavailable'
                    ? `${device.runningSessionCount > 0 ? `进行中 ×${device.runningSessionCount} · ` : ''}等待决策状态不可观测`
                    : device.runningSessionCount > 0
                      ? `进行中 ×${device.runningSessionCount}${device.pendingInteractionCount > 0 ? ` · 等待决策 ×${device.pendingInteractionCount}` : ''}`
                      : device.pendingInteractionCount > 0
                        ? `等待决策 ×${device.pendingInteractionCount}`
                        : STATE_LABELS[device.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
