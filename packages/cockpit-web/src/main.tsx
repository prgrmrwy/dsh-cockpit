import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'
import { api } from './api/client.js'
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

  // Startup behavior: enter the last used device; first run shows overview.
  const lastUsed = useMemo(() => {
    try { return window.localStorage.getItem('cockpit:last-device') ?? undefined } catch { return undefined }
  }, [])
  useEffect(() => {
    if (devices.length === 0) return
    const target = lastUsed !== undefined && devices.some(d => d.deviceId === lastUsed)
      ? lastUsed
      : devices.some(d => d.kind === 'local') ? devices.find(d => d.kind === 'local')!.deviceId : devices[0]?.deviceId
    setCurrentId(prev => prev ?? target)
    if (lastUsed === undefined) setPanel('overview')
  }, [devices, lastUsed])

  const select = useCallback((deviceId: string) => {
    setCurrentId(deviceId)
    try { window.localStorage.setItem('cockpit:last-device', deviceId) } catch { /* ignore */ }
  }, [])

  const current = devices.find(d => d.deviceId === currentId)

  return (
    <div className="cockpit">
      <TopBar
        devices={devices}
        currentId={currentId}
        onSelect={select}
        onOpenPanel={setPanel}
        onRefresh={refresh}
      />
      <main className="cockpit-main">
        {error !== undefined && <div className="cockpit-error" role="alert">{error}</div>}
        <Workbench device={current} />
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

const root = document.getElementById('root')
if (root !== null) {
  createRoot(root).render(
    <StrictMode><App /></StrictMode>,
  )
}