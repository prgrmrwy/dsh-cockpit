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
})
