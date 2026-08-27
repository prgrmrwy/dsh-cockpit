import { Module } from '@nestjs/common'
import { StorageModule } from '../storage/storage.module.js'
import { ConnectivityService } from './connectivity.service.js'
import { DeviceEventsService } from './device-events.service.js'

@Module({
  imports: [StorageModule],
  providers: [ConnectivityService, DeviceEventsService],
  exports: [ConnectivityService, DeviceEventsService],
})
export class ConnectivityModule {}