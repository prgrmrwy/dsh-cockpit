import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { AUTH_STATE_LABELS, type DeviceForm } from './deviceForm.js'

export function DeviceFields({ form, onChange, device }: {
  form: DeviceForm; onChange: (form: DeviceForm) => void; device?: DeviceStatusFacts
}) {
  const set = <K extends keyof DeviceForm>(key: K, value: DeviceForm[K]) => onChange({ ...form, [key]: value })
  return <>
    <section className="console-section"><h3>连接</h3><div className="console-fields">
      <label>显示名<input aria-label="显示名" value={form.displayName} onChange={e => set('displayName', e.target.value)} required placeholder="例如：开发虚拟机" /></label>
      {!device && <label>类型<select aria-label="类型" value={form.kind} onChange={e => set('kind', e.target.value as DeviceForm['kind'])}><option value="remote">SSH 远端</option><option value="local">本机</option></select></label>}
      {form.kind === 'remote' && <label>SSH 别名<div><input aria-label="SSH 别名" value={form.sshAlias} onChange={e => set('sshAlias', e.target.value)} required placeholder="例如：lumevm" /><p>复用 ~/.ssh/config 中已配置的免密别名。</p></div></label>}
      <label>DSH 端口<input aria-label="DSH 端口" type="number" min={1} max={65535} value={form.remoteDshPort} onChange={e => set('remoteDshPort', e.target.value)} required /></label>
      <label className="console-check"><span>启用设备</span><input aria-label="启用设备" type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} /></label>
      {device && <div className="console-readonly"><span>设备 ID</span><span>{device.deviceId}</span></div>}
    </div></section>
    <section className="console-section"><h3>DSH 认证</h3><div className="console-fields">
      {device && <div className="console-readonly" role="status" aria-label={`当前 DSH 认证状态：${AUTH_STATE_LABELS[device.dshAuthState]}`}><span>当前认证</span><div><span data-auth-state={device.dshAuthState}>{AUTH_STATE_LABELS[device.dshAuthState]}</span>{device.dshAuthState === 'recovery-required' && <p>现有认证材料不可用，请粘贴当前 dsh web 启动 URL，或启用自动恢复。</p>}</div></div>}
      <label>DSH 启动 URL<div><input aria-label="DSH 启动 URL" type="url" autoComplete="off" value={form.dshLaunchUrl} onChange={e => set('dshLaunchUrl', e.target.value)} placeholder="http://127.0.0.1:3080/?token=…" /><p>可选。粘贴 dsh web 输出的完整启动 URL；保存后不会回显。编辑时留空不会修改现有认证材料。</p></div></label>
      {device && <label className="console-check"><div>清除现有认证材料<p>保存时清除 launch token 与 cookie，不能同时提交新的启动 URL。</p></div><input aria-label="清除 DSH 认证材料" type="checkbox" checked={form.clearDshLaunchToken} onChange={e => set('clearDshLaunchToken', e.target.checked)} /></label>}
      <label className="console-check"><div>自动认证恢复<p>默认关闭。启用后仅在认证失效时读取{form.kind === 'local' ? '本机' : '通过现有 BatchMode SSH 身份读取远端'}标准 $DSH_HOME/dsh.log 的有限尾部；不会扫描其它文件或执行写操作。</p></div><input aria-label="启用 ohmydsh 自动认证恢复" type="checkbox" checked={form.dshAuthAutoDiscovery} onChange={e => set('dshAuthAutoDiscovery', e.target.checked)} /></label>
    </div></section>
  </>
}
