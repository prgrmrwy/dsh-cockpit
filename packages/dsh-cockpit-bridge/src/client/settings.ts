/**
 * Read-only “驾驶舱转发” settings section (device-forward-registry D9).
 *
 * Lists this device's forward table from the snapshot the cockpit parent page
 * pushes. It offers no create, delete or release control: management happens
 * in the cockpit device panel. Labels and diagnostics are rendered as React
 * text children only, never as HTML.
 *
 * The reader may not be the person operating the cockpit, so the section says
 * what it is showing before it shows it: the tunnels are the cockpit's, the
 * local address is only valid on the machine running the cockpit, and the
 * controls live in the cockpit's device panel. `settingsView` holds that copy
 * as data, which is what the bridge's node-only tests assert.
 *
 * Presentation lives in `settings-styles.ts` (the host owns the theme).
 */
import { createElement, useSyncExternalStore, type ReactElement } from 'react'
import type { ForwardEntryState, ForwardsSnapshot } from '@dsh-cockpit/shared'
import { SECTION_ATTRIBUTE } from './settings-styles.js'

export const SECTION_LABEL = '驾驶舱转发'

const STATE_TEXT: Record<ForwardEntryState, string> = {
  starting: '建立中',
  ready: '就绪',
  retrying: '重试中',
  paused: '暂停',
}

const LEDE = '驾驶舱为这台设备建立的回环转发。表中的本地地址只在运行驾驶舱的那台机器上有效。'
const HINT = '创建与删除在驾驶舱设备面板中进行；本页只读。'
const EMPTY_GUIDANCE = '还没有附加转发。设备上的组件申请转发，或在驾驶舱设备面板中添加常驻条目后，会出现在这里。'
const NOT_CONNECTED_TITLE = '未连接驾驶舱'
const NOT_CONNECTED_GUIDANCE = [
  '这个区块只在设备页面运行于驾驶舱工作台内时才会填充。',
  '在驾驶舱里打开这台设备，就能在这里看到它的转发表。',
]
const READING_TITLE = '正在读取转发表'
const LOCAL_TITLE = '本机设备无需转发'
const LOCAL_GUIDANCE = ['驾驶舱与这台 DSH 在同一台机器上，设备上的组件直接访问本地地址即可，不需要经过 SSH 隧道。']

/** How the row is drawn: the main channel is not an additional entry, and it
 * cannot be deleted. */
export type SettingsRowKind = 'main' | 'additional'

export interface SettingsRow {
  readonly key: string
  readonly kind: SettingsRowKind
  /** Device port. */
  readonly port: string
  /** Loopback address on the cockpit host, empty until the entry is ready. */
  readonly address: string
  readonly state: string
  readonly stateKind: ForwardEntryState
  /** 主通道 / 常驻 / 随持有者. */
  readonly lifetime: string
  readonly holders: string
  readonly diagnostic: string
}

export type SettingsView =
  | { readonly kind: 'message'; readonly title: string; readonly guidance: readonly string[] }
  | {
    readonly kind: 'rows'
    readonly lede: string
    readonly main: readonly SettingsRow[]
    readonly additional: readonly SettingsRow[]
    readonly usage: { readonly count: number; readonly limit: number }
    readonly emptyGuidance: string
    readonly hint: string
    /** Always empty: the section is read-only by contract. */
    readonly controls: readonly never[]
  }

function additionalRow(row: ForwardsSnapshot['rows'][number]): SettingsRow {
  const address = row.state === 'ready' && row.localPort !== undefined ? `127.0.0.1:${row.localPort}` : ''
  if (row.kind === 'system') {
    return {
      key: 'system',
      kind: 'main',
      port: String(row.devicePort),
      address,
      state: STATE_TEXT[row.state],
      stateKind: row.state,
      lifetime: '主通道',
      holders: '',
      diagnostic: '',
    }
  }
  return {
    key: String(row.devicePort),
    kind: 'additional',
    port: String(row.devicePort),
    address,
    state: STATE_TEXT[row.state],
    stateKind: row.state,
    lifetime: row.pinned ? '常驻' : '随持有者',
    // Labels are untrusted text; they are joined, never parsed.
    holders: [row.label, ...row.holders].filter((value): value is string => value !== undefined && value !== '').join(', '),
    diagnostic: row.diagnostic ?? '',
  }
}

/** Pure view model: what the section shows for a handshake state and a
 * snapshot. */
export function settingsView(connected: boolean, snapshot: ForwardsSnapshot | undefined): SettingsView {
  if (!connected) return { kind: 'message', title: NOT_CONNECTED_TITLE, guidance: NOT_CONNECTED_GUIDANCE }
  if (snapshot === undefined) return { kind: 'message', title: READING_TITLE, guidance: [] }
  if (snapshot.local === true) return { kind: 'message', title: LOCAL_TITLE, guidance: LOCAL_GUIDANCE }
  const rows = snapshot.rows.map(additionalRow)
  return {
    kind: 'rows',
    lede: LEDE,
    main: rows.filter(row => row.kind === 'main'),
    additional: rows.filter(row => row.kind === 'additional'),
    usage: { count: snapshot.additionalCount, limit: snapshot.limit },
    emptyGuidance: EMPTY_GUIDANCE,
    hint: HINT,
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

/** Eight slots is the whole point of the meter, so an implausible limit simply
 * loses the meter rather than drawing a wall of segments. */
function meter(usage: { readonly count: number; readonly limit: number }): ReactElement | undefined {
  if (!Number.isInteger(usage.limit) || usage.limit < 1 || usage.limit > 24) return undefined
  const filled = Math.max(0, Math.min(usage.count, usage.limit))
  return createElement('span', { className: 'dshcf-meter', 'aria-hidden': 'true' },
    ...Array.from({ length: usage.limit }, (_, index) =>
      createElement('span', { className: 'dshcf-seg', key: index, 'data-filled': index < filled ? 'true' : 'false' })))
}

/** The section root carries the marker the stylesheet is scoped to. */
function sectionProps(): Record<string, string> {
  return { className: 'dshcf', [SECTION_ATTRIBUTE]: '' }
}

function rowElement(row: SettingsRow): ReactElement {
  return createElement('li', {
    className: 'dshcf-row',
    key: row.key,
    'data-kind': row.kind,
    'data-state': row.stateKind,
  },
  createElement('span', { className: 'dshcf-port' }, row.port),
  createElement('span', { className: 'dshcf-arrow', 'aria-hidden': 'true' }, '→'),
  createElement('span', { className: 'dshcf-address' }, row.address === '' ? '尚未就绪' : row.address),
  createElement('span', { className: 'dshcf-state' }, row.state),
  createElement('span', { className: 'dshcf-life' }, row.lifetime),
  ...(row.holders === '' ? [] : [createElement('span', { className: 'dshcf-holders' }, row.holders)]),
  ...(row.diagnostic === '' ? [] : [createElement('p', { className: 'dshcf-diag' },
    createElement('span', { className: 'dshcf-diag-label' }, '诊断'),
    createElement('span', null, row.diagnostic))]))
}

export function ForwardsSettingsSection(props: Partial<SettingsInjected>): ReactElement | null {
  const { view, subscribe } = props
  const current = useSyncExternalStore(subscribe ?? (() => () => {}), view ?? (() => undefined))
  if (current === undefined) return null
  if (current.kind === 'message') {
    return createElement('section', sectionProps(),
      createElement('p', { className: 'dshcf-title' }, current.title),
      ...current.guidance.map((text, index) => createElement('p', { className: 'dshcf-guidance', key: index }, text)))
  }
  const meterElement = meter(current.usage)
  /* The pool sits under its own meter, so the rows below the rule are exactly
     the ones the count governs. The main channel stays above it: it is not part
     of the pool and cannot be deleted. */
  return createElement('section', sectionProps(),
    createElement('p', { className: 'dshcf-lede' }, current.lede),
    ...(current.main.length === 0 ? [] : [createElement('ul', { className: 'dshcf-rows', key: 'main' },
      ...current.main.map(rowElement))]),
    createElement('div', { className: 'dshcf-pool' },
      createElement('div', { className: 'dshcf-usage' },
        createElement('span', { className: 'dshcf-usage-label' }, '附加转发'),
        ...(meterElement === undefined ? [] : [meterElement]),
        createElement('span', { className: 'dshcf-usage-count' }, `${current.usage.count} / ${current.usage.limit}`)),
      ...(current.additional.length === 0
        ? [createElement('p', { className: 'dshcf-empty', key: 'empty' }, current.emptyGuidance)]
        : [createElement('ul', { className: 'dshcf-rows', key: 'additional' }, ...current.additional.map(rowElement))])),
    createElement('p', { className: 'dshcf-hint' }, current.hint))
}
