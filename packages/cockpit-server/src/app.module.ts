import { Module } from '@nestjs/common'
import { DevicesController } from './devices/devices.controller.js'
import { ConnectivityModule } from './connectivity/connectivity.module.js'
import { AuthModule } from './auth/auth.module.js'
import { RuntimeModule } from './runtime/runtime.module.js'

@Module({
  imports: [ConnectivityModule, AuthModule, RuntimeModule],
  controllers: [DevicesController],
})
export class AppModule {}
