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
    // Host first, before ANY exemption: a DNS-rebinding page reaches this
    // loopback port under its own hostname, and must not get the bootstrap
    // cookie or the 401's Set-Cookie either.
    const host = headerValue(request.headers.host)
    if (!isCockpitHost(host)) {
      this.#reject(request, response, 'host')
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
        this.#reject(request, response, 'origin')
        return
      }
      const fetchSite = headerValue(request.headers['sec-fetch-site'])
      if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        this.#reject(request, response, 'fetch-site')
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

  #reject(request: Request, response: Response, reason: 'host' | 'origin' | 'fetch-site'): void {
    // Never echo request headers back (attacker-controlled), never log cookies.
    this.#logger.debug({ event: 'cross-origin-rejected', method: request.method, path: requestPathname(request), reason })
    response.status(403).json({ code: 'cross-origin-rejected', message: 'request origin is not the cockpit' })
  }
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
  return host !== undefined && /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(host)
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
  '/api/bridge/publishable-port',
  '/api/bridge/publish-port',
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