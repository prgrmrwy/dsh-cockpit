import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import type { DevicesPayload } from './client.js'

/** Subscribe to the server's live device-status stream (SSE).
 *
 * The server pushes `{ device: DeviceStatusFacts[] }` immediately on connect
 * and again whenever any device's facts change, so this is the only thing the
 * UI needs to stay current — no manual refresh, no polling. The browser
 * reconnects the EventSource automatically after transient failures.
 *
 * Returns an unsubscribe function. The subscription is harmless while the
 * server is unreachable: EventSource retries on its own, frames are ignored
 * until they parse, and a later push resumes the live flow.
 */
export function subscribeDevices(next: (devices: readonly DeviceStatusFacts[]) => void): () => void {
  const source = new EventSource('/api/devices/stream')
  source.onmessage = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as DevicesPayload
      if (Array.isArray(payload.device)) next(payload.device)
    } catch {
      // Malformed frame: ignore and wait for the next push (auto-reconnect).
    }
  }
  return () => source.close()
}
