import { Module } from '@nestjs/common'
import { DeviceRegistry } from './registry.js'

/** Storage directory + atomic device registry. */
@Module({
  providers: [
    {
      provide: DeviceRegistry,
      useFactory: () => {
        const home = process.env.DSH_COCKPIT_HOME ?? `${process.env.HOME ?? ''}/.dsh-cockpit`
        return new DeviceRegistry(home)
      },
    },
  ],
  exports: [DeviceRegistry],
})
export class StorageModule {}