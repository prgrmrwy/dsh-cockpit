import { Logger } from '@nestjs/common'
import { dshIframeLaunchUrl } from './dsh-auth.js'
import {
  isSessionForAuthority,
  validateWorkbenchLaunchToken,
  type WorkbenchLaunchCode,
  type WorkbenchLaunchSnapshot,
} from './workbench-launch.js'

/** Commits newly discovered auth material for one snapshot. Returning undefined
 * means the compare-and-swap lost (the user replaced or cleared the material,
 * or another recovery committed first); the caller must not navigate with what
 * it found. */
export type CommitDiscoveredAuth = (
  snapshot: WorkbenchLaunchSnapshot,
  token: string,
  session: { readonly cookie: string; readonly expiresAt: number },
) => Promise<number | undefined>

export interface CoordinatorOptions {
  /** How long a settled outcome may be reused before the endpoint is asked
   * again. Bounds how often validation makes DSH mint a cookie nobody keeps. */
  readonly validationTtlMs?: number
  readonly logger?: Pick<Logger, 'warn'>
}

interface LaunchContext {
  readonly snapshot: WorkbenchLaunchSnapshot
  readonly endpoint: URL
  readonly storedToken: string | undefined
  readonly discoveryAuthorized: boolean
  readonly doFetch: typeof fetch
}

interface SuccessResult {
  readonly ok: true
  readonly url: string
  readonly authGeneration: number
}

interface FailureResult {
  readonly ok: false
  readonly code: WorkbenchLaunchCode
  readonly message: string
}

export type WorkbenchLaunchOutcome = SuccessResult | FailureResult

const AUTH_REQUIRED = 'workbench authentication required; paste the current dsh web startup URL'
const UNAVAILABLE = 'workbench authentication could not be verified'

/**
 * Owns workbench start-up validation as ONE bounded operation per
 * `(deviceId, authority, auth generation)`.
 *
 * Two properties matter and are easy to get wrong:
 *
 * 1. The shared operation is NOT owned by whichever HTTP request arrived
 *    first. A browser that navigates away (or a lifecycle caller that is torn
 *    down) cancels only its own wait; other callers still receive the result,
 *    and the operation is aborted only when the device itself goes away.
 * 2. A settled outcome is reused for a short bounded window, so several tabs
 *    (or a user retry) cannot make DSH mint a fresh cookie per request.
 */
export class WorkbenchLaunchCoordinator {
  readonly #validationTtlMs: number
  readonly #logger: Pick<Logger, 'warn'> | undefined
  #now: () => number = Date.now.bind(Date)
  /** In-flight shared operations, keyed as `${deviceId}\u0000${authority}\u0000${generation}`. */
  readonly #operations = new Map<string, { readonly task: Promise<WorkbenchLaunchOutcome>; readonly abort: AbortController }>()
  readonly #settledAt = new Map<string, { readonly at: number; readonly outcome: WorkbenchLaunchOutcome }>()

  constructor(options: CoordinatorOptions = {}) {
    this.#validationTtlMs = options.validationTtlMs ?? 15_000
    this.#logger = options.logger
  }

  /** Runs (or joins) one bounded validation operation for this tuple. */
  async launch(
    snapshot: WorkbenchLaunchSnapshot,
    endpoint: URL,
    doFetch: typeof fetch,
    options: {
      readonly token?: string
      readonly discoveryAuthorized: boolean
      readonly discover?: () => Promise<string | undefined>
      readonly commit?: CommitDiscoveredAuth
      readonly signal?: AbortSignal
    },
  ): Promise<WorkbenchLaunchOutcome> {
    const key = operationKey(snapshot)
    const cached = this.#settledAt.get(key)
    if (cached !== undefined && this.#now() - cached.at < this.#validationTtlMs) return cached.outcome

    let operation = this.#operations.get(key)
    if (operation === undefined) {
      const abort = new AbortController()
      const context: LaunchContext = {
        snapshot,
        endpoint,
        storedToken: options.token,
        discoveryAuthorized: options.discoveryAuthorized,
        doFetch,
      }
      const task = this.#run(context, options.discover, options.commit, abort.signal)
      operation = { task, abort }
      this.#operations.set(key, operation)
      task.then(
        outcome => { this.#settle(key, operation!, outcome) },
        () => { this.#settle(key, operation!, { ok: false, code: 'workbench-unavailable', message: UNAVAILABLE }) },
      )
    }
    return await raceWaiter(operation.task, options.signal)
  }

  /** Aborts every in-flight operation for a device: disable, delete, device
   * stop and cockpit shutdown. Only the owner of the device may do this; a
   * single departing caller never can. */
  cancelDevice(deviceId: string): void {
    const prefix = `${deviceId}\u0000`
    for (const [key, operation] of this.#operations) {
      if (!key.startsWith(prefix)) continue
      operation.abort.abort(new Error('device stopped'))
    }
    for (const key of this.#settledAt.keys()) if (key.startsWith(prefix)) this.#settledAt.delete(key)
  }

  /** Test seam: the real implementation is monotonic enough, and injecting a
   * clock here would hide the production TTL behind a fake one. */
  setNowForTesting(now: () => number): void {
    this.#now = now
  }

  async #run(
    context: LaunchContext,
    discover: (() => Promise<string | undefined>) | undefined,
    commit: CommitDiscoveredAuth | undefined,
    signal: AbortSignal,
  ): Promise<WorkbenchLaunchOutcome> {
    const { snapshot, endpoint } = context
    const STALE: FailureResult = { ok: false, code: 'workbench-launch-stale', message: 'workbench launch superseded' }
    let current: Awaited<ReturnType<typeof validateWorkbenchLaunchToken>>
    try {
      current = await validateWorkbenchLaunchToken(endpoint, context.storedToken, context.doFetch, signal)
    } catch {
      // The shared operation was aborted: the device went away (disable, delete,
      // teardown), so this result belongs to no connection any more.
      return STALE
    }
    if ((signal.aborted)) return STALE
    if (current.ok) {
      if (!isSessionForAuthority(current.session, snapshot.authority)) {
        return { ok: false, code: 'workbench-unavailable', message: UNAVAILABLE }
      }
      // A valid stored token is REPEATABLE in every supported typert runtime,
      // so the browser can exchange the same token for its own cookie. The
      // session minted here is deliberately discarded: it differs on every
      // exchange and committing it would bump the generation on every launch.
      return success(endpoint, context.storedToken, snapshot.authGeneration)
    }
    if (current.reason !== 'rejected') {
      // Worth one bounded line: this is the case that must NOT be mistaken for
      // a stale token, so an operator can tell "endpoint is broken" apart from
      // "credentials are stale" without re-running anything.
      this.#logger?.warn(`workbench validation unavailable: ${current.reason}`)
      return { ok: false, code: 'workbench-unavailable', message: UNAVAILABLE }
    }
    if (!context.discoveryAuthorized || discover === undefined) {
      return { ok: false, code: 'workbench-auth-required', message: AUTH_REQUIRED }
    }
    let discovered: string | undefined
    try {
      discovered = await discover()
    } catch {
      discovered = undefined
    }
    if (signal.aborted) return STALE
    if (discovered === undefined || discovered === context.storedToken) {
      return { ok: false, code: 'workbench-auth-required', message: AUTH_REQUIRED }
    }
    let recovered: Awaited<ReturnType<typeof validateWorkbenchLaunchToken>>
    try {
      recovered = await validateWorkbenchLaunchToken(endpoint, discovered, context.doFetch, signal)
    } catch {
      return STALE
    }
    if (signal.aborted) return STALE
    if (!recovered.ok) {
      return recovered.reason === 'rejected'
        ? { ok: false, code: 'workbench-auth-required', message: AUTH_REQUIRED }
        : { ok: false, code: 'workbench-unavailable', message: UNAVAILABLE }
    }
    if (!isSessionForAuthority(recovered.session, snapshot.authority)) {
      return { ok: false, code: 'workbench-unavailable', message: UNAVAILABLE }
    }
    if (commit === undefined) return { ok: false, code: 'workbench-auth-required', message: AUTH_REQUIRED }
    const committedGeneration = await commit(snapshot, discovered, recovered.session)
    if (committedGeneration === undefined) {
      // Another writer won the compare-and-swap. Its material is authoritative;
      // no stale result may be navigated, and the next launch re-reads it.
      return STALE
    }
    return success(endpoint, discovered, committedGeneration)
  }

  #settle(key: string, operation: { readonly abort: AbortController }, outcome: WorkbenchLaunchOutcome): void {
    if (this.#operations.get(key)?.abort !== operation.abort) return
    this.#operations.delete(key)
    this.#settledAt.set(key, { at: this.#now(), outcome })
    this.#pruneSettled()
  }

  #pruneSettled(): void {
    const cutoff = this.#now() - this.#validationTtlMs
    for (const [key, entry] of this.#settledAt) if (entry.at < cutoff) this.#settledAt.delete(key)
  }
}

function operationKey(snapshot: WorkbenchLaunchSnapshot): string {
  return [snapshot.deviceId, snapshot.authority, snapshot.authGeneration].join('\u0000')
}

function success(endpoint: URL, token: string | undefined, authGeneration: number): SuccessResult {
  const url = dshIframeLaunchUrl(endpoint, token)
  if (url === undefined) throw new Error('workbench launch URL unavailable')
  return { ok: true, url, authGeneration }
}

/** Waits for the shared operation while honouring THIS waiter's own
 * cancellation. The shared work keeps running for every other waiter. */
function raceWaiter(task: Promise<WorkbenchLaunchOutcome>, signal: AbortSignal | undefined): Promise<WorkbenchLaunchOutcome> {
  if (signal === undefined) return task
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      cause => { signal.removeEventListener('abort', onAbort); reject(cause) },
    )
  })
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error('workbench launch wait aborted')
}
