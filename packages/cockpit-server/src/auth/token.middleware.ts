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
    const pathname = request.path
    if (!requiresToken(pathname)) {
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

/** Only API paths need the cookie; static assets and the bootstrap endpoint
 * (which issues the cookie) are exempt. */
export function requiresToken(pathname: string): boolean {
  return pathname.startsWith('/api/') && pathname !== '/api/bootstrap'
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