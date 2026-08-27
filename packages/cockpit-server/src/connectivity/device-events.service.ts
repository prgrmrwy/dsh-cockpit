import { Injectable } from '@nestjs/common'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

/** Broadcasts device status changes to browser subscribers (SSE). One emitter
 * per process; subscribers receive the full current snapshot on connect and
 * incremental updates afterwards. */
@Injectable()
export class DeviceEventsService {
  readonly #listeners = new Set<(facts: readonly DeviceStatusFacts[]) => void>()

  /** Notifies all subscribers with a fresh snapshot. */
  publish(facts: readonly DeviceStatusFacts[]): void {
    for (const listener of this.#listeners) listener(facts)
  }

  subscribe(listener: (facts: readonly DeviceStatusFacts[]) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
}