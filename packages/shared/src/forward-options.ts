/** Pinned-entry open options (change forward-fixed-port-open). Kept apart from
 * `forwards.ts` so the device-side bridge bundle, which inlines that module,
 * does not change. */

/** Rejections only the cockpit panel's create endpoint can raise (HTTP 409);
 * the bridge acquire seam never returns them. */
export type ForwardPinErrorCode = 'local-port-conflict' | 'invalid-open-path' | 'invalid-url-command'

/** Failures of resolving an entry's open address (HTTP 409 `{ code }`). */
export type ForwardOpenErrorCode =
  | 'forward-not-ready'
  | 'url-command-failed'
  | 'url-command-timed-out'
  | 'url-command-no-url'
  | 'url-command-output-too-large'

export const FORWARD_OPEN_PATH_MAX = 512
export const FORWARD_URL_COMMAND_MAX = 1024

/** A path (with optional query/fragment) appended to `http://127.0.0.1:<port>`:
 * leading `/`, no spaces or control characters. */
export function isValidOpenPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/[\x21-\x7E]*$/.test(value) && value.length <= FORWARD_OPEN_PATH_MAX
}

/** A single-line device command: printable ASCII, no newline or tab. */
export function isValidUrlCommand(value: unknown): value is string {
  return typeof value === 'string' && /^[\x20-\x7E]+$/.test(value) && value.length <= FORWARD_URL_COMMAND_MAX
}

/** The address an entry opens at when it has no URL command. */
export function forwardOpenUrl(localPort: number, openPath?: string): string {
  return `http://127.0.0.1:${localPort}${openPath ?? '/'}`
}
