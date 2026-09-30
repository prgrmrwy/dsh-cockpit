import { Inject, Injectable, Logger, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { TokenService } from './token.js'

export const BRIDGE_CAPABILITY_HEADER = 'x-dsh-cockpit-bridge-capability'

/**
 * Gates the cockpit API: first the request's own addressing (Host) and origin,
 * then an HttpOnly cookie. Static assets (the shell
 * bundle, which contains no secrets) and `/api/bootstrap` (which issues the
 * cookie on first visit) are exempt; everything under `/api/` requires it.
 * Other local processes or malicious web pages cannot read an HttpOnly cookie,
 * so this protects the loopback service while staying usable from a browser.
 */
@Injectable()
export class TokenMiddleware implements NestMiddleware {
  readonly #logger = new Logger('CockpitApiGuard')

  constructor(@Inject(TokenService) private readonly tokens: TokenService) {}

  async use(request: Request, response: Response, next: NextFunction): Promise<void> {
    // MUST be the true request path, not `request.path`. AuthModule mounts
    // this middleware with a path pattern (Express 5's catch-all form, since
    // a bare '*' is no longer valid path-to-regexp syntax there); Express
    // rebases `req.path`/`req.url` to be relative to that mount point for
    // everything running "inside" it, so `request.path` here is always just
    // "/" no matter what was actually requested — `requiresToken('/')` would
    // then be false and this middleware would gate NOTHING. `originalUrl` is
    // never rebased by mounting, so it is the only reliable source here.
    // Lowercased because Express routes case-insensitively by default: a
    // request for `/API/devices` reaches the `/api/devices` handler, so every
    // path decision here MUST fold case the same way, or a mixed-case path
    // skips the gate entirely while still being served.
    const route = classifyApiPath(requestPathname(request))
    if (!route.api) {
      next()
      return
    }
    // The request target and Host were already enforced by `requestGuard`
    // (app-factory), ahead of CORS; re-checked here so this middleware never
    // relies on being mounted behind it.
    const host = headerValue(request.headers.host)
    if (!isOriginForm(request) || !isCockpitHost(host)) {
      rejectCrossOrigin(this.#logger, request, response, 'host')
      return
    }
    // A bridge callback uses its own short-lived capability and is validated by
    // the controller. Never treat this header as the persistent cockpit token.
    const bridgeCallback = route.bridgeCallback && request.headers[BRIDGE_CAPABILITY_HEADER] !== undefined
    if (!route.bootstrap && !bridgeCallback) {
      // The cockpit cookie is not port-isolated: every device page and any
      // other local page on this host is "same-site" and sends it. Only the
      // cockpit's own origin — whatever Host it was reached under — may use it.
      const origin = headerValue(request.headers.origin)
      if (origin !== undefined && origin !== `http://${host}`) {
        rejectCrossOrigin(this.#logger, request, response, 'origin')
        return
      }
      const fetchSite = headerValue(request.headers['sec-fetch-site'])
      if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        rejectCrossOrigin(this.#logger, request, response, 'fetch-site')
        return
      }
    }
    if (route.bootstrap || bridgeCallback) {
      next()
      return
    }
    const token = await this.tokens.resolve()
    const cookie = parseCookie(request.headers.cookie)
    if (!this.tokens.verify(cookie?.cockpit_token)) {
      // First visit to an API route: issue the HttpOnly cookie alongside the
      // 401; the frontend retries once the cookie is stored.
      response.setHeader('Set-Cookie', `cockpit_token=${token}; HttpOnly; SameSite=Strict; Path=/`)
      response.status(401).json({ code: 'unauthorized', message: 'missing or invalid cockpit token' })
      return
    }
    next()
  }
}

/**
 * The first two guard layers (design D1), mounted by `createCockpitApp()`
 * ahead of CORS so that neither a preflight nor a request the router would
 * still dispatch can slip past them:
 *
 * 0. request target — only a plain origin-form target the guard and the
 *    router read identically. The router takes its path from `parseurl`,
 *    which (a) parses absolute-form (`GET http://x/api/devices`) out to
 *    `/api/devices`, and (b) on `#`, whitespace, U+00A0 or U+FEFF drops to
 *    `url.parse`, which rewrites `\` to `/` (`/api\devices#x` routes to
 *    `/api/devices`). Either way the raw target does not start with `/api/`
 *    while the handler it reaches does. So the target must start with `/`,
 *    contain none of those characters, and — checked, not assumed — the
 *    router's own reading (`request.path`, which IS `parseurl(req).pathname`
 *    while mounted at the root) must equal the guard's. Browsers never send
 *    any of the rejected forms.
 * 1. Host — every `/api/` request, before any exemption, CORS included: a
 *    DNS-rebinding page reaches this loopback port under its own hostname
 *    and must get neither the bootstrap cookie nor any CORS grant.
 */
export function requestGuard(request: Request, response: Response, next: NextFunction): void {
  if (!isOriginForm(request) || request.path !== requestPathname(request)) {
    guardLogger.debug({ event: 'bad-request-target', method: request.method })
    response.status(400).json({ code: 'bad-request-target', message: 'request target is not a plain origin-form path' })
    return
  }
  if (classifyApiPath(requestPathname(request)).api && !isCockpitHost(headerValue(request.headers.host))) {
    rejectCrossOrigin(guardLogger, request, response, 'host')
    return
  }
  next()
}

const guardLogger = new Logger('CockpitApiGuard')

function isOriginForm(request: Pick<Request, 'originalUrl'>): boolean {
  return request.originalUrl.startsWith('/') && !NON_ORIGIN_FORM_CHARACTER.test(request.originalUrl)
}

/** Characters that are not valid unescaped in an RFC 9112 origin-form target
 * and that send `parseurl` off its fast path or get normalized by it:
 * controls and space, `#`, `\`, DEL, and anything non-ASCII. */
// eslint-disable-next-line no-control-regex
const NON_ORIGIN_FORM_CHARACTER = /[\u0000-\u0020#\\\u007f-\uffff]/

function rejectCrossOrigin(logger: Logger, request: Request, response: Response, reason: 'host' | 'origin' | 'fetch-site'): void {
  // Never echo request headers back (attacker-controlled), never log cookies.
  logger.debug({ event: 'cross-origin-rejected', method: request.method, path: requestPathname(request), reason })
  response.status(403).json({ code: 'cross-origin-rejected', message: 'request origin is not the cockpit' })
}

export interface ApiRoute {
  /** Case-folded pathname, the form every decision below is made on. */
  readonly pathname: string
  readonly api: boolean
  readonly bootstrap: boolean
  readonly bridgeCallback: boolean
}

/**
 * The single classification of a request path shared by the auth guard and
 * the CORS policy. Case-folded because Express routes case-insensitively by
 * default (`/API/devices` reaches the `/api/devices` handler): any decision
 * made on the raw path would let a mixed-case variant skip it.
 */
export function classifyApiPath(pathname: string): ApiRoute {
  const folded = pathname.toLowerCase()
  const api = folded.startsWith('/api/')
  return {
    pathname: folded,
    api,
    bootstrap: api && folded === '/api/bootstrap',
    bridgeCallback: api && BRIDGE_CALLBACK_ROUTES.includes(folded),
  }
}

/** The cockpit only listens on the IPv4 loopback; it is reachable as
 * `127.0.0.1` or `localhost`, with an optional port, and nothing else — no
 * userinfo, no path, no other hostname that merely resolves here. */
export function isCockpitHost(host: string | undefined): host is string {
  const match = host === undefined ? null : /^(?:127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/i.exec(host)
  if (match === null) return false
  const port = match[1] === undefined ? 80 : Number(match[1])
  return port >= 1 && port <= 65_535
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Extracts the true request pathname (no query string), from `originalUrl`
 * rather than `path` — see the comment in `use()` for why. A missing/empty
 * `originalUrl` (never happens on a real Express request, but a test double
 * might omit it) falls back to `path` rather than throwing, so a malformed
 * request still fails closed (gated) instead of crashing the pipeline. */
export function requestPathname(request: Pick<Request, 'originalUrl' | 'path'>): string {
  const raw = request.originalUrl
  if (typeof raw !== 'string' || raw === '') return request.path
  const queryIndex = raw.indexOf('?')
  return queryIndex < 0 ? raw : raw.slice(0, queryIndex)
}

/** Only API paths need the cookie; static assets and the bootstrap endpoint
 * (which issues the cookie) are exempt. Case-insensitive, matching Express's
 * default routing — see the comment in `use()`. */
export function requiresToken(pathname: string): boolean {
  const route = classifyApiPath(pathname)
  return route.api && !route.bootstrap
}

/**
 * Routes a device's bridge plugin calls directly — the implementation of the
 * spec requirement "bridge 回调路由名单" (cockpit-api-auth), its single
 * authoritative source. Exact, lowercase, no prefix matching.
 *
 * These arrive cross-origin from the device's own DSH page, so they carry no
 * cockpit cookie by construction — the capability header is their credential
 * and the controller validates it. Anything reachable from the bridge MUST be
 * listed here, or it is rejected no matter how valid its capability is.
 */
export const BRIDGE_CALLBACK_ROUTES: readonly string[] = [
  '/api/bridge/hello',
  '/api/bridge/session-opened',
  '/api/bridge/pending-snapshot',
  '/api/bridge/forwards/acquire',
  '/api/bridge/forwards/release',
]

export function parseCookie(header: string | undefined): Record<string, string> {
  if (header === undefined) return {}
  const result: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    result[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  }
  return result
}