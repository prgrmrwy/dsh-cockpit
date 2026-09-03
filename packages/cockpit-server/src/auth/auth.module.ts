import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { TokenService } from './token.js'
import { TokenMiddleware } from './token.middleware.js'
import { BootstrapController } from './bootstrap.controller.js'
import { resolveCockpitHome } from '../runtime/config.js'
import { BridgeCapabilityService } from './bridge-capability.js'

@Module({
  controllers: [BootstrapController],
  providers: [
    BridgeCapabilityService,
    {
      provide: TokenService,
      useFactory: () => {
        return new TokenService(resolveCockpitHome())
      },
    },
  ],
  exports: [TokenService, BridgeCapabilityService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The middleware itself exempts static assets and /api/bootstrap; apply
    // globally so any future API route is gated by default.
    //
    // NOT a bare '*': this app runs on Express 5 (path-to-regexp v8), where a
    // bare '*' is invalid pattern syntax. NestJS's route compilation swallows
    // that per-route error instead of throwing, so `forRoutes('*')` silently
    // registers for ZERO routes — every /api/* endpoint (device CRUD, the
    // bridge capability/hello/session-opened routes this change adds, etc.)
    // ran completely unauthenticated regardless of cookie. '/{*splat}' is the
    // Express 5 / path-to-regexp v8 catch-all form and is verified (see
    // token.middleware.test.ts) to actually match every request path.
    consumer.apply(TokenMiddleware).forRoutes('/{*splat}')
  }
}
