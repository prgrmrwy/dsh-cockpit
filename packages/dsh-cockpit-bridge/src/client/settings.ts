/**
 * Read-only "驾驶舱转发" settings section (device-forward-registry D9).
 *
 * Lists this device's forward table from the snapshot the cockpit parent page
 * pushes. It offers no create, delete or release control: management happens
 * in the cockpit device panel. Labels and diagnostics are rendered as React
 * text children only, never as HTML.
 */
import { createElement, useSyncExternalStore, type ReactElement } from 'react'
import type { ForwardEntryState, ForwardsSnapshot } from '@dsh-cockpit/shared'

export const SECTION_LABEL = '驾驶舱转发'

const STATE_TEXT: Record<ForwardEntryState, string> = {
  starting: '建立中',
  ready: '就绪',
  retrying: '重试中',
  paused: '暂停',
}

export interface SettingsRow {
  readonly key: string
  readonly port: string
  readonly address: string
  readonly state: string
  readonly pinned: string
  readonly holders: string
  readonly diagnostic: string
}

export type SettingsView =
  | { readonly kind: 'message'; readonly text: string }
  | {
    readonly kind: 'rows'
    readonly usage: string
    readonly hint: string
    readonly rows: readonly SettingsRow[]
    /** Always empty: the section is read-only by contract. */
    readonly controls: readonly never[]
  }

/** Pure view model: what the section shows for a handshake state and a
 * snapshot. */
export function settingsView(connected: boolean, snapshot: ForwardsSnapshot | undefined): SettingsView {
  if (!connected) return { kind: 'message', text: '未连接驾驶舱' }
  if (snapshot === undefined) return { kind: 'message', text: '正在读取转发表' }
  if (snapshot.local === true) return { kind: 'message', text: '本机设备无需转发' }
  return {
    kind: 'rows',
    usage: `${snapshot.additionalCount} / ${snapshot.limit}`,
    hint: '在驾驶舱设备面板中管理',
    rows: snapshot.rows.map(row => {
      const address = row.state === 'ready' && row.localPort !== undefined ? `127.0.0.1:${row.localPort}` : ''
      if (row.kind === 'system') {
        return { key: 'system', port: String(row.devicePort), address, state: STATE_TEXT[row.state], pinned: '系统', holders: '', diagnostic: '' }
      }
      return {
        key: String(row.devicePort),
        port: String(row.devicePort),
        address,
        state: STATE_TEXT[row.state],
        pinned: row.pinned ? '常驻' : '随持有者',
        holders: [row.label, ...row.holders].filter((value): value is string => value !== undefined && value !== '').join(', '),
        diagnostic: row.diagnostic ?? '',
      }
    }),
    controls: [],
  }
}

/** The slot's inject face: a cached view and a change subscription, shaped
 * for `useSyncExternalStore`. */
export interface SettingsInjected {
  readonly view: () => SettingsView
  readonly subscribe: (listener: () => void) => () => void
}

export function createSettingsStore(source: {
  readonly connected: () => boolean
  readonly snapshot: () => ForwardsSnapshot | undefined
}): SettingsInjected & { readonly changed: () => void } {
  const listeners = new Set<() => void>()
  let cached: SettingsView | undefined
  return {
    view: () => (cached ??= settingsView(source.connected(), source.snapshot())),
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    changed: () => {
      cached = undefined
      for (const listener of [...listeners]) listener()
    },
  }
}

const cell = (text: string) => createElement('td', null, text)

export function ForwardsSettingsSection(props: Partial<SettingsInjected>): ReactElement | null {
  const { view, subscribe } = props
  const current = useSyncExternalStore(subscribe ?? (() => () => {}), view ?? (() => undefined))
  if (current === undefined) return null
  if (current.kind === 'message') return createElement('p', null, current.text)
  return createElement('section', null,
    createElement('p', null, `附加转发占用 ${current.usage}`),
    createElement('table', null,
      createElement('thead', null, createElement('tr', null,
        ...['设备端口', '本地地址', '状态', '类型', '标签 / 持有者', '诊断'].map(title => createElement('th', { key: title }, title)))),
      createElement('tbody', null, ...current.rows.map(row => createElement('tr', { key: row.key },
        cell(row.port), cell(row.address), cell(row.state), cell(row.pinned), cell(row.holders), cell(row.diagnostic))))),
    createElement('p', null, current.hint))
}
