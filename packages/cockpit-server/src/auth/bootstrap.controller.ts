import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'
import { Inject } from '@nestjs/common'
import { TokenService } from './token.js'

/** Issues the HttpOnly cockpit cookie on first visit so the shell can start
 * making authenticated API calls without a manual reload. */
@Controller('api')
export class BootstrapController {
  constructor(@Inject(TokenService) private readonly tokens: TokenService) {}

  @Get('bootstrap')
  async bootstrap(@Res({ passthrough: true }) response: Response): Promise<{ ok: true }> {
    const token = await this.tokens.resolve()
    response.setHeader('Set-Cookie', `cockpit_token=${token}; HttpOnly; SameSite=Strict; Path=/`)
    return { ok: true }
  }
}