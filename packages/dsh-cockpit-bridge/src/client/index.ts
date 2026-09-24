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
 * settings, credentials or content. Cross-boundary traffic remains limited to
 * minimal state identifiers and parent-supplied connection metadata. Stable
 * same-page services may consume that metadata without opening a second
 * iframe-to-Cockpit channel.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  BRIDGE_CONFIG_MESSAGE,
  CAPABILITY_EXPIRED_MESSAGE,
  COCKPIT_EDITOR_OPEN_SERVICE,
  COCKPIT_PORT_FORWARD_SERVICE,
  DEVICE_ACTIVATED_MESSAGE,
  createRemoteEditorUri,
  isValidDevicePort,
  isValidPortForwardChannelId,
  isValidSshAlias,
  type BridgeConfigMessage,
  type CockpitEditorOpenService,
  type CockpitPortForwardService,
  type PortForwardHandle,
} from '@dsh-cockpit/shared'

export const inject = ['sessions', 'uiSession']

const CAPABILITY_HEADER = 'x-dsh-cockpit-bridge-capability'
const PLUGIN_VERSION = '0.5.1'
const PROTOCOL_VERSION = 2
const PENDING_PROTOCOL_VERSION = 3
const PENDING_SEAM_VERSION = 1

// These limits are deliberately implementation details rather than protocol.
const FLUSH_DELAY_MS = 250
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 30_000
const REQUEST_TIMEOUT_MS = 10_000
const OUTBOX_TTL_MS = 5 * 60_000
const OUTBOX_CAPACITY = 32
/** How long a seam call waits for the parent to supply a fresh capability. */
const CAPABILITY_RENEWAL_WAIT_MS = 5_000
const CAPABILITY_RENEWAL_POLL_MS = 100
const CLEARED_KEY = '\u0000selection-cleared'

interface BridgeConfig {
  cockpitOrigin: string
  capability: string
  sshAlias?: string
}

interface OutboxEntry {
  key: string
  sessionId?: string
  current: string | null
  updatedAt: number
}

function parseConfig(event: MessageEvent): BridgeConfig | undefined {
  if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null) return
  const data = event.data as Partial<BridgeConfigMessage>
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
  return {
    cockpitOrigin: data.cockpitOrigin,
    capability: data.capability,
    ...(isValidSshAlias(data.sshAlias) ? { sshAlias: data.sshAlias } : {}),
  }
}

function isActivation(event: MessageEvent, config: BridgeConfig | undefined): boolean {
  return config !== undefined
    && event.source === window.parent
    && event.origin === config.cockpitOrigin
    && typeof event.data === 'object'
    && event.data !== null
    && (event.data as { type?: unknown }).type === DEVICE_ACTIVATED_MESSAGE
}

interface PendingInteraction { readonly sessionId: string; readonly kind: 'approval' | 'question'; readonly key: string }
interface PendingObservable { getSnapshot(): ReadonlyMap<string, PendingInteraction>; subscribe(listener: () => void): () => void }
type BridgeContext = Context & {
  readonly sessions: { readonly list: { getSnapshot(): { readonly current?: string }; subscribe(listener: () => void): () => void } }
  readonly uiSession: { readonly pendingInteractions: PendingObservable }
}

export function apply(ctx: BridgeContext): void {
  // Stable, consumer-agnostic seam. The object is provided immediately so
  // other plugins can discover it regardless of load order; every call reads
  // the latest asynchronously received bridge config. Missing/invalid config
  // throws synchronously so a consumer can fall back to its local behavior.
  let config: BridgeConfig | undefined
  const editorOpen: CockpitEditorOpenService = {
    open(path: string): void {
      const sshAlias = config?.sshAlias
      if (sshAlias === undefined) throw new Error('cockpit remote editor is unavailable')
      const uri = createRemoteEditorUri(sshAlias, path)
      window.open(uri, '_blank')
    },
  }
  ctx.provide(COCKPIT_EDITOR_OPEN_SERVICE, editorOpen)

  /** Second seam, same contract shape as editorOpen: provided immediately,
   * consumer-agnostic, and unavailable-by-throwing so a consumer can fall back
   * to its own loopback address. Unlike editorOpen this one reaches the
   * cockpit server (it creates an ssh forward), so the capability header is
   * mandatory and a rejection is surfaced rather than swallowed. */
  /** One capability-bearing POST; no retry, no renewal. */
  const seamFetch = async (path: string, body: object, active: BridgeConfig): Promise<Response> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
    try {
      return await fetch(`${active.cockpitOrigin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CAPABILITY_HEADER]: active.capability },
        body: JSON.stringify({ ...body, protocolVersion: PROTOCOL_VERSION }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Wait for the parent to hand down a capability different from the stale one.
   *
   * Capabilities live ~60s, and this seam is driven by a human click that can
   * land long after the page loaded — so an expired capability is the NORMAL
   * case here, not an error. Asking the parent and waiting briefly turns it
   * into a transparent retry instead of a user-visible 401.
   */
  const renewConfig = async (stale: BridgeConfig): Promise<BridgeConfig | undefined> => {
    try {
      window.parent.postMessage({ type: CAPABILITY_EXPIRED_MESSAGE }, stale.cockpitOrigin)
    } catch {
      return undefined
    }
    for (let waited = 0; waited < CAPABILITY_RENEWAL_WAIT_MS; waited += CAPABILITY_RENEWAL_POLL_MS) {
      await new Promise(resolve => setTimeout(resolve, CAPABILITY_RENEWAL_POLL_MS))
      const next = config
      if (next !== undefined && next.capability !== stale.capability) return next
    }
    return undefined
  }

  const seamRequest = async (path: string, body: object): Promise<unknown> => {
    const active = config
    if (active === undefined) throw new Error('cockpit port forward is unavailable')
    let response = await seamFetch(path, body, active)
    if (response.status === 401 || response.status === 400) {
      // The renewal path below is the one the reporting callbacks already use;
      // this seam needs it too, because a click can arrive after the page has
      // been sitting idle for minutes.
      const renewed = await renewConfig(active)
      if (renewed !== undefined) response = await seamFetch(path, body, renewed)
    }
    if (!response.ok) throw new Error(`cockpit port forward rejected (${response.status})`)
    return await response.json()
  }

  const portForward: CockpitPortForwardService = {
    async register(channelId: string, devicePort: number): Promise<void> {
      if (!isValidPortForwardChannelId(channelId)) throw new Error('invalid channel id')
      if (!isValidDevicePort(devicePort)) throw new Error('invalid device port')
      await seamRequest('/api/bridge/publishable-port', { channelId, devicePort })
    },
    async publish(channelId: string): Promise<PortForwardHandle> {
      if (!isValidPortForwardChannelId(channelId)) throw new Error('invalid channel id')
      const result = await seamRequest('/api/bridge/publish-port', { channelId }) as { url?: unknown }
      if (typeof result?.url !== 'string' || result.url === '') throw new Error('cockpit returned no forward url')
      return { channelId, url: result.url }
    },
  }
  ctx.provide(COCKPIT_PORT_FORWARD_SERVICE, portForward)

  ctx.effect(() => {
    let helloReady = false
    let disposed = false
    let running = false
    let rerunRequested = false
    let failureCount = 0
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let lastSelection = ctx.sessions.list.getSnapshot().current
    let pendingDirty = ctx.uiSession !== undefined
    let pendingFingerprint = ''
    const outbox = new Map<string, OutboxEntry>()


    const pendingSnapshot = (): readonly PendingInteraction[] => {
      const source = ctx.uiSession?.pendingInteractions.getSnapshot()
      if (source === undefined) return []
      return [...source.values()]
        .filter(item => item.kind === 'approval' || item.kind === 'question')
        .map(item => ({ sessionId: item.sessionId, kind: item.kind, key: item.key }))
        .sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.key.localeCompare(right.key))
    }

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

    /** Read the structured error code the cockpit returns, when present. */
    const readErrorCode = async (response: Response): Promise<string | undefined> => {
      try {
        const body = await response.json() as { code?: unknown }
        return typeof body.code === 'string' ? body.code : undefined
      } catch {
        return undefined
      }
    }

    const isCapabilityFailure = (status: number | undefined, code: string | undefined): boolean =>
      status === 401 || (status === 400 && code === 'bridge-capability-invalid')

    const fail = (status: number | undefined, code: string | undefined, activeConfig: BridgeConfig | undefined): void => {
      if (activeConfig !== undefined && isCapabilityFailure(status, code)) {
        // Invalid/expired capability: the parent must issue a fresh one.
        // Resetting helloReady re-runs the hello with the next config; the
        // capability-expired message is the backstop for hidden iframes
        // where the parent's renewal timer is throttled.
        helloReady = false
        try {
          window.parent.postMessage({ type: CAPABILITY_EXPIRED_MESSAGE }, activeConfig.cockpitOrigin)
        } catch {
          // Parent gone: stays quiet, outbox keeps the ack for the next
          // recovery opportunity.
        }
      }
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
            fail(undefined, undefined, activeConfig)
            return
          }
          if (!response.ok) {
            failed = true
            fail(response.status, await readErrorCode(response), activeConfig)
            return
          }
          if (config !== activeConfig) {
            rerunRequested = true
            return
          }
          helloReady = true
          pendingDirty = ctx.uiSession !== undefined
          failureCount = 0
          // A successful hello is a recovery point. Re-asserting the current
          // selection also recreates an ack that may have expired from outbox.
          const current = ctx.sessions.list.getSnapshot().current
          if (current !== undefined) enqueue(current)
        }

        if (pendingDirty && ctx.uiSession !== undefined) {
          const items = pendingSnapshot()
          const fingerprint = JSON.stringify(items)
          let response: Response
          try {
            response = await post('/api/bridge/pending-snapshot', {
              protocolVersion: PENDING_PROTOCOL_VERSION,
              seamVersion: PENDING_SEAM_VERSION,
              items,
            }, activeConfig)
          } catch {
            failed = true
            fail(undefined, undefined, activeConfig)
            return
          }
          if (!response.ok) {
            failed = true
            fail(response.status, await readErrorCode(response), activeConfig)
            return
          }
          pendingFingerprint = fingerprint
          pendingDirty = false
          failureCount = 0
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
            fail(undefined, undefined, activeConfig)
            return
          }
          if (!response.ok) {
            failed = true
            fail(response.status, await readErrorCode(response), activeConfig)
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
    const unsubscribePending = ctx.uiSession?.pendingInteractions.subscribe(() => {
      const fingerprint = JSON.stringify(pendingSnapshot())
      if (fingerprint === pendingFingerprint) return
      pendingDirty = true
      requestRun(FLUSH_DELAY_MS, true)
    })
    const onMessage = (event: MessageEvent): void => {
      const nextConfig = parseConfig(event)
      if (nextConfig !== undefined && (config === undefined || nextConfig.cockpitOrigin === config.cockpitOrigin)) {
        config = nextConfig
        // A pure capability renewal must NOT re-assert the current selection:
        // that would acknowledge a completion the user has not actually seen
        // (the parent renews periodically while the user is elsewhere).
        // helloReady is kept as-is: the initial handshake still runs the
        // hello, but a later renewal only retries retained acknowledgements
        // with the fresh capability. A real activation below re-asserts.
        requestRun(0, true)
        return
      }
      if (!isActivation(event, config)) return
      const current = ctx.sessions.list.getSnapshot().current
      if (current !== undefined) enqueue(current)
      pendingDirty = ctx.uiSession !== undefined
      helloReady = false
      requestRun(0, true)
    }
    window.addEventListener('message', onMessage)

    return () => {
      disposed = true
      clearFlushTimer()
      clearRetryTimer()
      unsubscribe()
      unsubscribePending?.()
      window.removeEventListener('message', onMessage)
      outbox.clear()
    }
  }, 'cockpit-bridge: reliable current session acknowledgement')
}
