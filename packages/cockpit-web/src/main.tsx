import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { api } from './api/client.js'
import { subscribeDevices } from './api/stream.js'
import { registerServiceWorker } from './pwa.js'
import { TopBar } from './components/TopBar.jsx'
import { Workbench } from './workbench/Workbench.jsx'
import { DevicePanel, OverviewPanel, SettingsPanel, type PanelName } from './panels/Panels.jsx'
import './styles/app.css'

export type SelectedDevice = { deviceId: string; state: DeviceStatusFacts['state'] }

export function App() {
  const [devices, setDevices] = useState<readonly DeviceStatusFacts[]>([])
  const [currentId, setCurrentId] = useState<string | undefined>()
  const [panel, setPanel] = useState<PanelName | undefined>(undefined)
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    try {
      const payload = await api.devices()
      setDevices(payload.device)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  // First visit: ask the server to set the cookie, then load. Subsequent
  // reloads already hold the cookie and skip the round trip.
  const boot = async () => {
    try { await api.bootstrap() } catch { /* token may already exist */ }
    await refresh()
  }
  useEffect(() => { void boot() }, [refresh])

  // Live status: the server pushes every facts change over SSE. Without this
  // subscription the UI would only update on full page refreshes — the
  // CONNECTING → READY transition would be invisible ("刷新了才出来").
  useEffect(() => subscribeDevices(setDevices), [])

  // The registry snapshot includes disabled devices for management, but only
  // enabled records are valid workbench navigation targets.
  const enabledDevices = useMemo(
    () => devices.filter(device => device.enabled).sort((left, right) => left.order - right.order),
    [devices],
  )

  // Startup behavior: enter the last used enabled device. If the current
  // device is disabled/deleted later, deterministically fall back to the first
  // enabled record without overwriting the user's last-used preference.
  const lastUsed = useMemo(() => {
    try { return window.localStorage.getItem('cockpit:last-device') ?? undefined } catch { return undefined }
  }, [])
  useEffect(() => {
    const target = lastUsed !== undefined && enabledDevices.some(device => device.deviceId === lastUsed)
      ? lastUsed
      : enabledDevices[0]?.deviceId
    setCurrentId(previous => (
      previous !== undefined && enabledDevices.some(device => device.deviceId === previous)
        ? previous
        : target
    ))
    if (devices.length > 0 && lastUsed === undefined) setPanel('overview')
  }, [devices.length, enabledDevices, lastUsed])

  const select = useCallback((deviceId: string) => {
    setCurrentId(deviceId)
    try { window.localStorage.setItem('cockpit:last-device', deviceId) } catch { /* ignore */ }
  }, [])

  // Reconnect only the current device; everything that is already connected
  // stays untouched (a global refresh would disrupt healthy tunnels).
  const reconnectCurrent = useCallback(async () => {
    if (currentId === undefined) return
    try { await api.reconnectDevice(currentId) } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [currentId])

  // Clear completion reminders independently of device selection. The server
  // publishes the accepted facts through the existing SSE stream, so the UI
  // deliberately waits for that authoritative update instead of hiding the
  // chip optimistically.
  const ackCompleted = useCallback(async (deviceId: string) => {
    try {
      await api.ackCompleted(deviceId)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const current = enabledDevices.find(device => device.deviceId === currentId)

  return (
    <div className="cockpit">
      <TopBar
        devices={enabledDevices}
        currentId={currentId}
        onSelect={select}
        onOpenPanel={setPanel}
        onRefresh={reconnectCurrent}
        onRefreshLabel="重连当前设备"
        onAckCompleted={ackCompleted}
      />
      <main className="cockpit-main">
        {error !== undefined && <div className="cockpit-error" role="alert">{error}</div>}
        <Workbench
          device={current}
          enabledDeviceIds={enabledDevices.map(device => device.deviceId)}
          requestBridgeCapability={api.bridgeCapability}
          requestWorkbenchLaunch={api.workbenchLaunch}
          onReconnect={reconnectCurrent}
          onManageDevices={() => setPanel('devices')}
        />
      </main>
      {panel === 'devices' && (
        <DevicePanel devices={devices} onClose={() => setPanel(undefined)} onChanged={() => void refresh()} />
      )}
      {panel === 'overview' && (
        <OverviewPanel devices={devices} onClose={() => setPanel(undefined)} onSelect={deviceId => { select(deviceId); setPanel(undefined) }} />
      )}
      {panel === 'settings' && <SettingsPanel onClose={() => setPanel(undefined)} />}
    </div>
  )
}

// PWA: register the service worker on production builds only (registering in
// dev would let it cache vite's HMR responses and stale the dev server).
registerServiceWorker()

const root = document.getElementById('root')
if (root !== null) {
  createRoot(root).render(
    <StrictMode><App /></StrictMode>,
  )
}