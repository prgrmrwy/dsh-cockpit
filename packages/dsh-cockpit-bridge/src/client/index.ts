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

const COCKPIT_BASE = 'http://127.0.0.1:3090'

/** Fire-and-forget report; failures must never disturb the DSH page. */
async function reportOpen(ctx: ClientContext, sessionId: string): Promise<void> {
  try {
    const response = await fetch(`${COCKPIT_BASE}/api/bridge/session-opened`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    if (response.status === 401) {
      // The cockpit cookie is unknown to this browser yet — ask for it once,
      // then re-send (the Set-Cookie is issued on /api/bootstrap).
      await fetch(`${COCKPIT_BASE}/api/bootstrap`, { credentials: 'include' })
      await fetch(`${COCKPIT_BASE}/api/bridge/session-opened`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    }
  } catch {
    // No cockpit running / transient failure: swallow. The selection was still
    // observed locally; a later session change re-reports.
  }
}

/** Debounce consecutive selection changes (rapid left/right clicks). */
function schedule(callback: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; callback() }, 250)
  }
}

export function apply(ctx: ClientContext): void {
  let last: string | undefined

  // Subscribe to the official sessions list store; `current` flips exactly
  // when the user opens a session (SessionManager.select persists it to
  // dsh.sessions.current).
  ctx.effect(() => {
    const flush = schedule(() => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined || current === last) return
      last = current
      void reportOpen(ctx, current)
    })
    return ctx.sessions.list.subscribe(flush)
  }, 'cockpit-bridge: current session watch')
}
