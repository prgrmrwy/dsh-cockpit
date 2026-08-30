import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { TokenService } from './token.js'
import { TokenMiddleware } from './token.middleware.js'
import { BootstrapController } from './bootstrap.controller.js'
import { resolveCockpitHome } from '../runtime/config.js'

@Module({
  controllers: [BootstrapController],
  providers: [
    {
      provide: TokenService,
      useFactory: () => {
        return new TokenService(resolveCockpitHome())
      },
    },
  ],
  exports: [TokenService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The middleware itself exempts static assets and /api/bootstrap; apply
    // globally so any future API route is gated by default.
    consumer.apply(TokenMiddleware).forRoutes('*')
  }
}
