import { createHash } from 'node:crypto'

const AUTH_REQUIRED_BODY = 'dsh web authentication required; reopen the URL printed by dsh web.'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/u
const COOKIE_PREFIX = 'dsh-auth-'

export interface DshCookieSession {
  readonly cookie: string
  readonly cleanUrl: URL
  readonly authority: string
  readonly expiresAt: number
}

/** The deterministic, authority-bound cookie name DSH mints for one endpoint.
 * Exported so callers and tests share ONE definition of the binding instead of
 * duplicating the digest: a response whose cookie name does not equal this
 * value for the endpoint's own authority has not proven that endpoint. */
export function dshCookieName(authority: string): string {
  const digest = createHash('sha256').update(authority).digest('base64url')
  return COOKIE_PREFIX + digest
}

/** Parse the write-only URL printed by DSH 0.1.2. Only its opaque token crosses
 * into the durable registry; the user-supplied authority is never trusted as a
 * request target. */
export function parseDshLaunchUrl(value: string, remoteDshPort: number): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('DSH launch URL invalid')
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('DSH launch URL must use http://127.0.0.1')
  }
  if (url.port !== String(remoteDshPort) || url.pathname !== '/' || url.hash !== '') {
    throw new Error('DSH launch URL must match the registered DSH port and root path')
  }
  const entries = [...url.searchParams.entries()]
  if (entries.length !== 1 || entries[0]?.[0] !== 'token' || !TOKEN_PATTERN.test(entries[0][1])) {
    throw new Error('DSH launch URL must contain exactly one valid token parameter')
  }
  return entries[0][1]
}

export function isDshAuthenticationRequired(status: number, body: string): boolean {
  return status === 401 && body.trim() === AUTH_REQUIRED_BODY
}

/** Exchange a DSH process launch token for the authority-bound browser cookie
 * used by unary HTTP and Remote-stream WebSocket carriers. */
export async function exchangeDshLaunchToken(
  endpoint: URL,
  token: string,
  options: { readonly fetch?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<DshCookieSession> {
  if (!TOKEN_PATTERN.test(token)) throw new Error('DSH launch token invalid')
  const doFetch = options.fetch ?? fetch
  const url = new URL('/', endpoint)
  url.searchParams.set('token', token)
  const response = await doFetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: 'text/html' },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  // DSH 0.1.x returns '/', while 0.2.0 returns './'. Both are clean roots
  // for this root request; do not normalize or follow arbitrary redirects.
  const location = response.headers.get('location')
  if (response.status !== 303 || (location !== '/' && location !== './')) {
    throw new Error('DSH authentication failed; paste the current dsh web startup URL')
  }
  const rawCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter((value): value is string => value !== null)
  const rawCookie = rawCookies.find(value => value.trim().startsWith(COOKIE_PREFIX))
  if (rawCookie === undefined) throw new Error('DSH authentication failed; paste the current dsh web startup URL')
  const cookie = rawCookie.split(';', 1)[0]?.trim()
  const expiresAt = cookieExpiry(rawCookie)
  if (cookie === undefined || expiresAt === undefined) {
    throw new Error('DSH authentication failed; paste the current dsh web startup URL')
  }
  // Strict authority binding: merely carrying the `dsh-auth-` prefix proves
  // nothing. The name must be exactly the deterministic name for THIS
  // endpoint's authority, or a substituted/malformed endpoint could pass the
  // exchange and leave the browser with a cookie it can never use.
  if (!inspectDshCookie(cookie, endpoint.host, expiresAt)) {
    throw new Error('DSH authentication failed; paste the current dsh web startup URL')
  }
  return { cookie, cleanUrl: new URL('/', endpoint), authority: endpoint.host, expiresAt }
}

/** Validate a persisted DSH cookie without possessing the DSH signing secret.
 * Its deterministic name proves the authority binding; the signed payload
 * provides only the public absolute expiry used to avoid replaying stale
 * material. DSH remains authoritative and verifies the signature on probe. */
export function inspectDshCookie(cookie: string, authority: string, expiresAt: number, now = Date.now()): boolean {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false
  const separator = cookie.indexOf('=')
  if (separator <= 0 || separator === cookie.length - 1 || cookie.includes(';')) return false
  return cookie.slice(0, separator) === dshCookieName(authority)
}

function cookieExpiry(rawCookie: string, now = Date.now()): number | undefined {
  let maxAge: number | undefined
  for (const part of rawCookie.split(';').slice(1)) {
    const [rawName, ...rawValue] = part.trim().split('=')
    const name = rawName?.toLowerCase()
    const value = rawValue.join('=')
    if (name === 'expires') {
      const parsed = Date.parse(value)
      if (Number.isFinite(parsed)) return parsed
    }
    if (name === 'max-age' && /^\d+$/u.test(value)) maxAge = Number(value)
  }
  return maxAge !== undefined && Number.isSafeInteger(maxAge) ? now + maxAge * 1_000 : undefined
}

/** Build the one-shot iframe URL. The device performs the exchange and removes
 * the query through its own 303 redirect; the cockpit never reads the cookie. */
export function dshIframeLaunchUrl(endpoint: URL, token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  const url = new URL('/', endpoint)
  url.searchParams.set('token', token)
  return url.toString()
}
