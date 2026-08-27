import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { TokenService } from './token.js'

/** Requires the cockpit cookie on every route. The token is persisted in the
 * data directory; a fresh install resolves it lazily and sets it once. Other
 * local processes or malicious web pages cannot read an HttpOnly cookie, so
 * this gates access to the loopback service. */
@Injectable()
export class TokenMiddleware implements NestMiddleware {
  constructor(@Inject(TokenService) private readonly tokens: TokenService) {}

  async use(request: Request, response: Response, next: NextFunction): Promise<void> {
    const token = await this.tokens.resolve()
    const cookie = parseCookie(request.headers.cookie)
    if (!this.tokens.verify(cookie?.cockpit_token)) {
      // First visit: issue the HttpOnly cookie in the 401 body only once.
      response.setHeader('Set-Cookie', `cockpit_token=${token}; HttpOnly; SameSite=Strict; Path=/`)
      response.status(401).json({ code: 'unauthorized', message: 'missing or invalid cockpit token' })
      return
    }
    next()
  }
}

function parseCookie(header: string | undefined): Record<string, string> {
  if (header === undefined) return {}
  const result: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    result[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  }
  return result
}