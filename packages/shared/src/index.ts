/** Device category. Local devices need no tunnel; remote devices are reached
 * through an owned localhost SSH forward. */
export type DeviceKind = 'local' | 'remote'

/** Connection-layer states, driven by the connectivity layer only. */
export type DeviceState =
  | 'SSH_UNREACHABLE'
  | 'TUNNEL_ERROR'
  | 'DSH_UNAVAILABLE'
  | 'NON_DSH_SERVICE'
  | 'INCOMPATIBLE'
  | 'CONNECTING'
  | 'READY'
  | 'DEGRADED'

/** A device record as persisted by the registry. */
export interface DeviceRecord {
  readonly deviceId: string
  readonly displayName: string
  readonly kind: DeviceKind
  readonly sshAlias?: string
  readonly remoteDshPort: number
  readonly localPort?: number
  readonly enabled: boolean
  readonly order: number
}

/** Live per-device connection facts. Endpoint is the loopback URL. */
export interface DeviceConnectionStatus {
  readonly state: DeviceState
  readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
  readonly diagnostic: string
  readonly endpoint?: string
  readonly lastUpdatedAt: number
}

/** Official session-row status families (dsh-client-ui-workspace
 * sessionStatuses): warning = pending human interaction, ongoing = active
 * work, done = completed/idle. The cockpit reuses the official vocabulary and
 * ordering — no new states or homegrown mappings. */
export type SessionActivityState = 'ongoing' | 'warning' | 'done'

/** Which official status a summary group represents. */
export type SessionActivityKind = 'running' | 'approval' | 'question' | 'completed'

/** One non-zero session-status group of a device, e.g. { running ×N }. */
export interface SessionActivitySummary {
  readonly state: SessionActivityState
  readonly kind: SessionActivityKind
  readonly count: number
}

/** Aggregated status the shell renders on the top bar. */
export interface DeviceStatusFacts {
  readonly deviceId: string
  readonly displayName: string
  readonly kind: DeviceKind
  readonly enabled: boolean
  readonly order: number
  readonly state: DeviceState
  readonly runningSessionCount: number
  readonly pendingInteractionCount: number
  readonly outcomeUnknownCount: number
  /** Official session-row status groups, non-zero only, ordered by official
   * priority (pending warning first, then active work). */
  readonly sessionStatuses: readonly SessionActivitySummary[]
  readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
  readonly lastUpdatedAt: number
  readonly diagnostic?: string
  readonly endpoint?: string
}

/** One session status as reported by the remote rc.2 session.list / events. */
export interface SessionStatusEvent {
  readonly sessionId: string
  readonly running: boolean
}

/** Pending human interaction surfaced by remote events (approval/question). */
export interface PendingInteractionEvent {
  readonly sessionId: string
  readonly kind: 'approval' | 'question'
  readonly rpcId: string
}

/** Aggregated baseline snapshot for one device (from session.list). */
export interface DeviceBaseline {
  readonly deviceId: string
  readonly runningSessions: number
  readonly totalSessions: number
  readonly updatedAt: number
}

/** Event kinds the cockpit consumes from the official mux/host streams. */
export type CockpitEvent =
  | { readonly type: 'session-status'; readonly deviceId: string; readonly sessionId: string; readonly running: boolean }
  | { readonly type: 'interaction'; readonly deviceId: string; readonly kind: 'approval' | 'question'; readonly rpcId: string; readonly resolved: boolean }
  | { readonly type: 'session-added'; readonly deviceId: string }
  | { readonly type: 'session-removed'; readonly deviceId: string }

/** REST API responses exposed by cockpit-local. */
export interface DevicesResponse {
  readonly devices: readonly DeviceStatusFacts[]
}

export interface DeviceDetailResponse {
  readonly device: DeviceStatusFacts
}

export interface AddDeviceRequest {
  readonly displayName: string
  /** Kind of device; remote requires sshAlias, local targets the loopback port directly. */
  readonly kind?: 'local' | 'remote'
  readonly sshAlias?: string
  readonly remoteDshPort: number
  readonly enabled?: boolean
}

export interface UpdateDeviceRequest {
  readonly displayName?: string
  readonly sshAlias?: string
  readonly remoteDshPort?: number
  readonly enabled?: boolean
}

export interface RemoveDeviceRequest {
  readonly deviceId: string
  readonly confirmed: boolean
}

export interface ApiError {
  readonly code: string
  readonly message: string
}