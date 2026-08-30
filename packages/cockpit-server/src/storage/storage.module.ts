import { Module } from '@nestjs/common'
import { DeviceRegistry } from './registry.js'
import { resolveCockpitHome } from '../runtime/config.js'

/** Storage directory + atomic device registry. */
@Module({
  providers: [
    {
      provide: DeviceRegistry,
      useFactory: () => {
        return new DeviceRegistry(resolveCockpitHome())
      },
    },
  ],
  exports: [DeviceRegistry],
})
export class StorageModule {}
