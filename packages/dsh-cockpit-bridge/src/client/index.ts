/**
 * Cockpit bridge — official DSH web client plugin.
 *
 * Runs INSIDE each device's own DSH web client (cordis bundle, same origin as
 * the device's DSH). The official workspace sidebar opens a session through
 * `ctx.sessions.open(id)` → `SessionManager.select`, which is browser-local
 * state with NO server-visible signal; the cockpit cannot observe it from the
 * event stream. This plugin is the bridge: it subscribes to the sessions list
 * store and, when the CURRENT session changes (the user clicked a session),
 * reports `{ sessionId }` to the cockpit over HTTP.
 *
 * The cockpit matches the device by the request's Origin (this page runs at
 * 127.0.0.1:<device port>), then clears exactly that session's green
 * "completed" reminder — the official select() semantics, but observed by the
 * cockpit instead of lost in the browser.
 *
 * Non-goals (by design): nothing here reads or forwards any conversation,
 * settings, credentials or content — only the session id of a user-initiated
 * selection crosses the bridge.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const inject = ['sessions']

const BRIDGE_CONFIG_MESSAGE = 'dsh-cockpit:bridge-config'
const DEVICE_ACTIVATED_MESSAGE = 'dsh-cockpit:device-activated'
const CAPABILITY_HEADER = 'x-dsh-cockpit-bridge-capability'
const PLUGIN_VERSION = '0.2.0'
const PROTOCOL_VERSION = 2

// These limits are deliberately implementation details rather than protocol.
const FLUSH_DELAY_MS = 250
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 30_000
const REQUEST_TIMEOUT_MS = 10_000
const OUTBOX_TTL_MS = 5 * 60_000
const OUTBOX_CAPACITY = 32
const CLEARED_KEY = '\u0000selection-cleared'

interface BridgeConfig {
  cockpitOrigin: string
  capability: string
}

interface OutboxEntry {
  key: string
  sessionId?: string
  current: string | null
  updatedAt: number
}

function parseConfig(event: MessageEvent): BridgeConfig | undefined {
  if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null) return
  const data = event.data as { type?: unknown; cockpitOrigin?: unknown; capability?: unknown }
  if (data.type !== BRIDGE_CONFIG_MESSAGE || typeof data.cockpitOrigin !== 'string' || typeof data.capability !== 'string' || data.capability === '') return
  try {
    const url = new URL(data.cockpitOrigin)
    // The sender is the claimed Cockpit origin. Requiring canonical origin form
    // prevents a path, credentials, or a look-alike origin from becoming the
    // base for capability-bearing requests.
    if (url.origin !== data.cockpitOrigin || event.origin !== data.cockpitOrigin) return
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return
  } catch {
    return
  }
  return { cockpitOrigin: data.cockpitOrigin, capability: data.capability }
}

function isActivation(event: MessageEvent, config: BridgeConfig | undefined): boolean {
  return config !== undefined
    && event.source === window.parent
    && event.origin === config.cockpitOrigin
    && typeof event.data === 'object'
    && event.data !== null
    && (event.data as { type?: unknown }).type === DEVICE_ACTIVATED_MESSAGE
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    let config: BridgeConfig | undefined
    let helloReady = false
    let disposed = false
    let running = false
    let rerunRequested = false
    let failureCount = 0
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let lastSelection = ctx.sessions.list.getSnapshot().current
    const outbox = new Map<string, OutboxEntry>()

    const currentKey = (): string | undefined => {
      const current = ctx.sessions.list.getSnapshot().current
      return current === undefined ? undefined : current
    }

    const purgeExpired = (now = Date.now()): void => {
      for (const [key, entry] of outbox) {
        if (now - entry.updatedAt >= OUTBOX_TTL_MS) outbox.delete(key)
      }
    }

    const enforceCapacity = (): void => {
      while (outbox.size > OUTBOX_CAPACITY) {
        const protectedKey = currentKey()
        const oldestNonCurrent = [...outbox.keys()].find(key => key !== protectedKey)
        outbox.delete(oldestNonCurrent ?? outbox.keys().next().value as string)
      }
    }

    const enqueue = (current: string | undefined): void => {
      const key = current ?? CLEARED_KEY
      // Re-insertion makes a duplicate pending ID recent without increasing the
      // bounded set, which also gives archive-clear/reopen ordering semantics.
      outbox.delete(key)
      outbox.set(key, {
        key,
        ...(current === undefined ? {} : { sessionId: current }),
        current: current ?? null,
        updatedAt: Date.now(),
      })
      purgeExpired()
      enforceCapacity()
    }

    const post = async (path: string, body: object, activeConfig: BridgeConfig): Promise<Response> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
      try {
        return await fetch(`${activeConfig.cockpitOrigin}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [CAPABILITY_HEADER]: activeConfig.capability,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
    }

    const clearFlushTimer = (): void => {
      if (flushTimer !== undefined) clearTimeout(flushTimer)
      flushTimer = undefined
    }

    const clearRetryTimer = (): void => {
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      retryTimer = undefined
    }

    const scheduleRetry = (): void => {
      if (disposed || config === undefined || retryTimer !== undefined) return
      const exponent = Math.min(failureCount, 16)
      const delay = Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS)
      failureCount += 1
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void run()
      }, delay)
    }

    const fail = (status?: number): void => {
      if (status === 401) helloReady = false
      scheduleRetry()
    }

    const run = async (): Promise<void> => {
      if (disposed || config === undefined) return
      if (running) {
        rerunRequested = true
        return
      }
      running = true
      const activeConfig = config
      let failed = false
      try {
        if (!helloReady) {
          let response: Response
          try {
            const current = ctx.sessions.list.getSnapshot().current
            response = await post('/api/bridge/hello', {
              version: PLUGIN_VERSION,
              protocolVersion: PROTOCOL_VERSION,
              current: current ?? null,
            }, activeConfig)
          } catch {
            failed = true
            fail()
            return
          }
          if (!response.ok) {
            failed = true
            fail(response.status)
            return
          }
          if (config !== activeConfig) {
            rerunRequested = true
            return
          }
          helloReady = true
          failureCount = 0
          // A successful hello is a recovery point. Re-asserting the current
          // selection also recreates an ack that may have expired from outbox.
          const current = ctx.sessions.list.getSnapshot().current
          if (current !== undefined) enqueue(current)
        }

        purgeExpired()
        while (!disposed && config === activeConfig && outbox.size > 0) {
          const entry = outbox.values().next().value as OutboxEntry
          let response: Response
          try {
            response = await post('/api/bridge/session-opened', {
              protocolVersion: PROTOCOL_VERSION,
              ...(entry.sessionId === undefined ? {} : { sessionId: entry.sessionId }),
              current: entry.current,
            }, activeConfig)
          } catch {
            failed = true
            fail()
            return
          }
          if (!response.ok) {
            failed = true
            fail(response.status)
            return
          }
          // A selection may have been re-enqueued while this request was in
          // flight. Only remove the exact accepted entry, never its successor.
          if (outbox.get(entry.key) === entry) outbox.delete(entry.key)
          failureCount = 0
        }
      } catch {
        // This bridge must never leak failures into the host DSH page, including
        // unexpected mocks/polyfills throwing outside fetch itself.
        failed = true
        scheduleRetry()
      } finally {
        running = false
        if (rerunRequested && !disposed) {
          rerunRequested = false
          if (!failed) {
            clearRetryTimer()
            void run()
          }
        }
      }
    }

    const requestRun = (delay: number, recovery: boolean): void => {
      if (disposed || config === undefined) return
      if (recovery) {
        failureCount = 0
        clearRetryTimer()
      }
      clearFlushTimer()
      flushTimer = setTimeout(() => {
        flushTimer = undefined
        void run()
      }, delay)
    }

    const onSelectionChange = (): void => {
      // Capture now. Never defer getSnapshot(): a subsequent archive can clear
      // current before the 250 ms network batching window expires.
      const current = ctx.sessions.list.getSnapshot().current
      if (current === lastSelection) {
        // An ordinary store refresh stays deduplicated, but if this ID is still
        // pending after a failure it is an explicit recovery opportunity.
        const key = current ?? CLEARED_KEY
        if (outbox.has(key)) requestRun(FLUSH_DELAY_MS, true)
        return
      }
      lastSelection = current
      enqueue(current)
      requestRun(FLUSH_DELAY_MS, true)
    }

    const unsubscribe = ctx.sessions.list.subscribe(onSelectionChange)
    const onMessage = (event: MessageEvent): void => {
      const nextConfig = parseConfig(event)
      if (nextConfig !== undefined && (config === undefined || nextConfig.cockpitOrigin === config.cockpitOrigin)) {
        config = nextConfig
        helloReady = false
        // bridge-config doubles as activation/capability refresh: heartbeat,
        // current snapshot and all retained acknowledgements are retried.
        requestRun(0, true)
        return
      }
      if (!isActivation(event, config)) return
      const current = ctx.sessions.list.getSnapshot().current
      if (current !== undefined) enqueue(current)
      helloReady = false
      requestRun(0, true)
    }
    window.addEventListener('message', onMessage)

    return () => {
      disposed = true
      clearFlushTimer()
      clearRetryTimer()
      unsubscribe()
      window.removeEventListener('message', onMessage)
      outbox.clear()
    }
  }, 'cockpit-bridge: reliable current session acknowledgement')
}
