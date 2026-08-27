import { useEffect, useRef, useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

export interface WorkbenchProps {
  readonly device: DeviceStatusFacts | undefined
}

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
export function Workbench({ device }: WorkbenchProps) {
  const registryRef = useRef<Map<string, FrameInfo>>(new Map())
  const [frames, setFrames] = useState<readonly FrameInfo[]>([])

  useEffect(() => {
    if (device === undefined) return
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
      const prior = registryRef.current.get(device.deviceId)!
      const updated: FrameInfo = { ...prior, state: device.state, diagnostic: device.diagnostic, lastUpdatedAt: device.lastUpdatedAt }
      registryRef.current.set(device.deviceId, updated)
      if (updated.state !== prior.state || updated.diagnostic !== prior.diagnostic) {
        setFrames([...registryRef.current.values()])
      }
    }
  }, [device])

  if (device === undefined || frames.length === 0) {
    return (
      <section className="workbench" data-cockpit-workbench="true">
        <div className="workbench-empty"><p>选择一台设备开始使用</p></div>
      </section>
    )
  }

  return (
    <section className="workbench" data-cockpit-workbench="true">
      {frames.map(frame => {
        const active = frame.deviceId === device.deviceId
        const offline = active && frame.state !== 'READY' && frame.state !== 'DEGRADED'
        return (
          <div
            key={frame.deviceId}
            className="workbench-frame"
            style={active ? undefined : { display: 'none' }}
            data-workbench-mounted={frame.deviceId}
          >
            <iframe
              src={frame.url}
              title={frame.deviceId}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              className="workbench-iframe"
              data-workbench-device={frame.deviceId}
            />
            {offline && (
              <div className="workbench-overlay" role="status" data-cockpit-offline={frame.deviceId}>
                <p className="overlay-title">设备不可用</p>
                <p className="overlay-diagnostic">{frame.diagnostic}</p>
                <p className="overlay-meta">最后更新：{new Date(frame.lastUpdatedAt).toLocaleTimeString()}</p>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}