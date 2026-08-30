import { Controller, Get, Headers, HttpCode, HttpException, HttpStatus, Inject, Post } from '@nestjs/common'
import { RuntimeControlService } from './runtime-control.service.js'
import type { RuntimeRecord } from './runtime-record.js'

@Controller('api/runtime')
export class RuntimeController {
  constructor(@Inject(RuntimeControlService) private readonly runtime: RuntimeControlService) {}

  @Get('status')
  status(): RuntimeRecord {
    return this.runtime.status()
  }

  @Post('shutdown')
  @HttpCode(HttpStatus.ACCEPTED)
  shutdown(@Headers('x-cockpit-instance') instanceId: string | undefined): { accepted: true } {
    try {
      return this.runtime.requestShutdown(instanceId)
    } catch (cause) {
      throw new HttpException({
        code: 'runtime-instance-mismatch',
        message: cause instanceof Error ? cause.message : 'runtime instance mismatch',
      }, HttpStatus.CONFLICT)
    }
  }
}
