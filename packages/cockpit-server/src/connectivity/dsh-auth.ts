const AUTH_REQUIRED_BODY = 'dsh web authentication required; reopen the URL printed by dsh web.'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/u

export interface DshCookieSession {
  readonly cookie: string
  readonly cleanUrl: URL
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
  if (response.status !== 303 || response.headers.get('location') !== '/') {
    throw new Error('DSH authentication failed; paste the current dsh web startup URL')
  }
  const rawCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter((value): value is string => value !== null)
  const cookie = rawCookies.map(value => value.split(';', 1)[0]?.trim()).find(value => value?.startsWith('dsh-auth-'))
  if (cookie === undefined || !cookie.includes('=')) {
    throw new Error('DSH authentication failed; paste the current dsh web startup URL')
  }
  return { cookie, cleanUrl: new URL('/', endpoint) }
}

/** Build the one-shot iframe URL. The device performs the exchange and removes
 * the query through its own 303 redirect; the cockpit never reads the cookie. */
export function dshIframeLaunchUrl(endpoint: URL, token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  const url = new URL('/', endpoint)
  url.searchParams.set('token', token)
  return url.toString()
}
