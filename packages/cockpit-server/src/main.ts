import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

/** Loopback-only listener: the cockpit is a local tool, never exposed. */
export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] })
  app.enableShutdownHooks()
  await app.listen(3090, '127.0.0.1')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void bootstrap()
}