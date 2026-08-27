import { Module } from '@nestjs/common'
import { StorageModule } from '../storage/storage.module.js'
import { ConnectivityService } from './connectivity.service.js'

@Module({
  imports: [StorageModule],
  providers: [ConnectivityService],
  exports: [ConnectivityService],
})
export class ConnectivityModule {}