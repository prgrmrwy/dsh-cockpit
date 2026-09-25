import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRemoteEditorUri, isValidEditorPath, isValidSshAlias } from '../src/bridge.ts'

/**
 * Runtime coverage for the remote-editor URI primitives.
 *
 * These helpers live in `shared` but were previously exercised only through the
 * bridge package's BUNDLED copy, so a regression in this module could be masked
 * by a stale bundle. Everything asserted here is a security boundary from the
 * `驾驶舱为设备提供远程编辑器打开接缝` requirement: the alias character set, the
 * absolute-path rule, and the no-traversal rule — including the case where a
 * caller tries to smuggle `..` through percent-encoding.
 */
describe('remote editor URI primitives', () => {
  it('produces the vscode-remote URI for a POSIX absolute path', () => {
    assert.equal(
      createRemoteEditorUri('vm-a', '/work/project'),
      'vscode://vscode-remote/ssh-remote+vm-a/work/project?windowId=_blank',
    )
  })

  it('keeps a Windows drive colon readable and normalizes backslashes', () => {
    assert.equal(
      createRemoteEditorUri('vm-a', 'C:\\work\\project'),
      'vscode://vscode-remote/ssh-remote+vm-a/C:/work/project?windowId=_blank',
    )
  })

  it('percent-encodes spaces, unicode and separators inside path segments', () => {
    assert.equal(
      createRemoteEditorUri('vm-a', '/work/My Project'),
      'vscode://vscode-remote/ssh-remote+vm-a/work/My%20Project?windowId=_blank',
    )
    assert.equal(
      createRemoteEditorUri('vm-a', '/工作/子目录'),
      'vscode://vscode-remote/ssh-remote+vm-a/' +
        '%E5%B7%A5%E4%BD%9C/%E5%AD%90%E7%9B%AE%E5%BD%95?windowId=_blank',
    )
    // A literal '?' or '#' inside a segment must not become a query/fragment.
    const withDelimiters = createRemoteEditorUri('vm-a', '/work/a?b#c')
    assert.equal(withDelimiters.endsWith('?windowId=_blank'), true)
    assert.equal(withDelimiters.includes('?b'), false)
  })

  it('rejects a traversal segment that is only hidden by percent-encoding', () => {
    const uri = createRemoteEditorUri('vm-a', '/work/%2e%2e/secret')
    // The literal text must survive as encoded DATA, so no downstream URI parser
    // can decode it back into a '..' segment that escapes /work.
    assert.equal(uri.includes('..'), false)
    assert.equal(uri.includes('/work/%252e%252e/secret'), true)
  })

  it('rejects traversal, relative, empty and NUL-bearing paths', () => {
    for (const path of [
      '/work/../secret',
      'C:\\work\\..\\secret',
      '/..',
      'relative/path',
      'C:relative',
      '',
      '/work/\0null',
    ]) {
      assert.equal(isValidEditorPath(path), false, `expected ${JSON.stringify(path)} to be rejected`)
      assert.throws(() => createRemoteEditorUri('vm-a', path), /invalid editor path/u)
    }
  })

  it('accepts the documented path shapes', () => {
    for (const path of ['/', '/work', 'C:/work', 'C:\\work', '/work/My Project']) {
      assert.equal(isValidEditorPath(path), true, `expected ${JSON.stringify(path)} to be accepted`)
    }
  })

  it('enforces the alias character contract', () => {
    for (const alias of ['vm-a', 'a', 'a.b_c-d', 'A1', 'x'.repeat(128)]) {
      assert.equal(isValidSshAlias(alias), true, `expected ${JSON.stringify(alias)} to be valid`)
    }
    for (const alias of ['user@host', 'host:22', 'has space', '-leading', '.leading', '_leading', 'x'.repeat(129), '']) {
      assert.equal(isValidSshAlias(alias), false, `expected ${JSON.stringify(alias)} to be invalid`)
      assert.throws(() => createRemoteEditorUri(alias, '/work'), /invalid SSH alias/u)
    }
  })
})
