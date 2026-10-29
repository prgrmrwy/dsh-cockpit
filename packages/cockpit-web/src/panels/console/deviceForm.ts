import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

export type ConsoleSelection = { kind: 'device'; deviceId: string } | { kind: 'add' } | { kind: 'general' }
export type DeviceForm = {
  displayName: string; kind: 'local' | 'remote'; sshAlias: string; remoteDshPort: string
  enabled: boolean; dshLaunchUrl: string; clearDshLaunchToken: boolean; dshAuthAutoDiscovery: boolean
}
export const EMPTY_DEVICE_FORM: DeviceForm = {
  displayName: '', kind: 'remote', sshAlias: '', remoteDshPort: '3080', enabled: true,
  dshLaunchUrl: '', clearDshLaunchToken: false, dshAuthAutoDiscovery: false,
}
export const STATE_LABELS: Record<DeviceStatusFacts['state'], string> = {
  DISABLED: '已禁用', SSH_UNREACHABLE: 'SSH 不可达', TUNNEL_ERROR: '隧道建立失败',
  DSH_UNAVAILABLE: 'DSH 未运行', NON_DSH_SERVICE: '非 DSH 服务', INCOMPATIBLE: '版本不兼容',
  CONNECTING: '正在连接', READY: '已连接', DEGRADED: '连接异常',
}
export const AUTH_STATE_LABELS = { 'not-configured': '未配置', ready: '已配置', 'recovery-required': '需更新' }
export function stateTone(state: DeviceStatusFacts['state']) {
  if (state === 'READY') return 'ok'
  if (state === 'CONNECTING' || state === 'DEGRADED') return 'warn'
  return state === 'DISABLED' ? 'disabled' : 'error'
}
export function draftFor(device: DeviceStatusFacts): DeviceForm {
  return { ...EMPTY_DEVICE_FORM, displayName: device.displayName, kind: device.kind,
    sshAlias: device.sshAlias ?? '', remoteDshPort: String(device.remoteDshPort),
    enabled: device.enabled, dshAuthAutoDiscovery: device.dshAuthAutoDiscovery }
}
export function isDirty(form: DeviceForm, baseline: DeviceForm) {
  return (Object.keys(form) as (keyof DeviceForm)[]).some(key => form[key] !== baseline[key])
}
export function connectionFields(form: DeviceForm) {
  return { displayName: form.displayName, ...(form.kind === 'remote' ? { sshAlias: form.sshAlias } : {}),
    remoteDshPort: Number(form.remoteDshPort), enabled: form.enabled, dshAuthAutoDiscovery: form.dshAuthAutoDiscovery,
    ...(form.dshLaunchUrl.trim() ? { dshLaunchUrl: form.dshLaunchUrl.trim() } : {}),
    ...(form.clearDshLaunchToken ? { clearDshLaunchToken: true } : {}) }
}
export function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
