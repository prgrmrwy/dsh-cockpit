import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { TokenService } from './token.js'
import { TokenMiddleware } from './token.middleware.js'
import { BootstrapController } from './bootstrap.controller.js'

@Module({
  controllers: [BootstrapController],
  providers: [
    {
      provide: TokenService,
      useFactory: () => {
        const home = process.env.DSH_COCKPIT_HOME ?? `${process.env.HOME ?? ''}/.dsh-cockpit`
        return new TokenService(home)
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