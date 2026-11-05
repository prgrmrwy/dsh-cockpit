import type { ForwardOpenErrorCode } from '@dsh-cockpit/shared'
import { defaultDiscoverySpawner, type DiscoveryProcess, type DiscoveryProcessSpawner } from './dsh-auth-discovery.js'
import { validateSshAlias } from './ssh.js'

/** Open-address resolution for a pinned forward (change
 * forward-fixed-port-open, design D6). The command and its output may carry a
 * token, so nothing here logs: callers receive only a URL or a stable code. */

export const URL_COMMAND_TIMEOUT_MS = 10_000
export const URL_COMMAND_MAX_BYTES = 64 * 1024

/** A failed resolution (HTTP 409 `{ code }`). */
export class ForwardOpenFailure extends Error {
  constructor(readonly code: ForwardOpenErrorCode) {
    super(code)
    this.name = 'ForwardOpenFailure'
  }
}

/** Punctuation a log line may wrap a URL in, never part of the address. */
const TRAILING_PUNCTUATION = /[).,;\]]+$/u

/** The LAST URL in `stdout` whose origin is exactly
 * `http://127.0.0.1:<devicePort>`, with its port swapped for the entry's
 * current local port. Every candidate is re-validated by the URL parser. */
export function extractOpenUrl(stdout: string, devicePort: number, localPort: number): string | undefined {
  const pattern = new RegExp(`http://127\\.0\\.0\\.1:${devicePort}(?:[/?#][^\\s"'<>]*)?(?![0-9])`, 'gu')
  const candidates = [...stdout.matchAll(pattern)].map(match => match[0].replace(TRAILING_PUNCTUATION, ''))
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    let url: URL
    try {
      url = new URL(candidates[index]!)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== String(devicePort)) continue
    url.port = String(localPort)
    return url.toString()
  }
  return undefined
}

export interface UrlCommandOptions {
  readonly sshExecutable?: string
  readonly spawn?: DiscoveryProcessSpawner
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

/** Run the user's command on the device over BatchMode OpenSSH (stdin
 * closed, `shell: false` locally; the device's login shell interprets the
 * command) and resolve the open address from its stdout. stderr is drained
 * and discarded. */
export async function resolveUrlByCommand(
  sshAlias: string,
  command: string,
  devicePort: number,
  localPort: number,
  options: UrlCommandOptions = {},
): Promise<string> {
  const argv = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', validateSshAlias(sshAlias), command]
  const maxBytes = options.maxBytes ?? URL_COMMAND_MAX_BYTES
  let child: DiscoveryProcess
  try {
    child = (options.spawn ?? defaultDiscoverySpawner)(options.sshExecutable ?? 'ssh', argv)
  } catch {
    throw new ForwardOpenFailure('url-command-failed')
  }
  child.stderr.resume()
  const chunks: Buffer[] = []
  let bytes = 0
  let overflow = false
  child.stdout.on('data', (chunk: Buffer | string) => {
    if (overflow) return
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += value.byteLength
    if (bytes > maxBytes) {
      overflow = true
      child.kill('SIGKILL')
      return
    }
    chunks.push(value)
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), options.timeoutMs ?? URL_COMMAND_TIMEOUT_MS) })
  const outcome = await Promise.race([child.exited, timedOut])
  clearTimeout(timer)
  if (outcome === 'timeout') {
    child.kill('SIGKILL')
    await Promise.race([child.exited, new Promise(resolve => setTimeout(resolve, 1_000))])
    throw new ForwardOpenFailure('url-command-timed-out')
  }
  if (overflow) throw new ForwardOpenFailure('url-command-output-too-large')
  if (outcome.code !== 0) throw new ForwardOpenFailure('url-command-failed')
  const url = extractOpenUrl(Buffer.concat(chunks).toString('utf8'), devicePort, localPort)
  if (url === undefined) throw new ForwardOpenFailure('url-command-no-url')
  return url
}
