import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RuntimeRecordError, RuntimeRecordStore, type RuntimeRecord } from '../src/runtime/runtime-record.js'

let directory: string
let store: RuntimeRecordStore

const record = (instanceId: string): RuntimeRecord => ({
  version: 1,
  app: 'dsh-cockpit',
  instanceId,
  pid: 123,
  port: 3090,
  repoRoot: path.resolve('repo'),
  startedAt: Date.now(),
})

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cockpit-runtime-'))
  store = new RuntimeRecordStore(directory)
})

afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('runtime record store', () => {
  it('writes and reads one atomic runtime record without temp files', async () => {
    const expected = record('one')
    await store.write(expected)
    await expect(store.read()).resolves.toEqual(expected)
    const entries = await import('node:fs/promises').then(fs => fs.readdir(directory))
    expect(entries).toEqual(['runtime.json'])
    if (process.platform !== 'win32') {
      const stat = await import('node:fs/promises').then(fs => fs.stat(store.file))
      expect(stat.mode & 0o777).toBe(0o600)
    }
  })

  it('removes only a record owned by the same instance', async () => {
    const expected = record('new')
    await store.write(expected)
    await expect(store.removeIfOwned('old')).resolves.toBe(false)
    await expect(store.read()).resolves.toEqual(expected)
    await expect(store.removeIfOwned('new')).resolves.toBe(true)
    await expect(store.read()).resolves.toBeUndefined()
  })

  it('fails closed on corrupt content and does not overwrite it', async () => {
    await writeFile(store.file, '{broken')
    await expect(store.read()).rejects.toBeInstanceOf(RuntimeRecordError)
    expect(await readFile(store.file, 'utf8')).toBe('{broken')
  })
})
