/** Stable bridge protocol names shared by the Cockpit shell and device plugin. */
export const BRIDGE_CONFIG_MESSAGE = 'dsh-cockpit:bridge-config' as const
export const DEVICE_ACTIVATED_MESSAGE = 'dsh-cockpit:device-activated' as const
export const CAPABILITY_EXPIRED_MESSAGE = 'dsh-cockpit:capability-expired' as const

/** Stable cross-package service name. Changing it is a breaking change. */
export const COCKPIT_EDITOR_OPEN_SERVICE = 'cockpitBridge.editorOpen' as const

/** Stable cross-package service name for publishing a device-side loopback
 * port to the cockpit host. Changing it is a breaking change. */
export const COCKPIT_PORT_FORWARD_SERVICE = 'cockpitBridge.portForward' as const

/** Channel ids name one publishable service of a device. Mirrors the server's
 * accepted shape; `workbench` is reserved for the device's own DSH tunnel. */
export const PORT_FORWARD_CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function isValidPortForwardChannelId(value: unknown): value is string {
  return typeof value === 'string' && value !== 'workbench' && PORT_FORWARD_CHANNEL_PATTERN.test(value)
}

export function isValidDevicePort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}

export const SSH_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function isValidSshAlias(value: unknown): value is string {
  return typeof value === 'string' && SSH_ALIAS_PATTERN.test(value)
}

/** Accept POSIX or drive-letter absolute paths and reject traversal segments. */
export function isValidEditorPath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.includes('\0')) return false
  if (!value.startsWith('/') && !/^[A-Za-z]:[/\\]/.test(value)) return false
  return !value.replaceAll('\\', '/').split('/').includes('..')
}

export interface BridgeConfigMessage {
  readonly type: typeof BRIDGE_CONFIG_MESSAGE
  readonly cockpitOrigin: string
  readonly capability: string
  readonly sshAlias?: string
}

export interface CockpitEditorOpenService {
  /** Throws when the current bridge config/path cannot produce a remote URI. */
  open(path: string): void
}

/** One delivered forward: a host-reachable URL bound to a single device port.
 * Consumers use `url` directly and need not query the cockpit again. */
export interface PortForwardHandle {
  readonly channelId: string
  /** Origin on the cockpit host, e.g. `http://127.0.0.1:54321`. */
  readonly url: string
}

/**
 * Publish one device-side loopback port so a browser on the cockpit host can
 * reach it.
 *
 * Deliberately NOT a general tunnel: a caller declares a channel and its port,
 * and receives a handle bound to that single port.
 *
 * Failures come in two kinds, and a consumer MUST tell them apart:
 *
 * - **Unavailable** (`PortForwardUnavailableError`): there is no forward to
 *   have — the page is not inside a cockpit, or the device IS the cockpit
 *   host. The browser and the device port are on the same machine, so the
 *   consumer falls back to its own loopback address. Same outcome as when the
 *   service is absent altogether.
 * - **Rejected** (`PortForwardRejectedError`): a cockpit exists and refused or
 *   failed. The consumer MUST NOT fall back to a loopback address here — the
 *   browser is (usually) on another machine, and `localhost:<port>` would
 *   resolve there, not on the device.
 *
 * The shapes are detected structurally (by `name`/fields), never by class
 * identity: consumers live in other bundles that cannot share this module.
 */
export interface CockpitPortForwardService {
  /** Declare a device-side port publishable. Throws when unavailable. */
  register(channelId: string, devicePort: number): Promise<void>
  /** Publish a registered channel and resolve its host-reachable handle. */
  publish(channelId: string): Promise<PortForwardHandle>
}

export const PORT_FORWARD_UNAVAILABLE_ERROR = 'PortForwardUnavailableError'
export const PORT_FORWARD_REJECTED_ERROR = 'PortForwardRejectedError'

/** Why no forward can exist for this page. Stable; consumers may switch on it. */
export type PortForwardUnavailableReason = 'no-cockpit' | 'local-device'

/** "No forward to have" — consumer falls back to its own loopback address. */
export class PortForwardUnavailableError extends Error {
  override readonly name = PORT_FORWARD_UNAVAILABLE_ERROR
  readonly reason: PortForwardUnavailableReason
  constructor(reason: PortForwardUnavailableReason, message: string) {
    super(message)
    this.reason = reason
  }
}

/** The cockpit answered and said no (or could not). `code` is the cockpit's
 * stable error code when the response carried one. */
export class PortForwardRejectedError extends Error {
  override readonly name = PORT_FORWARD_REJECTED_ERROR
  readonly status: number
  readonly code: string | undefined
  constructor(status: number, code: string | undefined, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Structural check usable from any bundle. */
export function isPortForwardUnavailable(error: unknown): error is { readonly name: typeof PORT_FORWARD_UNAVAILABLE_ERROR; readonly reason: PortForwardUnavailableReason } {
  return typeof error === 'object' && error !== null
    && (error as { name?: unknown }).name === PORT_FORWARD_UNAVAILABLE_ERROR
    && typeof (error as { reason?: unknown }).reason === 'string'
}

/** Encode a validated path without allowing query/fragment delimiters through. */
export function createRemoteEditorUri(sshAlias: string, path: string): string {
  if (!isValidSshAlias(sshAlias)) throw new Error('invalid SSH alias')
  if (!isValidEditorPath(path)) throw new Error('invalid editor path')
  const normalizedPath = path.replaceAll('\\', '/')
  const authorityPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  const encodedPath = authorityPath.split('/').map((segment, index) => {
    // Keep a drive colon readable in the first path segment; encode every
    // other byte as path data, including '%' so encoded traversal text cannot
    // be decoded into a '..' segment by a downstream URI parser.
    if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment
    return encodeURIComponent(segment)
  }).join('/')
  return `vscode://vscode-remote/ssh-remote+${sshAlias}${encodedPath}?windowId=_blank`
}
