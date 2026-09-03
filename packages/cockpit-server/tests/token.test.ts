import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TokenMiddleware, parseCookie, requestPathname, requiresToken } from '../src/auth/token.middleware.js'
import { TokenService } from '../src/auth/token.js'

/** A real Express request mounted under AuthModule's `/{*splat}` middleware
 * pattern has `path`/`url` REBASED to "/" (mounting semantics) while
 * `originalUrl` keeps the true, full path. Every fixture below models that
 * exactly — using only `path` (as older fixtures did) would silently hide
 * the exact bug this suite now guards against: the middleware reading
 * `request.path` instead of `request.originalUrl` and therefore gating
 * NOTHING, because `requiresToken('/')` is always false. */
const mountedRequest = (fullPath: string, headers: Record<string, string> = {}) => ({
  path: '/',
  originalUrl: fullPath,
  headers,
}) as never

describe('token middleware', () => {
  it('gates only API paths and exempts bootstrap/static', () => {
    expect(requiresToken('/api/devices')).toBe(true)
    expect(requiresToken('/api/bootstrap')).toBe(false)
    expect(requiresToken('/')).toBe(false)
    expect(requiresToken('/assets/index-abc.js')).toBe(false)
  })

  it('parses the cockpit cookie from a cookie header', () => {
    expect(parseCookie('cockpit_token=abc; Other=x')).toEqual({ cockpit_token: 'abc', Other: 'x' })
    expect(parseCookie(undefined)).toEqual({})
    expect(parseCookie('')).toEqual({})
  })

  it('reads the true pathname from originalUrl even when path has been rebased to "/" by mounting — the exact bug this middleware previously had', () => {
    // This is the regression case: AuthModule applies TokenMiddleware via
    // `consumer.apply(TokenMiddleware).forRoutes('/{*splat}')` (required
    // because Express 5 / path-to-regexp v8 rejects a bare '*'). Express
    // mounting rebases `req.path` to be relative to the mount point, so for
    // ANY request matched by that wildcard, `request.path` is always "/".
    // Reading `request.path` here previously made `requiresToken` see "/"
    // for every request — including `/api/devices` — and gate NOTHING.
    expect(requestPathname({ path: '/', originalUrl: '/api/devices' })).toBe('/api/devices')
    expect(requestPathname({ path: '/', originalUrl: '/api/devices?x=1' })).toBe('/api/devices')
    expect(requestPathname({ path: '/', originalUrl: '/' })).toBe('/')
    // Defensive fallback only: a real Express request always has a
    // non-empty originalUrl, but a malformed test double must fail closed
    // (fall back to path) rather than throw.
    expect(requestPathname({ path: '/api/devices', originalUrl: '' })).toBe('/api/devices')
  })

  it('rejects an unauthenticated runtime status request even though path has been rebased to "/" by the wildcard mount', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cockpit-token-'))
    try {
      const middleware = new TokenMiddleware(new TokenService(directory))
      const next = vi.fn()
      let responseStatus = 0
      let responseBody: unknown
      const response = {
        setHeader: vi.fn(),
        status(code: number) { responseStatus = code; return this },
        json(body: unknown) { responseBody = body; return this },
      }
      await middleware.use(mountedRequest('/api/runtime/status'), response as never, next)
      expect(responseStatus).toBe(401)
      expect(responseBody).toEqual(expect.objectContaining({ code: 'unauthorized' }))
      expect(next).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects an unauthenticated device-list request (the concrete route this bug let through in production)', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cockpit-token-'))
    try {
      const middleware = new TokenMiddleware(new TokenService(directory))
      const next = vi.fn()
      let responseStatus = 0
      const response = { setHeader: vi.fn(), status(code: number) { responseStatus = code; return this }, json: vi.fn() }
      await middleware.use(mountedRequest('/api/devices'), response as never, next)
      expect(responseStatus).toBe(401)
      expect(next).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('lets a bridge callback presenting the capability header through without the cockpit cookie', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cockpit-token-'))
    try {
      const middleware = new TokenMiddleware(new TokenService(directory))
      const next = vi.fn()
      const response = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() }
      await middleware.use(
        mountedRequest('/api/bridge/session-opened', { 'x-dsh-cockpit-bridge-capability': 'some-token' }),
        response as never,
        next,
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(response.status).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('still rejects a bridge-path request that presents no capability header at all (no cookie fallback)', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cockpit-token-'))
    try {
      const middleware = new TokenMiddleware(new TokenService(directory))
      const next = vi.fn()
      let responseStatus = 0
      const response = { setHeader: vi.fn(), status(code: number) { responseStatus = code; return this }, json: vi.fn() }
      await middleware.use(mountedRequest('/api/bridge/session-opened'), response as never, next)
      expect(responseStatus).toBe(401)
      expect(next).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not extend the capability-header carve-out to unrelated API routes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cockpit-token-'))
    try {
      const middleware = new TokenMiddleware(new TokenService(directory))
      const next = vi.fn()
      let responseStatus = 0
      const response = { setHeader: vi.fn(), status(code: number) { responseStatus = code; return this }, json: vi.fn() }
      await middleware.use(
        mountedRequest('/api/devices', { 'x-dsh-cockpit-bridge-capability': 'some-token' }),
        response as never,
        next,
      )
      expect(responseStatus).toBe(401)
      expect(next).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
