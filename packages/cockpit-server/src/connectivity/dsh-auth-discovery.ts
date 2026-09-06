import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, type Readable } from 'node:stream'
import { parseDshLaunchUrl } from './dsh-auth.js'
import { validateSshAlias } from './ssh.js'

export const DSH_LOG_TAIL_BYTES = 64 * 1024
export const DSH_LOG_MAX_LINES = 512
export const DSH_LOG_READ_BYTES = DSH_LOG_TAIL_BYTES + 1
const LAUNCH_URL_CANDIDATE = /http:\/\/127\.0\.0\.1:\d{1,5}\/\?token=\S+/gu

export type DshAuthDiscoveryFailure =
  | 'cancelled'
  | 'command-failed'
  | 'invalid-alias'
  | 'invalid-output'
  | 'output-too-large'
  | 'source-unavailable'
  | 'source-unsafe'
  | 'timed-out'

export type DshAuthDiscoveryResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: DshAuthDiscoveryFailure }

/** Parse only complete lines from an already bounded log tail. Candidates are
 * considered newest-to-oldest and validated by the same strict parser used for
 * manually supplied launch URLs. */
export function parseDshLaunchTokenTail(tail: string, remoteDshPort: number): string | undefined {
  const bounded = Buffer.from(tail).subarray(-DSH_LOG_TAIL_BYTES).toString('utf8')
  const lines = bounded.split(/\r?\n/u).slice(-DSH_LOG_MAX_LINES)
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines[lineIndex]!
    const candidates = [...line.matchAll(LAUNCH_URL_CANDIDATE)].map(match => match[0])
    for (let candidateIndex = candidates.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      try {
        return parseDshLaunchUrl(candidates[candidateIndex]!, remoteDshPort)
      } catch {
        // A malformed, stale-port, or non-root candidate is not authoritative.
      }
    }
  }
  return undefined
}

function completeBoundedTail(bytes: Buffer): string {
  let bounded = bytes
  if (bytes.byteLength > DSH_LOG_TAIL_BYTES) {
    bounded = bytes.subarray(bytes.byteLength - DSH_LOG_TAIL_BYTES)
    const firstNewline = bounded.indexOf(0x0a)
    bounded = firstNewline < 0 ? Buffer.alloc(0) : bounded.subarray(firstNewline + 1)
  }
  return bounded.toString('utf8')
}

export interface LocalDshAuthDiscoveryOptions {
  readonly dshHome?: string
  readonly home?: string
  readonly env?: NodeJS.ProcessEnv
  readonly signal?: AbortSignal
}

/** Read exactly the standard ohmydsh log. lstat plus O_NOFOLLOW (where Node's
 * platform constants expose it) rejects a symlink at the final path. */
export async function discoverLocalDshLaunchToken(
  remoteDshPort: number,
  options: LocalDshAuthDiscoveryOptions = {},
): Promise<DshAuthDiscoveryResult> {
  if (options.signal?.aborted === true) return { ok: false, reason: 'cancelled' }
  const env = options.env ?? process.env
  const dshHome = options.dshHome ?? env.DSH_HOME ?? join(options.home ?? env.HOME ?? homedir(), '.dsh')
  const logPath = join(dshHome, 'dsh.log')
  let handle
  try {
    const stat = await lstat(logPath)
    if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, reason: 'source-unsafe' }
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    handle = await open(logPath, fsConstants.O_RDONLY | noFollow)
    const opened = await handle.stat()
    if (!opened.isFile()) return { ok: false, reason: 'source-unsafe' }
    const length = Math.min(opened.size, DSH_LOG_READ_BYTES)
    const bytes = Buffer.alloc(length)
    await handle.read(bytes, 0, length, Math.max(0, opened.size - length))
    if (options.signal?.aborted ?? false) return { ok: false, reason: 'cancelled' }
    const token = parseDshLaunchTokenTail(completeBoundedTail(bytes), remoteDshPort)
    return token === undefined ? { ok: false, reason: 'invalid-output' } : { ok: true, token }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ELOOP') return { ok: false, reason: 'source-unsafe' }
    return { ok: false, reason: 'source-unavailable' }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** This script is deliberately constant: callers can select only a validated
 * SSH alias, never a path, command, pattern, or shell fragment. */
export const OHMYDSH_REMOTE_READ_SCRIPT = `set -eu
dsh_home=\${DSH_HOME:-"$HOME/.dsh"}
log="$dsh_home/dsh.log"
[ -f "$log" ] && [ ! -L "$log" ] || exit 44
tail -c ${DSH_LOG_READ_BYTES} -- "$log"`
const OHMYDSH_REMOTE_COMMAND = `sh -c '${OHMYDSH_REMOTE_READ_SCRIPT}'`

export interface DiscoveryProcess {
  readonly stdout: Readable
  readonly stderr: Readable
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  kill(signal?: NodeJS.Signals): boolean
}

export type DiscoveryProcessSpawner = (executable: string, argv: readonly string[]) => DiscoveryProcess

const defaultDiscoverySpawner: DiscoveryProcessSpawner = (executable, argv) => {
  const child = spawn(executable, [...argv], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  child.stdout.pipe(stdout)
  child.stderr.pipe(stderr)
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal }))
    child.once('error', () => resolve({ code: null, signal: null }))
  })
  return { stdout, stderr, exited, kill: signal => child.kill(signal) }
}

export interface RemoteDshAuthDiscoveryOptions {
  readonly sshExecutable?: string
  readonly connectTimeoutSeconds?: number
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly spawn?: DiscoveryProcessSpawner
}

function remoteReadArgs(alias: string, connectTimeoutSeconds: number): string[] {
  return [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${connectTimeoutSeconds}`,
    '--', validateSshAlias(alias),
    OHMYDSH_REMOTE_COMMAND,
  ]
}

/** Run the fixed read-only log tail over system OpenSSH. All process details and
 * output stay local to this function; callers receive only a token or enum. */
export async function discoverRemoteDshLaunchToken(
  sshAlias: string,
  remoteDshPort: number,
  options: RemoteDshAuthDiscoveryOptions = {},
): Promise<DshAuthDiscoveryResult> {
  if (options.signal?.aborted === true) return { ok: false, reason: 'cancelled' }
  let argv: string[]
  try {
    argv = remoteReadArgs(sshAlias, options.connectTimeoutSeconds ?? 5)
  } catch {
    return { ok: false, reason: 'invalid-alias' }
  }

  let child: DiscoveryProcess
  try {
    child = (options.spawn ?? defaultDiscoverySpawner)(options.sshExecutable ?? 'ssh', argv)
  } catch {
    return { ok: false, reason: 'command-failed' }
  }
  child.stderr.resume()
  const chunks: Buffer[] = []
  let bytes = 0
  let overflow = false
  child.stdout.on('data', (chunk: Buffer | string) => {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += value.byteLength
    if (bytes > DSH_LOG_READ_BYTES) {
      overflow = true
      child.kill('SIGKILL')
      return
    }
    chunks.push(value)
  })

  let finish!: (reason: 'cancelled' | 'timed-out') => void
  const interrupted = new Promise<'cancelled' | 'timed-out'>(resolve => { finish = resolve })
  const timer = setTimeout(() => finish('timed-out'), options.timeoutMs ?? 8_000)
  const abort = () => finish('cancelled')
  options.signal?.addEventListener('abort', abort, { once: true })
  const outcome = await Promise.race([
    child.exited.then(exit => ({ kind: 'exit' as const, exit })),
    interrupted.then(reason => ({ kind: reason })),
  ])
  clearTimeout(timer)
  options.signal?.removeEventListener('abort', abort)

  if (outcome.kind !== 'exit') {
    child.kill('SIGTERM')
    const terminated = await Promise.race([
      child.exited.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 250)),
    ])
    if (!terminated) {
      child.kill('SIGKILL')
      await Promise.race([
        child.exited,
        new Promise(resolve => setTimeout(resolve, 1_000)),
      ])
    }
    return { ok: false, reason: outcome.kind }
  }
  if (overflow) return { ok: false, reason: 'output-too-large' }
  if (outcome.exit.code !== 0) return { ok: false, reason: 'command-failed' }
  const token = parseDshLaunchTokenTail(completeBoundedTail(Buffer.concat(chunks)), remoteDshPort)
  return token === undefined ? { ok: false, reason: 'invalid-output' } : { ok: true, token }
}
