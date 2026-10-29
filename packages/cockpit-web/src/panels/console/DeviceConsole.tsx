import { useEffect, useRef, useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { api } from '../../api/client.js'
import { ConsoleSidebar } from './ConsoleSidebar.js'
import { DeviceDetail } from './DeviceDetail.js'
import { AddDeviceForm } from './AddDeviceForm.js'
import { GeneralSettings } from './GeneralSettings.js'
import { connectionFields, draftFor, EMPTY_DEVICE_FORM, errorMessage, isDirty, type ConsoleSelection, type DeviceForm } from './deviceForm.js'

export function DevicePanel({ devices, onClose, onChanged, initialSelection, confirmDiscard = () => window.confirm('有未保存的修改，确定放弃？'), confirmDelete = device => window.confirm(`确认删除设备「${device.displayName}」？该操作不可撤销。`), confirmDeleteForward }: {
  devices: readonly DeviceStatusFacts[]; onClose: () => void; onChanged: () => void
  initialSelection?: ConsoleSelection; confirmDiscard?: () => boolean
  confirmDelete?: (device: DeviceStatusFacts) => boolean; confirmDeleteForward?: (message: string) => boolean
}) {
  const ordered = [...devices].sort((a, b) => a.order - b.order)
  const [selection, setSelection] = useState<ConsoleSelection>(() => initialSelection ?? (ordered[0] ? { kind: 'device', deviceId: ordered[0].deviceId } : { kind: 'add' }))
  const initialDevice = selection.kind === 'device' ? ordered.find(d => d.deviceId === selection.deviceId) : undefined
  const [baseline, setBaseline] = useState<DeviceForm>(() => initialDevice ? draftFor(initialDevice) : EMPTY_DEVICE_FORM)
  const [form, setForm] = useState(baseline)
  const [view, setView] = useState('list')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const pendingId = useRef<string>()
  const previousIndex = useRef(0)
  const dialog = useRef<HTMLDivElement>(null)
  const device = selection.kind === 'device' ? ordered.find(d => d.deviceId === selection.deviceId) : undefined
  const dirty = selection.kind !== 'general' && isDirty(form, baseline)
  const choose = (next: ConsoleSelection) => {
    setSelection(next)
    const selected = next.kind === 'device' ? ordered.find(d => d.deviceId === next.deviceId) : undefined
    const draft = selected ? draftFor(selected) : EMPTY_DEVICE_FORM
    setBaseline(draft); setForm(draft); setError(undefined)
    if (selected) previousIndex.current = ordered.indexOf(selected)
  }
  const navigate = (next: ConsoleSelection) => {
    if (busy) return
    if (JSON.stringify(next) !== JSON.stringify(selection)) {
      if (dirty && !confirmDiscard()) return
      choose(next)
    }
    setView('detail')
  }
  const close = () => { if (!busy && (!dirty || confirmDiscard())) onClose() }
  useEffect(() => {
    if (selection.kind !== 'device') return
    if (device) {
      previousIndex.current = ordered.findIndex(d => d.deviceId === device.deviceId)
      if (pendingId.current === device.deviceId) { pendingId.current = undefined; const draft = draftFor(device); setBaseline(draft); setForm(draft) }
    } else if (pendingId.current !== selection.deviceId) {
      const adjacent = ordered[Math.min(previousIndex.current, ordered.length - 1)]
      choose(adjacent ? { kind: 'device', deviceId: adjacent.deviceId } : { kind: 'add' })
    }
  }, [devices, selection])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const siblings = Array.from(dialog.current?.parentElement?.children ?? []).filter(el => el !== dialog.current) as HTMLElement[]
    const prior = siblings.map(el => el.inert)
    siblings.forEach(el => { el.inert = true })
    dialog.current?.focus()
    return () => { siblings.forEach((el, index) => { el.inert = prior[index] ?? false }); previous?.focus() }
  }, [])
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(undefined)
    if (form.clearDshLaunchToken && form.dshLaunchUrl.trim()) { setError('不能同时粘贴新的 DSH 启动 URL 和清除现有认证材料。'); return }
    setBusy(true)
    try {
      if (selection.kind === 'device') {
        await api.updateDevice(selection.deviceId, connectionFields(form))
        const saved = { ...form, dshLaunchUrl: '', clearDshLaunchToken: false }
        setForm(saved); setBaseline(saved)
      } else {
        const result = await api.addDevice({ ...connectionFields(form), kind: form.kind })
        pendingId.current = result.deviceId
        setSelection({ kind: 'device', deviceId: result.deviceId })
        const clean = { ...form, dshLaunchUrl: '', clearDshLaunchToken: false }
        setForm(clean); setBaseline(clean)
      }
      onChanged()
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  const action = async (run: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError(undefined)
    try { await run(); onChanged() } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  const toggle = () => {
    if (!device || (dirty && !confirmDiscard())) return
    const next = { ...draftFor(device), enabled: !device.enabled }
    void action(async () => { await api.updateDevice(device.deviceId, { enabled: !device.enabled }); setForm(next); setBaseline(next) })
  }
  const remove = () => {
    if (!device || !confirmDelete(device)) return
    void action(async () => {
      await api.removeDevice({ deviceId: device.deviceId, confirmed: true })
      const index = ordered.indexOf(device)
      const adjacent = ordered[index + 1] ?? ordered[index - 1]
      choose(adjacent ? { kind: 'device', deviceId: adjacent.deviceId } : { kind: 'add' })
    })
  }
  return <div ref={dialog} tabIndex={-1} className="panel device-panel console-shell" role="dialog" aria-modal="true" aria-labelledby="device-panel-title" data-cockpit-panel="devices" data-view={view} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
    }
  }}>
    <ConsoleSidebar devices={ordered} selection={selection} onSelect={navigate} onClose={close} busy={busy} />
    <div className="console-detail"><div className="console-toolbar"><button className="ghost console-back" onClick={() => setView('list')}>返回</button><button className="ghost console-close" aria-label="关闭设备管理" disabled={busy} onClick={close}>✕</button></div>
      {selection.kind === 'general' ? <GeneralSettings /> : selection.kind === 'add' ? <AddDeviceForm form={form} onChange={setForm} onSave={event => void save(event)} busy={busy} error={error} /> : device ? <DeviceDetail device={device} form={form} onChange={setForm} busy={busy} dirty={dirty} error={error}
        onSave={event => void save(event)} onReset={() => { const next = draftFor(device); setForm(next); setBaseline(next); setError(undefined) }}
        first={ordered.indexOf(device) === 0} last={ordered.indexOf(device) === ordered.length - 1}
        onMove={direction => void action(() => api.updateDevice(device.deviceId, { order: ordered.indexOf(device) + direction }))} onToggle={toggle} onDelete={remove}
        {...(confirmDeleteForward ? { confirmDeleteForward } : {})} /> : <div className="console-content" role="status">正在同步设备…{error && <p role="alert">{error}</p>}</div>}
    </div>
  </div>
}
