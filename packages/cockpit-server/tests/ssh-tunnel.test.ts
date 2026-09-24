import { createServer, type Server } from 'node:net'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { defaultSpawner, probeSshIdentity, reserveCandidatePort, validateSshAlias, type OwnedProcess } from '../src/connectivity/ssh.js'
import { TunnelManager, WORKBENCH_CHANNEL, isPortBindFailure } from '../src/connectivity/tunnel-manager.js'

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
  /** Model OpenSSH writing a diagnostic to stderr and then exiting. The exit is
   * deferred a tick so the manager's 'data' listener (attached right after
   * spawn returns) drains the chunk before diagnostic() runs. */
  emitStderrThenExit(text: string, code: number): void {
    ;(this.stderr as Readable).push(Buffer.from(text))
    setTimeout(() => this.#resolveExit({ code, signal: null }), 0)
  }
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
    const free = (await reserveCandidatePort()).port
    const reserved = await reserveCandidatePort(free)
    expect(reserved.port).toBe(free)
    expect(reserved.preferredRejected).toBe(false)
  })

  it('falls back to an OS-assigned port when the preferred one is taken', async () => {
    const taken = (await reserveCandidatePort()).port
    const holder = await occupy(taken)
    try {
      const reserved = await reserveCandidatePort(taken)
      expect(reserved.port).not.toBe(taken)
      expect(reserved.port).toBeGreaterThan(0)
      // Deterministic attribution: our own listen on the preferred port failed.
      expect(reserved.preferredRejected).toBe(true)
      expect(reserved.preferredRejectionCode).toBe('EADDRINUSE')
    } finally {
      await release(holder)
    }
  })

  it('assigns a fresh port when no preference is given', async () => {
    const reserved = await reserveCandidatePort()
    expect(reserved.port).toBeGreaterThan(0)
    expect(reserved.port).toBeLessThanOrEqual(65535)
    expect(reserved.preferredRejected).toBe(false)
  })
})

/** Origin stability: the workbench iframe is loaded from
 * `http://127.0.0.1:<localPort>`, so a port that changes on every reconnect
 * discards the device's own DSH web localStorage. */
describe('tunnel manager local port reuse', () => {
  it('reuses the persisted port so the endpoint origin survives a reconnect', async () => {
    const persisted = (await reserveCandidatePort()).port
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
    const persisted = (await reserveCandidatePort()).port
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
    const persisted = (await reserveCandidatePort()).port
    const spawned: string[][] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => {
        spawned.push([...argv])
        const child = new FakeProcess(60 + spawned.length)
        // First attempt models OpenSSH losing the race for the reused port:
        // ExitOnForwardFailure makes it exit with a bind-failure diagnostic.
        if (spawned.length === 1) child.emitStderrThenExit(`bind [127.0.0.1]:${persisted}: Address already in use\r\nchannel_setup_fwd_listener_tcpip: cannot listen to port: ${persisted}\r\nCould not request local forwarding.\r\n`, 255)
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

  it('keeps the persisted port across a link-level failure so the origin does not drift', async () => {
    const persisted = (await reserveCandidatePort()).port
    const spawned: string[][] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => {
        spawned.push([...argv])
        const child = new FakeProcess(70 + spawned.length)
        // First attempt fails for a reason unrelated to the local port
        // (connection timeout). The persisted port must be retried, not dropped.
        if (spawned.length === 1) child.emitStderrThenExit('ssh: connect to host 10.255.255.1 port 22: Operation timed out\r\n', 255)
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
    // The retry stays on the persisted port: a link blip must not drift origin.
    expect(forwardedPort(spawned[1]!)).toBe(persisted)
    expect(handle.localPort).toBe(persisted)
    await manager.disposeAll()
  })

  it('keeps the persisted port when an early exit cannot be attributed', async () => {
    const persisted = (await reserveCandidatePort()).port
    const spawned: string[][] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => {
        spawned.push([...argv])
        const child = new FakeProcess(80 + spawned.length)
        // Empty stderr: unclassifiable. Conservative default keeps the port.
        if (spawned.length === 1) child.emitStderrThenExit('', 255)
        return child
      },
      readinessProbe: async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { ok: true, state: 'READY' as const, diagnostic: 'ok' }
      },
    })
    const handle = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: persisted })
    expect(forwardedPort(spawned[1]!)).toBe(persisted)
    expect(handle.localPort).toBe(persisted)
    await manager.disposeAll()
  })

  it('warns once with attribution when the local port drifts, and stays silent when it does not', async () => {
    const persisted = (await reserveCandidatePort()).port
    const holder = await occupy(persisted)
    const warnings: string[] = []
    const manager = new TunnelManager({
      spawn: () => new FakeProcess(90),
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
      logger: { warn: message => warnings.push(message) },
    })
    try {
      const drifted = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: persisted })
      expect(drifted.localPort).not.toBe(persisted)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('device=d1')
      expect(warnings[0]).toContain(`from=${persisted}`)
      expect(warnings[0]).toContain(`to=${drifted.localPort}`)
      expect(warnings[0]).toContain('reason=preferred-port-unavailable')
    } finally {
      await manager.disposeAll()
      await release(holder)
    }

    // A clean reuse (no drift) must not warn.
    const stablePort = (await reserveCandidatePort()).port
    const quiet: string[] = []
    const stable = new TunnelManager({
      spawn: () => new FakeProcess(91),
      readinessProbe: async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' }),
      logger: { warn: message => quiet.push(message) },
    })
    const handle = await stable.connect({ deviceId: 'd2', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: stablePort })
    expect(handle.localPort).toBe(stablePort)
    expect(quiet).toHaveLength(0)
    await stable.disposeAll()
  })
})

describe('isPortBindFailure', () => {
  it('classifies real OpenSSH port-bind stderr as a port failure (matching port)', () => {
    const stderr = 'bind [127.0.0.1]:54695: Address already in use\nchannel_setup_fwd_listener_tcpip: cannot listen to port: 54695\nCould not request local forwarding.\n'
    expect(isPortBindFailure(stderr, 54695)).toBe(true)
  })

  it('does not attribute an address-in-use for a different port to our port', () => {
    const stderr = 'bind [127.0.0.1]:11111: Address already in use\n'
    expect(isPortBindFailure(stderr, 54695)).toBe(false)
  })

  it('treats "Could not request local forwarding" alone as a port-bind failure', () => {
    expect(isPortBindFailure('Could not request local forwarding.\n', 54695)).toBe(true)
  })

  it('classifies link/auth/resolution failures as NOT a port failure', () => {
    expect(isPortBindFailure('ssh: connect to host 10.255.255.1 port 22: Operation timed out\n', 54695)).toBe(false)
    expect(isPortBindFailure('ssh: Could not resolve hostname vm-a: nodename nor servname provided\n', 54695)).toBe(false)
    expect(isPortBindFailure('Permission denied (publickey).\n', 54695)).toBe(false)
    expect(isPortBindFailure('', 54695)).toBe(false)
  })
})

/** Additional channels exist so one device can publish a loopback service
 * alongside its workbench tunnel. The invariant under test is independence:
 * opening, losing or disposing one channel must not disturb another. */
describe('tunnel manager additional channels', () => {
  const ready = async () => ({ ok: true, state: 'READY' as const, diagnostic: 'ok' })

  it('keeps the workbench tunnel and additional channels side by side', async () => {
    const children: FakeProcess[] = []
    const forwards: number[] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => {
        forwards.push(Number(argv[argv.indexOf('-L') + 1]!.split(':')[3]))
        const child = new FakeProcess(100 + children.length)
        children.push(child)
        return child
      },
      readinessProbe: ready,
    })

    const workbench = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })
    const extra = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', channelId: 'cards', remoteDshPort: 3939 })

    expect(workbench.channelId).toBe(WORKBENCH_CHANNEL)
    expect(extra.channelId).toBe('cards')
    // Distinct local ports, and each forwards to its own device-side port.
    expect(extra.localPort).not.toBe(workbench.localPort)
    expect(forwards).toEqual([3080, 3939])
    // The workbench child must NOT have been torn down by the second connect.
    expect(children[0]!.signals()).toEqual([])
    expect(children).toHaveLength(2)

    await manager.disposeAll()
  })

  it('replaces only the same channel when it is reconnected', async () => {
    const children: FakeProcess[] = []
    const manager = new TunnelManager({
      spawn: () => { const c = new FakeProcess(200 + children.length); children.push(c); return c },
      readinessProbe: ready,
    })

    await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })
    await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', channelId: 'cards', remoteDshPort: 3939 })
    await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', channelId: 'cards', remoteDshPort: 3939 })

    // Only the first 'cards' process is replaced; workbench stays untouched.
    expect(children[0]!.signals()).toEqual([])
    expect(children[1]!.signals()).toContain('SIGTERM')
    expect(children[2]!.signals()).toEqual([])

    await manager.disposeAll()
  })

  it('disposeChannel drops one channel and leaves the others running', async () => {
    const children: FakeProcess[] = []
    const manager = new TunnelManager({
      spawn: () => { const c = new FakeProcess(300 + children.length); children.push(c); return c },
      readinessProbe: ready,
    })

    await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })
    await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', channelId: 'cards', remoteDshPort: 3939 })

    await manager.disposeChannel('d1', 'cards')
    expect(children[1]!.signals()).toContain('SIGTERM')
    expect(children[0]!.signals()).toEqual([])

    await manager.disposeAll()
  })

  it('disposeNode clears every channel of that device only', async () => {
    const children: FakeProcess[] = []
    const manager = new TunnelManager({
      spawn: () => { const c = new FakeProcess(400 + children.length); children.push(c); return c },
      readinessProbe: ready,
    })

    await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 })
    await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', channelId: 'cards', remoteDshPort: 3939 })
    await manager.connect({ deviceId: 'd2', sshAlias: 'vm-b', remoteDshPort: 3080 })

    await manager.disposeNode('d1')
    expect(children[0]!.signals()).toContain('SIGTERM')
    expect(children[1]!.signals()).toContain('SIGTERM')
    // A different device keeps its tunnel.
    expect(children[2]!.signals()).toEqual([])

    await manager.disposeAll()
  })

  it('never offers a persisted port to an additional channel', async () => {
    // D3: only the workbench tunnel has a stable-origin requirement. An extra
    // channel must not inherit the device's persisted port, or two channels
    // would contend for the same local port on every reconnect.
    const persisted = (await reserveCandidatePort()).port
    const forwards: number[] = []
    const manager = new TunnelManager({
      spawn: (_exe, argv) => {
        forwards.push(Number(argv[argv.indexOf('-L') + 1]!.split(':')[1]))
        return new FakeProcess(600 + forwards.length)
      },
      readinessProbe: ready,
    })

    const workbench = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080, preferredLocalPort: persisted })
    const extra = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', channelId: 'cards', remoteDshPort: 3939 })

    expect(workbench.localPort).toBe(persisted)
    expect(extra.localPort).not.toBe(persisted)
    expect(forwards[0]).toBe(persisted)
    expect(forwards[1]).not.toBe(persisted)

    await manager.disposeAll()
  })

  it('does not probe an additional channel for DSH', async () => {
    // Real-device regression: an additional channel forwards an arbitrary
    // service (a card browser, a docs server). Probing it for DSH rejected
    // every healthy forward with DSH_UNAVAILABLE. Readiness for these channels
    // is "OpenSSH bound the port", nothing more.
    const probed: string[] = []
    const manager = new TunnelManager({
      spawn: () => new FakeProcess(700),
      readinessProbe: async endpoint => {
        probed.push(endpoint.toString())
        return { ok: false, state: 'DSH_UNAVAILABLE' as const, diagnostic: 'endpoint is not a supported DSH service' }
      },
    })

    const extra = await manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', channelId: 'cards', remoteDshPort: 45999 })
    expect(extra.port ?? extra.localPort).toBeGreaterThan(0)
    expect(probed).toEqual([])

    await manager.disposeAll()
  })

  it('still gates the workbench channel on DSH readiness', async () => {
    // The counterpart of the case above: skipping the probe must not leak into
    // the workbench channel, whose entire job is to carry DSH.
    let probes = 0
    const manager = new TunnelManager({
      spawn: () => new FakeProcess(701),
      readinessProbe: async () => {
        probes += 1
        return { ok: false, state: 'DSH_UNAVAILABLE' as const, diagnostic: 'endpoint is not a supported DSH service' }
      },
    })

    await expect(manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', remoteDshPort: 3080 }))
      .rejects.toThrow(/DSH_UNAVAILABLE/)
    expect(probes).toBeGreaterThan(0)

    await manager.disposeAll()
  }, 20_000)

  it('stays terminal for additional channels after disposeAll', async () => {
    const manager = new TunnelManager({
      spawn: () => new FakeProcess(500),
      readinessProbe: ready,
    })
    await manager.disposeAll()
    await expect(manager.connect({ deviceId: 'd1', sshAlias: 'vm-a', channelId: 'cards', remoteDshPort: 3939 }))
      .rejects.toThrow(/shut down/)
  })
})
