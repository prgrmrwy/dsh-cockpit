import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createCockpitApp } from '../src/app-factory.js'
import { RuntimeControlService } from '../src/runtime/runtime-control.service.js'

/**
 * spec: cockpit-api-auth (change cockpit-api-same-origin).
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
const CAPABILITY_HEADER = 'x-dsh-cockpit-bridge-capability'

describe('cockpit API same-origin guard (real NestJS + Express, via createCockpitApp)', () => {
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
    directory = await mkdtemp(path.join(tmpdir(), 'cockpit-same-origin-'))
    previousHome = process.env.DSH_COCKPIT_HOME
    previousPort = process.env.COCKPIT_PORT
    process.env.DSH_COCKPIT_HOME = directory
    process.env.COCKPIT_PORT = '0'
    // A disabled local device: addressable by the device routes, never dialed.
    await writeFile(path.join(directory, 'devices.json'), `${JSON.stringify({
      version: 1,
      devices: [{ deviceId: DEVICE_ID, displayName: 'Device One', kind: 'local', remoteDshPort: 3939, enabled: false, order: 0 }],
    }, null, 2)}\n`, { mode: 0o600 })

    app = await createCockpitApp({ logger: false })
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

  // Requirement: 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求

  it('accepts the cockpit page itself (Origin == http://Host, same-origin)', async () => {
    const reply = await send('POST', `/api/devices/${DEVICE_ID}/refresh`, { cookie, origin: self, 'sec-fetch-site': 'same-origin' })
    expect(reply.status).not.toBe(403)
    expect(code(reply)).not.toBe('cross-origin-rejected')
  })

  it('accepts the dev-proxy page (Host 127.0.0.1:5173 preserved, matching Origin)', async () => {
    const reply = await send('GET', '/api/devices', { host: '127.0.0.1:5173', cookie, origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' })
    expect(reply.status).toBe(200)
  })

  it('accepts a CLI request with cookie and no Origin/Sec-Fetch-Site', async () => {
    const reply = await send('GET', '/api/runtime/status', { cookie })
    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.body)).toMatchObject({ app: 'dsh-cockpit', port })
  })

  it('rejects workbench-launch from a device-page origin with 403 and no launch url', async () => {
    const reply = await send('POST', `/api/devices/${DEVICE_ID}/workbench-launch`, { cookie, origin: deviceOrigin, 'sec-fetch-site': 'same-site' })
    expect(reply.status).toBe(403)
    expect(code(reply)).toBe('cross-origin-rejected')
    expect(reply.body).not.toMatch(/url|token/i)
  })

  it('rejects PUT and DELETE device from a device-page origin and leaves the registry unchanged', async () => {
    const before = await registry()
    const put = await send('PUT', `/api/devices/${DEVICE_ID}`, { cookie, origin: deviceOrigin, 'content-type': 'application/json' }, JSON.stringify({ sshAlias: 'attacker' }))
    const del = await send('DELETE', `/api/devices/${DEVICE_ID}?confirmed=true`, { cookie, origin: deviceOrigin })
    expect([put.status, code(put)]).toEqual([403, 'cross-origin-rejected'])
    expect([del.status, code(del)]).toEqual([403, 'cross-origin-rejected'])
    expect(await registry()).toBe(before)
  })

  it('rejects Sec-Fetch-Site: same-site without Origin', async () => {
    const reply = await send('GET', '/api/devices', { cookie, 'sec-fetch-site': 'same-site' })
    expect([reply.status, code(reply)]).toEqual([403, 'cross-origin-rejected'])
  })

  it('lets a capability-bearing bridge callback past the origin check', async () => {
    const reply = await send('POST', '/api/bridge/session-opened', { origin: deviceOrigin, 'content-type': 'application/json', [CAPABILITY_HEADER]: 'forged' }, JSON.stringify({ sessionId: 's1' }))
    // Reaches the controller, which rejects the forged capability itself.
    expect(code(reply)).not.toBe('cross-origin-rejected')
    expect(reply.status).toBe(400)
  })

  it('rejects a capability-less bridge callback from a device origin', async () => {
    const reply = await send('POST', '/api/bridge/hello', { cookie, origin: deviceOrigin, 'content-type': 'application/json' }, JSON.stringify({ version: '0.5.1' }))
    expect([reply.status, code(reply)]).toEqual([403, 'cross-origin-rejected'])
  })

  it('omits Access-Control-Allow-Credentials on a non-bridge preflight', async () => {
    const reply = await send('OPTIONS', `/api/devices/${DEVICE_ID}`, { origin: deviceOrigin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' })
    expect(reply.headers['access-control-allow-credentials']).toBeUndefined()
    expect(reply.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('reflects the device origin and allows the capability header on a bridge preflight', async () => {
    const reply = await send('OPTIONS', '/api/bridge/hello', { origin: deviceOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': `content-type, ${CAPABILITY_HEADER}` })
    expect(reply.status).toBeLessThan(300)
    expect(reply.headers['access-control-allow-origin']).toBe(deviceOrigin)
    expect(String(reply.headers['access-control-allow-headers'])).toContain(CAPABILITY_HEADER)
  })

  it('gates mixed-case /api/ paths for both the token and the Host checks', async () => {
    const list = await send('GET', '/API/devices')
    const launch = await send('POST', `/Api/devices/${DEVICE_ID}/workbench-launch`)
    const rebound = await send('GET', '/API/devices', { host: 'evil.example:3090', cookie })
    expect([list.status, code(list)]).toEqual([401, 'unauthorized'])
    expect([launch.status, code(launch)]).toEqual([401, 'unauthorized'])
    expect([rebound.status, code(rebound)]).toEqual([403, 'cross-origin-rejected'])
    expect(rebound.headers['set-cookie']).toBeUndefined()
    for (const reply of [list, launch, rebound]) expect(reply.body).not.toMatch(/Device One|url|token=/)
  })

  it('rejects a rebinding Host on /api/devices and /api/bootstrap without Set-Cookie', async () => {
    for (const pathname of ['/api/devices', '/api/bootstrap']) {
      const reply = await send('GET', pathname, { host: 'evil.example:3090', cookie })
      expect([reply.status, code(reply)], pathname).toEqual([403, 'cross-origin-rejected'])
      expect(reply.headers['set-cookie'], pathname).toBeUndefined()
      expect(reply.body, pathname).not.toMatch(/Device One/)
    }
  })

  it('rejects an /api/ request with no Host header at all (HTTP/1.0)', async () => {
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => { socket.write(`GET /api/bootstrap HTTP/1.0\r\n\r\n`) })
      let text = ''
      socket.setEncoding('utf8')
      socket.on('data', chunk => { text += chunk })
      socket.on('end', () => resolve(text))
      socket.on('error', reject)
    })
    expect(raw).toMatch(/^HTTP\/1\.[01] 403/)
    expect(raw).not.toMatch(/set-cookie/i)
  })

  it('rejects a Host carrying userinfo or a path even if it names the loopback host', async () => {
    for (const host of ['evil@127.0.0.1', `127.0.0.1:${port}/x`, '127.0.0.1.evil.example']) {
      const reply = await send('GET', '/api/bootstrap', { host })
      expect(reply.status, host).toBe(403)
    }
  })

  // Requirement: bridge 回调路由名单

  it('does not exempt an unlisted /api/bridge/ path', async () => {
    const reply = await send('POST', '/api/bridge/unlisted', { cookie, origin: deviceOrigin, 'content-type': 'application/json', [CAPABILITY_HEADER]: 'forged' }, '{}')
    expect([reply.status, code(reply)]).toEqual([403, 'cross-origin-rejected'])
    const preflight = await send('OPTIONS', '/api/bridge/unlisted', { origin: deviceOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': CAPABILITY_HEADER })
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('matches a mixed-case listed bridge path as the listed route', async () => {
    const reply = await send('POST', '/API/Bridge/Hello', { origin: deviceOrigin, 'content-type': 'application/json', [CAPABILITY_HEADER]: 'forged' }, JSON.stringify({ version: '0.5.1' }))
    expect(code(reply)).not.toBe('cross-origin-rejected')
    expect(reply.status).toBe(400)
    const preflight = await send('OPTIONS', '/API/Bridge/Hello', { origin: deviceOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': CAPABILITY_HEADER })
    expect(preflight.headers['access-control-allow-origin']).toBe(deviceOrigin)
  })

  // Requirement: 驾驶舱页面只允许被驾驶舱自身嵌入

  it("sends frame-ancestors 'self' on GET /", async () => {
    // No web dist is mounted here, so `/` may 404; the header is what matters.
    const reply = await send('GET', '/', { 'sec-fetch-mode': 'navigate' })
    expect(String(reply.headers['content-security-policy'])).toContain("frame-ancestors 'self'")
  })

  it("sends frame-ancestors 'self' on a 403 rejection", async () => {
    const reply = await send('POST', `/api/devices/${DEVICE_ID}/workbench-launch`, { cookie, origin: deviceOrigin })
    expect(reply.status).toBe(403)
    expect(String(reply.headers['content-security-policy'])).toContain("frame-ancestors 'self'")
  })

  it("sends frame-ancestors 'self' on a bridge preflight", async () => {
    const reply = await send('OPTIONS', '/api/bridge/hello', { origin: deviceOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': CAPABILITY_HEADER })
    expect(reply.headers['access-control-allow-origin']).toBe(deviceOrigin)
    expect(String(reply.headers['content-security-policy'])).toContain("frame-ancestors 'self'")
  })

  it('sends a CSP with only the frame-ancestors directive', async () => {
    const reply = await send('GET', '/')
    expect(reply.headers['content-security-policy']).toBe("frame-ancestors 'self'")
  })
})
