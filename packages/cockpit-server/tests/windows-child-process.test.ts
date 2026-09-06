import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { discoverRemoteDshLaunchToken } from '../src/connectivity/dsh-auth-discovery.js'
import { defaultSpawner } from '../src/connectivity/ssh.js'

function fakeChild(): EventEmitter & {
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  readonly kill: ReturnType<typeof vi.fn>
  readonly pid: number
} {
  const child = new EventEmitter() as ReturnType<typeof fakeChild>
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    pid: 1234,
  })
  return child
}

describe('Windows background child process visibility', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('hides OpenSSH identity probes and tunnels without enabling a shell', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const process = defaultSpawner('ssh', ['-V'])

    expect(spawnMock).toHaveBeenCalledWith('ssh', ['-V'], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    child.emit('exit', 0, null)
    await expect(process.exited).resolves.toEqual({ code: 0, signal: null })
  })

  it('hides the OpenSSH process used for remote auth recovery', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const pending = discoverRemoteDshLaunchToken('vm-safe', 3081)
    child.stdout.end('http://127.0.0.1:3081/?token=newtokenabcdefgh\n')
    child.stderr.end()
    child.emit('close', 0, null)

    await expect(pending).resolves.toEqual({ ok: true, token: 'newtokenabcdefgh' })
    expect(spawnMock).toHaveBeenCalledOnce()
    expect(spawnMock.mock.calls[0]?.[2]).toEqual({
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  })
})
