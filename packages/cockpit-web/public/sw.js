/* DSH Cockpit service worker.
 *
 * Goals: the cockpit shell is installable and opens offline. It does NOT
 * cache the device workbench iframes (cross-origin 127.0.0.1:<port>) nor the
 * SSE event streams, which must always go to the network.
 *
 * Strategy:
 *  - install: precache the app shell (/, index.html, manifest, icons).
 *    Hashed /assets/* files are NOT hard-coded here (they change per build);
 *    they are populated on first use by the cache-first rule below.
 *  - navigate (HTML): network-first, fall back to the cached shell, and write
 *    the fresh response back to cache so the offline shell tracks the latest
 *    deployed build.
 *  - /assets/* (hashed, immutable) + manifest + icons: cache-first, populate
 *    on miss.
 *  - /api/* GET (device list, status facts): network-first, fall back to the
 *    last cached response so the shell can render the last known state
 *    offline. POST/PUT (bootstrap, reconnect, ack) are untouched.
 *  - text/event-stream (EventSource): network only, never cached — a cached
 *    stream would be a dead stream.
 *
 * When behavior changes, bump CACHE_VERSION so the old cache is purged on
 * activation (skipWaiting + clientsClaim take over without a prompt).
 */
const CACHE_VERSION = 'cockpit-shell-v2'
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION)
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

const isEventStream = (request) => request.headers.get('accept')?.includes('text/event-stream') === true

const isApi = (request) => new URL(request.url).pathname.startsWith('/api/')

const isImmutableAsset = (request) => {
  const { pathname } = new URL(request.url)
  return pathname.startsWith('/assets/')
    || pathname === '/manifest.webmanifest'
    || pathname.startsWith('/icons/')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Non-GET and SSE always go to the network — never cached, never answered
  // from cache (a cached stream is a dead stream).
  if (request.method !== 'GET' || isEventStream(request)) return
  // The device workbench iframes (127.0.0.1:<other port>) are out of scope.
  if (new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate' || isApi(request)) {
    // Network-first: fresh HTML/API data while online; cached shell / last
    // known API response when offline. Successful navigations AND API GETs
    // refresh their cache copy, so the offline shell always matches the last
    // deployed build (e.g. theme changes reach offline users on next reload).
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request)
        const cache = await caches.open(CACHE_VERSION)
        void cache.put(request, fresh.clone())
        return fresh
      } catch {
        const cache = await caches.open(CACHE_VERSION)
        const hit = await cache.match(request)
        if (hit !== undefined) return hit
        if (request.mode === 'navigate') {
          const shell = await cache.match('/')
          if (shell !== undefined) return shell
        }
        return Response.error()
      }
    })())
    return
  }

  if (isImmutableAsset(request)) {
    // Hashed /assets files never change under the same name; icons and the
    // manifest are precached. Cache-first with on-miss population.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION)
      const hit = await cache.match(request)
      if (hit !== undefined) return hit
      const fresh = await fetch(request)
      if (fresh.ok) void cache.put(request, fresh.clone())
      return fresh
    })())
  }
})