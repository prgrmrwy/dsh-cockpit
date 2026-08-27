import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { TokenService } from './token.js'

/** Requires `Authorization: Bearer <token>` on every route. The token is read
 * lazily so a fresh install works before the service has resolved it. */
@Injectable()
export class TokenMiddleware implements NestMiddleware {
  constructor(private readonly tokens: TokenService) {}

  async use(request: Request, response: Response, next: NextFunction): Promise<void> {
    await this.tokens.resolve()
    const header = request.headers.authorization ?? ''
    const candidate = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!this.tokens.verify(candidate)) {
      response.status(401).json({ code: 'unauthorized', message: 'missing or invalid cockpit token' })
      return
    }
    next()
  }
}