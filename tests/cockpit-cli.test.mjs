import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildCommandInvocation,
  findExecutable,
  needsBuild,
  parseCliArgs,
  resolvePnpmCommand,
  resolveCliHome,
  resolveCliPort,
  validateNodeVersion,
  validateRuntimeStatus,
} from '../bin/cockpit'

test('parses the existing command surface and rejects unknown commands', () => {
  assert.deepEqual(parseCliArgs(['start', '--foreground', '--no-open', '--build']), {
    action: 'start', foreground: true, noOpen: true, dev: false, build: true, force: false, help: false,
  })
  assert.equal(parseCliArgs(['--dev']).dev, true)
  assert.equal(parseCliArgs([]).action, 'start')
  assert.throws(() => parseCliArgs(['unknown']), /unknown command/)
})

test('validates Node 22 and runtime port configuration', () => {
  assert.equal(validateNodeVersion('22.0.0'), '22.0.0')
  assert.equal(validateNodeVersion('24.12.0'), '24.12.0')
  assert.throws(() => validateNodeVersion('21.9.0'), /Node.js >= 22/)
  assert.equal(resolveCliPort({}), 3090)
  assert.equal(resolveCliPort({ COCKPIT_PORT: '43190' }), 43190)
  assert.throws(() => resolveCliPort({ COCKPIT_PORT: '65536' }), /invalid COCKPIT_PORT/)
})

test('uses OS home instead of HOME and honors an explicit cockpit home', () => {
  assert.equal(resolveCliHome({ HOME: '/wrong' }, () => '/users/alice'), path.join('/users/alice', '.dsh-cockpit'))
  assert.equal(resolveCliHome({ DSH_COCKPIT_HOME: './isolated' }, () => '/unused'), path.resolve('./isolated'))
})

test('finds a PATH executable without invoking a shell', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cockpit-cli-path-'))
  const executable = path.join(directory, process.platform === 'win32' ? 'tool.cmd' : 'tool')
  try {
    await writeFile(executable, '#!/usr/bin/env node\n')
    await chmod(executable, 0o755)
    assert.equal(findExecutable('tool', { env: { PATH: directory }, platform: process.platform }), executable)
    assert.equal(findExecutable('missing', { env: { PATH: directory }, platform: process.platform }), undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('adapts only Windows cmd/bat shims through fixed ComSpec arguments', () => {
  const direct = buildCommandInvocation('/usr/bin/pnpm', ['--version'], { platform: 'linux', env: {} })
  assert.deepEqual(direct, { executable: '/usr/bin/pnpm', args: ['--version'], windowsVerbatimArguments: false })

  const shim = buildCommandInvocation('C:\\tools\\pnpm.cmd', ['--filter', 'name & echo injected'], {
    platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  })
  assert.equal(shim.executable, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(shim.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.match(shim.args[3], /^""C:\\tools\\pnpm\.cmd" "--filter" "name & echo injected""$/)
  assert.equal(shim.windowsVerbatimArguments, true)
  assert.throws(
    () => buildCommandInvocation('C:\\tools\\pnpm.cmd', ['bad\narg'], { platform: 'win32', env: { ComSpec: 'cmd.exe' } }),
    /line breaks/,
  )
})

test('prefers corepack for the repository-pinned pnpm unless explicitly overridden', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cockpit-cli-corepack-'))
  try {
    const corepack = path.join(directory, process.platform === 'win32' ? 'corepack.cmd' : 'corepack')
    const pnpm = path.join(directory, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
    await writeFile(corepack, '')
    await writeFile(pnpm, '')
    await chmod(corepack, 0o755)
    await chmod(pnpm, 0o755)
    const env = { PATH: directory, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    assert.deepEqual(resolvePnpmCommand(env, process.platform), { executable: corepack, prefixArgs: ['pnpm'] })
    assert.deepEqual(resolvePnpmCommand({ ...env, DSH_COCKPIT_PNPM_EXECUTABLE: pnpm }, process.platform), {
      executable: pnpm, prefixArgs: [],
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('cross-validates runtime identity instead of trusting a PID', () => {
  const record = {
    version: 1, app: 'dsh-cockpit', instanceId: 'one', pid: 123, port: 3090,
    repoRoot: path.resolve('repo'), startedAt: Date.now(),
  }
  assert.equal(validateRuntimeStatus(record, { ...record }, record.repoRoot), true)
  assert.equal(validateRuntimeStatus(record, { ...record, instanceId: 'other' }, record.repoRoot), false)
  assert.equal(validateRuntimeStatus(record, { ...record, repoRoot: path.resolve('other') }, record.repoRoot), false)
})

test('rebuilds when any package output is older than source', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'cockpit-cli-build-'))
  const files = [
    'packages/cockpit-server/dist/main.js',
    'packages/cockpit-web/dist/index.html',
    'packages/shared/dist/index.js',
    'packages/cockpit-server/src/main.ts',
    'packages/cockpit-web/src/main.tsx',
    'packages/shared/src/index.ts',
  ]
  try {
    for (const file of files) {
      const full = path.join(repo, file)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, '')
    }
    const old = new Date('2026-01-01T00:00:00Z')
    const current = new Date('2026-01-02T00:00:00Z')
    const future = new Date('2026-01-03T00:00:00Z')
    for (const file of files) await utimes(path.join(repo, file), current, current)
    await utimes(path.join(repo, 'packages/cockpit-web/dist/index.html'), old, old)
    assert.equal(await needsBuild(repo), true)
    await utimes(path.join(repo, 'packages/cockpit-web/dist/index.html'), future, future)
    assert.equal(await needsBuild(repo), false)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
