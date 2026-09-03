import { createServer, type Server } from 'node:net'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { defaultSpawner, probeSshIdentity, reserveCandidatePort, validateSshAlias, type OwnedProcess } from '../src/connectivity/ssh.js'
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
    this.stderr = new Readable({ read() {} })
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
    let usedExecutable = ''
    let usedArgs: string[] = []
    const spawn = (exe: string, argv: readonly string[]) => { usedExecutable = exe; usedArgs = [...argv]; return alive }
    const result = await probeSshIdentity('vm-a', { stabilityMs: 30, terminateGraceMs: 5, spawn })
    expect(result.ok).toBe(true)
    expect(usedExecutable).toBe('ssh')
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

  it('uses an explicit executable without shell interpretation', async () => {
    const alive = new FakeProcess(11)
    let usedExecutable = ''
    const result = await probeSshIdentity('vm-a', {
      sshExecutable: 'C:\\OpenSSH\\ssh.exe',
      stabilityMs: 20,
      terminateGraceMs: 5,
      spawn: (executable) => { usedExecutable = executable; return alive },
    })
    expect(result.ok).toBe(true)
    expect(usedExecutable).toBe('C:\\OpenSSH\\ssh.exe')
  })

  it('preserves a missing executable spawn error as diagnostic text', async () => {
    const process = defaultSpawner(`missing-ssh-${Date.now()}`, ['-V'])
    let diagnostic = ''
    process.stderr.setEncoding('utf8')
    process.stderr.on('data', chunk => { diagnostic += String(chunk) })
    const ended = new Promise<void>(resolve => { process.stderr.once('end', resolve) })
    await process.exited
    await ended
    expect(diagnostic).toMatch(/failed to start missing-ssh-/)
    expect(diagnostic).toMatch(/ENOENT|not found/i)
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

  it('passes an explicit ssh executable to the process spawner', async () => {
    const child = new FakeProcess(3)
    let executable = ''
    const manager = new TunnelManager({
      sshExecutable: 'custom-ssh',
      spawn: value => { executable = value; return child },
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })
    expect(executable).toBe('custom-ssh')
    await manager.disposeAll()
  })

  it('is terminal: after disposeAll no new tunnel can start', async () => {
    const manager = new TunnelManager({
      spawn: () => new FakeProcess(9),
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    await manager.disposeAll()
    await expect(manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })).rejects.toThrow(/shut down/)
  })

  it('never publishes an endpoint when DSH readiness fails', { timeout: 15_000 }, async () => {
    const manager = new TunnelManager({
      spawn: () => new FakeProcess(5),
      readinessProbe: async () => ({ ok: false, state: 'DSH_UNAVAILABLE' as const, diagnostic: 'no dsh' }),
    })
    await expect(manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })).rejects.toThrow(/DSH_UNAVAILABLE/)
  })
})

/** Hold a loopback port for the duration of a test. */
async function occupy(port: number): Promise<Server> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}

async function release(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()))
}

/** The local port a tunnel bound, read back from its `-L` argument. */
function forwardedPort(argv: readonly string[]): number {
  const value = argv[argv.indexOf('-L') + 1]!
  return Number(value.split(':')[1])
}

describe('reserveCandidatePort', () => {
  it('returns the preferred port when it is bindable', async () => {
    const free = await reserveCandidatePort()
    await expect(reserveCandidatePort(free)).resolves.toBe(free)
  })

  it('falls back to an OS-assigned port when the preferred one is taken', async () => {
    const taken = await reserveCandidatePort()
    const holder = await occupy(taken)
    try {
      const port = await reserveCandidatePort(taken)
      expect(port).not.toBe(taken)
      expect(port).toBeGreaterThan(0)
    } finally {
      await release(holder)
    }
  })

  it('assigns a fresh port when no preference is given', async () => {
    const port = await reserveCandidatePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
  })
})

/** Origin stability: the workbench iframe is loaded from
 * `http://127.0.0.1:<localPort>`, so a port that changes on every reconnect
 * discards the device's own DSH web localStorage. */
describe('tunnel manager local port reuse', () => {
  it('reuses the persisted port so the endpoint origin survives a reconnect', async () => {
    const persisted = await reserveCandidatePort()
    const spawned: string[][] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => { spawned.push([...argv]); return new FakeProcess(20 + spawned.length) },
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })

    const first = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: persisted })
    expect(first.localPort).toBe(persisted)
    expect(first.endpoint.origin).toBe(`http://127.0.0.1:${persisted}`)
    expect(forwardedPort(spawned[0]!)).toBe(persisted)

    // Reconnect with the same persisted port: same origin, so browser storage
    // written under it is still readable.
    const second = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: persisted })
    expect(second.localPort).toBe(persisted)
    expect(second.endpoint.origin).toBe(first.endpoint.origin)

    await manager.disposeAll()
  })

  it('falls back to a fresh port and still connects when the persisted port is taken', async () => {
    const persisted = await reserveCandidatePort()
    const holder = await occupy(persisted)
    const spawned: string[][] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => { spawned.push([...argv]); return new FakeProcess(30 + spawned.length) },
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    try {
      const handle = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: persisted })
      // Reconnect must succeed — a busy port is never allowed to fail it.
      expect(handle.localPort).not.toBe(persisted)
      expect(handle.localPort).toBeGreaterThan(0)
      expect(handle.endpoint.origin).toBe(`http://127.0.0.1:${handle.localPort}`)
      expect(spawned).toHaveLength(1)
      expect(forwardedPort(spawned[0]!)).toBe(handle.localPort)
    } finally {
      await manager.disposeAll()
      await release(holder)
    }
  })

  it('assigns a fresh port on a first connection with nothing persisted', async () => {
    const spawned: string[][] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => { spawned.push([...argv]); return new FakeProcess(40 + spawned.length) },
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    const handle = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })
    expect(handle.localPort).toBeGreaterThan(0)
    expect(forwardedPort(spawned[0]!)).toBe(handle.localPort)
    expect(handle.endpoint.origin).toBe(`http://127.0.0.1:${handle.localPort}`)
    await manager.disposeAll()
  })

  it('ignores an out-of-range persisted port instead of splicing it into -L', async () => {
    const spawned: string[][] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => { spawned.push([...argv]); return new FakeProcess(50 + spawned.length) },
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
    })
    const handle = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: 70_000 })
    expect(handle.localPort).toBeGreaterThan(0)
    expect(handle.localPort).toBeLessThanOrEqual(65535)
    expect(forwardedPort(spawned[0]!)).toBe(handle.localPort)
    await manager.disposeAll()
  })

  it('retries on a fresh port when the reused one is stolen inside the bind window', async () => {
    const persisted = await reserveCandidatePort()
    const spawned: string[][] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => {
        spawned.push([...argv])
        const child = new FakeProcess(60 + spawned.length)
        // First attempt models OpenSSH losing the race for the reused port:
        // ExitOnForwardFailure makes it exit rather than bind elsewhere.
        if (spawned.length === 1) child.exit(255)
        return child
      },
      readinessProbe: async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { ok: true, state: 'READY' as const, diagnostic: 'ok' }
      },
    })

    const handle = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: persisted })

    expect(spawned).toHaveLength(2)
    expect(forwardedPort(spawned[0]!)).toBe(persisted)
    // The retry must not burn another attempt on the same doomed port.
    expect(forwardedPort(spawned[1]!)).not.toBe(persisted)
    expect(handle.localPort).toBe(forwardedPort(spawned[1]!))
    await manager.disposeAll()
  })
})
