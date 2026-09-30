import type {
  AddDeviceRequest,
  ApiError,
  DeviceStatusFacts,
  RemoveDeviceRequest,
  UpdateDeviceRequest,
} from '@dsh-cockpit/shared'

const BASE = '/api'

/** This page load's opaque id (design D4(b)): ≥128 random bits, base64url.
 * It rides the status stream (`?page=`), capability issue and instance
 * release, so forward holders created through this page are reclaimed once
 * the page is gone. A reload is a new page. */
export const PAGE_ID: string = (() => {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
})()

/** A failed API call carrying the server's STABLE code.
 *
 * Callers that must react differently per outcome (workbench launch: paste a
 * URL vs retry vs re-read the device) need the code, not a sentence. The code
 * is a fixed enum chosen by the server; the message is already redacted there
 * and is kept for humans/logs only. */
export class ApiRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  })
  if (!response.ok) {
    let error: ApiError
    try {
      error = await response.json() as ApiError
    } catch {
      error = { code: 'http-error', message: `HTTP ${response.status}` }
    }
    throw new ApiRequestError(error.code || 'http-error', error.message || error.code, response.status)
  }
  return await response.json() as T
}

export interface DevicesPayload { readonly device: readonly DeviceStatusFacts[] }

/** Short-lived, device-bound credential delivered to the optional bridge via
 * the workbench iframe handshake. It is deliberately not the persistent
 * HttpOnly cockpit token. */
export interface BridgeCapabilityPayload {
  readonly capability: string
  readonly expiresAt: number
  readonly protocolVersion?: number
}

export const api = {
  bootstrap: () => request<{ ok: true }>('/bootstrap'),
  devices: () => request<DevicesPayload>('/devices'),
  addDevice: (input: AddDeviceRequest) => request<{ deviceId: string }>('/devices', { method: 'POST', body: JSON.stringify(input) }),
  updateDevice: (deviceId: string, input: UpdateDeviceRequest) => request<{ deviceId: string }>(`/devices/${encodeURIComponent(deviceId)}`, { method: 'PUT', body: JSON.stringify(input) }),
  removeDevice: (input: RemoveDeviceRequest) => request<{ removed: boolean; requiresConfirmation: boolean }>(`/devices/${encodeURIComponent(input.deviceId)}${input.confirmed ? '?confirmed=true' : ''}`, { method: 'DELETE' }),
  refreshDevice: (deviceId: string) => request<{ refreshed: boolean }>(`/devices/${encodeURIComponent(deviceId)}/refresh`, { method: 'POST' }),
  reconnectDevice: (deviceId: string) => request<{ reconnecting: boolean }>(`/devices/${encodeURIComponent(deviceId)}/reconnect`, { method: 'POST' }),
  workbenchLaunch: (deviceId: string) => request<{ url: string; authGeneration: number }>(`/devices/${encodeURIComponent(deviceId)}/workbench-launch`, { method: 'POST' }),
  /** Marks every currently known completion generation for this device read. */
  ackCompleted: (deviceId: string) => request<{ acked: boolean }>(`/devices/${encodeURIComponent(deviceId)}/completed/ack`, { method: 'POST' }),
  /** Requests the short-lived capability used by the iframe bridge handshake. */
  bridgeCapability: (deviceId: string) => request<BridgeCapabilityPayload>(`/devices/${encodeURIComponent(deviceId)}/bridge/capability`, { method: 'POST', body: JSON.stringify({ pageId: PAGE_ID }) }),
  /** A bridge page instance in this device's iframe ended (design D4(a)). */
  releaseForwardInstance: (deviceId: string, instanceId: string) => request<{ released: boolean }>(`/devices/${encodeURIComponent(deviceId)}/forwards/release-instance`, { method: 'POST', body: JSON.stringify({ instanceId, pageId: PAGE_ID }) }),
  createForward: (deviceId: string, devicePort: number, label?: string) => request<{ devicePort: number; state: string }>(`/devices/${encodeURIComponent(deviceId)}/forwards`, { method: 'POST', body: JSON.stringify(label === undefined ? { devicePort } : { devicePort, label }) }),
  deleteForward: (deviceId: string, devicePort: number) => request<{ removed: boolean }>(`/devices/${encodeURIComponent(deviceId)}/forwards/${devicePort}`, { method: 'DELETE' }),
}