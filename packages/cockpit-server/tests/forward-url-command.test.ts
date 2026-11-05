import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { extractOpenUrl, resolveUrlByCommand, ForwardOpenFailure } from '../src/connectivity/forward-url-command.js'
import type { DiscoveryProcess } from '../src/connectivity/dsh-auth-discovery.js'

/** spec: cockpit-device-port-forward「驾驶舱经设备命令解析打开地址」. */

interface FakeRun {
  readonly argv: readonly string[]
  readonly signals: string[]
}

/** A fake ssh child: writes `stdout`, then exits with `code` (or never). */
function fakeSpawner(stdout: string | Buffer, code: number | 'never', runs: FakeRun[] = []) {
  return (_exe: string, argv: readonly string[]): DiscoveryProcess => {
    const out = new PassThrough()
    const err = new PassThrough()
    const signals: string[] = []
    runs.push({ argv, signals })
    let resolveExit!: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { resolveExit = resolve })
    setTimeout(() => {
      out.write(stdout)
      err.write('remote banner SECRET-ON-STDERR\n')
      if (code !== 'never') setTimeout(() => resolveExit({ code, signal: null }), 0)
    }, 0)
    return {
      stdout: out,
      stderr: err,
      exited,
      kill: signal => { signals.push(signal ?? 'SIGTERM'); resolveExit({ code: null, signal: signal ?? 'SIGTERM' }); return true },
    }
  }
}

describe('extractOpenUrl', () => {
  it('takes the last URL on the exact origin and swaps in the local port', () => {
    const stdout = 'http://127.0.0.1:3082/?token=old\nhttp://127.0.0.1:3082/?token=new\nhttp://127.0.0.1:9999/?token=x\n'
    expect(extractOpenUrl(stdout, 3082, 3082)).toBe('http://127.0.0.1:3082/?token=new')
    expect(extractOpenUrl(stdout, 3082, 41000)).toBe('http://127.0.0.1:41000/?token=new')
  })

  it('strips punctuation a log line wraps the URL in', () => {
    expect(extractOpenUrl('ready (http://127.0.0.1:3082/?token=abc).', 3082, 3082)).toBe('http://127.0.0.1:3082/?token=abc')
    expect(extractOpenUrl('see [http://127.0.0.1:3082/a];', 3082, 3082)).toBe('http://127.0.0.1:3082/a')
  })

  it('ignores other ports, localhost and longer port numbers', () => {
    expect(extractOpenUrl('http://localhost:3082/?t=1 http://127.0.0.1:30821/?t=2 https://127.0.0.1:3082/', 3082, 3082)).toBeUndefined()
    expect(extractOpenUrl('', 3082, 3082)).toBeUndefined()
  })
})

describe('resolveUrlByCommand', () => {
  it('runs the command after a strict -- boundary with BatchMode', async () => {
    const runs: FakeRun[] = []
    const url = await resolveUrlByCommand('vm-a', 'tail -1 x.log', 3082, 3082, { spawn: fakeSpawner('http://127.0.0.1:3082/?token=t\n', 0, runs) })
    expect(url).toBe('http://127.0.0.1:3082/?token=t')
    expect(runs[0]!.argv).toEqual(['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', 'vm-a', 'tail -1 x.log'])
  })

  it('maps a non-zero exit, empty output, timeout and oversized output to stable codes', async () => {
    const codeOf = async (run: Promise<unknown>) => {
      try { await run } catch (cause) { return cause instanceof ForwardOpenFailure ? cause.code : 'other' }
      return 'none'
    }
    expect(await codeOf(resolveUrlByCommand('vm-a', 'false', 3082, 3082, { spawn: fakeSpawner('http://127.0.0.1:3082/', 1) }))).toBe('url-command-failed')
    expect(await codeOf(resolveUrlByCommand('vm-a', 'true', 3082, 3082, { spawn: fakeSpawner('', 0) }))).toBe('url-command-no-url')

    const runs: FakeRun[] = []
    expect(await codeOf(resolveUrlByCommand('vm-a', 'sleep 99', 3082, 3082, { spawn: fakeSpawner('', 'never', runs), timeoutMs: 20 }))).toBe('url-command-timed-out')
    expect(runs[0]!.signals).toContain('SIGKILL')

    const big = Buffer.alloc(70 * 1024, 'a')
    expect(await codeOf(resolveUrlByCommand('vm-a', 'yes', 3082, 3082, { spawn: fakeSpawner(big, 'never') }))).toBe('url-command-output-too-large')
  })

  it('refuses an alias that could be parsed as an option', async () => {
    await expect(resolveUrlByCommand('-oProxyCommand=x', 'true', 3082, 3082, { spawn: fakeSpawner('', 0) })).rejects.toThrow()
  })
})
