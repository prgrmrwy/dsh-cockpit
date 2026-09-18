/** Stable bridge protocol names shared by the Cockpit shell and device plugin. */
export const BRIDGE_CONFIG_MESSAGE = 'dsh-cockpit:bridge-config' as const
export const DEVICE_ACTIVATED_MESSAGE = 'dsh-cockpit:device-activated' as const
export const CAPABILITY_EXPIRED_MESSAGE = 'dsh-cockpit:capability-expired' as const

/** Stable cross-package service name. Changing it is a breaking change. */
export const COCKPIT_EDITOR_OPEN_SERVICE = 'cockpitBridge.editorOpen' as const

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
