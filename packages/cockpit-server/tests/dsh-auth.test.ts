import { describe, expect, it, vi } from 'vitest'
import { dshCookieName, exchangeDshLaunchToken, inspectDshCookie } from '../src/connectivity/dsh-auth.js'

const endpoint = new URL('http://127.0.0.1:3081')
const otherAuthority = '127.0.0.1:3999'
const token = 'abcdefghijklmnop'
/** Same single source of truth the server uses, so a change to the binding
 * derivation cannot pass this suite by being duplicated here. */
const cookieNameFor = dshCookieName

function response(body: string, status: number, headers: Record<string, string>): Response {
  return new Response(body, { status, headers })
}

describe('DSH launch token exchange authority binding', () => {
  it('allows the same current typert token to validate and then exchange for the browser', async () => {
    // The supported typert contract: one current token can be exchanged by the
    // server to VALIDATE it and then by the browser to obtain its own cookie.
    // Each exchange mints a different cookie value; only the name is stable,
    // and the name must bind to the endpoint authority.
    let minted = 0
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      minted += 1
      expect(String(input)).toBe('http://127.0.0.1:3081/?token=' + token)
      return response('', 303, {
        location: '/',
        'set-cookie': `${cookieNameFor(endpoint.host)}=signed-${minted}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict`,
      })
    }) as unknown as typeof fetch

    const serverSession = await exchangeDshLaunchToken(endpoint, token, { fetch: fetcher })
    const browserSession = await exchangeDshLaunchToken(endpoint, token, { fetch: fetcher })

    expect(serverSession.cookie).toBe(`${cookieNameFor(endpoint.host)}=signed-1`)
    expect(browserSession.cookie).toBe(`${cookieNameFor(endpoint.host)}=signed-2`)
    expect(serverSession.authority).toBe(endpoint.host)
    expect(inspectDshCookie(serverSession.cookie, endpoint.host, serverSession.expiresAt)).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects a cookie whose name is not the deterministic name for the endpoint authority', async () => {
    const fetcher = vi.fn(async () => response('', 303, {
      location: '/',
      // Right prefix, wrong authority: the exact class of response that must
      // never be accepted as proof that this endpoint validated the token.
      'set-cookie': `${cookieNameFor(otherAuthority)}=foreign; Max-Age=2592000; Path=/; HttpOnly`,
    })) as unknown as typeof fetch

    await expect(exchangeDshLaunchToken(endpoint, token, { fetch: fetcher })).rejects.toThrow(/authentication failed/iu)
  })

  it('rejects a response that is not the official clean 303 redirect', async () => {
    const wrongStatus = vi.fn(async () => response('', 200, {
      'set-cookie': `${cookieNameFor(endpoint.host)}=signed; Max-Age=60; Path=/; HttpOnly`,
    })) as unknown as typeof fetch
    const wrongLocation = vi.fn(async () => response('', 303, {
      location: '/somewhere-else',
      'set-cookie': `${cookieNameFor(endpoint.host)}=signed; Max-Age=60; Path=/; HttpOnly`,
    })) as unknown as typeof fetch
    const noExpiry = vi.fn(async () => response('', 303, {
      location: '/',
      'set-cookie': `${cookieNameFor(endpoint.host)}=signed; Path=/; HttpOnly`,
    })) as unknown as typeof fetch

    await expect(exchangeDshLaunchToken(endpoint, token, { fetch: wrongStatus })).rejects.toThrow(/authentication failed/iu)
    await expect(exchangeDshLaunchToken(endpoint, token, { fetch: wrongLocation })).rejects.toThrow(/authentication failed/iu)
    await expect(exchangeDshLaunchToken(endpoint, token, { fetch: noExpiry })).rejects.toThrow(/authentication failed/iu)
  })

  it('rejects an invalid token shape before issuing any request', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    await expect(exchangeDshLaunchToken(endpoint, 'short', { fetch: fetcher })).rejects.toThrow(/token invalid/iu)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
