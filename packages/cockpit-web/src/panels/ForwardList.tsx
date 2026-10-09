import { useId, useState } from 'react'
import type { DeviceStatusFacts, ForwardEntryState, ForwardRow } from '@dsh-cockpit/shared'
import { api, ApiRequestError } from '../api/client.js'

/** One device's forward table in the device panel (cockpit-device-shell).
 * Data comes from the device status stream; nothing here polls. Labels,
 * holder labels and diagnostics are rendered as React text only. */

const STATE_TEXT: Record<ForwardEntryState, string> = {
  starting: '建立中',
  ready: '就绪',
  retrying: '重试中',
  paused: '暂停',
}

/** Fixed wording per stable server code; the server message is never shown. */
const CODE_TEXT: Record<string, string> = {
  'forward-limit': '已达到附加转发上限（8 条）。',
  'reserved-port': '该端口是设备 DSH 工作台端口，不能再次转发。',
  'invalid-port': '请输入 1–65535 之间的设备端口。',
  'invalid-label': '标签需为 1–64 个可打印 ASCII 字符。',
  'local-device': '本机设备无需转发。',
  'device-unavailable': '设备当前不可用，请稍后重试。',
}
const FALLBACK_TEXT = '操作失败，请重试。'

function failureText(cause: unknown): string {
  return cause instanceof ApiRequestError ? CODE_TEXT[cause.code] ?? FALLBACK_TEXT : FALLBACK_TEXT
}

function defaultConfirm(message: string): boolean {
  return window.confirm(message)
}

function RowView({ row, onDelete, busy }: { readonly row: ForwardRow; readonly onDelete: (row: ForwardRow) => void; readonly busy: boolean }) {
  const address = row.state === 'ready' && row.localPort !== undefined ? `127.0.0.1:${row.localPort}` : '—'
  const key = row.kind === 'system' ? 'system' : String(row.devicePort)
  const kind = row.kind === 'system' ? 'system' : row.pinned ? 'pinned' : 'held'
  return (
    <li className="forward-row" data-forward={key} data-forward-state={row.state}>
      {/* The row action shares the summary line (right column), never the
          label/holder line where it crowded the text. */}
      <div className="forward-row-line">
        <div className="forward-row-main">
          <strong>{row.devicePort}</strong>
          <span className="forward-address">{address}</span>
          <span className="forward-state" data-forward-state={row.state}>{STATE_TEXT[row.state]}</span>
          <span className="forward-kind" data-forward-kind={kind}>
            {row.kind === 'system' ? '主通道' : row.pinned ? '常驻' : '随持有者'}
          </span>
          {row.state === 'ready' && row.pid !== undefined && <span className="forward-pid">pid {row.pid}</span>}
        </div>
        {row.kind === 'additional' && (
          <button
            className="danger forward-delete"
            type="button"
            aria-label={`删除转发 ${row.devicePort}`}
            disabled={busy}
            onClick={() => { onDelete(row) }}
          >删除</button>
        )}
      </div>
      {row.kind === 'additional' && (
        <div className="forward-row-meta">
          {row.label !== undefined && <span className="forward-label">{row.label}</span>}
          <span className="forward-holders">持有者 {row.holderCount}</span>
          {row.holders.length > 0 && <span className="forward-holder-labels">{row.holders.join(', ')}</span>}
          {row.diagnostic !== undefined && row.diagnostic !== '' && <p className="forward-diagnostic">{row.diagnostic}</p>}
        </div>
      )}
    </li>
  )
}

export function ForwardList({ device, confirm = defaultConfirm }: {
  readonly device: DeviceStatusFacts
  readonly confirm?: (message: string) => boolean
}) {
  const [port, setPort] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const createHeadingId = useId()
  const title = `${device.displayName} 转发`

  if (device.kind === 'local') {
    return (
      <section className="forward-list" aria-label={title}>
        <p className="forward-empty">本机设备无需转发</p>
      </section>
    )
  }

  const projection = device.forwards
  const rows = projection?.rows ?? []

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(undefined)
    const devicePort = /^\d{1,5}$/.test(port.trim()) ? Number(port.trim()) : Number.NaN
    if (!Number.isInteger(devicePort) || devicePort < 1 || devicePort > 65_535) {
      setError(CODE_TEXT['invalid-port'])
      return
    }
    setBusy(true)
    try {
      const trimmed = label.trim()
      await api.createForward(device.deviceId, devicePort, trimmed === '' ? undefined : trimmed)
      setPort('')
      setLabel('')
    } catch (cause) {
      // Keep what the user typed; explain in place.
      setError(failureText(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row: ForwardRow) => {
    if (row.kind !== 'additional') return
    if (row.holderCount > 0 && !confirm(`转发 ${row.devicePort} 仍有 ${row.holderCount} 个持有者，删除后它们将失去访问。确定删除？`)) return
    setError(undefined)
    setBusy(true)
    try {
      await api.deleteForward(device.deviceId, row.devicePort)
    } catch (cause) {
      setError(failureText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="forward-list" aria-label={title}>
      <div className="forward-list-header">
        <h4 className="forward-heading">转发</h4>
        <span className="forward-usage">{projection === undefined ? '—' : `${projection.additionalCount} / ${projection.limit}`}</span>
      </div>
      <ul className="forward-rows">
        {rows.map(row => (
          <RowView key={row.kind === 'system' ? 'system' : row.devicePort} row={row} busy={busy} onDelete={row => { void remove(row) }} />
        ))}
      </ul>
      <form className="forward-form" aria-labelledby={createHeadingId} onSubmit={event => { void create(event) }}>
        <div className="forward-form-head">
          <h4 className="forward-heading" id={createHeadingId}>添加常驻转发</h4>
          <p className="forward-form-hint">常驻条目在驾驶舱重启后仍保留；设备上的组件申请的是「随持有者」条目，随持有者释放即回收。</p>
        </div>
        <div className="forward-form-row">
          <label className="forward-form-port">
            <span>设备端口</span>
            <input inputMode="numeric" value={port} onChange={event => { setPort(event.target.value) }} disabled={busy} />
          </label>
          <label className="forward-form-label">
            <span>标签（可选）</span>
            <input value={label} maxLength={64} onChange={event => { setLabel(event.target.value) }} disabled={busy} />
          </label>
          <button className="primary-action" type="submit" disabled={busy}>添加常驻转发</button>
        </div>
        {error !== undefined && <p className="panel-error" role="alert">{error}</p>}
      </form>
    </section>
  )
}
