import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { ForwardList } from '../ForwardList.js'
import { DeviceFields } from './DeviceFields.js'
import { ConnectionRoute } from './ConnectionRoute.js'
import { STATE_LABELS, stateTone, type DeviceForm } from './deviceForm.js'

export function DeviceDetail({ device, form, onChange, busy, dirty, error, onSave, onReset, onDelete, confirmDeleteForward }: {
  device: DeviceStatusFacts; form: DeviceForm; onChange: (form: DeviceForm) => void
  busy: boolean; dirty: boolean; error: string | undefined; onSave: (event: React.FormEvent) => void
  onReset: () => void; onDelete: () => void
  confirmDeleteForward?: (message: string) => boolean
}) {
  return <div className="console-content" data-device={device.deviceId} data-state={device.state}>
    <header className="console-detail-heading" role="presentation"><div><h2>{device.displayName}</h2><p><span>{device.kind === 'local' ? '本机' : 'SSH 远端'}</span><span className="console-connection-state" data-tone={stateTone(device.state)}><i className="route-point" />{STATE_LABELS[device.state]}</span></p></div>
    </header>
    <ConnectionRoute device={device} />
    {device.diagnostic && device.state !== 'READY' && <p className="console-diagnostic">{device.diagnostic}</p>}
    <form id="device-form" className="console-device-form" onSubmit={onSave}>
      <fieldset disabled={busy}><DeviceFields form={form} onChange={onChange} device={device} /></fieldset>
    </form>
    <ForwardList device={device} {...(confirmDeleteForward ? { confirm: confirmDeleteForward } : {})} />
    <section className="console-section console-danger-zone"><h3>删除设备</h3><div><p>仅从驾驶舱移除，不影响设备上的 DSH。</p><button className="danger" aria-label={`删除${device.displayName}`} disabled={busy} onClick={onDelete}>删除设备</button></div></section>
    <div className="console-savebar">{error ? <p className="panel-error" role="alert">{error}</p> : <span>{dirty ? '有未保存的修改' : '所有修改已保存'}</span>}<div><button className="ghost" disabled={busy || !dirty} onClick={onReset}>放弃修改</button><button className="primary-action" type="submit" form="device-form" disabled={busy || !dirty}>{busy ? '验证中…' : '保存修改'}</button></div></div>
  </div>
}
