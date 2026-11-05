import { useId, useState } from 'react'
import { forwardOpenUrl, type DeviceStatusFacts, type ForwardEntryState, type ForwardRow } from '@dsh-cockpit/shared'
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
  'local-port-conflict': '该本地端口已被其他设备的同端口转发或某台设备的工作台占用。',
  'invalid-open-path': '打开路径需以 / 开头，且不含空格（最长 512 个字符）。',
  'invalid-url-command': '打开地址命令需为单行可打印 ASCII（最长 1024 个字符）。',
  'forward-not-ready': '转发尚未就绪，请稍后再打开。',
  'url-command-failed': '打开地址命令执行失败（非零退出或无法连接设备）。',
  'url-command-timed-out': '打开地址命令 10 秒内未结束。',
  'url-command-no-url': '没有在命令输出中找到该端口的地址。',
  'url-command-output-too-large': '打开地址命令的输出过大（超过 64 KiB）。',
}
const FALLBACK_TEXT = '操作失败，请重试。'

function failureText(cause: unknown): string {
  return cause instanceof ApiRequestError ? CODE_TEXT[cause.code] ?? FALLBACK_TEXT : FALLBACK_TEXT
}

function defaultConfirm(message: string): boolean {
  return window.confirm(message)
}

function defaultOpenWindow(url: string): Window | null {
  return window.open(url, '_blank', url === '' ? undefined : 'noopener,noreferrer')
}

function RowView({ row, onDelete, onOpen, busy }: {
  readonly row: ForwardRow
  readonly onDelete: (row: ForwardRow) => void
  readonly onOpen: (row: ForwardRow) => void
  readonly busy: boolean
}) {
  const address = row.state === 'ready' && row.localPort !== undefined ? `127.0.0.1:${row.localPort}` : '—'
  const key = row.kind === 'system' ? 'system' : String(row.devicePort)
  const kind = row.kind === 'system' ? 'system' : row.pinned ? 'pinned' : 'held'
  const pid = row.state === 'ready' && row.pid !== undefined ? `pid ${row.pid}` : undefined
  // Second line: pid, label and holder facts. The system row has no label or
  // holders (SystemForwardRow carries no diagnostic either), so it shows a
  // second line only while it has a pid.
  const hasSecondLine = row.kind === 'additional' || pid !== undefined
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
        </div>
        {row.kind === 'additional' && (
          <div className="forward-row-actions">
          <button
            className="ghost forward-open"
            type="button"
            aria-label={`在浏览器打开转发 ${row.devicePort}`}
            disabled={busy || row.state !== 'ready' || row.localPort === undefined}
            onClick={() => { onOpen(row) }}
          >打开</button>
          <button
            className="danger forward-delete"
            type="button"
            aria-label={`删除转发 ${row.devicePort}`}
            disabled={busy}
            onClick={() => { onDelete(row) }}
          >删除</button>
          </div>
        )}
      </div>
      {hasSecondLine && (
        <div className="forward-row-meta">
          {pid !== undefined && <span className="forward-pid">{pid}</span>}
          {row.kind === 'additional' && (
            <>
              {row.label !== undefined && <span className="forward-label">{row.label}</span>}
              {row.sameLocalPort && <span className="forward-same-port">同端口</span>}
              {row.openPath !== undefined && <span className="forward-open-path">{row.openPath}</span>}
              {row.urlCommand !== undefined && <span className="forward-url-command" title="打开地址命令">命令 {row.urlCommand}</span>}
              <span className="forward-holders">持有者 {row.holderCount}</span>
              {row.holders.length > 0 && <span className="forward-holder-labels">{row.holders.join(', ')}</span>}
              {row.diagnostic !== undefined && row.diagnostic !== '' && <p className="forward-diagnostic">{row.diagnostic}</p>}
            </>
          )}
        </div>
      )}
    </li>
  )
}

export function ForwardList({ device, confirm = defaultConfirm, openWindow = defaultOpenWindow }: {
  readonly device: DeviceStatusFacts
  readonly confirm?: (message: string) => boolean
  /** `window.open`, injectable for tests. Called with '' for a blank window. */
  readonly openWindow?: (url: string) => Window | null
}) {
  const [port, setPort] = useState('')
  const [label, setLabel] = useState('')
  const [sameLocalPort, setSameLocalPort] = useState(false)
  const [openPath, setOpenPath] = useState('')
  const [urlCommand, setUrlCommand] = useState('')
  const [openError, setOpenError] = useState<string | undefined>()
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
      // Empty optional fields are omitted, so re-submitting an existing port
      // keeps what it already has; the same-port switch is always explicit.
      await api.createForward(device.deviceId, devicePort, {
        ...(trimmed === '' ? {} : { label: trimmed }),
        sameLocalPort,
        ...(openPath.trim() === '' ? {} : { openPath: openPath.trim() }),
        ...(urlCommand.trim() === '' ? {} : { urlCommand: urlCommand.trim() }),
      })
      setPort('')
      setLabel('')
      setSameLocalPort(false)
      setOpenPath('')
      setUrlCommand('')
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

  /** Open a ready entry in a new browser window that holds no opener. With a
   * device command, the blank window opens synchronously (inside the click,
   * so it is not blocked as a popup) and navigates once the address resolves;
   * a failure closes it and explains in place — never the command's output. */
  const open = async (row: ForwardRow) => {
    if (row.kind !== 'additional' || row.state !== 'ready' || row.localPort === undefined) return
    setOpenError(undefined)
    if (row.urlCommand === undefined) {
      openWindow(forwardOpenUrl(row.localPort, row.openPath))
      return
    }
    const blank = openWindow('')
    if (blank !== null) blank.opener = null
    try {
      const { url } = await api.resolveForwardUrl(device.deviceId, row.devicePort)
      if (blank === null) openWindow(url)
      else blank.location.href = url
    } catch (cause) {
      blank?.close()
      setOpenError(failureText(cause))
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
          <RowView key={row.kind === 'system' ? 'system' : row.devicePort} row={row} busy={busy} onDelete={row => { void remove(row) }} onOpen={row => { void open(row) }} />
        ))}
      </ul>
      {openError !== undefined && <p className="panel-error" role="alert">{openError}</p>}
      <form className="forward-form" aria-labelledby={createHeadingId} onSubmit={event => { void create(event) }}>
        <div className="forward-form-head">
          <h4 className="forward-heading" id={createHeadingId}>添加常驻转发</h4>
          <p className="forward-form-hint">常驻条目在驾驶舱重启后仍保留；设备上的组件申请的是「随持有者」条目，随持有者释放即回收。对已有端口再次提交会更新它的选项，留空的选项保持不变。</p>
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
          <label className="forward-form-same-port">
            <input type="checkbox" checked={sameLocalPort} onChange={event => { setSameLocalPort(event.target.checked) }} disabled={busy} />
            <span>本地端口同设备端口</span>
          </label>
          <p className="forward-form-hint">用于只接受 Host 为 127.0.0.1:&lt;本端口&gt; 的面板；端口被占用时报错重试，不会换端口。每个本地端口只能被一台设备占用。</p>
          <label className="forward-form-path">
            <span>打开路径（可选）</span>
            <input value={openPath} maxLength={512} placeholder="/" onChange={event => { setOpenPath(event.target.value) }} disabled={busy} />
          </label>
          <label className="forward-form-command">
            <span>打开地址命令（可选）</span>
            <input value={urlCommand} maxLength={1024} spellCheck={false} onChange={event => { setUrlCommand(event.target.value) }} disabled={busy} />
          </label>
          <p className="forward-form-hint">配置后，「打开」会经 SSH 在设备上执行这条命令，取输出中最后一个 http://127.0.0.1:&lt;设备端口&gt; 地址打开；只在点击时执行，输出不保存。</p>
          <button className="primary-action" type="submit" disabled={busy}>添加常驻转发</button>
        </div>
        {error !== undefined && <p className="panel-error" role="alert">{error}</p>}
      </form>
    </section>
  )
}
