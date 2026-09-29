import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { discoverRemoteDshLaunchToken } from '../src/connectivity/dsh-auth-discovery.js'
import { defaultSpawner } from '../src/connectivity/ssh.js'

function fakeChild(): EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  pid: number
  kill: ReturnType<typeof vi.fn>
} {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 1234,
    kill: vi.fn(() => true),
  })
}

describe('OpenSSH child process options', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => fakeChild())
  })

  it('hides the identity and tunnel child window on Windows', () => {
    defaultSpawner('ssh', ['-V'])

    expect(spawnMock).toHaveBeenCalledWith('ssh', ['-V'], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
  })

  it('hides the remote auth-discovery child window on Windows', async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeChild()
      setTimeout(() => {
        child.stdout.end('http://127.0.0.1:3080/?token=abcdefghijklmnop\n')
        child.stderr.end()
        child.emit('close', 0, null)
      }, 0)
      return child
    })

    await expect(discoverRemoteDshLaunchToken('remote-host', 3080)).resolves.toEqual({
      ok: true,
      token: 'abcdefghijklmnop',
    })

    expect(spawnMock).toHaveBeenCalledWith('ssh', expect.arrayContaining(['remote-host']), {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  })
})
