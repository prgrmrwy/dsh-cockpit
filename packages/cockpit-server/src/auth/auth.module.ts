import { Module, type NestModule, type MiddlewareConsumer } from '@nestjs/common'
import { TokenService } from './token.js'
import { TokenMiddleware } from './token.middleware.js'

@Module({
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
    consumer.apply(TokenMiddleware).forRoutes('*')
  }
}