import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { CockpitEvent, DeviceState } from '@dsh-cockpit/shared'
import { exchangeDshLaunchToken, isDshAuthenticationRequired } from './dsh-auth.js'
import { DualEventStream, Rc2Client } from './rc2-client.js'

export interface SessionRow {
  readonly sessionId: string
  readonly running: boolean
  readonly updatedAt: number
  readonly blank: boolean
  readonly origin?: string
  readonly parentSessionId?: string
}

export interface WorkspaceRow {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceRow[]
  readonly archivedSessionIds: readonly string[]
}

export interface DeviceProtocolClient {
  readonly kind: 'rc2' | 'typert'
  probe(): Promise<{ ok: boolean; state: DeviceState; diagnostic: string }>
  listSessions(): Promise<readonly SessionRow[]>
  listWorkspaces(): Promise<WorkspaceBaseline>
}

export interface DeviceProtocolStream {
  on(event: string | symbol, listener: (...args: any[]) => void): this
  off(event: string | symbol, listener: (...args: any[]) => void): this
  open(): Promise<void>
  dispose(): void | Promise<void>
}

export interface DeviceProtocolAdapter {
  readonly kind: 'rc2' | 'typert'
  readonly client: DeviceProtocolClient
  readonly stream: DeviceProtocolStream
}

export interface CreateProtocolOptions {
  readonly endpoint: URL
  readonly deviceId: string
  readonly launchToken?: string
  readonly fetch?: typeof fetch
  readonly createSocket?: (url: URL, headers: Record<string, string>) => WebSocket
}

/** The tunnel readiness gate accepts only a proven rc.2 RPC endpoint or the
 * exact DSH 0.1.2 authentication challenge. Full protocol setup follows inside
 * DeviceLifecycle, where the device's write-only launch token is available. */
export async function probeDshCarrier(endpoint: URL, signal: AbortSignal): Promise<{ ok: boolean; state: DeviceState; diagnostic: string }> {
  const rc2 = await new Rc2Client({ endpoint }).probe()
  if (rc2.ok) return rc2
  try {
    const response = await fetch(new URL('/', endpoint), { method: 'GET', redirect: 'manual', signal })
    const body = await response.text()
    if (isDshAuthenticationRequired(response.status, body)) {
      return { ok: true, state: 'READY', diagnostic: 'DSH 0.1.2 authentication required' }
    }
    return { ok: false, state: response.status === 401 ? 'NON_DSH_SERVICE' : 'DSH_UNAVAILABLE', diagnostic: 'endpoint is not a supported DSH service' }
  } catch (cause) {
    return { ok: false, state: 'DSH_UNAVAILABLE', diagnostic: cause instanceof Error ? cause.message : 'carrier probe failed' }
  }
}

export async function createDeviceProtocol(options: CreateProtocolOptions): Promise<DeviceProtocolAdapter> {
  const doFetch = options.fetch ?? fetch
  const rc2 = new Rc2Client({ endpoint: options.endpoint })
  const rc2Probe = await rc2.probe()
  if (rc2Probe.ok) {
    return {
      kind: 'rc2',
      client: Object.assign(rc2, { kind: 'rc2' as const }),
      stream: new DualEventStream({ endpoint: options.endpoint, deviceId: options.deviceId }),
    }
  }
  let root: Response
  try {
    root = await doFetch(new URL('/', options.endpoint), { method: 'GET', redirect: 'manual' })
  } catch (cause) {
    throw new Error(cause instanceof Error ? cause.message : 'DSH endpoint unavailable', { cause })
  }
  const rootBody = await root.text()
  if (root.status === 401) {
    if (!isDshAuthenticationRequired(root.status, rootBody)) {
      throw new Error('NON_DSH_SERVICE: endpoint returned a non-DSH authentication challenge')
    }
    if (options.launchToken === undefined) {
      throw new Error('DSH authentication required; paste the current dsh web startup URL')
    }
    const session = await exchangeDshLaunchToken(options.endpoint, options.launchToken, { fetch: doFetch })
    const stream = new TypertEventStream({
      endpoint: options.endpoint,
      deviceId: options.deviceId,
      cookie: session.cookie,
      fetch: doFetch,
      ...(options.createSocket === undefined ? {} : { createSocket: options.createSocket }),
    })
    const client = new TypertClient(options.endpoint, session.cookie, stream, doFetch)
    return { kind: 'typert', client, stream }
  }
  throw new Error(rc2Probe.diagnostic)
}

interface RpcResult<T> {
  readonly type?: unknown
  readonly rpcId?: unknown
  readonly result?: { readonly ok?: unknown; readonly value?: T; readonly error?: { readonly code?: unknown; readonly message?: unknown } }
}

export class TypertClient implements DeviceProtocolClient {
  readonly kind = 'typert' as const
  #counter = 0

  constructor(
    private readonly endpoint: URL,
    private readonly cookie: string,
    private readonly stream: TypertEventStream,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const rpcId = 'cockpit-typert-' + String(++this.#counter)
    const response = await this.doFetch(new URL('/api/' + method, this.endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', cookie: this.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    })
    if (!response.ok) throw new Error('typert ' + method + ' HTTP ' + String(response.status))
    const body = await response.json() as RpcResult<T>
    if (body.type !== 'server-response' || body.rpcId !== rpcId || body.result?.ok !== true) {
      const error = body.result?.error
      throw new Error('typert ' + method + ' refused: ' + String(error?.code ?? 'invalid-response') + ' ' + String(error?.message ?? ''))
    }
    return body.result.value as T
  }

  async probe(): Promise<{ ok: boolean; state: DeviceState; diagnostic: string }> {
    try {
      await this.listSessions()
      return { ok: true, state: 'READY', diagnostic: 'typert session/list ok' }
    } catch (cause) {
      return { ok: false, state: 'DSH_UNAVAILABLE', diagnostic: cause instanceof Error ? cause.message : 'typert probe failed' }
    }
  }

  async listSessions(): Promise<readonly SessionRow[]> {
    const value = await this.call<{ readonly items: readonly SessionRow[] }>('session/list', { _request: {} })
    if (!Array.isArray(value.items)) throw new Error('typert session/list returned invalid items')
    return value.items
  }

  async listWorkspaces(): Promise<WorkspaceBaseline> {
    return this.stream.workspaceBaseline()
  }
}

interface TypertStreamOptions {
  readonly endpoint: URL
  readonly deviceId: string
  readonly cookie: string
  readonly fetch?: typeof fetch
  readonly createSocket?: (url: URL, headers: Record<string, string>) => WebSocket
}

export class TypertEventStream extends EventEmitter implements DeviceProtocolStream {
  readonly #endpoint: URL
  readonly #deviceId: string
  readonly #cookie: string
  readonly #fetch: typeof fetch
  readonly #createSocket: (url: URL, headers: Record<string, string>) => WebSocket
  #socket: WebSocket | undefined
  #clientId: string | undefined
  readonly #repliedWaterfalls = new Set<string>()
  #closed = false
  #disconnected = false
  #workspace: WorkspaceBaseline | undefined
  readonly #workspaceReady: { promise: Promise<void>; resolve: () => void; reject: (cause: unknown) => void }

  constructor(options: TypertStreamOptions) {
    super()
    this.#endpoint = options.endpoint
    this.#deviceId = options.deviceId
    this.#cookie = options.cookie
    this.#fetch = options.fetch ?? fetch
    this.#createSocket = options.createSocket ?? ((url, headers) => new WebSocket(url, { headers }))
    let resolve!: () => void
    let reject!: (cause: unknown) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    this.#workspaceReady = { promise, resolve, reject }
  }

  open(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const url = new URL('/api/remote.mux', this.#endpoint)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = this.#createSocket(url, { Cookie: this.#cookie })
      this.#socket = socket
      let opened = false
      const fail = (cause: Error) => {
        if (!opened) reject(cause)
        this.#disconnect()
      }
      socket.once('open', () => {
        opened = true
        socket.send(JSON.stringify({ type: 'open', streamId: 'events', endpoint: '$events', payload: { args: {} } }))
        socket.send(JSON.stringify({ type: 'open', streamId: 'workspace', endpoint: 'workspace/follow', payload: { args: {} } }))
        void this.#workspaceReady.promise.then(resolve, reject)
      })
      socket.on('message', data => { void this.#receive(String(data)).catch(error => fail(error instanceof Error ? error : new Error(String(error)))) })
      socket.once('error', error => fail(error instanceof Error ? error : new Error('typert stream error')))
      socket.once('close', () => fail(new Error('typert stream closed')))
    })
  }

  workspaceBaseline(): Promise<WorkspaceBaseline> {
    if (this.#workspace !== undefined) return Promise.resolve(cloneBaseline(this.#workspace))
    return this.#workspaceReady.promise.then(() => cloneBaseline(this.#workspace as WorkspaceBaseline))
  }

  async dispose(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const socket = this.#socket
    this.#socket = undefined
    if (socket !== undefined && socket.readyState < WebSocket.CLOSING) socket.close()
  }

  async #receive(text: string): Promise<void> {
    const frame = JSON.parse(text) as { readonly type?: unknown; readonly streamId?: unknown; readonly value?: unknown; readonly error?: unknown }
    if (frame.type === 'error') throw new Error('typert logical stream failed: ' + JSON.stringify(frame.error))
    if (frame.type === 'end') throw new Error('typert logical stream ended: ' + String(frame.streamId))
    if (frame.type !== 'item' || (frame.streamId !== 'events' && frame.streamId !== 'workspace')) return
    if (frame.streamId === 'workspace') {
      this.#workspaceFrame(frame.value)
      return
    }
    await this.#eventFrame(frame.value)
  }

  #workspaceFrame(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string') throw new Error('invalid workspace/follow frame')
    if (value.type === 'baseline') {
      if (!isRecord(value.value) || !Array.isArray(value.value.items) || !Array.isArray(value.value.archivedSessionIds)) throw new Error('invalid workspace baseline')
      this.#workspace = {
        items: value.value.items.filter(isWorkspaceRow),
        archivedSessionIds: value.value.archivedSessionIds.filter(isString),
      }
      this.#workspaceReady.resolve()
      return
    }
    if (this.#workspace === undefined) throw new Error('workspace increment arrived before baseline')
    if (value.type === 'archived' && Array.isArray(value.archivedSessionIds)) {
      this.#workspace = { ...this.#workspace, archivedSessionIds: value.archivedSessionIds.filter(isString) }
      this.emit('event', { type: 'archived-sessions-changed', deviceId: this.#deviceId, archivedSessionIds: this.#workspace.archivedSessionIds } satisfies CockpitEvent)
    } else if (value.type === 'upsert' && isWorkspaceRow(value.workspace)) {
      const workspace = value.workspace
      const items = this.#workspace.items.filter(item => item.workspaceId !== workspace.workspaceId)
      this.#workspace = { ...this.#workspace, items: [...items, workspace] }
    } else if (value.type === 'remove' && typeof value.workspaceId === 'string') {
      this.#workspace = { ...this.#workspace, items: this.#workspace.items.filter(item => item.workspaceId !== value.workspaceId) }
    } else if (value.type === 'order' && Array.isArray(value.workspaceIds)) {
      const byId = new Map(this.#workspace.items.map(item => [item.workspaceId, item]))
      const ordered = value.workspaceIds.filter(isString).map(id => byId.get(id)).filter((item): item is WorkspaceRow => item !== undefined)
      this.#workspace = { ...this.#workspace, items: ordered }
    }
  }

  async #eventFrame(value: unknown): Promise<void> {
    if (!isRecord(value) || typeof value.type !== 'string') throw new Error('invalid $events frame')
    if (value.type === 'ready') {
      if (typeof value.clientId !== 'string') throw new Error('invalid $events ready frame')
      this.#clientId = value.clientId
      return
    }
    if (value.type === 'cancel') return
    if (value.type === 'waterfall') {
      if (typeof value.eventId !== 'string' || this.#clientId === undefined || this.#repliedWaterfalls.has(value.eventId)) return
      this.#repliedWaterfalls.add(value.eventId)
      await this.#replyNext(this.#clientId, value.eventId)
      return
    }
    if (value.type !== 'emit' || typeof value.event !== 'string' || !Array.isArray(value.args)) return
    const event = mapTypertEvent(this.#deviceId, value.event, value.args)
    if (event !== undefined) this.emit('event', event)
  }

  async #replyNext(clientId: string, eventId: string): Promise<void> {
    const rpcId = 'cockpit-event-' + eventId
    const response = await this.#fetch(new URL('/api/$events/result', this.#endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.#cookie },
      body: JSON.stringify({
        type: 'client-request', rpcId, method: '$events/result',
        payload: { args: { clientId, eventId, outcome: { kind: 'next' } } },
      }),
    })
    if (!response.ok) throw new Error('typert waterfall next HTTP ' + String(response.status))
  }

  #disconnect(): void {
    if (this.#closed || this.#disconnected) return
    this.#disconnected = true
    this.emit('disconnect')
  }
}

function mapTypertEvent(deviceId: string, event: string, args: readonly unknown[]): CockpitEvent | undefined {
  if (event === 'api-session/status' && typeof args[0] === 'string' && typeof args[1] === 'boolean') {
    return { type: 'session-status', deviceId, sessionId: args[0], running: args[1] }
  }
  if (event === 'api-session/added' && isRecord(args[0]) && typeof args[0].sessionId === 'string') {
    return { type: 'session-added', deviceId, sessionId: args[0].sessionId, ...(args[0].origin === 'subagent' ? { origin: 'subagent' as const } : {}) }
  }
  if (event === 'api-session/removed' && typeof args[0] === 'string') {
    return { type: 'session-removed', deviceId, sessionId: args[0] }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isString(value: unknown): value is string { return typeof value === 'string' }
function isWorkspaceRow(value: unknown): value is WorkspaceRow {
  return isRecord(value) && typeof value.workspaceId === 'string' && typeof value.path === 'string' && typeof value.title === 'string' && Array.isArray(value.sessionIds) && value.sessionIds.every(isString)
}
function cloneBaseline(value: WorkspaceBaseline): WorkspaceBaseline {
  return { items: value.items.map(item => ({ ...item, sessionIds: [...item.sessionIds] })), archivedSessionIds: [...value.archivedSessionIds] }
}
