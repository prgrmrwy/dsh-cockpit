// PWA registration — production builds only. Registering in dev (vite, 5173)
// would let the service worker cache HMR responses and stale the dev server,
// so the register call is gated on import.meta.env.PROD.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch((cause: unknown) => {
    console.warn('[pwa] service worker registration failed', cause)
  })
}