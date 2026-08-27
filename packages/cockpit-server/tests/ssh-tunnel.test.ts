import { describe, expect, it } from 'vitest'
import { defaultSpawner, probeSshIdentity, validateSshAlias, type OwnedProcess } from '../src/connectivity/ssh.js'
import { TunnelManager } from '../src/connectivity/tunnel-manager.js'

/** Fake ssh: keeps running long enough to look alive; records signals. */
class FakeProcess implements OwnedProcess {
  readonly pid: number
  readonly stderr: NodeJS.ReadableStream
  #signals: string[] = []
  #resolveExit!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>

  constructor(pid: number) {
    this.pid = pid
    this.exited = new Promise(resolve => { this.#resolveExit = resolve })
    this.stderr = new (require('node:stream').Readable)({ read() {} })
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.#signals.push(signal ?? 'SIGTERM')
    return true
  }
  signals(): string[] { return this.#signals }
  exit(code: number): void { this.#resolveExit({ code, signal: null }) }
}

describe('ssh identity probe', () => {
  it('accepts only a BatchMode session that stays alive through the window', async () => {
    const alive = new FakeProcess(10)
    let usedArgs: string[] = []
    const spawn = (_exe: string, argv: readonly string[]) => { usedArgs = [...argv]; return alive }
    const result = await probeSshIdentity('vm-a', { stabilityMs: 30, terminateGraceMs: 5, spawn })
    expect(result.ok).toBe(true)
    expect(usedArgs).toContain('-o')
    expect(usedArgs).toContain('BatchMode=yes')
    expect(usedArgs).toContain('SessionType=none')
    expect(usedArgs).toContain('--')
    expect(usedArgs.at(-1)).toBe('vm-a')
  })

  it('rejects an alias that could be parsed as an option', () => {
    for (const alias of ['-oProxyCommand=x', '--', '-L', 'a b', '', 'a\nb']) {
      expect(() => validateSshAlias(alias)).toThrow()
    }
    expect(validateSshAlias('vm-1')).toBe('vm-1')
  })
})

describe('tunnel manager lifecycle', () => {
  it('announces readiness only after probe success and releases on disposeAll', async () => {
    const children = [new FakeProcess(1), new FakeProcess(2)]
    let spawnCount = 0
    const manager = new TunnelManager({
      spawn: () => children[spawnCount++]!,
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    const handle = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })
    expect(handle.endpoint.protocol).toBe('http:')
    expect(handle.endpoint.hostname).toBe('127.0.0.1')
    await manager.disposeAll()
    expect(children[0]!.signals()).toContain('SIGTERM')
  })

  it('is terminal: after disposeAll no new tunnel can start', async () => {
    const manager = new TunnelManager({
      spawn: () => new FakeProcess(9),
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    await manager.disposeAll()
    await expect(manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })).rejects.toThrow(/shut down/)
  })

  it('never publishes an endpoint when DSH readiness fails', async () => {
    const manager = new TunnelManager({
      spawn: () => new FakeProcess(5),
      readinessProbe: async () => ({ ok: false, state: 'DSH_UNAVAILABLE' as const, diagnostic: 'no dsh' }),
    })
    await expect(manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })).rejects.toThrow(/DSH_UNAVAILABLE/)
  })
})