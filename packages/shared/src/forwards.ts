/** Per-device forward table contracts (change device-forward-registry).
 *
 * The table is the single source of truth for every `ssh -L` child the cockpit
 * owns for one device: the workbench channel is projected as a `system` row,
 * additional entries are keyed by device port. */

/** Additional entries per device (pinned and held share the cap). */
export const FORWARD_LIMIT = 8

/** Longest diagnostic kept for an entry; ssh stderr is untrusted input. */
export const FORWARD_DIAGNOSTIC_MAX = 300

export type ForwardEntryState = 'starting' | 'ready' | 'retrying' | 'paused'

/** Stable business rejection codes (HTTP 409 `{ code }`). */
export type ForwardErrorCode =
  | 'forward-limit'
  | 'reserved-port'
  | 'invalid-port'
  | 'invalid-holder'
  | 'invalid-label'
  | 'local-device'
  | 'device-unavailable'

export const FORWARD_ERROR_CODES: readonly ForwardErrorCode[] = [
  'forward-limit',
  'reserved-port',
  'invalid-port',
  'invalid-holder',
  'invalid-label',
  'local-device',
  'device-unavailable',
]

/** Opaque random identifiers: bridge instance ids and cockpit page ids. */
export const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

export function isValidOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value)
}

/** Holder labels and entry labels: 1–64 printable ASCII characters. */
export function isValidForwardLabel(value: unknown): value is string {
  return typeof value === 'string' && /^[\x20-\x7E]{1,64}$/.test(value)
}

/** The workbench channel, projected (never stored) as a table row. */
export interface SystemForwardRow {
  readonly kind: 'system'
  readonly devicePort: number
  readonly state: ForwardEntryState
  readonly localPort?: number
  readonly pid?: number
}

/** One additional entry as projected on the device status stream. `localPort`
 * and `pid` are present only while `ready`. Holder identities (page/instance
 * ids) never leave the server: only labels and the count do. */
export interface AdditionalForwardRow {
  readonly kind: 'additional'
  readonly devicePort: number
  readonly state: ForwardEntryState
  readonly pinned: boolean
  readonly label?: string
  readonly holders: readonly string[]
  readonly holderCount: number
  readonly diagnostic?: string
  readonly createdAt: number
  readonly stateChangedAt: number
  readonly localPort?: number
  readonly pid?: number
}

export type ForwardRow = SystemForwardRow | AdditionalForwardRow

export interface DeviceForwardsProjection {
  readonly rows: readonly ForwardRow[]
  readonly additionalCount: number
  readonly limit: number
}

/** Persisted pinned entry: no local port, ever. */
export interface PinnedForwardRecord {
  readonly devicePort: number
  readonly label?: string
}

/** Parent page → device iframe: this device's forward table (design D7). */
export const FORWARDS_SNAPSHOT_MESSAGE = 'dsh-cockpit:forwards-snapshot' as const
/** Device iframe → parent page: a bridge page instance ended (design D4(a)). */
export const BRIDGE_INSTANCE_ENDED_MESSAGE = 'dsh-cockpit:bridge-instance-ended' as const

/** The workbench channel as the device page sees it: no host ssh pid. */
export interface SystemForwardSnapshotRow {
  readonly kind: 'system'
  readonly devicePort: number
  readonly state: ForwardEntryState
  readonly localPort?: number
}

/** One additional entry as the device page sees it: no host ssh pid, and
 * (like the projection) no page or instance ids. `localPort` only while
 * `ready`. */
export interface AdditionalForwardSnapshotRow {
  readonly kind: 'additional'
  readonly devicePort: number
  readonly state: ForwardEntryState
  readonly pinned: boolean
  readonly label?: string
  readonly holders: readonly string[]
  readonly holderCount: number
  readonly diagnostic?: string
  readonly localPort?: number
}

export type ForwardSnapshotRow = SystemForwardSnapshotRow | AdditionalForwardSnapshotRow

export interface ForwardsSnapshot {
  readonly rows: readonly ForwardSnapshotRow[]
  readonly additionalCount: number
  readonly limit: number
}

export interface ForwardsSnapshotMessage {
  readonly type: typeof FORWARDS_SNAPSHOT_MESSAGE
  readonly snapshot: ForwardsSnapshot
}

export interface BridgeInstanceEndedMessage {
  readonly type: typeof BRIDGE_INSTANCE_ENDED_MESSAGE
  readonly instanceId: string
}

/** Reduce the status-stream projection to what the device page may see:
 * the system row and every additional entry, field by field (an allow-list, so a field added
 * to the projection later never leaks by default). */
export function toForwardsSnapshot(projection: DeviceForwardsProjection): ForwardsSnapshot {
  const rows = projection.rows.map((row): ForwardSnapshotRow => {
    const address = row.state === 'ready' && row.localPort !== undefined ? { localPort: row.localPort } : {}
    if (row.kind === 'system') return { kind: 'system', devicePort: row.devicePort, state: row.state, ...address }
    return {
      kind: 'additional',
      devicePort: row.devicePort,
      state: row.state,
      pinned: row.pinned,
      ...(row.label === undefined ? {} : { label: row.label }),
      holders: [...row.holders],
      holderCount: row.holderCount,
      ...(row.diagnostic === undefined ? {} : { diagnostic: row.diagnostic }),
      ...address,
    }
  })
  return { rows, additionalCount: projection.additionalCount, limit: projection.limit }
}
