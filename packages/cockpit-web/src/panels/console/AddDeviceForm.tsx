import { DeviceFields } from './DeviceFields.js'
import type { DeviceForm } from './deviceForm.js'

export function AddDeviceForm({ form, onChange, onSave, busy, error }: {
  form: DeviceForm; onChange: (form: DeviceForm) => void; onSave: (event: React.FormEvent) => void
  busy: boolean; error: string | undefined
}) {
  return <div className="console-content"><header className="console-detail-heading" role="presentation"><div><h2>添加设备</h2><p>连接本机，或通过 SSH 连接远端 DSH。</p></div></header>
    <form id="device-form" className="console-device-form" onSubmit={onSave}>
      <fieldset className="device-form-fields" disabled={busy}><DeviceFields form={form} onChange={onChange} /></fieldset>
      <div className="console-savebar">{error && <p className="panel-error" role="alert">{error}</p>}<button className="primary-action" disabled={busy} type="submit">{busy ? '验证中…' : '验证并添加'}</button></div>
    </form>
  </div>
}
