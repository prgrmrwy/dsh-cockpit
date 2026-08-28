import { useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { api } from '../api/client.js'

export type PanelName = 'devices' | 'overview' | 'settings'

export interface PanelProps {
  readonly onClose: () => void
}

/** Full-screen overlay panels; the workbench resumes underneath. */

type DeviceForm = {
  readonly displayName: string
  readonly kind: 'local' | 'remote'
  readonly sshAlias: string
  readonly remoteDshPort: string
  readonly enabled: boolean
}

const EMPTY_DEVICE_FORM: DeviceForm = {
  displayName: '',
  kind: 'remote',
  sshAlias: '',
  remoteDshPort: '3080',
  enabled: true,
}

const STATE_LABELS: Record<DeviceStatusFacts['state'], string> = {
  DISABLED: '已禁用',
  SSH_UNREACHABLE: 'SSH 不可达',
  TUNNEL_ERROR: '隧道建立失败',
  DSH_UNAVAILABLE: 'DSH 未运行',
  NON_DSH_SERVICE: '非 DSH 服务',
  INCOMPATIBLE: '版本不兼容',
  CONNECTING: '正在连接',
  READY: '已连接',
  DEGRADED: '连接异常',
}

function stateTone(state: DeviceStatusFacts['state']): 'ok' | 'warn' | 'error' | 'disabled' {
  if (state === 'READY') return 'ok'
  if (state === 'CONNECTING' || state === 'DEGRADED') return 'warn'
  if (state === 'DISABLED') return 'disabled'
  return 'error'
}

function draftFor(device: DeviceStatusFacts): DeviceForm {
  return {
    displayName: device.displayName,
    kind: device.kind,
    sshAlias: device.sshAlias ?? '',
    remoteDshPort: String(device.remoteDshPort),
    enabled: device.enabled,
  }
}

function secondaryIdentifier(device: DeviceStatusFacts): string {
  return device.kind === 'remote'
    ? `${device.sshAlias ?? '未设置 SSH 别名'}:${device.remoteDshPort}`
    : `127.0.0.1:${device.remoteDshPort}`
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Default delete confirmation. Injectable so tests can drive both answers and
 * a future in-panel dialog can replace it without touching callers. */
function confirmDeleteDefault(device: DeviceStatusFacts): boolean {
  return window.confirm(`确认删除设备「${device.displayName}」？该操作不可撤销。`)
}

export function DevicePanel({ devices, onClose, onChanged, confirmDelete = confirmDeleteDefault }: {
  readonly devices: readonly DeviceStatusFacts[]
  readonly onClose: () => void
  readonly onChanged: () => void
  readonly confirmDelete?: (device: DeviceStatusFacts) => boolean
}) {
  const [mode, setMode] = useState<{ readonly kind: 'add' } | { readonly kind: 'edit'; readonly deviceId: string }>({ kind: 'add' })
  const [form, setForm] = useState<DeviceForm>(EMPTY_DEVICE_FORM)
  const [formError, setFormError] = useState<string | undefined>()
  const [actionErrors, setActionErrors] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)
  const [busyDeviceId, setBusyDeviceId] = useState<string | undefined>()

  const orderedDevices = [...devices].sort((left, right) => left.order - right.order)
  const readyCount = devices.filter(device => device.enabled && device.state === 'READY').length
  const disabledCount = devices.filter(device => !device.enabled).length
  const attentionCount = devices.filter(device => device.enabled && device.state !== 'READY').length

  const resetToAdd = () => {
    setMode({ kind: 'add' })
    setForm(EMPTY_DEVICE_FORM)
    setFormError(undefined)
  }

  const edit = (device: DeviceStatusFacts) => {
    setMode({ kind: 'edit', deviceId: device.deviceId })
    setForm(draftFor(device))
    setFormError(undefined)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFormError(undefined)
    try {
      const connectionFields = {
        displayName: form.displayName,
        ...(form.kind === 'remote' ? { sshAlias: form.sshAlias } : {}),
        remoteDshPort: Number(form.remoteDshPort),
        enabled: form.enabled,
      }
      if (mode.kind === 'edit') {
        await api.updateDevice(mode.deviceId, connectionFields)
      } else {
        await api.addDevice({ ...connectionFields, kind: form.kind })
      }
      resetToAdd()
      onChanged()
    } catch (cause) {
      setFormError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const runDeviceAction = async (deviceId: string, action: () => Promise<void>) => {
    setBusyDeviceId(deviceId)
    setActionErrors(current => ({ ...current, [deviceId]: undefined }))
    try {
      await action()
    } catch (cause) {
      setActionErrors(current => ({ ...current, [deviceId]: errorMessage(cause) }))
    } finally {
      setBusyDeviceId(undefined)
    }
  }

  // Deleting a device is irreversible, so every delete asks first. Declining
  // must be completely inert: no request leaves the browser.
  const remove = (device: DeviceStatusFacts) => runDeviceAction(device.deviceId, async () => {
    if (!confirmDelete(device)) return
    await api.removeDevice({ deviceId: device.deviceId, confirmed: true })
    onChanged()
  })

  const toggle = (device: DeviceStatusFacts) => runDeviceAction(device.deviceId, async () => {
    await api.updateDevice(device.deviceId, { enabled: !device.enabled })
    onChanged()
  })

  const move = (device: DeviceStatusFacts, targetOrder: number) => runDeviceAction(device.deviceId, async () => {
    await api.updateDevice(device.deviceId, { order: targetOrder })
    onChanged()
  })

  return (
    <div className="panel device-panel" role="dialog" aria-modal="true" aria-labelledby="device-panel-title" data-cockpit-panel="devices">
      <div className="device-panel-shell">
        <header className="device-panel-heading">
          <div>
            <h2 id="device-panel-title">设备管理</h2>
            <p>管理本机和 SSH 远端的连接配置、启用状态与显示顺序。</p>
          </div>
          <button className="ghost panel-close" type="button" onClick={onClose} aria-label="关闭设备管理">✕</button>
        </header>

        <div className="device-summary" aria-label="设备状态摘要">
          <span data-summary="total">设备总数 <strong>{devices.length}</strong></span>
          <span data-summary="ready">已连接 <strong>{readyCount}</strong></span>
          <span data-summary="attention">需处理 <strong>{attentionCount}</strong></span>
          <span data-summary="disabled">已禁用 <strong>{disabledCount}</strong></span>
        </div>

        <div className="device-console">
          <section className="device-list-section" aria-labelledby="device-list-title">
            <div className="device-list-header">
              <div>
                <h3 id="device-list-title">设备列表</h3>
                <p>状态来自连接层；诊断信息仅在可用时显示。</p>
              </div>
            </div>

            {orderedDevices.length === 0 ? (
              <div className="panel-empty">
                <div>
                  <strong>还没有设备</strong>
                  <p>从添加表单登记本机或 SSH 远端，即可开始使用。</p>
                  <a href="#device-form">添加第一台设备</a>
                </div>
              </div>
            ) : (
              <ul className="panel-list device-list">
                {orderedDevices.map((device, index) => {
                  const deviceBusy = busyDeviceId === device.deviceId
                  return (
                    <li
                      key={device.deviceId}
                      className="device-card"
                      data-device={device.deviceId}
                      data-state={device.state}
                      aria-label={`${device.displayName}，${STATE_LABELS[device.state]}`}
                    >
                      <div className="device-card-main">
                        <span className="dot" aria-hidden="true" data-state={device.state} data-tone={stateTone(device.state)} />
                        <div className="device-card-copy">
                          <div className="device-card-title">
                            <strong>{device.displayName}</strong>
                            <span className="device-kind">{device.kind === 'remote' ? 'SSH 远端' : '本机'}</span>
                            <span className="device-state" data-state={device.state} data-tone={stateTone(device.state)}>{STATE_LABELS[device.state]}</span>
                          </div>
                          <div className="device-card-meta">
                            <span>{secondaryIdentifier(device)}</span>
                            {' · '}
                            <span>{device.deviceId}</span>
                          </div>
                          {device.state !== 'READY' && device.diagnostic !== undefined && device.diagnostic !== '' && (
                            <p className="device-card-diagnostic">{device.diagnostic}</p>
                          )}
                          {actionErrors[device.deviceId] !== undefined && (
                            <p className="panel-error" role="alert">{actionErrors[device.deviceId]}</p>
                          )}
                        </div>
                      </div>

                      <div className="device-card-actions" aria-label={`${device.displayName} 操作`}>
                        <span className="device-order-actions">
                          <button
                            className="ghost"
                            type="button"
                            aria-label={`上移${device.displayName}`}
                            disabled={deviceBusy || index === 0}
                            onClick={() => void move(device, index - 1)}
                          >上移</button>
                          <button
                            className="ghost"
                            type="button"
                            aria-label={`下移${device.displayName}`}
                            disabled={deviceBusy || index === orderedDevices.length - 1}
                            onClick={() => void move(device, index + 1)}
                          >下移</button>
                        </span>
                        <button className="ghost" type="button" aria-label={`编辑${device.displayName}`} disabled={deviceBusy} onClick={() => edit(device)}>编辑</button>
                        <button className="ghost" type="button" aria-label={`${device.enabled ? '禁用' : '启用'}${device.displayName}`} disabled={deviceBusy} onClick={() => void toggle(device)}>{device.enabled ? '禁用' : '启用'}</button>
                        <button className="danger" type="button" aria-label={`删除${device.displayName}`} disabled={deviceBusy} onClick={() => void remove(device)}>删除</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <aside className="device-form-card">
            <h3>{mode.kind === 'edit' ? '编辑设备' : '添加设备'}</h3>
            <p>{mode.kind === 'edit' ? '保存前会重新验证远端 SSH 连接。' : 'SSH 远端需要可用的免密别名。'}</p>
            <form id="device-form" className="panel-form" onSubmit={submit}>
              {formError !== undefined && <p className="panel-error" role="alert">{formError}</p>}
              <fieldset className="device-form-fields" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <label>
                  显示名
                  <input aria-label="显示名" value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} required placeholder="例如：开发虚拟机" />
                </label>
                <div>
                  <span>类型</span>
                  <div className="device-type-switch" role="radiogroup" aria-label="类型">
                    <button
                      className={`device-type-option${form.kind === 'remote' ? ' active' : ''}`}
                      type="button"
                      role="radio"
                      aria-checked={form.kind === 'remote'}
                      disabled={mode.kind === 'edit' || busy}
                      onClick={() => setForm(current => ({ ...current, kind: 'remote' }))}
                    >SSH 远端</button>
                    <button
                      className={`device-type-option${form.kind === 'local' ? ' active' : ''}`}
                      type="button"
                      role="radio"
                      aria-checked={form.kind === 'local'}
                      disabled={mode.kind === 'edit' || busy}
                      onClick={() => setForm(current => ({ ...current, kind: 'local' }))}
                    >本机</button>
                  </div>
                  <span className="field-hint">编辑设备时类型不可更改。</span>
                </div>
                {form.kind === 'remote' && (
                  <label>
                    SSH 别名
                    <input aria-label="SSH 别名" value={form.sshAlias} onChange={event => setForm(current => ({ ...current, sshAlias: event.target.value }))} required placeholder="例如：lumevm" />
                    <span className="field-hint">复用 ~/.ssh/config 中已配置的免密别名。</span>
                  </label>
                )}
                <label>
                  DSH 端口
                  <input aria-label="DSH 端口" type="number" min={1} max={65535} value={form.remoteDshPort} onChange={event => setForm(current => ({ ...current, remoteDshPort: event.target.value }))} required />
                </label>
                <label>
                  <span>
                    <input aria-label="启用设备" type="checkbox" checked={form.enabled} onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))} />
                    {' '}启用设备
                  </span>
                </label>
              </fieldset>
              <div className="form-actions">
                <button className="primary-action" type="submit" disabled={busy}>{busy ? '验证中…' : mode.kind === 'edit' ? '保存修改' : '验证并添加'}</button>
                {mode.kind === 'edit' && <button className="ghost" type="button" disabled={busy} onClick={resetToAdd}>取消编辑</button>}
              </div>
            </form>
          </aside>
        </div>
      </div>
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
