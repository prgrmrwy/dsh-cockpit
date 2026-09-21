/** Device category. Local devices need no tunnel; remote devices are reached
 * through an owned localhost SSH forward. */
export type DeviceKind = 'local' | 'remote'

/** Connection-layer states, driven by the connectivity layer only. */
export type DeviceState =
  | 'DISABLED'
  | 'SSH_UNREACHABLE'
  | 'TUNNEL_ERROR'
  | 'DSH_UNAVAILABLE'
  | 'NON_DSH_SERVICE'
  | 'INCOMPATIBLE'
  | 'CONNECTING'
  | 'READY'
  | 'DEGRADED'

export type DshAuthState = 'not-configured' | 'ready' | 'recovery-required'
export type DshAuthDiscovery = 'disabled' | 'ohmydsh-log'

/** Private DSH browser-session material. Never project this object wholesale
 * into a read API. */
export interface DshAuthMaterial {
  readonly version: 1
  readonly launchToken?: string
  readonly serverCookie?: string
  readonly cookieAuthority?: string
  readonly cookieExpiresAt?: number
  readonly autoDiscovery: DshAuthDiscovery
  readonly updatedAt: number
  readonly generation: number
}

/** A device record as persisted by the registry. */
export interface DeviceRecord {
  readonly deviceId: string
  readonly displayName: string
  readonly kind: DeviceKind
  readonly sshAlias?: string
  readonly remoteDshPort: number
  /** Local forward port of this device's WORKBENCH tunnel, persisted so the
   * workbench iframe origin stays stable across reconnects. Additional
   * channels (see the port-forward capability) are deliberately NOT recorded
   * here: their consumers read the URL from a freshly delivered handle every
   * time, so they have no cross-reconnect origin dependency, and persisting
   * them would only widen the reserved-port surface. */
  readonly localPort?: number
  /** Legacy DSH 0.1.2 process launch token. Accepted on read for migration. */
  readonly dshLaunchToken?: string
  /** Versioned private browser-session material. */
  readonly dshAuth?: DshAuthMaterial
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
  readonly sshAlias?: string
  readonly remoteDshPort: number
  readonly enabled: boolean
  readonly order: number
  readonly state: DeviceState
  readonly runningSessionCount: number
  readonly pendingInteractionCount: number
  /** Whether the current protocol source can authoritatively observe pending
   * approval/question state. */
  readonly pendingInteractionObservability: 'available' | 'unavailable'
  /** Official session-row status groups, non-zero only, ordered by official
   * priority (pending warning first, then active work). */
  readonly sessionStatuses: readonly SessionActivitySummary[]
  /** Epoch ms of the last bridge hello from this device's DSH web client
   * (the dsh-cockpit-bridge plugin); undefined = plugin not seen yet. */
  readonly bridgeSeenAt?: number
  readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
  readonly lastUpdatedAt: number
  readonly diagnostic?: string
  readonly endpoint?: string
  /** Non-sensitive DSH browser-auth projection. */
  readonly dshAuthConfigured: boolean
  readonly dshAuthState: DshAuthState
  readonly dshAuthAutoDiscovery: boolean
  readonly dshAuthGeneration: number
  readonly dshAuthExpiresAt?: number
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
  | { readonly type: 'interaction'; readonly deviceId: string; readonly sessionId: string; readonly kind: 'approval' | 'question'; readonly rpcId: string; readonly resolved: boolean }
  | { readonly type: 'session-added'; readonly deviceId: string; readonly sessionId?: string; readonly origin?: 'subagent' }
  /** Full authoritative archive set after a durable archive/restore change. */
  | { readonly type: 'archived-sessions-changed'; readonly deviceId: string; readonly archivedSessionIds: readonly string[] }
  /** Authoritative permanent removal, distinct from archive visibility. */
  | { readonly type: 'session-removed'; readonly deviceId: string; readonly sessionId: string }

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
  /** Full loopback URL printed by DSH 0.1.2; accepted write-only. */
  readonly dshLaunchUrl?: string
  /** Explicit opt-in to bounded ohmydsh log discovery. Defaults false. */
  readonly dshAuthAutoDiscovery?: boolean
}

export interface UpdateDeviceRequest {
  readonly displayName?: string
  readonly sshAlias?: string
  readonly remoteDshPort?: number
  readonly enabled?: boolean
  readonly order?: number
  /** Full loopback URL printed by DSH 0.1.2; accepted write-only. */
  readonly dshLaunchUrl?: string
  /** Explicitly removes all previously stored DSH auth material. */
  readonly clearDshLaunchToken?: boolean
  /** Enables the fixed, bounded ohmydsh log recovery adapter for this device. */
  readonly dshAuthAutoDiscovery?: boolean
}

export interface RemoveDeviceRequest {
  readonly deviceId: string
  readonly confirmed: boolean
}

export interface ApiError {
  readonly code: string
  readonly message: string
}
export * from './bridge.js'
