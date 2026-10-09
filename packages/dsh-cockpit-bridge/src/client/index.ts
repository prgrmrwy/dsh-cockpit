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
  COCKPIT_FORWARDS_SERVICE,
  DEVICE_ACTIVATED_MESSAGE,
  createRemoteEditorUri,
  isValidSshAlias,
  type BridgeConfigMessage,
  type CockpitEditorOpenService,
} from '@dsh-cockpit/shared'
import { createForwards } from './forwards.js'
import { registerForwardsSettingsNavIcon } from './nav-icon.js'
import { createSettingsStore, ForwardsSettingsSection, SECTION_LABEL, type SettingsInjected } from './settings.js'
import { injectSectionStyles } from './settings-styles.js'

/** The slice of the `slots` service (dsh-client-ui-renderer) used here. */
interface SlotsLike {
  inject(name: 'settings.section', callback: () => unknown): unknown
  register(options: {
    name: 'settings.section'
    id: string
    order: number
    label: () => string
    inject: () => SettingsInjected
  }, component: (props: Partial<SettingsInjected>) => unknown): unknown
}

export const inject = ['sessions', 'uiSession']

const CAPABILITY_HEADER = 'x-dsh-cockpit-bridge-capability'
const PLUGIN_VERSION = '0.6.4'
const PROTOCOL_VERSION = 2
/** Official per-session status snapshot (running / completionUnread). */
const STATUS_PROTOCOL_VERSION = 1
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
interface Observable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
interface SessionListSnapshot {
  readonly current?: string
  readonly byId?: Readonly<Record<string, { readonly id: string; readonly retainedBy?: { readonly mainView?: number } }>>
}
type BridgeContext = Context & {
  readonly sessions: { readonly list: Observable<SessionListSnapshot> }
  readonly uiSession?: {
    readonly pendingInteractions?: unknown
    readonly sessionStatus?: unknown
    /** 0.2.0 official binding: the session the DSH UI has open right now. */
    readonly adapter?: { readonly current?: unknown }
  }
}

/** The DSH UI's open-session binding (0.2.0). `retainedBy.mainView` is a
 * retention COUNT — several sessions can carry it, and the list is ordered by
 * recency — so it cannot identify the session the user has open. The official
 * UI publishes that binding as `uiSession.adapter.current`; its snapshot is the
 * binding value whose `key` is the open session id (absent = nothing open). */
function currentBinding(ui: BridgeContext['uiSession']): Observable<{ readonly key?: unknown }> | undefined {
  const current = ui?.adapter?.current
  return isObservable(current) ? current as Observable<{ readonly key?: unknown }> : undefined
}

/** Legacy/fallback selection: the old authoritative `current`, else the first
 * session retained by the main view. */
function currentSelection(snapshot: SessionListSnapshot): string | undefined {
  if (snapshot.byId !== undefined && !Object.hasOwn(snapshot, 'current')) {
    return Object.values(snapshot.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id
  }
  if (snapshot.byId !== undefined && Object.values(snapshot.byId).some(row => row.retainedBy !== undefined)) {
    return Object.values(snapshot.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id
  }
  return snapshot.current
}

function isObservable(value: unknown): value is Observable<ReadonlyMap<string, unknown>> {
  return typeof value === 'object' && value !== null
    && typeof (value as Observable<unknown>).getSnapshot === 'function'
    && typeof (value as Observable<unknown>).subscribe === 'function'
}

/** Project only public identifiers; do not read or forward interaction contents. */
function pendingSource(ui: BridgeContext['uiSession']): Observable<readonly PendingInteraction[]> | undefined {
  const legacy = ui?.pendingInteractions
  const status = ui?.sessionStatus
  const source = isObservable(legacy) ? legacy : isObservable(status) ? status : undefined
  if (source === undefined) return
  return {
    subscribe: listener => source.subscribe(listener),
    getSnapshot: () => {
      const snapshot = source.getSnapshot()
      if (!(snapshot instanceof Map)) throw new Error('unknown pending snapshot')
      const result: PendingInteraction[] = []
      for (const row of snapshot.values()) {
        const item = source === legacy ? row : (row as { pendingInteraction?: unknown } | undefined)?.pendingInteraction
        if (item === undefined) continue
        if (typeof item !== 'object' || item === null) throw new Error('unknown pending interaction')
        const { sessionId, kind, key } = item as Partial<PendingInteraction>
        if (kind !== 'approval' && kind !== 'question') continue
        if (typeof sessionId !== 'string' || typeof key !== 'string') throw new Error('invalid pending identity')
        result.push({ sessionId, kind, key })
      }
      return result.sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.key.localeCompare(right.key))
    },
  }
}

/** One session's official status booleans, identifiers only. */
interface SessionStatusEntry {
  readonly sessionId: string
  readonly running: boolean
  readonly completionUnread: boolean
}

/** The official per-session status map (0.2.0 `uiSession.sessionStatus`: the
 * same map the DSH UI renders its status dots from). Legacy surfaces only
 * expose pendingInteractions; without this map the cockpit keeps its run-round
 * model, so the bridge stays silent rather than sending a fabricated empty
 * snapshot ("nothing is running or unread"). */
function statusSource(ui: BridgeContext['uiSession']): Observable<readonly SessionStatusEntry[]> | undefined {
  const source = ui?.sessionStatus
  if (!isObservable(source)) return undefined
  return {
    subscribe: listener => source.subscribe(listener),
    getSnapshot: () => {
      const snapshot = source.getSnapshot()
      if (!(snapshot instanceof Map)) throw new Error('unknown status snapshot')
      const result: SessionStatusEntry[] = []
      for (const [sessionId, row] of snapshot.entries()) {
        if (typeof sessionId !== 'string' || sessionId === '') throw new Error('invalid status identity')
        if (typeof row !== 'object' || row === null) throw new Error('unknown status row')
        const { running, completionUnread } = row as { running?: unknown; completionUnread?: unknown }
        if (typeof running !== 'boolean' || typeof completionUnread !== 'boolean') {
          // A status map without both booleans is not the official 0.2.0 shape.
          if (running === undefined && completionUnread === undefined) continue
          throw new Error('invalid status row')
        }
        if (!running && !completionUnread) continue
        result.push({ sessionId, running, completionUnread })
      }
      return result.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
    },
  }
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


  /** `cockpitBridge.forwards`: same contract shape as the seams above —
   * provided immediately, unavailable-by-throwing until the handshake. */
  const forwards = createForwards({
    config: () => config,
    renew: renewConfig,
    send: async (path, body, active) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
      try {
        return await fetch(`${active.cockpitOrigin}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [CAPABILITY_HEADER]: active.capability },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
    },
  })
  ctx.provide(COCKPIT_FORWARDS_SERVICE, forwards.service)

  // Read-only settings section (design D9). `slots` is deliberately NOT in
  // the plugin's `inject`: an unresolved inject makes a client plugin
  // silently not load, and the rest of the bridge must work without the
  // settings package. A child fiber waits for it instead.
  const settings = createSettingsStore({ connected: () => config !== undefined, snapshot: () => forwards.snapshot() })
  ctx.inject(['slots'], child => {
    const slots = (child as Context & { readonly slots: SlotsLike }).slots
    // The section brings its own stylesheet: the host owns the theme, so the
    // sheet only maps colour roles onto official tokens (settings-styles.ts).
    child.effect(() => {
      const removeStyles = injectSectionStyles()
      return () => { removeStyles?.() }
    }, 'cockpit-bridge: forwards section styles')
    // `settings.section` projects no icon field, so the nav row is identified by
    // its label and drawn by the sheet (design D9, nav-icon.ts).
    child.effect(() => registerForwardsSettingsNavIcon(() => SECTION_LABEL),
      'cockpit-bridge: forwards settings nav glyph')
    slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: 'dsh-cockpit-forwards',
      order: 300,
      label: () => SECTION_LABEL,
      inject: (): SettingsInjected => ({ view: settings.view, subscribe: settings.subscribe }),
    }, ForwardsSettingsSection))
  })

  ctx.effect(() => {
    // A fresh one-shot page instance id per effect run (design D4(a)).
    forwards.startInstance()
    const onPageHide = (): void => { forwards.endInstance() }
    const onPageShow = (event: Event): void => {
      if ((event as PageTransitionEvent).persisted === true) forwards.restoreInstance()
    }
    const onSnapshot = (event: MessageEvent): void => {
      if (forwards.handleMessage(event)) settings.changed()
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('message', onSnapshot)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('message', onSnapshot)
      forwards.stopInstance()
    }
  }, 'cockpit-bridge: forwards page instance')

  ctx.effect(() => {
    let helloReady = false
    let disposed = false
    let running = false
    let rerunRequested = false
    let failureCount = 0
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const binding = currentBinding(ctx.uiSession)
    const readSelection = (): string | undefined => {
      if (binding === undefined) return currentSelection(ctx.sessions.list.getSnapshot())
      const value = binding.getSnapshot()
      const key = value?.key
      return typeof key === 'string' ? key : undefined
    }
    let lastSelection = readSelection()
    const pending = pendingSource(ctx.uiSession)
    const status = statusSource(ctx.uiSession)
    let pendingDirty = pending !== undefined
    let pendingFingerprint = ''
    let statusDirty = status !== undefined
    let statusFingerprint = ''
    // The status report is an optional enhancement: a cockpit built before the
    // route existed answers 404. Remember that refusal for this activation so
    // the report neither blocks the acknowledgements behind it nor retries
    // forever; a real activation (or a new hello) tries again.
    let statusUnsupported = false
    const outbox = new Map<string, OutboxEntry>()


    const pendingSnapshot = (): readonly PendingInteraction[] => pending?.getSnapshot() ?? []
    const statusSnapshot = (): readonly SessionStatusEntry[] => status?.getSnapshot() ?? []

    const currentKey = (): string | undefined => readSelection()

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
            const current = readSelection()
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
          if (disposed) return
          helloReady = true
          pendingDirty = pending !== undefined
          statusDirty = status !== undefined
          statusUnsupported = false
          failureCount = 0
          // A successful hello is a recovery point. Re-asserting the current
          // selection also recreates an ack that may have expired from outbox.
          const current = readSelection()
          if (current !== undefined) enqueue(current)
        }

        if (pendingDirty && pending !== undefined) {
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
          if (disposed || config !== activeConfig) return
          pendingFingerprint = fingerprint
          // A newer snapshot may have arrived while the accepted one was in flight.
          pendingDirty = JSON.stringify(pendingSnapshot()) !== fingerprint
          if (pendingDirty) rerunRequested = true
          failureCount = 0
        }

        if (statusDirty && status !== undefined && !statusUnsupported) {
          const items = statusSnapshot()
          const fingerprint = JSON.stringify(items)
          let response: Response
          try {
            response = await post('/api/bridge/status-snapshot', {
              protocolVersion: STATUS_PROTOCOL_VERSION,
              items,
            }, activeConfig)
          } catch {
            failed = true
            fail(undefined, undefined, activeConfig)
            return
          }
          if (response.status === 404 || response.status === 405) {
            // Older cockpit: no such route. This is not a failure of the bridge
            // link, so no retry backoff and no early return: the acknowledgements
            // below must still go out.
            statusUnsupported = true
            statusDirty = false
          } else if (!response.ok) {
            failed = true
            fail(response.status, await readErrorCode(response), activeConfig)
            return
          } else {
            if (disposed || config !== activeConfig) return
            statusFingerprint = fingerprint
            statusDirty = JSON.stringify(statusSnapshot()) !== fingerprint
            if (statusDirty) rerunRequested = true
            failureCount = 0
          }
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
      const current = readSelection()
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

    let unsubscribe = (): void => {}
    let unsubscribeBinding = (): void => {}
    let unsubscribeStatus: (() => void) | undefined
    let unsubscribePending: (() => void) | undefined
    try {
      // Validate the initial shape before registering any callbacks.
      pending?.getSnapshot()
      // Selection changes arrive through whichever source owns them: the 0.2.0
      // binding fires on open/close, the list fires on legacy surfaces and on
      // the retention/archive changes the outbox retry path depends on.
      unsubscribeBinding = binding?.subscribe(onSelectionChange) ?? (() => {})
      unsubscribe = ctx.sessions.list.subscribe(onSelectionChange)
      unsubscribeStatus = status?.subscribe(() => {
        if (disposed) return
        try {
          const fingerprint = JSON.stringify(statusSnapshot())
          if (fingerprint === statusFingerprint) return
          statusDirty = true
          requestRun(FLUSH_DELAY_MS, true)
        } catch {
          // Unknown status shape: stay silent, never leak into the DSH page.
        }
      })
      unsubscribePending = pending?.subscribe(() => {
        if (disposed) return
        try {
          const fingerprint = JSON.stringify(pendingSnapshot())
          if (fingerprint === pendingFingerprint) return
          pendingDirty = true
          requestRun(FLUSH_DELAY_MS, true)
        } catch {
          // Unknown is not an empty snapshot. Retain last acknowledged state.
        }
      })
    } catch {
      disposed = true
      unsubscribe()
      unsubscribePending?.()
      clearFlushTimer()
      clearRetryTimer()
      return () => {}
    }
    const onMessage = (event: MessageEvent): void => {
      const nextConfig = parseConfig(event)
      if (nextConfig !== undefined && (config === undefined || nextConfig.cockpitOrigin === config.cockpitOrigin)) {
        const firstHandshake = config === undefined
        config = nextConfig
        // The settings section turns from "not connected" to "reading".
        if (firstHandshake) settings.changed()
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
      const current = readSelection()
      if (current !== undefined) enqueue(current)
      pendingDirty = pending !== undefined
      statusDirty = status !== undefined
      helloReady = false
      requestRun(0, true)
    }
    window.addEventListener('message', onMessage)

    return () => {
      disposed = true
      clearFlushTimer()
      clearRetryTimer()
      unsubscribe()
      unsubscribeBinding()
      unsubscribeStatus?.()
      unsubscribePending?.()
      window.removeEventListener('message', onMessage)
      outbox.clear()
    }
  }, 'cockpit-bridge: reliable current session acknowledgement')
}
