import { exchangeDshLaunchToken, inspectDshCookie, isDshAuthenticationRequired, type DshCookieSession } from './dsh-auth.js'
import { exchangeFetch } from './protocol-client.js'

/** Public, stable workbench-launch outcomes. Each maps to ONE HTTP status and a
 * fixed safe message; no internal cause, URL, token or cookie may reach the
 * client, and only `auth-required` is actionable by pasting/enabling recovery. */
export type WorkbenchLaunchCode =
  | 'workbench-origin-forbidden'
  | 'workbench-launch-stale'
  | 'workbench-auth-required'
  | 'workbench-unavailable'

export class WorkbenchLaunchError extends Error {
  constructor(readonly code: WorkbenchLaunchCode, message: string) {
    super(message)
    this.name = 'WorkbenchLaunchError'
  }
}

export interface WorkbenchLaunchSuccess {
  readonly url: string
  readonly authGeneration: number
}

export interface WorkbenchLaunchSnapshot {
  readonly deviceId: string
  /** The endpoint authority this launch is bound to. Part of the single-flight
   * key: a drifted port must never share validation state with the old one. */
  readonly authority: string
  /** Auth generation captured before any validation ran. */
  readonly authGeneration: number
  /** Lifecycle connection generation captured before any validation ran. */
  readonly connectionGeneration: number
}

export type WorkbenchLaunchValidation =
  | { readonly ok: true; readonly session: DshCookieSession }
  /** `rejected`: the official DSH endpoint refused THIS token — the only
   * observation that may authorize reading discovery logs.
   * `definitive`: the endpoint proved DSH but the exchange could not produce a
   * usable authority-bound cookie (non-401 status, malformed redirect, wrong
   * authority). Retrying with a freshly discovered token would hide a real
   * protocol/authority problem, so this is final.
   * `unavailable`: the endpoint could not be proven to be a DSH service at all. */
  | { readonly ok: false; readonly reason: 'rejected' | 'definitive' | 'unavailable' }

/**
 * Resolve what the CURRENT endpoint's root says about this device.
 *
 * This pre-flight is what makes the failure classification mechanically sound.
 * A `303` -> cookie response alone does not prove DSH (`exchangeDshLaunchToken`
 * derives the authority itself, so a foreign service's redirect would only be
 * caught by the cookie-name check). Only the official DSH
 * authentication-required challenge proves an authenticated typert endpoint,
 * and therefore only that result may authorize reading discovery logs.
 */
export async function probeAuthenticatedDsh(
  endpoint: URL,
  doFetch: typeof fetch,
  signal?: AbortSignal,
): Promise<'dsh' | 'not-dsh' | 'unavailable'> {
  try {
    const response = await doFetch(new URL('/', endpoint), {
      method: 'GET',
      redirect: 'manual',
      ...(signal === undefined ? {} : { signal }),
    })
    const body = await response.text()
    return isDshAuthenticationRequired(response.status, body) ? 'dsh' : 'not-dsh'
  } catch {
    return 'unavailable'
  }
}

/**
 * Strictly validate a stored launch token against the CURRENT endpoint.
 *
 * The classification is deliberately conservative, because ONLY `rejected` may
 * authorize reading the device's DSH log:
 *
 * - `unavailable` covers transport failures and endpoints that are not DSH.
 * - `definitive` covers an endpoint that IS DSH but answered the exchange with
 *   something other than 401 (wrong status/redirect, or a cookie bound to a
 *   different authority). That is a protocol or authority problem, not a stale
 *   token, and discovery must not paper over it.
 * - `rejected` is reserved for the official authentication-required challenge
 *   together with a refused exchange.
 */
export async function validateWorkbenchLaunchToken(
  endpoint: URL,
  token: string | undefined,
  doFetch: typeof fetch,
  signal?: AbortSignal,
): Promise<WorkbenchLaunchValidation> {
  const endpointState = await probeAuthenticatedDsh(endpoint, doFetch, signal)
  if (endpointState !== 'dsh') return { ok: false, reason: 'unavailable' }
  if (token === undefined) return { ok: false, reason: 'rejected' }
  try {
    const session = await exchangeDshLaunchToken(endpoint, token, {
      fetch: exchangeFetch(doFetch),
      ...(signal === undefined ? {} : { signal }),
    })
    return { ok: true, session }
  } catch (cause) {
    const status = httpStatusOf(cause)
    return { ok: false, reason: status === 401 || status === 403 ? 'rejected' : 'definitive' }
  }
}

/** `HttpStatusError` from protocol-client is not imported here on purpose: this
 * module must stay usable without the protocol layer. */
function httpStatusOf(cause: unknown): number | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined
  const status = (cause as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

/** True when a candidate cookie session is usable for exactly this authority. */
export function isSessionForAuthority(session: DshCookieSession, authority: string): boolean {
  return session.authority === authority && inspectDshCookie(session.cookie, authority, session.expiresAt)
}
