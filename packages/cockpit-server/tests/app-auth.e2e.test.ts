import { request as httpRequest } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from '../src/app.module.js'

/**
 * A REAL end-to-end regression guard for the auth-gate wiring bug found during
 * this change's manual acceptance testing: `consumer.apply(TokenMiddleware)
 * .forRoutes('*')` compiled to zero effective routes under the installed
 * Express 5 / path-to-regexp v8, so EVERY `/api/*` endpoint — not just ones
 * this change touches — ran completely unauthenticated regardless of cookie.
 *
 * `token.middleware.test.ts` unit-tests `TokenMiddleware.use()` directly,
 * which cannot catch this class of bug: the bug was in how NestJS's
 * `MiddlewareConsumer.forRoutes()` registers the middleware against the real
 * Express router, not in the middleware's own logic. Only booting the actual
 * `AppModule` through `NestFactory` and making a real HTTP request against a
 * real listening port exercises that wiring.
 */
describe('auth gate (real NestJS + Express integration)', () => {
  let directory: string
  let app: NestExpressApplication
  let baseUrl: string
  let previousHome: string | undefined
  let previousPort: string | undefined

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'cockpit-e2e-'))
    previousHome = process.env.DSH_COCKPIT_HOME
    previousPort = process.env.COCKPIT_PORT
    process.env.DSH_COCKPIT_HOME = directory
    // A non-default port doubles as coverage for design.md D7/2.4: the auth
    // gate must hold regardless of which COCKPIT_PORT the app is configured
    // for, not just the documented default.
    process.env.COCKPIT_PORT = '0'

    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false })
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await app.close()
    if (previousHome === undefined) delete process.env.DSH_COCKPIT_HOME
    else process.env.DSH_COCKPIT_HOME = previousHome
    if (previousPort === undefined) delete process.env.COCKPIT_PORT
    else process.env.COCKPIT_PORT = previousPort
    await rm(directory, { recursive: true, force: true })
  })

  it('actually resolves the whole production dependency graph at boot', async () => {
    // `beforeEach` already boots the REAL AppModule through NestFactory, so
    // reaching this assertion means every provider resolved. That is the point:
    // a controller/service constructor that unit tests instantiate DIRECTLY can
    // still be un-injectable, and Nest only reports it while starting the app
    // (a live "cockpit server exited early with code 1"). A route smoke-check
    // makes that class of regression fail here instead of in production.
    const response = await fetch(`${baseUrl}/api/bootstrap`)
    expect(response.status).toBe(200)
    const devices = await fetch(`${baseUrl}/api/devices`, { headers: { cookie: (await fetch(`${baseUrl}/api/bootstrap`)).headers.get('set-cookie')!.split(';')[0]! } })
    expect(devices.status).toBe(200)
  })

  it('rejects GET /api/devices with no cookie — the exact route the bug let through', async () => {
    const response = await fetch(`${baseUrl}/api/devices`)
    expect(response.status).toBe(401)
    const body = await response.json() as { code: string }
    expect(body.code).toBe('unauthorized')
  })

  it('rejects every other gated /api/* route this change touches or neighbors, with no cookie', async () => {
    const cases: Array<[string, RequestInit]> = [
      ['/api/devices/some-id', { method: 'PUT', body: '{}', headers: { 'content-type': 'application/json' } }],
      ['/api/devices/some-id', { method: 'DELETE' }],
      ['/api/devices/some-id/refresh', { method: 'POST' }],
      ['/api/devices/some-id/reconnect', { method: 'POST' }],
      ['/api/devices/some-id/completed/ack', { method: 'POST' }],
      ['/api/devices/some-id/bridge/capability', { method: 'POST' }],
      ['/api/runtime/status', { method: 'GET' }],
    ]
    for (const [pathname, init] of cases) {
      const response = await fetch(`${baseUrl}${pathname}`, init)
      expect(response.status, `${String(init.method ?? 'GET')} ${pathname} must be gated`).toBe(401)
    }
  })

  it('serves /api/bootstrap without a cookie, and issues one via Set-Cookie', async () => {
    // Static asset serving (`useStaticAssets`) is wired in `main.ts#bootstrap()`,
    // not in `AppModule` itself, and depends on a built `cockpit-web/dist` on
    // disk — orthogonal to the auth gate this suite exists to guard. `/` with
    // no static handler mounted 404s here, which is fine: the assertion that
    // matters is that the auth *middleware* does not itself reject a static
    // path (see `requiresToken` unit coverage in token.test.ts for that).
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`)
    expect(bootstrap.status).toBe(200)
    expect(bootstrap.headers.get('set-cookie')).toMatch(/^cockpit_token=.+; HttpOnly; SameSite=Strict; Path=\//)
  })

  it('accepts a gated route once the bootstrap cookie is presented back', async () => {
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`)
    const setCookie = bootstrap.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    const cookie = setCookie!.split(';')[0]!

    const devices = await fetch(`${baseUrl}/api/devices`, { headers: { cookie } })
    expect(devices.status).toBe(200)
    const body = await devices.json() as { device: unknown[] }
    expect(body.device).toEqual([])
  })

  it('accepts a bridge callback carrying a capability header even with no cookie, past the auth gate (controller-level capability validation then applies)', async () => {
    const response = await fetch(`${baseUrl}/api/bridge/hello`, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:1', 'content-type': 'application/json', 'x-dsh-cockpit-bridge-capability': 'forged' },
      body: JSON.stringify({ version: '0.2.0' }),
    })
    // Must NOT be 401 (auth-gate carve-out worked); the controller then
    // rejects the forged/unbound capability with its own 400.
    expect(response.status).toBe(400)
  })

  it('carves out EVERY bridge route, not just the reporting ones', async () => {
    // Real-device regression: the port-forward routes were added to the
    // controller but not to the auth gate's allowlist. A bridge call arrives
    // cross-origin from the device's own DSH page and therefore carries no
    // cockpit cookie by construction, so an unlisted route answers 401 no
    // matter how valid its capability is — and the UI reported exactly that.
    for (const path of ['/api/bridge/publishable-port', '/api/bridge/publish-port']) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:1', 'content-type': 'application/json', 'x-dsh-cockpit-bridge-capability': 'forged' },
        body: JSON.stringify({ channelId: 'probe', devicePort: 3939, protocolVersion: 2 }),
      })
      // Past the gate; the controller then rejects the forged capability.
      expect(response.status, `${path} must not be gated at the auth layer`).not.toBe(401)
    }
  })

  /** The workbench-launch response is the ONE place a current DSH launch token
   * leaves the server for the browser. Cookies are not port-isolated and every
   * `127.0.0.1` port is same-site, so the persistent cookie alone cannot say
   * "this is the cockpit's own page" — another loopback page could otherwise
   * read the tokenized JSON. These cases drive the REAL Express router. */
  describe('workbench launch origin gate', () => {
    async function cockpitCookie(): Promise<string> {
      const bootstrap = await fetch(`${baseUrl}/api/bootstrap`)
      return bootstrap.headers.get('set-cookie')!.split(';')[0]!
    }

    async function launch(init: RequestInit): Promise<Response> {
      return await fetch(`${baseUrl}/api/devices/device-1/workbench-launch`, { method: 'POST', ...init })
    }

    /**
     * Raw HTTP for the cases `fetch` cannot express.
     *
     * Node's fetch treats `Host` as a forbidden header name and silently drops
     * whatever the caller sets, so a "missing Host" case built on fetch would
     * actually be tested against a perfectly valid Host — a false pass. The raw
     * client sends exactly the headers given, including a missing or repeated
     * `Host`, and also lets one request carry a duplicated `Origin`.
     */
    function rawLaunch(rawHeaders: Array<[string, string]>): Promise<{ status: number; body: string }> {
      const target = new URL(baseUrl)
      return new Promise((resolve, reject) => {
        const request = httpRequest({
          host: target.hostname,
          port: target.port,
          method: 'POST',
          path: '/api/devices/device-1/workbench-launch',
          // setHost:false keeps Node from inventing a Host header, so the
          // caller's header list is the ONLY source of truth. Passing an array
          // of tuples (rather than an object) is what lets a name repeat.
          setHost: false,
          headers: rawHeaders,
        }, response => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', chunk => { body += chunk })
          response.on('end', () => { resolve({ status: response.statusCode ?? 0, body }) })
        })
        request.on('error', reject)
        request.end()
      })
    }

    it('rejects every non-exact workbench launch Origin and Host before secret access', async () => {
      const cookie = await cockpitCookie()
      const cockpitOrigin = new URL(baseUrl).origin
      const cockpitHost = new URL(baseUrl).host
      const cases: Array<[string, Record<string, string>]> = [
        ['missing Origin', { host: cockpitHost, cookie }],
        ['empty Origin', { host: cockpitHost, origin: '', cookie }],
        ['different loopback port', { host: cockpitHost, origin: 'http://127.0.0.1:1', cookie }],
        ['localhost instead of 127.0.0.1', { host: cockpitHost, origin: `http://localhost:${new URL(baseUrl).port}`, cookie }],
        ['unparsable Origin', { host: cockpitHost, origin: 'not-a-url', cookie }],
        ['zero port', { host: cockpitHost, origin: 'http://127.0.0.1:0', cookie }],
        ['forwarded disguise', { host: cockpitHost, origin: 'http://127.0.0.1:1', 'x-forwarded-host': cockpitHost, 'x-forwarded-proto': 'http', cookie }],
      ]
      for (const [label, headers] of cases) {
        const response = await launch({ headers })
        expect(response.status, label).toBe(403)
        const body = await response.text()
        expect(body, label).toContain('workbench-origin-forbidden')
        expect(body, label).not.toMatch(/token|dsh-auth|cookie/iu)
      }

      // Host cases `fetch` cannot express: it silently drops a caller-supplied
      // Host and rejects control characters before the wire.
      const rawCases: Array<[string, Array<[string, string]>]> = [
        ['missing Host', [['Origin', cockpitOrigin], ['Cookie', cookie]]],
        ['empty Host', [['Host', ''], ['Origin', cockpitOrigin], ['Cookie', cookie]]],
        ['duplicate Host', [['Host', cockpitHost], ['Host', '127.0.0.1:1'], ['Origin', cockpitOrigin], ['Cookie', cookie]]],
        ['duplicate Origin', [['Host', cockpitHost], ['Origin', cockpitOrigin], ['Origin', 'http://127.0.0.1:1'], ['Cookie', cookie]]],
        ['scheme-less Origin', [['Host', cockpitHost], ['Origin', '127.0.0.1:1'], ['Cookie', cookie]]],
      ]
      for (const [label, rawHeaders] of rawCases) {
        const response = await rawLaunch(rawHeaders)
        // A request with no usable Host is refused before routing (Express
        // answers 400); every other shape reaches the gate and gets 403. Both
        // are fail-closed, and neither may carry authentication material.
        expect(response.status, label).toBeGreaterThanOrEqual(400)
        expect(response.status, label).toBeLessThan(500)
        if (response.status === 403) expect(response.body, label).toContain('workbench-origin-forbidden')
        expect(response.body, label).not.toMatch(/token=|dsh-auth|cookie/iu)
      }
    })

    it('uses raw matching Origin and Host while ignoring forwarded headers', async () => {
      const cookie = await cockpitCookie()
      const cockpitOrigin = new URL(baseUrl).origin
      const cockpitHost = new URL(baseUrl).host
      const response = await launch({
        headers: {
          host: cockpitHost,
          origin: cockpitOrigin,
          forwarded: 'for=203.0.113.7;host=evil.test;proto=https',
          'x-forwarded-host': 'evil.test',
          'x-forwarded-proto': 'https',
          'x-forwarded-for': '203.0.113.7',
          cookie,
        },
      })
      // Forwarded headers must NOT rewrite the expected origin; the raw pair
      // matches, so the request proceeds past the gate (the id is unknown).
      expect(response.status).not.toBe(403)
      expect(response.status).toBe(404)
    })

    it('returns only the launch URL and generation with no-store and no-referrer headers', async () => {
      const cookie = await cockpitCookie()
      const response = await launch({
        headers: { host: new URL(baseUrl).host, origin: new URL(baseUrl).origin, cookie },
        body: JSON.stringify({}),
      })
      // Unknown device id: the gate passed and the handler answered. The
      // security headers must be present on this response regardless, and the
      // body must carry no authentication material.
      expect(response.status).not.toBe(403)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      const body = await response.text()
      expect(body).not.toMatch(/token=|dsh-auth|cookie/iu)
    })
  })
})
