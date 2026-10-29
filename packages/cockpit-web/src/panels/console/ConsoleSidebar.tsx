import { useCallback, useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { StateDot } from '../../components/StateDot.js'
import { STATE_LABELS, stateTone, type ConsoleSelection } from './deviceForm.js'
import { DeviceMenu } from './DeviceMenu.js'

export function ConsoleSidebar({ devices, selection, onSelect, onClose, busy, onMove, onToggle, actionError }: {
  devices: readonly DeviceStatusFacts[]; selection: ConsoleSelection
  onSelect: (selection: ConsoleSelection) => void; onClose: () => void; busy: boolean
  onMove: (device: DeviceStatusFacts, direction: number) => void; onToggle: (device: DeviceStatusFacts) => void
  actionError?: { deviceId: string; message: string } | undefined
}) {
  const [open, setOpen] = useState<{ deviceId: string; anchor: HTMLButtonElement }>()
  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(current => { if (restoreFocus) current?.anchor.focus(); return undefined })
  }, [])
  const select = (next: ConsoleSelection) => { closeMenu(false); onSelect(next) }
  const ready = devices.filter(d => d.enabled && d.state === 'READY').length
  const disabled = devices.filter(d => !d.enabled).length
  const attention = devices.length - ready - disabled
  const menuDevice = open && !busy ? devices.find(d => d.deviceId === open.deviceId) : undefined
  return <nav className="console-sidebar" aria-label="设备与设置">
    <div className="console-sidebar-title"><h2 id="device-panel-title">设备与设置</h2><button className="console-list-close ghost" onClick={onClose} aria-label="关闭设备列表">✕</button></div>
    <p className="console-summary" role="note" aria-label="设备状态摘要">{devices.length === 0 ? '还没有设备' : `${devices.length} 台设备，${ready} 台已连接${attention ? `，${attention} 台需要处理` : ''}${disabled ? `，${disabled} 台已禁用` : ''}`}</p>
    <div className="console-nav-devices">
      {devices.map(device => <div key={device.deviceId} className="console-device-entry" data-device={device.deviceId} data-state={device.state}>
        <div className="console-device-row" data-selected={selection.kind === 'device' && selection.deviceId === device.deviceId || undefined}>
          <button type="button" className="console-nav-item" aria-current={selection.kind === 'device' && selection.deviceId === device.deviceId ? 'page' : undefined}
            aria-label={`${device.displayName}，${STATE_LABELS[device.state]}`} disabled={busy} onClick={() => select({ kind: 'device', deviceId: device.deviceId })}>
            <span className="console-state-dot" data-tone={stateTone(device.state)}>{device.state === 'CONNECTING' ? <StateDot state="ongoing" /> : <span className="route-point" />}</span>
            <span className="console-nav-name">{device.displayName}</span>
          </button>
          {!device.enabled && <span className="console-disabled-tag">已禁用</span>}
          <button type="button" className="console-more" aria-label={`${device.displayName} 更多操作`} aria-haspopup="menu" aria-expanded={menuDevice?.deviceId === device.deviceId} disabled={busy}
            onClick={event => { if (open?.deviceId === device.deviceId) closeMenu(); else setOpen({ deviceId: device.deviceId, anchor: event.currentTarget }) }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="13" cy="8" r="1.2" /></svg>
          </button>
        </div>
        {actionError?.deviceId === device.deviceId && <p className="console-row-error" role="alert">{actionError.message}</p>}
      </div>)}
      <button className="console-nav-item" aria-current={selection.kind === 'add' ? 'page' : undefined} disabled={busy} onClick={() => select({ kind: 'add' })}><span aria-hidden="true">＋</span>添加设备</button>
    </div>
    <div className="console-nav-general"><button className="console-nav-item" aria-current={selection.kind === 'general' ? 'page' : undefined} disabled={busy} onClick={() => select({ kind: 'general' })}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /><path d="M5 2v4M11 6v4M6 10v4" /></svg>通用</button></div>
    {menuDevice && open && <DeviceMenu key={menuDevice.deviceId} device={menuDevice} anchor={open.anchor} first={devices[0]?.deviceId === menuDevice.deviceId} last={devices[devices.length - 1]?.deviceId === menuDevice.deviceId} onClose={closeMenu} onMove={direction => onMove(menuDevice, direction)} onToggle={() => onToggle(menuDevice)} />}
  </nav>
}
