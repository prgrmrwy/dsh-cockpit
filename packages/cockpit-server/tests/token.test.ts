import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TokenMiddleware, parseCookie, requiresToken } from '../src/auth/token.middleware.js'
import { TokenService } from '../src/auth/token.js'

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

  it('rejects an unauthenticated runtime status request', async () => {
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
      await middleware.use({ path: '/api/runtime/status', headers: {} } as never, response as never, next)
      expect(responseStatus).toBe(401)
      expect(responseBody).toEqual(expect.objectContaining({ code: 'unauthorized' }))
      expect(next).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
