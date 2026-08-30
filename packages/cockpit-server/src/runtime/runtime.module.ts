import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { resolveCockpitHome } from './config.js'
import { RuntimeControlService } from './runtime-control.service.js'
import { RuntimeController } from './runtime.controller.js'
import { RuntimeRecordStore } from './runtime-record.js'

@Module({
  imports: [AuthModule],
  controllers: [RuntimeController],
  providers: [
    {
      provide: RuntimeRecordStore,
      useFactory: () => new RuntimeRecordStore(resolveCockpitHome()),
    },
    RuntimeControlService,
  ],
  exports: [RuntimeControlService],
})
export class RuntimeModule {}
