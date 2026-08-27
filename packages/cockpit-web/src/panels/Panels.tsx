import { useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { api } from '../api/client.js'

export type PanelName = 'devices' | 'overview' | 'settings'

export interface PanelProps {
  readonly onClose: () => void
}

/** Full-screen overlay panels; the workbench resumes underneath. */

export function DevicePanel({ devices, onClose, onChanged }: {
  readonly devices: readonly DeviceStatusFacts[]
  readonly onClose: () => void
  readonly onChanged: () => void
}) {
  const [form, setForm] = useState({ displayName: '', sshAlias: '', remoteDshPort: '3080' })
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(undefined)
    try {
      await api.addDevice({
        displayName: form.displayName,
        sshAlias: form.sshAlias,
        remoteDshPort: Number(form.remoteDshPort),
      })
      setForm({ displayName: '', sshAlias: '', remoteDshPort: '3080' })
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (deviceId: string, confirmed: boolean) => {
    setError(undefined)
    try {
      const result = await api.removeDevice({ deviceId, confirmed })
      if (result.requiresConfirmation && !confirmed) {
        if (window.confirm('该设备仍有未知结果的写操作，确认删除？')) {
          await api.removeDevice({ deviceId, confirmed: true })
        } else return
      }
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const toggle = async (device: DeviceStatusFacts) => {
    try {
      await api.updateDevice(device.deviceId, { enabled: !device.enabled })
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="panel" role="dialog" aria-modal="true" data-cockpit-panel="devices">
      <header className="panel-header">
        <h2>设备管理</h2>
        <button className="ghost" onClick={onClose}>✕</button>
      </header>
      <form className="panel-form" onSubmit={submit}>
        <h3>添加设备</h3>
        {error !== undefined && <p className="panel-error" role="alert">{error}</p>}
        <label>
          显示名
          <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} required />
        </label>
        <label>
          SSH 别名
          <input value={form.sshAlias} onChange={e => setForm(f => ({ ...f, sshAlias: e.target.value }))} required placeholder="lumevm" />
        </label>
        <label>
          远端 DSH 端口
          <input type="number" min={1} max={65535} value={form.remoteDshPort} onChange={e => setForm(f => ({ ...f, remoteDshPort: e.target.value }))} required />
        </label>
        <button type="submit" disabled={busy}>{busy ? '验证中…' : '添加'}</button>
      </form>
      <ul className="panel-list">
        {devices.map(device => (
          <li key={device.deviceId} className="panel-row" data-device={device.deviceId}>
            <span className="dot" aria-hidden="true" data-state={device.state} />
            <span className="panel-row-name">{device.displayName} <small>({device.deviceId})</small></span>
            <span className="panel-row-state">{device.state}</span>
            <button className="ghost" onClick={() => toggle(device)}>{device.enabled ? '禁用' : '启用'}</button>
            <button className="danger" onClick={() => void remove(device.deviceId, device.outcomeUnknownCount === 0)}>删除</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

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
            <li key={device.deviceId} className="panel-row" data-device={device.deviceId}>
              <span className="dot" aria-hidden="true" data-state={device.state} />
              <button className="panel-row-name" onClick={() => onSelect(device.deviceId)}>{device.displayName}</button>
              <span className="panel-row-state">
                {device.runningSessionCount > 0 ? `${device.runningSessionCount} 在跑 · ` : ''}
                {device.pendingInteractionCount > 0 ? `${device.pendingInteractionCount} 等待决策` : device.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SettingsPanel({ onClose }: PanelProps) {
  return (
    <div className="panel" role="dialog" aria-modal="true" data-cockpit-panel="settings">
      <header className="panel-header">
        <h2>设置</h2>
        <button className="ghost" onClick={onClose}>✕</button>
      </header>
      <p>驾驶舱数据目录：<code>~/.dsh-cockpit/</code></p>
    </div>
  )
}