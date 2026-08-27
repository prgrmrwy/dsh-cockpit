import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { Readable } from 'node:stream'

/** A tracked child process. */
export interface OwnedProcess {
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  stderr: Readable
  kill(signal?: NodeJS.Signals): boolean
  readonly pid: number
}

export type ProcessSpawner = (executable: string, argv: readonly string[]) => OwnedProcess

export const defaultSpawner: ProcessSpawner = (executable, argv) => {
  const child = spawn(executable, [...argv], { stdio: ['ignore', 'ignore', 'pipe'] })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
    child.once('error', () => { child.kill() ; resolve({ code: null, signal: null }) })
  })
  return { exited, stderr: child.stderr, kill: (sig?: NodeJS.Signals) => child.kill(sig), pid: child.pid ?? 0 }
}

export interface SshIdentityProbeOptions {
  readonly sshExecutable?: string
  readonly connectTimeoutSeconds?: number
  readonly stabilityMs?: number
  readonly terminateGraceMs?: number
  readonly spawn?: ProcessSpawner
}

export interface SshIdentityProbeResult {
  readonly ok: boolean
  readonly exit: { code: number | null; signal: NodeJS.Signals | null }
  readonly diagnostic: string
}

const sshAliasPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** SSH alias strictness: reject anything that could be interpreted as an option. */
export function validateSshAlias(alias: string): string {
  if (!sshAliasPattern.test(alias)) throw new Error('invalid SSH alias')
  return alias
}

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/** Graceful then forced termination of an owned child. Bounded: never waits
 * longer than graceMs for a child that refuses to settle. */
export async function terminateChild(process: OwnedProcess, graceMs: number): Promise<void> {
  let settled = false
  void process.exited.then(() => { settled = true })
  if (!settled) process.kill('SIGTERM')
  await Promise.race([process.exited.catch(() => undefined), wait(graceMs)])
  if (!settled) {
    process.kill('SIGKILL')
    // Escalate and give one more grace period; after that we return regardless.
    await Promise.race([process.exited.catch(() => undefined), wait(graceMs)])
  }
}

function identityArgs(alias: string, timeout: number): string[] {
  return ['-N', '-T', '-o', 'SessionType=none', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${timeout}`, '--', validateSshAlias(alias)]
}

/** Non-interactive identity probe. Passes only when the BatchMode session stays
 * alive through the stability window and is then cleanly terminated. */
export async function probeSshIdentity(alias: string, options: SshIdentityProbeOptions = {}): Promise<SshIdentityProbeResult> {
  const timeout = options.connectTimeoutSeconds ?? 5
  const stabilityMs = options.stabilityMs ?? 250
  const graceMs = options.terminateGraceMs ?? 1000
  const spawned = (options.spawn ?? defaultSpawner)(options.sshExecutable ?? '/usr/bin/ssh', identityArgs(alias, timeout))
  const chunks: Buffer[] = []
  let bytes = 0
  spawned.stderr.on('data', (chunk: Buffer) => {
    const remaining = 8192 - bytes
    if (remaining <= 0) return
    chunks.push(chunk.subarray(0, remaining))
    bytes += Math.min(chunk.byteLength, remaining)
  })
  const outcome = await Promise.race([
    spawned.exited.then(exit => ({ kind: 'exit' as const, exit })),
    wait(stabilityMs).then(() => ({ kind: 'stable' as const })),
  ])
  const diagnostic = Buffer.concat(chunks).toString('utf8').trim()
  if (outcome.kind === 'exit') return { ok: false, exit: outcome.exit, diagnostic }
  await terminateChild(spawned, graceMs)
  return { ok: true, exit: { code: 0, signal: null }, diagnostic }
}

/** Reserve an OS-assigned loopback port, then release it for the tunnel to bind. */
export function reserveCandidatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') return reject(new Error('loopback candidate unavailable'))
      const { port } = address
      server.close(error => (error ? reject(error) : resolve(port)))
    })
  })
}