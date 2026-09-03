import { randomBytes } from 'node:crypto'

export const BRIDGE_CAPABILITY_HEADER = 'x-dsh-cockpit-bridge-capability'
export const BRIDGE_CAPABILITY_PURPOSE = 'bridge-callback' as const

export type BridgeCapabilityPurpose = typeof BRIDGE_CAPABILITY_PURPOSE

export interface BridgeCapabilityGrant {
  readonly deviceId: string
  readonly origin: string
  readonly purpose: BridgeCapabilityPurpose
  readonly issuedAt: number
  readonly expiresAt: number
}

export interface IssuedBridgeCapability extends BridgeCapabilityGrant {
  readonly token: string
}

export interface BridgeCapabilityOptions {
  readonly ttlMs?: number
  readonly maxEntries?: number
  readonly now?: () => number
  readonly randomToken?: () => string
}

/**
 * Process-local, deliberately short-lived authority for callbacks made by a
 * bridge running in a device DSH page. The opaque random token is the only
 * value sent to that page; the persistent cockpit token never leaves its
 * HttpOnly cookie.
 */
export class BridgeCapabilityService {
  readonly #ttlMs: number
  readonly #maxEntries: number
  readonly #now: () => number
  readonly #randomToken: () => string
  readonly #grants = new Map<string, BridgeCapabilityGrant>()

  constructor(options: BridgeCapabilityOptions = {}) {
    this.#ttlMs = positiveInteger(options.ttlMs, 60_000, 'ttlMs')
    this.#maxEntries = positiveInteger(options.maxEntries, 512, 'maxEntries')
    this.#now = options.now ?? Date.now
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'))
  }

  issue(input: {
    readonly deviceId: string
    readonly origin: string
    readonly purpose?: BridgeCapabilityPurpose
  }): IssuedBridgeCapability {
    const now = this.#now()
    this.#prune(now)
    while (this.#grants.size >= this.#maxEntries) {
      const oldest = this.#grants.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.#grants.delete(oldest)
    }

    const origin = normalizeOrigin(input.origin)
    const purpose = input.purpose ?? BRIDGE_CAPABILITY_PURPOSE
    let token = this.#randomToken()
    while (token === '' || this.#grants.has(token)) token = this.#randomToken()
    const grant: BridgeCapabilityGrant = {
      deviceId: input.deviceId,
      origin,
      purpose,
      issuedAt: now,
      expiresAt: now + this.#ttlMs,
    }
    this.#grants.set(token, grant)
    return { token, ...grant }
  }

  validate(
    token: string | undefined,
    expected: {
      readonly deviceId?: string
      readonly origin?: string
      readonly purpose: BridgeCapabilityPurpose
    },
  ): BridgeCapabilityGrant | undefined {
    if (token === undefined || token === '') return undefined
    const grant = this.#grants.get(token)
    if (grant === undefined) return undefined
    const now = this.#now()
    if (grant.expiresAt <= now) {
      this.#grants.delete(token)
      return undefined
    }
    if (grant.purpose !== expected.purpose) return undefined
    if (expected.deviceId !== undefined && grant.deviceId !== expected.deviceId) return undefined
    if (expected.origin !== undefined) {
      let origin: string
      try {
        origin = normalizeOrigin(expected.origin)
      } catch {
        return undefined
      }
      if (grant.origin !== origin) return undefined
    }
    return grant
  }

  /** Validate and revoke a capability atomically for genuinely one-shot uses. */
  consume(
    token: string | undefined,
    expected: {
      readonly deviceId?: string
      readonly origin?: string
      readonly purpose: BridgeCapabilityPurpose
    },
  ): BridgeCapabilityGrant | undefined {
    const grant = this.validate(token, expected)
    if (grant !== undefined && token !== undefined) this.#grants.delete(token)
    return grant
  }

  revokeDevice(deviceId: string): void {
    for (const [token, grant] of this.#grants) {
      if (grant.deviceId === deviceId) this.#grants.delete(token)
    }
  }

  #prune(now: number): void {
    for (const [token, grant] of this.#grants) {
      if (grant.expiresAt <= now) this.#grants.delete(token)
    }
  }
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (url.origin === 'null' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(`invalid origin ${value}`)
  }
  return url.origin
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${name} must be a positive integer`)
  return resolved
}
