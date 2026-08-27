import 'reflect-metadata'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module.js'

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] })
  app.enableShutdownHooks()

  const here = path.dirname(fileURLToPath(import.meta.url))
  // src/main.ts (dev) or dist/main.js (built) both resolve to repository root.
  const repoRoot = path.resolve(here, '../../..')
  const webDist = path.join(repoRoot, 'packages/cockpit-web/dist')
  app.useStaticAssets(webDist)

  await app.listen(3090, '127.0.0.1')

  // The browser keeps one SSE connection open forever (EventSource). Node's
  // server.close() waits for every HTTP connection to end, so Ctrl-C would
  // hang until the browser tab closes. Force-drop all connections on signal so
  // shutdown is immediate; the SSE client reconnects on the next launch.
  const server = app.getHttpServer() as import('node:http').Server
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.closeAllConnections?.()
    })
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  void bootstrap()
}