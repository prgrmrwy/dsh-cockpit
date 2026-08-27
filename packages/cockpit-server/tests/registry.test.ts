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

  it('writes 0600 and never leaves temp files after success', async () => {
    await registry.save([remote()])
    const entries = await import('node:fs/promises').then(fs => fs.readdir(dir))
    expect(entries.filter(e => e.endsWith('.tmp'))).toEqual([])
    const stat = await import('node:fs/promises').then(fs => fs.stat(path.join(dir, 'devices.json')))
    expect(stat.mode & 0o777).toBe(0o600)
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

  it('rejects a remote device without sshAlias and an invalid port', async () => {
    await expect(registry.save([remote({ sshAlias: undefined as never })])).rejects.toThrow()
    // Invalid rows make the whole file fail-closed on load.
    const bad = path.join(dir, 'devices.json')
    await writeFile(bad, JSON.stringify({ version: 1, devices: [{ deviceId: 'x', displayName: 'x', kind: 'remote', remoteDshPort: 0, enabled: true, order: 0 }] }))
    await expect(new DeviceRegistry(dir).load()).rejects.toBeInstanceOf(DeviceRegistryError)
  })
})