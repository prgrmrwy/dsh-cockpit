import { useEffect, useRef, useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

export interface WorkbenchProps {
  readonly device: DeviceStatusFacts | undefined
  /** All records that are currently allowed to own a workbench iframe. */
  readonly enabledDeviceIds?: readonly string[]
  /** Reconnects this single device; provided by the shell so the offline
   * overlay offers an explicit recovery action. */
  readonly onReconnect?: () => void
  /** Recovery path when every registered device is disabled. */
  readonly onManageDevices?: () => void
}

const DEVICE_ACTIVATED_MESSAGE = { type: 'dsh-cockpit:device-activated' } as const

interface FrameInfo {
  readonly deviceId: string
  readonly url: string
  readonly state: DeviceStatusFacts['state']
  readonly diagnostic: string | undefined
  readonly lastUpdatedAt: number
}

/** Workbench keeps every created iframe MOUNTED and merely hides non-current
 * ones (display:none). Unmounting an iframe would destroy its internal page
 * state — input, scroll, connection — which is exactly what lazy-load +
 * keep-alive promises to preserve. The parent never reads the iframe DOM;
 * status aggregation goes through the cockpit API, so a workbench crash
 * cannot affect it and vice versa. */
export function Workbench({ device, enabledDeviceIds, onReconnect, onManageDevices }: WorkbenchProps) {
  const registryRef = useRef<Map<string, FrameInfo>>(new Map())
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map())
  const [frames, setFrames] = useState<readonly FrameInfo[]>([])

  const notifyActivated = (deviceId: string): void => {
    const frame = registryRef.current.get(deviceId)
    const iframe = iframeRefs.current.get(deviceId)
    if (frame === undefined || iframe === undefined || iframe.contentWindow === null || frame.url === '') return
    try {
      iframe.contentWindow.postMessage(DEVICE_ACTIVATED_MESSAGE, new URL(frame.url).origin)
    } catch {
      // A malformed/missing endpoint is already represented by the offline
      // overlay; activation signaling must not disturb that recovery UI.
    }
  }

  useEffect(() => {
    if (enabledDeviceIds === undefined) return
    const enabled = new Set(enabledDeviceIds)
    let changed = false
    for (const deviceId of registryRef.current.keys()) {
      if (enabled.has(deviceId)) continue
      registryRef.current.delete(deviceId)
      iframeRefs.current.delete(deviceId)
      changed = true
    }
    if (changed) setFrames([...registryRef.current.values()])
  }, [enabledDeviceIds])

  useEffect(() => {
    if (device === undefined || !device.enabled) return
    if (!registryRef.current.has(device.deviceId)) {
      registryRef.current.set(device.deviceId, {
        deviceId: device.deviceId,
        url: device.endpoint ?? '',
        state: device.state,
        diagnostic: device.diagnostic,
        lastUpdatedAt: device.lastUpdatedAt,
      })
      setFrames([...registryRef.current.values()])
    } else {
      // Keep live status current on the already-created frame (reconnect etc).
      // The tunnel endpoint is reassigned on every reconnect (fresh random
      // loopback port), so the iframe must follow the live endpoint — otherwise
      // it would keep loading the OLD dead port after a successful reconnect.
      const prior = registryRef.current.get(device.deviceId)!
      const updated: FrameInfo = {
        ...prior,
        url: device.endpoint ?? prior.url,
        state: device.state,
        diagnostic: device.diagnostic,
        lastUpdatedAt: device.lastUpdatedAt,
      }
      registryRef.current.set(device.deviceId, updated)
      if (updated.url !== prior.url || updated.state !== prior.state || updated.diagnostic !== prior.diagnostic || updated.lastUpdatedAt !== prior.lastUpdatedAt) {
        setFrames([...registryRef.current.values()])
      }
    }
  }, [device])

  // Device tab switches keep every iframe mounted, so the child page observes
  // no navigation or session-store change. Explicitly tell an already-loaded
  // frame when it becomes active again; its bridge can then re-acknowledge the
  // session that is already focused.
  useEffect(() => {
    if (device !== undefined) notifyActivated(device.deviceId)
  }, [device?.deviceId])

  if (device === undefined || frames.length === 0) {
    const noEnabledDevices = enabledDeviceIds !== undefined && enabledDeviceIds.length === 0
    return (
      <section className="workbench" data-cockpit-workbench="true">
        <div className="workbench-empty" data-cockpit-no-enabled={String(noEnabledDevices)}>
          <div>
            <p>{noEnabledDevices ? '没有已启用设备' : '选择一台设备开始使用'}</p>
            {noEnabledDevices && onManageDevices !== undefined && (
              <button className="overlay-action" onClick={onManageDevices}>打开设备管理</button>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="workbench" data-cockpit-workbench="true">
      {frames.map(frame => {
        const active = frame.deviceId === device.deviceId
        // CONNECTING is a live "in progress" state — show a spinner and
        // connecting wording, not the failure overlay. Everything that is not
        // READY/DEGRADED keeps the overlay so the iframe stays mounted but
        // hidden behind an honest status panel.
        const busy = active && frame.state === 'CONNECTING'
        const offline = active && frame.state !== 'READY' && frame.state !== 'DEGRADED'
        return (
          <div
            key={frame.deviceId}
            className="workbench-frame"
            style={active ? undefined : { display: 'none' }}
            data-workbench-mounted={frame.deviceId}
          >
            <iframe
              ref={element => {
                if (element === null) iframeRefs.current.delete(frame.deviceId)
                else iframeRefs.current.set(frame.deviceId, element)
              }}
              src={frame.url}
              title={frame.deviceId}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              className="workbench-iframe"
              data-workbench-device={frame.deviceId}
              onLoad={() => { if (active) notifyActivated(frame.deviceId) }}
            />
            {offline && (
              <div
                className="workbench-overlay"
                role="status"
                data-cockpit-offline={frame.deviceId}
                data-cockpit-overlay-state={frame.state}
              >
                {busy && <span className="overlay-spinner" aria-hidden="true" />}
                <p className="overlay-title">{busy ? '正在连接…' : '设备不可用'}</p>
                <p className="overlay-diagnostic">{frame.diagnostic}</p>
                <p className="overlay-meta">最后更新：{new Date(frame.lastUpdatedAt).toLocaleTimeString()}</p>
                {onReconnect !== undefined && (
                  <button className="overlay-action" onClick={onReconnect}>{busy ? '重新连接' : '重连此设备'}</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}