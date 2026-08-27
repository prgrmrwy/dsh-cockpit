import { useEffect, useRef, useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

export interface WorkbenchProps {
  readonly device: DeviceStatusFacts | undefined
}

/** iframe registry persists per device once created (lazy instantiate, keep
 * alive across switches to preserve input/scroll/connection). The parent never
 * reads the iframe DOM — status aggregation goes through the cockpit API, so a
 * workbench crash cannot affect it and vice versa. */
export function Workbench({ device }: WorkbenchProps) {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set())
  const { keepAlive } = useWorkbench()
  const current = device?.deviceId

  useEffect(() => {
    if (current === undefined) return
    if (!loaded.has(current)) {
      setLoaded(prev => new Set(prev).add(current))
    }
  }, [current, loaded])

  const frame = current === undefined || !loaded.has(current) ? undefined : keepAlive(current, device)

  return (
    <section className="workbench" data-cockpit-workbench="true">
      {frame === undefined ? (
        <div className="workbench-empty">
          <p>选择一台设备开始使用</p>
        </div>
      ) : (
        <div className="workbench-frame">
          <iframe
            key={frame.deviceId}
            src={frame.url}
            title={frame.deviceId}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="workbench-iframe"
            data-workbench-device={frame.deviceId}
          />
          {frame.state !== 'READY' && frame.state !== 'DEGRADED' && (
            <div className="workbench-overlay" role="status" data-cockpit-offline={frame.deviceId}>
              <p className="overlay-title">设备不可用</p>
              <p className="overlay-diagnostic">{frame.diagnostic}</p>
              <p className="overlay-meta">最后更新：{new Date(frame.lastUpdatedAt).toLocaleTimeString()}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

interface FrameInfo {
  readonly deviceId: string
  readonly url: string
  readonly state: DeviceStatusFacts['state']
  readonly diagnostic: string | undefined
  readonly lastUpdatedAt: number
}

function useWorkbench(): { keepAlive: (deviceId: string, device?: DeviceStatusFacts) => FrameInfo | undefined } {
  const registryRef = useRef<Map<string, FrameInfo>>(new Map())
  const keepAlive = (deviceId: string, device?: DeviceStatusFacts): FrameInfo | undefined => {
    const existing = registryRef.current.get(deviceId)
    if (existing !== undefined) return existing
    if (device === undefined) return undefined
    const frame: FrameInfo = {
      deviceId,
      url: device.endpoint ?? '',
      state: device.state,
      diagnostic: device.diagnostic,
      lastUpdatedAt: device.lastUpdatedAt,
    }
    registryRef.current.set(deviceId, frame)
    return frame
  }
  return { keepAlive }
}
