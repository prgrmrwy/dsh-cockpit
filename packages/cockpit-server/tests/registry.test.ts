import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceRegistry, DeviceRegistryError } from '../src/storage/registry.js'

let dir: string
let registry: DeviceRegistry

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cockpit-registry-'))
  registry = new DeviceRegistry(dir)
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const remote = (overrides: Partial<Parameters<DeviceRegistry['save']>[0][number]> = {}) => ({
  deviceId: 'device-1',
  displayName: 'VM A',
  kind: 'remote' as const,
  sshAlias: 'vm-a',
  remoteDshPort: 3080,
  enabled: true,
  order: 0,
  ...overrides,
})

describe('device registry', () => {
  it('persists, reloads and sorts by order then id', async () => {
    await registry.save([remote({ order: 2 }), remote({ deviceId: 'device-0', order: 1 })])
    const loaded = await new DeviceRegistry(dir).load()
    expect(loaded.map(d => d.deviceId)).toEqual(['device-0', 'device-1'])
  })

  it('persists a launch token only inside the protected device registry', async () => {
    await registry.save([remote({ dshLaunchToken: 'opaque-launch-token' })])
    expect((await new DeviceRegistry(dir).load())[0]?.dshLaunchToken).toBe('opaque-launch-token')
    expect(await readFile(registry.file, 'utf8')).toContain('opaque-launch-token')
    if (process.platform !== 'win32') {
      const stat = await import('node:fs/promises').then(fs => fs.stat(registry.file))
      expect(stat.mode & 0o777).toBe(0o600)
    }
  })

  it('migrates a legacy launch token in memory with discovery disabled', async () => {
    await writeFile(registry.file, JSON.stringify({ version: 1, devices: [remote({ dshLaunchToken: 'legacy-token-abcdef' })] }))
    const loaded = await registry.load()
    expect(loaded[0]?.dshAuth).toEqual({ version: 1, launchToken: 'legacy-token-abcdef', autoDiscovery: 'disabled', updatedAt: 0, generation: 1 })
  })

  it('fails closed on a partial or unsupported private auth record', async () => {
    for (const dshAuth of [
      { version: 2 },
      { version: 1, serverCookie: 'secret', autoDiscovery: 'disabled', updatedAt: 0, generation: 1 },
      { version: 1, autoDiscovery: 'anywhere', updatedAt: 0, generation: 1 },
    ]) {
      await writeFile(registry.file, JSON.stringify({ version: 1, devices: [remote({ dshAuth: dshAuth as never })] }))
      await expect(registry.load()).rejects.toBeInstanceOf(DeviceRegistryError)
    }
  })

  it('CAS commits recovered auth only for the expected enabled opt-in generation', async () => {
    const original = remote({ dshAuth: { version: 1, launchToken: 'old-token-abcdef', autoDiscovery: 'ohmydsh-log', updatedAt: 1, generation: 2 } })
    await registry.save([original])
    const recovered = { version: 1 as const, launchToken: 'new-token-abcdef', serverCookie: 'cookie=value', cookieAuthority: '127.0.0.1:3080', cookieExpiresAt: Date.now() + 10_000, autoDiscovery: 'ohmydsh-log' as const, updatedAt: 2, generation: 3 }
    await expect(registry.commitRecoveredAuth('device-1', 1, recovered)).resolves.toBeUndefined()
    await expect(registry.commitRecoveredAuth('device-1', 2, recovered)).resolves.toMatchObject({ dshAuth: recovered })
    expect((await registry.load())[0]?.dshAuth).toEqual(recovered)
  })

  it('writes 0600 and never leaves temp files after success', async () => {
    await registry.save([remote()])
    const entries = await import('node:fs/promises').then(fs => fs.readdir(dir))
    expect(entries.filter(e => e.endsWith('.tmp'))).toEqual([])
    if (process.platform !== 'win32') {
      const stat = await import('node:fs/promises').then(fs => fs.stat(path.join(dir, 'devices.json')))
      expect(stat.mode & 0o777).toBe(0o600)
    }
  })

  it('fails closed on corrupt or invalid content and never overwrites', async () => {
    await registry.save([remote()])
    const good = await readFile(registry.file, 'utf8')
    await writeFile(registry.file, '{"version":1,"devices":[{"deviceId":123}]}')
    await expect(registry.load()).rejects.toBeInstanceOf(DeviceRegistryError)
    expect(await readFile(registry.file, 'utf8')).toBe('{"version":1,"devices":[{"deviceId":123}]}')

    await writeFile(registry.file, 'not json')
    await expect(registry.load()).rejects.toBeInstanceOf(DeviceRegistryError)
    expect(await readFile(registry.file, 'utf8')).toBe('not json')
    expect(await readFile(registry.file, 'utf8')).not.toBe(good)
  })

  it('records a local forward port and reloads it as the next preferred port', async () => {
    await registry.save([remote(), remote({ deviceId: 'device-2', order: 1 })])

    await registry.updateLocalPort('device-1', 45123)

    const reloaded = await new DeviceRegistry(dir).load()
    expect(reloaded.find(d => d.deviceId === 'device-1')?.localPort).toBe(45123)
    // Siblings are untouched by the narrow read-modify-write.
    expect(reloaded.find(d => d.deviceId === 'device-2')?.localPort).toBeUndefined()
    expect(reloaded.map(d => d.deviceId)).toEqual(['device-1', 'device-2'])
  })

  it('leaves the file untouched for an unknown device or an unchanged port', async () => {
    await registry.save([remote({ localPort: 45123 })])
    const before = await readFile(registry.file, 'utf8')

    await registry.updateLocalPort('device-missing', 45999)
    await registry.updateLocalPort('device-1', 45123)

    expect(await readFile(registry.file, 'utf8')).toBe(before)
  })

  it('rejects an out-of-range local port write', async () => {
    await registry.save([remote()])
    for (const port of [0, -1, 70_000, 1.5]) {
      await expect(registry.updateLocalPort('device-1', port)).rejects.toBeInstanceOf(DeviceRegistryError)
    }
    expect((await registry.load())[0]?.localPort).toBeUndefined()
  })

  it('treats an out-of-range stored local port as absent without failing the file closed', async () => {
    await writeFile(registry.file, JSON.stringify({
      version: 1,
      devices: [{ ...remote(), localPort: 70_000 }],
    }))

    const loaded = await new DeviceRegistry(dir).load()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.localPort).toBeUndefined()
  })

  it('rejects a remote device without sshAlias and an invalid port', async () => {
    await expect(registry.save([remote({ sshAlias: undefined as never })])).rejects.toThrow()
    // Invalid rows make the whole file fail-closed on load.
    const bad = path.join(dir, 'devices.json')
    await writeFile(bad, JSON.stringify({ version: 1, devices: [{ deviceId: 'x', displayName: 'x', kind: 'remote', remoteDshPort: 0, enabled: true, order: 0 }] }))
    await expect(new DeviceRegistry(dir).load()).rejects.toBeInstanceOf(DeviceRegistryError)
  })
})
