import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `main.ts#bootstrap()` must build the app through the SAME factory the e2e
 * tests use. Otherwise an e2e suite can prove the security configuration
 * (CORS, frame-ancestors, middleware order) while production silently skips
 * it — the exact gap this factory exists to close.
 */
const createCockpitApp = vi.fn()
vi.mock('../src/app-factory.js', () => ({ createCockpitApp }))

describe('main.ts bootstrap', () => {
  afterEach(() => {
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    vi.unstubAllEnvs()
  })

  it('creates the app through createCockpitApp()', async () => {
    // Isolate from the real cockpit home in case the factory is bypassed (the
    // red phase of this test boots the real app).
    vi.stubEnv('DSH_COCKPIT_HOME', path.join(tmpdir(), `cockpit-main-${process.pid}`))
    vi.stubEnv('COCKPIT_PORT', '3999')
    const activate = vi.fn(async () => undefined)
    const listen = vi.fn(async () => undefined)
    createCockpitApp.mockResolvedValue({
      enableShutdownHooks: vi.fn(),
      useStaticAssets: vi.fn(),
      listen,
      getHttpServer: () => ({ closeAllConnections: vi.fn() }),
      get: () => ({ activate }),
      close: vi.fn(),
    })
    const { bootstrap } = await import('../src/main.js')
    await bootstrap()
    expect(createCockpitApp).toHaveBeenCalledTimes(1)
    expect(listen).toHaveBeenCalledWith(3999, '127.0.0.1')
    expect(activate).toHaveBeenCalledTimes(1)
  })
})
