import { Module } from '@nestjs/common'
import { StorageModule } from '../storage/storage.module.js'
import { AuthModule } from '../auth/auth.module.js'
import { ConnectivityService } from './connectivity.service.js'
import { DeviceEventsService } from './device-events.service.js'

@Module({
  imports: [StorageModule, AuthModule],
  providers: [ConnectivityService, DeviceEventsService],
  exports: [ConnectivityService, DeviceEventsService],
})
export class ConnectivityModule {}