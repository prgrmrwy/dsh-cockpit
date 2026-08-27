import { describe, expect, it } from 'vitest'
import { parseCookie, requiresToken } from '../src/auth/token.middleware.js'

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
})