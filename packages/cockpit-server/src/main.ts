import 'reflect-metadata'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createCockpitApp } from './app-factory.js'
import { resolveCockpitPort } from './runtime/config.js'
import { RuntimeControlService } from './runtime/runtime-control.service.js'

export async function bootstrap(): Promise<void> {
  const app = await createCockpitApp()
  app.enableShutdownHooks()

  const here = path.dirname(fileURLToPath(import.meta.url))
  // src/main.ts (dev) or dist/main.js (built) both resolve to repository root.
  const repoRoot = path.resolve(here, '../../..')
  const webDist = path.join(repoRoot, 'packages/cockpit-web/dist')
  // Static files are served BEFORE the module middleware (TokenMiddleware),
  // behind only the factory's request-target/Host guard. The web build must
  // therefore never emit anything under `api/`: such a file would be served
  // without the cockpit cookie. (The Vite build does not.)
  app.useStaticAssets(webDist)

  const port = resolveCockpitPort()
  await app.listen(port, '127.0.0.1')

  // The browser keeps one SSE connection open forever (EventSource). Node's
  // server.close() waits for every HTTP connection to end, so Ctrl-C would
  // hang until the browser tab closes. Force-drop all connections on signal so
  // shutdown is immediate; the SSE client reconnects on the next launch.
  const server = app.getHttpServer() as import('node:http').Server
  const runtime = app.get(RuntimeControlService)
  await runtime.activate({
    port,
    repoRoot,
    shutdown: async () => {
      server.closeAllConnections?.()
      await app.close()
    },
  })
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
