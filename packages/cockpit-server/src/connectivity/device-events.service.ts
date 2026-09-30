import { Injectable, type OnApplicationShutdown } from '@nestjs/common'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

/** How long a cockpit page may have no status-stream connection before its
 * forward holders are reclaimed (design D4(b)). Covers EventSource's own
 * reconnect and brief background throttling. */
export const PAGE_GRACE_MS = 30_000

/** Broadcasts device status changes to browser subscribers (SSE). One emitter
 * per process; subscribers receive the full current snapshot on connect and
 * incremental updates afterwards.
 *
 * It also counts stream connections per cockpit page id (design D4(b)): when a
 * page's count drops to zero a single per-page grace timer starts; a
 * reconnect under the same id cancels it, and expiry notifies the
 * `onPageExpired` listeners. Page-less connections are served but counted
 * nowhere. */
@Injectable()
export class DeviceEventsService implements OnApplicationShutdown {
  readonly #listeners = new Set<(facts: readonly DeviceStatusFacts[]) => void>()
  readonly #pageConnections = new Map<string, number>()
  readonly #pageGrace = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #expiryListeners = new Set<(pageId: string) => void>()

  /** Notifies all subscribers with a fresh snapshot. */
  publish(facts: readonly DeviceStatusFacts[]): void {
    for (const listener of this.#listeners) listener(facts)
  }

  /** Subscribe one stream connection. `pageId` must already be validated by
   * the caller; `undefined` means "not counted for any page". */
  subscribe(listener: (facts: readonly DeviceStatusFacts[]) => void, pageId?: string): () => void {
    // A distinct wrapper per connection, so two connections sharing one
    // listener function are still counted and removed independently.
    const entry = (facts: readonly DeviceStatusFacts[]) => { listener(facts) }
    this.#listeners.add(entry)
    if (pageId !== undefined) this.#connectPage(pageId)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.#listeners.delete(entry)
      if (pageId !== undefined) this.#disconnectPage(pageId)
    }
  }

  /** Whether the page currently has at least one stream connection. */
  hasPage(pageId: string): boolean {
    return (this.#pageConnections.get(pageId) ?? 0) > 0
  }

  /** Start the grace period for a page that has no connection right now (an
   * acquire under a page id that never connected must still be reclaimed).
   * A connected page, or one already in grace, is left alone. */
  armPageGrace(pageId: string): void {
    if (this.hasPage(pageId) || this.#pageGrace.has(pageId)) return
    const timer = setTimeout(() => {
      this.#pageGrace.delete(pageId)
      if (this.hasPage(pageId)) return
      for (const listener of this.#expiryListeners) listener(pageId)
    }, PAGE_GRACE_MS)
    timer.unref?.()
    this.#pageGrace.set(pageId, timer)
  }

  onPageExpired(listener: (pageId: string) => void): () => void {
    this.#expiryListeners.add(listener)
    return () => { this.#expiryListeners.delete(listener) }
  }

  onApplicationShutdown(): void {
    for (const timer of this.#pageGrace.values()) clearTimeout(timer)
    this.#pageGrace.clear()
  }

  #connectPage(pageId: string): void {
    this.#pageConnections.set(pageId, (this.#pageConnections.get(pageId) ?? 0) + 1)
    const timer = this.#pageGrace.get(pageId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.#pageGrace.delete(pageId)
    }
  }

  #disconnectPage(pageId: string): void {
    const remaining = (this.#pageConnections.get(pageId) ?? 1) - 1
    if (remaining > 0) {
      this.#pageConnections.set(pageId, remaining)
      return
    }
    this.#pageConnections.delete(pageId)
    this.armPageGrace(pageId)
  }
}
