import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { CockpitEvent, DeviceState } from '@dsh-cockpit/shared'

/** Minimal unary RPC over the loopback tunnel. */
export interface Rc2ClientOptions {
  readonly endpoint: URL
  readonly requestTimeoutMs?: number
}

export class Rc2Client {
  readonly #endpoint: URL
  readonly #timeoutMs: number

  constructor(options: Rc2ClientOptions) {
    this.#endpoint = options.endpoint
    this.#timeoutMs = options.requestTimeoutMs ?? 10_000
  }

  async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const rpcId = `cockpit-${++this.#counter}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs)
    try {
      const response = await fetch(new URL(`/api/${method}`, this.#endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`rc.2 ${method} HTTP ${response.status}`)
      const body = await response.json() as { result?: { ok?: boolean; value?: T; error?: { code?: string; message?: string } } }
      const result = body.result
      if (result?.ok !== true) throw new Error(`rc.2 ${method} refused: ${result?.error?.code ?? 'unknown'} ${result?.error?.message ?? ''}`)
      return result.value as T
    } finally {
      clearTimeout(timer)
    }
  }

  async probe(): Promise<{ ok: boolean; state: DeviceState; diagnostic: string }> {
    try {
      await this.call('host.describe', {})
      return { ok: true, state: 'READY', diagnostic: 'rc.2 host.describe ok' }
    } catch (cause) {
      return { ok: false, state: 'DSH_UNAVAILABLE', diagnostic: cause instanceof Error ? cause.message : 'probe failed' }
    }
  }

  async listSessions(): Promise<readonly { sessionId: string; running: boolean; updatedAt: number; blank: boolean; origin?: string; parentSessionId?: string }[]> {
    const value = await this.call<{ items: readonly { sessionId: string; running: boolean; updatedAt: number; blank: boolean; origin?: string; parentSessionId?: string }[] }>('session.list', {})
    return value.items
  }

  /** Official workspace baseline. `archivedSessionIds` is the reconnect
   * baseline for host/archived-sessions-changed — the archive set is NOT
   * replayed on events.host open, so a consumer must re-query it after every
   * connection. Items are WorkspaceView projections (sessionIds, path,
   * title, createdAt, updatedAt). */
  async listWorkspaces(): Promise<{
    items: readonly { workspaceId: string; path: string; title: string; sessionIds: readonly string[] }[]
    archivedSessionIds: readonly string[]
  }> {
    const value = await this.call<{
      items: readonly { workspaceId: string; path: string; title: string; sessionIds: readonly string[] }[]
      archivedSessionIds: readonly string[]
    }>('workspace.list', {})
    return value
  }

  #counter = 0
}

/** Official dual event stream consumer. Frames are validated by shape; unknown
 * methods are ignored. On error or close, `disconnect` fires once per stream. */
export interface DualStreamOptions {
  readonly endpoint: URL
  readonly deviceId: string
  readonly createSocket?: (url: URL) => WebSocket
}

export class DualEventStream extends EventEmitter {
  readonly #deviceId: string
  readonly #endpoint: URL
  readonly #createSocket: (url: URL) => WebSocket
  readonly #sockets = new Map<'mux' | 'host', WebSocket>()
  #closed = false

  constructor(options: DualStreamOptions) {
    super()
    this.#deviceId = options.deviceId
    this.#endpoint = options.endpoint
    this.#createSocket = options.createSocket ?? (url => new WebSocket(url))
  }

  open(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let pending = 2
      const onOpen = () => { pending -= 1; if (pending === 0) resolve() }
      let failed = false
      const fail = (cause: Error) => { if (!failed) { failed = true; for (const ws of this.#sockets.values()) if (ws.readyState < 2) ws.close(); reject(cause) } }
      for (const stream of ['mux', 'host'] as const) {
        const ws = this.#createSocket(new URL(`/api/events.${stream}`, this.#endpoint))
        this.#sockets.set(stream, ws)
        ws.on('open', onOpen)
        ws.on('message', data => this.#onMessage(stream, String(data)))
        ws.on('error', () => fail(new Error(`${stream} stream failed`)))
        ws.on('close', () => this.#onClose(stream))
      }
    })
  }

  #onMessage(stream: 'mux' | 'host', raw: string): void {
    if (this.#closed) return
    let message: { method?: unknown; payload?: unknown; rpcId?: unknown }
    try {
      message = JSON.parse(raw) as { method?: unknown; payload?: unknown; rpcId?: unknown }
    } catch {
      return
    }
    if (typeof message.method !== 'string' || typeof message.payload !== 'object' || message.payload === null) return
    const payload = message.payload as Record<string, unknown>
    const envelopeRpcId = typeof message.rpcId === 'string' ? message.rpcId : undefined
    const event = this.#convert(stream, message.method, payload, envelopeRpcId)
    if (event !== undefined) this.emit('event', event)
  }

  #convert(stream: 'mux' | 'host', method: string, payload: Record<string, unknown>, envelopeRpcId: string | undefined): CockpitEvent | undefined {
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined
    switch (method) {
      case 'host/session-status':
        return sessionId === undefined ? undefined : {
          type: 'session-status', deviceId: this.#deviceId, sessionId,
          running: payload.running === true,
        }
      case 'approval/requested':
        // Official frame fields: approvalId (stated in the mux frame schema),
        // NOT rpcId — the old converter matched nothing and dropped every
        // pending approval, leaving pendingInteractionCount at 0 forever.
        if (sessionId === undefined || typeof payload.approvalId !== 'string') return undefined
        return { type: 'interaction', deviceId: this.#deviceId, sessionId, kind: 'approval', rpcId: payload.approvalId, resolved: false }
      case 'approval/resolved':
        if (sessionId === undefined || typeof payload.approvalId !== 'string') return undefined
        return { type: 'interaction', deviceId: this.#deviceId, sessionId, kind: 'approval', rpcId: payload.approvalId, resolved: true }
      case 'question/requested':
        // question/requested carries no identity field; the official client
        // keys it by the outer envelope rpcId (q:${envelope.rpcId}) and the
        // matching question/resolved echoes it back as questionRpcId.
        if (sessionId === undefined || envelopeRpcId === undefined) return undefined
        return { type: 'interaction', deviceId: this.#deviceId, sessionId, kind: 'question', rpcId: envelopeRpcId, resolved: false }
      case 'question/resolved':
        if (sessionId === undefined || typeof payload.questionRpcId !== 'string') return undefined
        return { type: 'interaction', deviceId: this.#deviceId, sessionId, kind: 'question', rpcId: payload.questionRpcId, resolved: true }
      case 'host/session-added':
      case 'session/subscribed':
        return {
          type: 'session-added', deviceId: this.#deviceId,
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(payload.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
        }
      case 'host/archived-sessions-changed':
        return !Array.isArray(payload.archivedSessionIds) || payload.archivedSessionIds.some(id => typeof id !== 'string')
          ? undefined
          : { type: 'archived-sessions-changed', deviceId: this.#deviceId, archivedSessionIds: payload.archivedSessionIds }
      case 'host/session-removed':
        return sessionId === undefined ? undefined : { type: 'session-removed', deviceId: this.#deviceId, sessionId }
      default:
        return undefined
    }
  }

  #onClose(stream: 'mux' | 'host'): void {
    if (this.#closed) return
    this.#closed = true
    for (const ws of this.#sockets.values()) if (ws.readyState < 2) ws.close()
    this.emit('disconnect', { stream })
  }

  dispose(): void {
    this.#closed = true
    for (const ws of this.#sockets.values()) if (ws.readyState < 2) ws.close()
    this.#sockets.clear()
  }
}