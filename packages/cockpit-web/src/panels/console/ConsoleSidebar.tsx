import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { StateDot } from '../../components/StateDot.js'
import { STATE_LABELS, stateTone, type ConsoleSelection } from './deviceForm.js'

export function ConsoleSidebar({ devices, selection, onSelect, onClose, busy }: {
  devices: readonly DeviceStatusFacts[]; selection: ConsoleSelection
  onSelect: (selection: ConsoleSelection) => void; onClose: () => void; busy: boolean
}) {
  const ready = devices.filter(d => d.enabled && d.state === 'READY').length
  const disabled = devices.filter(d => !d.enabled).length
  const attention = devices.length - ready - disabled
  return <nav className="console-sidebar" aria-label="设备与设置">
    <div className="console-sidebar-title"><h2 id="device-panel-title">设备与设置</h2><button className="console-list-close ghost" onClick={onClose} aria-label="关闭设备列表">✕</button></div>
    <p className="console-summary" role="note" aria-label="设备状态摘要">{devices.length === 0 ? '还没有设备' : `${devices.length} 台设备，${ready} 台已连接${attention ? `，${attention} 台需要处理` : ''}${disabled ? `，${disabled} 台已禁用` : ''}`}</p>
    <div className="console-nav-devices">
      {devices.map(device => <button key={device.deviceId} type="button" data-device={device.deviceId} data-state={device.state}
        className="console-nav-item" aria-current={selection.kind === 'device' && selection.deviceId === device.deviceId ? 'page' : undefined}
        aria-label={`${device.displayName}，${STATE_LABELS[device.state]}`} disabled={busy} onClick={() => onSelect({ kind: 'device', deviceId: device.deviceId })}>
        <span className="console-state-dot" data-tone={stateTone(device.state)}>{device.state === 'CONNECTING' ? <StateDot state="ongoing" /> : <span className="route-point" />}</span>
        <span className="console-nav-name">{device.displayName}</span>{!device.enabled && <small>已禁用</small>}
      </button>)}
      <button className="console-nav-item" aria-current={selection.kind === 'add' ? 'page' : undefined} disabled={busy} onClick={() => onSelect({ kind: 'add' })}><span aria-hidden="true">＋</span>添加设备</button>
    </div>
    <div className="console-nav-general"><button className="console-nav-item" aria-current={selection.kind === 'general' ? 'page' : undefined} disabled={busy} onClick={() => onSelect({ kind: 'general' })}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /><path d="M5 2v4M11 6v4M6 10v4" /></svg>通用</button></div>
  </nav>
}
