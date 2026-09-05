import { useEffect, useRef, useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

interface BridgeCapabilityPayload {
  readonly capability: string
  readonly expiresAt: number
  readonly protocolVersion?: number
}

export interface WorkbenchProps {
  readonly device: DeviceStatusFacts | undefined
  /** All records that are currently allowed to own a workbench iframe. */
  readonly enabledDeviceIds?: readonly string[]
  /** Reconnects this single device; provided by the shell so the offline
   * overlay offers an explicit recovery action. */
  readonly onReconnect?: () => void
  /** Recovery path when every registered device is disabled. */
  readonly onManageDevices?: () => void
  /** Issues a short-lived bridge capability through the same-origin shell API. */
  readonly requestBridgeCapability?: (deviceId: string) => Promise<BridgeCapabilityPayload>
  /** Supplies a one-shot tokenized root only for a newly mounted generation. */
  readonly requestWorkbenchLaunch?: (deviceId: string) => Promise<{ url: string }>
}

const DEVICE_ACTIVATED_MESSAGE = { type: 'dsh-cockpit:device-activated' } as const
const BRIDGE_CONFIG_MESSAGE = 'dsh-cockpit:bridge-config' as const
const CAPABILITY_EXPIRED_MESSAGE = 'dsh-cockpit:capability-expired' as const

/** Bridge capabilities expire on the server after a short TTL. The parent
 * renews before expiry (grace window below) so a user staying on one device
 * never loses reliable acknowledgements; renewal failures retry with bounded
 * exponential backoff. */
const CAPABILITY_RENEW_GRACE_MS = 15_000
const CAPABILITY_RENEW_RETRY_BASE_MS = 15_000
const CAPABILITY_RENEW_RETRY_MAX_MS = 120_000
/** The bridge reports an invalid/expired capability as backstop for hidden
 * iframes where timers are throttled; the parent rate-limits its renewal. */
const CAPABILITY_RENEW_THROTTLE_MS = 5_000

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
export function Workbench({ device, enabledDeviceIds, onReconnect, onManageDevices, requestBridgeCapability, requestWorkbenchLaunch }: WorkbenchProps) {
  const registryRef = useRef<Map<string, FrameInfo>>(new Map())
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map())
  const [frames, setFrames] = useState<readonly FrameInfo[]>([])
  const capabilityRef = useRef<Map<string, BridgeCapabilityPayload>>(new Map())
  const renewalTimersRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; attempt: number }>>(new Map())
  const renewalInFlightRef = useRef<Set<string>>(new Set())
  const renewalRequestedAtRef = useRef<Map<string, number>>(new Map())
  const launchRequestedRef = useRef<Set<string>>(new Set())

  const notifyActivated = (deviceId: string): void => {
    const frame = registryRef.current.get(deviceId)
    const iframe = iframeRefs.current.get(deviceId)
    if (frame === undefined || iframe === undefined || iframe.contentWindow === null || frame.url === '') return
    let targetOrigin: string
    try {
      targetOrigin = new URL(frame.url).origin
    } catch {
      return
    }
    try {
      const capability = capabilityRef.current.get(deviceId)
      if (capability !== undefined) {
        iframe.contentWindow.postMessage({
          type: BRIDGE_CONFIG_MESSAGE,
          cockpitOrigin: window.location.origin,
          capability: capability.capability,
        }, targetOrigin)
      }
      iframe.contentWindow.postMessage(DEVICE_ACTIVATED_MESSAGE, targetOrigin)
    } catch {
      // A malformed/missing endpoint is already represented by the offline
      // overlay; activation signaling must not disturb that recovery UI.
    }
  }

  /** Capability renewal helpers — one routine shared by the initial issue,
   * the expiry timer, iframe load/activation and the bridge backstop signal,
   * so every path re-sends bridge-config exactly once after issuance. */
  const clearRenewalTimer = (deviceId: string): void => {
    const entry = renewalTimersRef.current.get(deviceId)
    if (entry !== undefined) {
      clearTimeout(entry.timer)
      renewalTimersRef.current.delete(deviceId)
    }
  }

  /** Schedule at an exact delay (used for retry backoff). */
  const setRenewalTimer = (deviceId: string, delayMs: number, attempt: number): void => {
    clearRenewalTimer(deviceId)
    renewalTimersRef.current.set(deviceId, {
      timer: setTimeout(() => {
        renewalTimersRef.current.delete(deviceId)
        renewCapability(deviceId)
      }, delayMs),
      attempt,
    })
  }

  /** Schedule ahead of a known expiry (deducting the renewal grace window). */
  const scheduleRenewal = (deviceId: string, expiresAt: number, attempt: number): void => {
    setRenewalTimer(deviceId, Math.max(0, expiresAt - Date.now() - CAPABILITY_RENEW_GRACE_MS), attempt)
  }

  const renewCapability = (deviceId: string): void => {
    if (requestBridgeCapability === undefined) return
    const frame = registryRef.current.get(deviceId)
    const iframe = iframeRefs.current.get(deviceId)
    if (frame === undefined || iframe === undefined || iframe.contentWindow === null) return
    if (renewalInFlightRef.current.has(deviceId)) return
    renewalInFlightRef.current.add(deviceId)
    requestBridgeCapability(deviceId).then(capability => {
      renewalInFlightRef.current.delete(deviceId)
      renewalRequestedAtRef.current.set(deviceId, Date.now())
      capabilityRef.current.set(deviceId, capability)
      notifyActivated(deviceId)
      scheduleRenewal(deviceId, capability.expiresAt, 0)
    }).catch(() => {
      renewalInFlightRef.current.delete(deviceId)
      const attempt = renewalTimersRef.current.get(deviceId)?.attempt ?? 0
      const delay = Math.min(CAPABILITY_RENEW_RETRY_BASE_MS * 2 ** attempt, CAPABILITY_RENEW_RETRY_MAX_MS)
      setRenewalTimer(deviceId, delay, attempt + 1)
    })
  }

  useEffect(() => {
    if (requestBridgeCapability === undefined || device === undefined || !device.enabled || device.endpoint === undefined) return
    let cancelled = false
    const deviceId = device.deviceId
    // Clean slate for this device: a previous timer/in-flight renewal belongs
    // to the old endpoint or an older device activation.
    clearRenewalTimer(deviceId)
    renewalInFlightRef.current.delete(deviceId)
    requestBridgeCapability(deviceId).then(capability => {
      if (cancelled) return
      renewalRequestedAtRef.current.set(deviceId, Date.now())
      capabilityRef.current.set(deviceId, capability)
      notifyActivated(deviceId)
      scheduleRenewal(deviceId, capability.expiresAt, 0)
    }).catch(() => {
      // Bridge is optional: a missing capability must never disturb the
      // native workbench. Still retry with bounded backoff, so one transient
      // failure at page load does not silently disable precise
      // acknowledgements until the user switches devices.
      const attempt = renewalTimersRef.current.get(deviceId)?.attempt ?? 0
      const delay = Math.min(CAPABILITY_RENEW_RETRY_BASE_MS * 2 ** attempt, CAPABILITY_RENEW_RETRY_MAX_MS)
      setRenewalTimer(deviceId, delay, attempt + 1)
    })
    return () => {
      cancelled = true
      clearRenewalTimer(deviceId)
      renewalInFlightRef.current.delete(deviceId)
    }
  }, [device?.deviceId, device?.endpoint, device?.enabled, requestBridgeCapability])

  // Backstop for hidden iframes (throttled timers): the bridge peeks at the
  // HTTP status of its own callbacks and asks the parent for a fresh
  // capability when the old one was rejected. Attribute strictly to OUR
  // iframe of that device and its exact origin.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'object' || event.data === null) return
      if ((event.data as { type?: unknown }).type !== CAPABILITY_EXPIRED_MESSAGE) return
      let deviceId: string | undefined
      for (const [id, iframe] of iframeRefs.current) {
        if (iframe.contentWindow === event.source) {
          deviceId = id
          break
        }
      }
      if (deviceId === undefined) return
      const frame = registryRef.current.get(deviceId)
      if (frame === undefined) return
      let expectedOrigin: string
      try {
        expectedOrigin = new URL(frame.url).origin
      } catch {
        return
      }
      if (event.origin !== expectedOrigin) return
      const requestedAt = renewalRequestedAtRef.current.get(deviceId) ?? 0
      if (Date.now() - requestedAt < CAPABILITY_RENEW_THROTTLE_MS) return
      renewCapability(deviceId)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [requestBridgeCapability])

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
      const initial: FrameInfo = {
        deviceId: device.deviceId,
        url: requestWorkbenchLaunch === undefined ? device.endpoint ?? '' : '',
        state: device.state,
        diagnostic: device.diagnostic,
        lastUpdatedAt: device.lastUpdatedAt,
      }
      registryRef.current.set(device.deviceId, initial)
      setFrames([...registryRef.current.values()])
      if (requestWorkbenchLaunch !== undefined && device.endpoint !== undefined && !launchRequestedRef.current.has(device.deviceId)) {
        launchRequestedRef.current.add(device.deviceId)
        void requestWorkbenchLaunch(device.deviceId).then(({ url }) => {
          const frame = registryRef.current.get(device.deviceId)
          if (frame === undefined) return
          registryRef.current.set(device.deviceId, { ...frame, url })
          setFrames([...registryRef.current.values()])
        }).catch(() => {})
      }
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
  }, [device, requestWorkbenchLaunch])

  // Device tab switches keep every iframe mounted, so the child page observes
  // no navigation or session-store change. Explicitly tell an already-loaded
  // frame when it becomes active again; its bridge can then re-acknowledge the
  // session that is already focused.
  useEffect(() => {
    if (device !== undefined) notifyActivated(device.deviceId)
  }, [device?.deviceId])


  const handleFrameLoad = (deviceId: string): void => {
    const frame = registryRef.current.get(deviceId)
    if (frame === undefined) return
    try {
      const loaded = new URL(frame.url)
      if (loaded.searchParams.has('token')) {
        loaded.search = ''
        loaded.hash = ''
        registryRef.current.set(deviceId, { ...frame, url: loaded.toString() })
        setFrames([...registryRef.current.values()])
        return
      }
    } catch { /* malformed endpoint stays covered by lifecycle diagnostics */ }
    if (device?.deviceId === deviceId) notifyActivated(deviceId)
  }

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
              allow="clipboard-read; clipboard-write"
              className="workbench-iframe"
              data-workbench-device={frame.deviceId}
              onLoad={() => { handleFrameLoad(frame.deviceId) }}
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