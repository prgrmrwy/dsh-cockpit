import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { TokenService } from './token.js'

/**
 * Gates the cockpit API behind an HttpOnly cookie. Static assets (the shell
 * bundle, which contains no secrets) and `/api/bootstrap` (which issues the
 * cookie on first visit) are exempt; everything under `/api/` requires it.
 * Other local processes or malicious web pages cannot read an HttpOnly cookie,
 * so this protects the loopback service while staying usable from a browser.
 */
@Injectable()
export class TokenMiddleware implements NestMiddleware {
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
    const pathname = requestPathname(request)
    if (!requiresToken(pathname)) {
      next()
      return
    }
    const token = await this.tokens.resolve()
    const cookie = parseCookie(request.headers.cookie)
    // A bridge callback uses its own short-lived capability and is validated by
    // the controller. Never treat this header as the persistent cockpit token.
    if (isBridgeCallback(pathname) && request.headers['x-dsh-cockpit-bridge-capability'] !== undefined) {
      next()
      return
    }
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
 * (which issues the cookie) are exempt. */
export function requiresToken(pathname: string): boolean {
  return pathname.startsWith('/api/') && pathname !== '/api/bootstrap'
}

function isBridgeCallback(pathname: string): boolean {
  return pathname === '/api/bridge/hello' || pathname === '/api/bridge/session-opened'
}

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