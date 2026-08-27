import type {
  AddDeviceRequest,
  ApiError,
  DeviceStatusFacts,
  RemoveDeviceRequest,
  UpdateDeviceRequest,
} from '@dsh-cockpit/shared'

const BASE = '/api'

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
    throw new Error(error.message || error.code)
  }
  return await response.json() as T
}

export interface DevicesPayload { readonly device: readonly DeviceStatusFacts[] }

export const api = {
  devices: () => request<DevicesPayload>('/devices'),
  addDevice: (input: AddDeviceRequest) => request<{ deviceId: string }>('/devices', { method: 'POST', body: JSON.stringify(input) }),
  updateDevice: (deviceId: string, input: UpdateDeviceRequest) => request<{ deviceId: string }>(`/devices/${encodeURIComponent(deviceId)}`, { method: 'PUT', body: JSON.stringify(input) }),
  removeDevice: (input: RemoveDeviceRequest) => request<{ removed: boolean; requiresConfirmation: boolean }>(`/devices/${encodeURIComponent(input.deviceId)}${input.confirmed ? '?confirmed=true' : ''}`, { method: 'DELETE' }),
  refreshDevice: (deviceId: string) => request<{ refreshed: boolean }>(`/devices/${encodeURIComponent(deviceId)}/refresh`, { method: 'POST' }),
}