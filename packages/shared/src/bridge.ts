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
 * and receives a handle bound to that single port. The consuming plugin must
 * treat an absent service, or any rejection, as "no forward available" and
 * fall back to its own loopback address — that is the normal state whenever
 * the page is not running inside a cockpit.
 */
export interface CockpitPortForwardService {
  /** Declare a device-side port publishable. Throws when unavailable. */
  register(channelId: string, devicePort: number): Promise<void>
  /** Publish a registered channel and resolve its host-reachable handle. */
  publish(channelId: string): Promise<PortForwardHandle>
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
