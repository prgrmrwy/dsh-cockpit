import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createCockpitApp } from '../src/app-factory.js'
import { RuntimeControlService } from '../src/runtime/runtime-control.service.js'
import { ConnectivityService } from '../src/connectivity/connectivity.service.js'

/**
 * spec: cockpit-device-port-forward + cockpit-api-auth (change
 * device-forward-registry): the forwards endpoints through the real app.
 *
 * Every request here goes through `node:http`, never `fetch`: Node's fetch
 * silently replaces a caller-supplied `Host`, which would make the Host-layer
 * scenarios (dev proxy, DNS rebinding) test nothing.
 */

interface Reply {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

const DEVICE_ID = 'dev-1'
const REMOTE_ID = 'vm-1'
const CAPABILITY_HEADER = 'x-dsh-cockpit-bridge-capability'

describe('forwards endpoints (real NestJS + Express, via createCockpitApp)', () => {
  let directory: string
  let app: NestExpressApplication
  let port: number
  let self: string
  let deviceOrigin: string
  let cookie: string
  let previousHome: string | undefined
  let previousPort: string | undefined

  function send(method: string, pathname: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        // `setHost: false` + an explicit header: exactly the Host the test names.
        setHost: false,
        headers: { host: `127.0.0.1:${port}`, ...headers, ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }) },
      }, incoming => {
        let text = ''
        incoming.setEncoding('utf8')
        incoming.on('data', chunk => { text += chunk })
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text }))
      })
      outgoing.on('error', reject)
      if (body !== undefined) outgoing.write(body)
      outgoing.end()
    })
  }

  function registry(): Promise<string> {
    return readFile(path.join(directory, 'devices.json'), 'utf8')
  }

  function code(reply: Reply): string | undefined {
    try { return (JSON.parse(reply.body) as { code?: string }).code } catch { return undefined }
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'cockpit-forwards-'))
    previousHome = process.env.DSH_COCKPIT_HOME
    previousPort = process.env.COCKPIT_PORT
    process.env.DSH_COCKPIT_HOME = directory
    process.env.COCKPIT_PORT = '0'
    // A disabled local device: addressable by the device routes, never dialed.
    await writeFile(path.join(directory, 'devices.json'), `${JSON.stringify({
      version: 1,
      devices: [
        { deviceId: DEVICE_ID, displayName: 'Device One', kind: 'local', remoteDshPort: 3939, enabled: false, order: 0 },
        { deviceId: REMOTE_ID, displayName: 'VM', kind: 'remote', sshAlias: 'vm-a', remoteDshPort: 3080, enabled: false, order: 1 },
      ],
    }, null, 2)}\n`, { mode: 0o600 })

    // Same order as main.ts: factory, then static assets, then listen.
    const web = path.join(directory, 'web')
    await mkdir(web)
    await writeFile(path.join(web, 'index.html'), '<!doctype html><title>cockpit</title>')
    app = await createCockpitApp({ logger: false })
    app.useStaticAssets(web)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    port = typeof address === 'object' && address !== null ? address.port : 0
    self = `http://127.0.0.1:${port}`
    deviceOrigin = `http://127.0.0.1:${port === 47001 ? 47002 : 47001}`
    await app.get(RuntimeControlService).activate({ port, repoRoot: directory, shutdown: async () => undefined })

    const bootstrap = await send('GET', '/api/bootstrap')
    const setCookie = bootstrap.headers['set-cookie']
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!
  })

  afterEach(async () => {
    await app.close()
    if (previousHome === undefined) delete process.env.DSH_COCKPIT_HOME
    else process.env.DSH_COCKPIT_HOME = previousHome
    if (previousPort === undefined) delete process.env.COCKPIT_PORT
    else process.env.COCKPIT_PORT = previousPort
    await rm(directory, { recursive: true, force: true })
  })

  const json = { 'content-type': 'application/json' }
  const acquireBody = JSON.stringify({ devicePort: 3939, holder: 'memex', instanceId: 'inst-1111111111111111' })
  const rows = () => app.get(ConnectivityService).statuses().find(status => status.deviceId === REMOTE_ID)?.forwards?.rows ?? []

  // Requirement: bridge 以设备端口申请、释放附加转发

  it('rejects a cookie-only same-origin call to forwards/acquire with 401', async () => {
    for (const route of ['/api/bridge/forwards/acquire', '/api/bridge/forwards/release']) {
      const reply = await send('POST', route, { ...json, cookie, origin: self, 'sec-fetch-site': 'same-origin' }, acquireBody)
      expect([route, reply.status, code(reply)]).toEqual([route, 401, 'unauthorized'])
    }
    expect(rows().filter(row => row.kind === 'additional')).toEqual([])
  })

  // Requirement: bridge 回调路由名单

  it('forwards list: does not exempt an unlisted /api/bridge/ path', async () => {
    // Removed routes and unlisted neighbours of the new ones are not exempt.
    for (const route of ['/api/bridge/publishable-port', '/api/bridge/publish-port', '/api/bridge/forwards/list', '/api/bridge/forwards']) {
      const reply = await send('POST', route, { ...json, cookie, origin: deviceOrigin, [CAPABILITY_HEADER]: 'forged' }, '{}')
      expect([route, reply.status, code(reply)]).toEqual([route, 403, 'cross-origin-rejected'])
      const preflight = await send('OPTIONS', route, { origin: deviceOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': CAPABILITY_HEADER })
      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined()
    }
  })

  it('forwards list: treats /API/Bridge/Hello and /API/Bridge/Forwards/Acquire as listed routes', async () => {
    const hello = await send('POST', '/API/Bridge/Hello', { ...json, origin: deviceOrigin, [CAPABILITY_HEADER]: 'forged' }, JSON.stringify({ version: '0.6.0' }))
    expect([hello.status, code(hello)]).toEqual([400, 'bad-request'])
    // Exempt like the listed route: reaches the endpoint's own capability check.
    const acquire = await send('POST', '/API/Bridge/Forwards/Acquire', { ...json, origin: deviceOrigin, [CAPABILITY_HEADER]: 'forged' }, acquireBody)
    expect([acquire.status, code(acquire)]).toEqual([400, 'bridge-capability-invalid'])
    const preflight = await send('OPTIONS', '/API/Bridge/Forwards/Acquire', { origin: deviceOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': CAPABILITY_HEADER })
    expect(preflight.headers['access-control-allow-origin']).toBe(deviceOrigin)
  })

  // Requirement: 转发表管理端点仅供驾驶舱自身页面使用

  it('creates a pinned 6379 entry from the cockpit page and records it in the registry', async () => {
    const reply = await send('POST', `/api/devices/${REMOTE_ID}/forwards`, { ...json, cookie, origin: self, 'sec-fetch-site': 'same-origin' }, JSON.stringify({ devicePort: 6379, label: 'redis' }))
    expect(reply.status).toBe(201)
    expect(rows()).toContainEqual(expect.objectContaining({ kind: 'additional', devicePort: 6379, pinned: true, label: 'redis' }))
    expect(JSON.parse(await registry()).devices.find((device: { deviceId: string }) => device.deviceId === REMOTE_ID).forwards)
      .toEqual([{ devicePort: 6379, label: 'redis' }])

    // Business rejections are 409 with a stable code; nothing changes.
    const reserved = await send('POST', `/api/devices/${REMOTE_ID}/forwards`, { ...json, cookie, origin: self }, JSON.stringify({ devicePort: 3080 }))
    expect([reserved.status, code(reserved)]).toEqual([409, 'reserved-port'])
    const local = await send('POST', `/api/devices/${DEVICE_ID}/forwards`, { ...json, cookie, origin: self }, JSON.stringify({ devicePort: 6379 }))
    expect([local.status, code(local)]).toEqual([409, 'local-device'])

    const removed = await send('DELETE', `/api/devices/${REMOTE_ID}/forwards/6379`, { cookie, origin: self, 'sec-fetch-site': 'same-origin' })
    expect(removed.status).toBe(200)
    expect(rows().filter(row => row.kind === 'additional')).toEqual([])
    expect(JSON.parse(await registry()).devices.find((device: { deviceId: string }) => device.deviceId === REMOTE_ID).forwards).toBeUndefined()
  })

  it('rejects capability-only calls to the forward management endpoints', async () => {
    const before = await registry()
    const attempts: [string, string, string | undefined][] = [
      ['POST', `/api/devices/${REMOTE_ID}/forwards`, JSON.stringify({ devicePort: 6379 })],
      ['DELETE', `/api/devices/${REMOTE_ID}/forwards/6379`, undefined],
      ['POST', `/api/devices/${REMOTE_ID}/forwards/release-instance`, JSON.stringify({ instanceId: 'inst-1111111111111111', pageId: 'page-1111111111111111' })],
    ]
    for (const [method, route, payload] of attempts) {
      // From the device page: the origin layer refuses it outright.
      const cross = await send(method, route, { ...json, origin: deviceOrigin, [CAPABILITY_HEADER]: 'forged' }, payload)
      expect([route, cross.status, code(cross)]).toEqual([route, 403, 'cross-origin-rejected'])
      // Without an Origin (a CLI-shaped call), a capability is no cookie.
      const bare = await send(method, route, { ...json, [CAPABILITY_HEADER]: 'forged' }, payload)
      expect([route, bare.status, code(bare)]).toEqual([route, 401, 'unauthorized'])
    }
    expect(await registry()).toBe(before)
    expect(rows().filter(row => row.kind === 'additional')).toEqual([])
  })
})
