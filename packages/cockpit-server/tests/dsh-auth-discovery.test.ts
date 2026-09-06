import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  DSH_LOG_READ_BYTES,
  DSH_LOG_TAIL_BYTES,
  OHMYDSH_REMOTE_READ_SCRIPT,
  discoverLocalDshLaunchToken,
  discoverRemoteDshLaunchToken,
  parseDshLaunchTokenTail,
  type DiscoveryProcess,
} from '../src/connectivity/dsh-auth-discovery.js'

const OLD_TOKEN = 'oldtokenabcdefgh'
const NEW_TOKEN = 'newtokenabcdefgh'
const OTHER_TOKEN = 'othertokenabcdefg'

class FakeDiscoveryProcess implements DiscoveryProcess {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly signals: NodeJS.Signals[] = []
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  #resolveExit!: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void

  constructor() {
    this.exited = new Promise(resolve => { this.#resolveExit = resolve })
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal)
    return true
  }

  finish(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.stdout.end()
    this.stderr.end()
    this.#resolveExit({ code, signal })
  }
}

function launch(port: number, token: string): string {
  return `http://127.0.0.1:${port}/?token=${token}`
}

describe('parseDshLaunchTokenTail', () => {
  it('selects the newest valid registered-port URL and returns only its token', () => {
    const tail = [
      `older ${launch(3081, OLD_TOKEN)}`,
      `wrong port ${launch(3082, OTHER_TOKEN)}`,
      'malformed http://127.0.0.1:3081/not-root?token=not-a-token',
      `newest ${launch(3081, NEW_TOKEN)}`,
    ].join('\n')
    expect(parseDshLaunchTokenTail(tail, 3081)).toBe(NEW_TOKEN)
  })

  it('rejects duplicate parameters, non-loopback hosts, and truncated URLs', () => {
    const tail = [
      `http://localhost:3081/?token=${NEW_TOKEN}`,
      `${launch(3081, NEW_TOKEN)}&token=${OLD_TOKEN}`,
      launch(3081, NEW_TOKEN).slice(0, -4),
    ].join('\n')
    expect(parseDshLaunchTokenTail(tail, 3081)).toBeUndefined()
  })

  it('ignores an incomplete first line when bounding an oversized tail', () => {
    const hidden = launch(3081, OLD_TOKEN)
    const oversized = `${hidden}${'x'.repeat(DSH_LOG_TAIL_BYTES)}\n${launch(3081, NEW_TOKEN)}\n`
    expect(parseDshLaunchTokenTail(oversized, 3081)).toBe(NEW_TOKEN)
  })

  it('bounds the number of newest lines considered', () => {
    const old = `${launch(3081, OLD_TOKEN)}\n`
    const newerNoise = 'nothing useful\n'.repeat(513)
    expect(parseDshLaunchTokenTail(old + newerNoise, 3081)).toBeUndefined()
  })
})

describe('local ohmydsh auth discovery', () => {
  it('reads only the fixed dsh.log beneath the configured DSH home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cockpit-discovery-'))
    const dshHome = join(root, 'dsh-home')
    await mkdir(dshHome)
    await writeFile(join(dshHome, 'other.log'), launch(3081, OLD_TOKEN))
    await writeFile(join(dshHome, 'dsh.log'), `old ${launch(3081, OLD_TOKEN)}\nnew ${launch(3081, NEW_TOKEN)}\n`)
    await expect(discoverLocalDshLaunchToken(3081, { dshHome })).resolves.toEqual({ ok: true, token: NEW_TOKEN })
    await expect(discoverLocalDshLaunchToken(3081, { env: { DSH_HOME: dshHome } })).resolves.toEqual({ ok: true, token: NEW_TOKEN })
  })

  it('fails closed for missing, rotated-only, and symlinked logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cockpit-discovery-'))
    await writeFile(join(root, 'dsh.log.1'), launch(3081, NEW_TOKEN))
    await expect(discoverLocalDshLaunchToken(3081, { dshHome: root })).resolves.toEqual({ ok: false, reason: 'source-unavailable' })
    await writeFile(join(root, 'target.log'), launch(3081, NEW_TOKEN))
    await symlink(join(root, 'target.log'), join(root, 'dsh.log'))
    await expect(discoverLocalDshLaunchToken(3081, { dshHome: root })).resolves.toEqual({ ok: false, reason: 'source-unsafe' })
  })

  it('honors cancellation without reading', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(discoverLocalDshLaunchToken(3081, { dshHome: '/does/not/matter', signal: controller.signal }))
      .resolves.toEqual({ ok: false, reason: 'cancelled' })
  })
})

describe('remote ohmydsh auth discovery', () => {
  it('uses fixed BatchMode OpenSSH argv and exposes no configurable script inputs', async () => {
    const process = new FakeDiscoveryProcess()
    let executable = ''
    let argv: readonly string[] = []
    const pending = discoverRemoteDshLaunchToken('vm-safe', 3081, {
      sshExecutable: '/usr/bin/ssh',
      spawn: (usedExecutable, usedArgv) => {
        executable = usedExecutable
        argv = usedArgv
        return process
      },
    })
    process.stdout.write(`${launch(3081, NEW_TOKEN)}\n`)
    process.finish()
    await expect(pending).resolves.toEqual({ ok: true, token: NEW_TOKEN })
    expect(executable).toBe('/usr/bin/ssh')
    expect(argv).toEqual([
      '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', 'vm-safe',
      `sh -c '${OHMYDSH_REMOTE_READ_SCRIPT}'`,
    ])
    expect(OHMYDSH_REMOTE_READ_SCRIPT).toContain('${DSH_HOME:-"$HOME/.dsh"}')
    expect(OHMYDSH_REMOTE_READ_SCRIPT).toContain('dsh.log')
    expect(OHMYDSH_REMOTE_READ_SCRIPT).toContain(`tail -c ${DSH_LOG_READ_BYTES}`)
  })

  it('rejects malicious aliases before spawning', async () => {
    let spawned = false
    for (const alias of ['-oProxyCommand=sh', 'vm;touch pwned', 'vm name', 'vm\ncommand']) {
      await expect(discoverRemoteDshLaunchToken(alias, 3081, {
        spawn: () => { spawned = true; return new FakeDiscoveryProcess() },
      })).resolves.toEqual({ ok: false, reason: 'invalid-alias' })
    }
    expect(spawned).toBe(false)
  })

  it('fails closed with redacted enums for command errors and invalid output', async () => {
    const failed = new FakeDiscoveryProcess()
    const failure = discoverRemoteDshLaunchToken('vm-safe', 3081, { spawn: () => failed })
    failed.stderr.write(`secret ${launch(3081, NEW_TOKEN)}`)
    failed.finish(44)
    await expect(failure).resolves.toEqual({ ok: false, reason: 'command-failed' })
    await expect(discoverRemoteDshLaunchToken('vm-safe', 3081, {
      spawn: () => { throw new Error(`spawn leaked ${NEW_TOKEN}`) },
    })).resolves.toEqual({ ok: false, reason: 'command-failed' })

    const foreign = new FakeDiscoveryProcess()
    const noMatch = discoverRemoteDshLaunchToken('vm-safe', 3081, { spawn: () => foreign })
    foreign.stdout.write(`${launch(9999, NEW_TOKEN)}\n`)
    foreign.finish()
    await expect(noMatch).resolves.toEqual({ ok: false, reason: 'invalid-output' })
  })

  it('bounds stdout and kills an oversized producer', async () => {
    const process = new FakeDiscoveryProcess()
    const pending = discoverRemoteDshLaunchToken('vm-safe', 3081, { spawn: () => process })
    process.stdout.write(Buffer.alloc(DSH_LOG_READ_BYTES + 1, 0x78))
    process.finish()
    await expect(pending).resolves.toEqual({ ok: false, reason: 'output-too-large' })
    expect(process.signals).toContain('SIGKILL')
  })

  it('times out and cancels with no process output in the result', async () => {
    const timed = new FakeDiscoveryProcess()
    await expect(discoverRemoteDshLaunchToken('vm-safe', 3081, { timeoutMs: 5, spawn: () => timed }))
      .resolves.toEqual({ ok: false, reason: 'timed-out' })
    expect(timed.signals).toContain('SIGKILL')

    const cancelled = new FakeDiscoveryProcess()
    const controller = new AbortController()
    const pending = discoverRemoteDshLaunchToken('vm-safe', 3081, { signal: controller.signal, spawn: () => cancelled })
    controller.abort()
    await expect(pending).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(cancelled.signals).toContain('SIGKILL')
  })
})
