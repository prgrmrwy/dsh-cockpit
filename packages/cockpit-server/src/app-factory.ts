import { NestFactory } from '@nestjs/core'
import type { LogLevel } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js'
import type { NextFunction, Request, Response } from 'express'
import { AppModule } from './app.module.js'
import { BRIDGE_CAPABILITY_HEADER, classifyApiPath, requestPathname } from './auth/token.middleware.js'

export interface CockpitAppOptions {
  readonly logger?: false | LogLevel[]
}

/**
 * The one place the cockpit HTTP app is built. `main.ts` and the e2e suites
 * both go through here, so whatever the e2e tests prove about the HTTP
 * security configuration is what production actually runs.
 *
 * Registration order is part of the contract (design D4):
 * 1. security response headers — first, so even responses that CORS or the
 *    auth guard end early (preflight 204, 401, 403) carry them;
 * 2. CORS;
 * 3. `listen`/`init`, by the caller.
 */
export async function createCockpitApp(options: CockpitAppOptions = {}): Promise<NestExpressApplication> {
  // `debug` is on by default deliberately: bridge callbacks that fail
  // capability or origin validation are the NORMAL self-healing path and are
  // recorded at debug with full structure (device/origin/reason/class) so they
  // stay diagnosable on demand, while WARN is reserved for genuine
  // self-healing failures. See connectivity/bridge-rejection-log.ts.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: options.logger ?? ['error', 'warn', 'log', 'debug'] })
  // Every response, including the ones CORS (preflight 204) or the auth guard
  // (401/403) end early: registered first. Only `frame-ancestors` — nothing
  // that would restrict the cockpit from framing device workbenches.
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
    next()
  })
  // Only bridge callbacks are cross-origin by design: the bridge plugin runs
  // inside each device's own DSH web client (127.0.0.1:<device port>) and
  // sends its capability in a header, never the cockpit cookie. Every other
  // route is used same-origin by the cockpit page and gets no CORS grant at
  // all — in particular no credentialed one for device origins.
  app.enableCors((request: Request, callback: (error: Error | null, options: CorsOptions) => void) => {
    if (!classifyApiPath(requestPathname(request)).bridgeCallback) {
      callback(null, { origin: false })
      return
    }
    callback(null, {
      origin: (origin, allow) => { allow(null, isLoopbackOrigin(origin)) },
      credentials: true,
      allowedHeaders: ['content-type', 'accept', BRIDGE_CAPABILITY_HEADER],
    })
  })
  return app
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return false
  try {
    const url = new URL(origin)
    // No IPv6: the cockpit only listens on 127.0.0.1, so a `[::1]` page could
    // never have been served a cockpit origin to call back to.
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  } catch { return false }
}
