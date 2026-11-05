import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { forwardOpenUrl, isValidOpenPath, isValidUrlCommand } from '../src/forward-options.ts'
import { toForwardsSnapshot, type DeviceForwardsProjection } from '../src/forwards.ts'

describe('pinned-entry open options', () => {
  it('accepts an open path only with a leading slash and no spaces or controls', () => {
    assert.equal(isValidOpenPath('/'), true)
    assert.equal(isValidOpenPath('/dashboard?tab=1#top'), true)
    assert.equal(isValidOpenPath(`/${'a'.repeat(511)}`), true)
    assert.equal(isValidOpenPath(`/${'a'.repeat(512)}`), false)
    assert.equal(isValidOpenPath('dashboard'), false)
    assert.equal(isValidOpenPath(''), false)
    assert.equal(isValidOpenPath('/a b'), false)
    assert.equal(isValidOpenPath('/a\x7F'), false)
    assert.equal(isValidOpenPath(42), false)
  })

  it('accepts a single-line printable command up to 1024 characters', () => {
    assert.equal(isValidUrlCommand("ls -t a/*.log | head -1 | xargs grep -ho 'x' | tail -1"), true)
    assert.equal(isValidUrlCommand('a'.repeat(1024)), true)
    assert.equal(isValidUrlCommand('a'.repeat(1025)), false)
    assert.equal(isValidUrlCommand(''), false)
    assert.equal(isValidUrlCommand('a\nb'), false)
    assert.equal(isValidUrlCommand('a\tb'), false)
    assert.equal(isValidUrlCommand('a\x7F'), false)
  })

  it('builds the open address from the local port and path', () => {
    assert.equal(forwardOpenUrl(3082), 'http://127.0.0.1:3082/')
    assert.equal(forwardOpenUrl(3082, '/dashboard'), 'http://127.0.0.1:3082/dashboard')
  })

  it('never copies the open options into the device iframe snapshot', () => {
    const projection: DeviceForwardsProjection = {
      additionalCount: 1,
      limit: 8,
      rows: [{
        kind: 'additional',
        devicePort: 3082,
        state: 'ready',
        pinned: true,
        sameLocalPort: true,
        workbenchTab: true,
        openPath: '/dashboard',
        urlCommand: 'echo SECRET',
        holders: [],
        holderCount: 0,
        createdAt: 1,
        stateChangedAt: 1,
        localPort: 3082,
        pid: 7,
      }],
    }
    const text = JSON.stringify(toForwardsSnapshot(projection))
    assert.equal(text.includes('sameLocalPort'), false)
    assert.equal(text.includes('workbenchTab'), false)
    assert.equal(text.includes('/dashboard'), false)
    assert.equal(text.includes('SECRET'), false)
    assert.equal(text.includes('3082'), true)
  })
})
