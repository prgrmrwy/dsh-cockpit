import { useEffect, useRef, useState } from 'react'
import { forwardOpenUrl, type DeviceStatusFacts } from '@dsh-cockpit/shared'
import { api, ApiRequestError } from '../api/client.js'
import { CODE_TEXT, STATE_TEXT } from '../panels/ForwardList.jsx'
import { FRAME_ALLOW, FRAME_SANDBOX } from './frame-attributes.js'
import { forwardTabsOf, type ForwardTab } from './forward-tabs-model.js'

/** Forward tabs (change forward-workbench-tab, design D3/D4): one iframe per
 * tab-marked same-port entry, created on first show and kept afterwards.
 *
 * The launch URL may carry a token, so it never enters React state: it lives
 * in `pendingRef` only until it is assigned to the iframe once. These frames
 * are deliberately unknown to `Workbench`, which is what keeps the device-side
 * bridge in them un-handshaken (no config, no capability, messages ignored). */

const NAVIGATION_DEADLINE_MS = 10_000
const FALLBACK_TEXT = '无法打开该标签页，请重试。'

type Phase = 'idle' | 'pending' | 'navigating' | 'loaded' | 'failed'

interface TabFrame {
  readonly key: string
  readonly phase: Phase
  readonly failureCode?: string
}

export interface ForwardTabReloadRequest {
  readonly key: string
  readonly nonce: number
}

export interface ForwardTabsProps {
  readonly devices: readonly DeviceStatusFacts[]
  /** The shown tab; undefined while the device workbench is shown. */
  readonly activeKey: string | undefined
  readonly reloadRequest?: ForwardTabReloadRequest
  /** Test seam; defaults to the cockpit API. */
  readonly resolveUrl?: (deviceId: string, devicePort: number) => Promise<{ url: string }>
  readonly navigationDeadlineMs?: number
}

export function ForwardTabs({ devices, activeKey, reloadRequest, resolveUrl = api.resolveForwardUrl, navigationDeadlineMs = NAVIGATION_DEADLINE_MS }: ForwardTabsProps) {
  const [frames, setFrames] = useState<ReadonlyMap<string, TabFrame>>(new Map())
  const framesRef = useRef(frames)
  const iframes = useRef(new Map<string, HTMLIFrameElement>())
  const pendingRef = useRef(new Map<string, string>())
  const appliedRef = useRef(new Set<string>())
  const deadlines = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const inFlight = useRef(new Set<string>())
  const mounted = useRef(true)

  const tabs = devices.filter(device => device.enabled).flatMap(device => forwardTabsOf(device))
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  const publish = (key: string, frame: TabFrame | undefined) => {
    const next = new Map(framesRef.current)
    if (frame === undefined) next.delete(key)
    else next.set(key, frame)
    framesRef.current = next
    setFrames(next)
  }

  const clearDeadline = (key: string) => {
    const timer = deadlines.current.get(key)
    if (timer !== undefined) clearTimeout(timer)
    deadlines.current.delete(key)
  }

  /** Hand the pending URL to the iframe exactly once, then drop it. */
  const apply = (key: string) => {
    const url = pendingRef.current.get(key)
    const iframe = iframes.current.get(key)
    if (url === undefined || iframe === undefined) return
    pendingRef.current.delete(key)
    appliedRef.current.add(key)
    iframe.src = url
    clearDeadline(key)
    deadlines.current.set(key, setTimeout(() => {
      deadlines.current.delete(key)
      appliedRef.current.delete(key)
      if (framesRef.current.get(key)?.phase === 'navigating') publish(key, { key, phase: 'loaded' })
    }, navigationDeadlineMs))
  }

  const launch = (tab: ForwardTab) => {
    if (inFlight.current.has(tab.key)) return
    const { row } = tab
    if (row.state !== 'ready' || row.localPort === undefined) {
      publish(tab.key, { key: tab.key, phase: 'failed', failureCode: 'forward-not-ready' })
      return
    }
    inFlight.current.add(tab.key)
    publish(tab.key, { key: tab.key, phase: 'pending' })
    const localPort = row.localPort
    const resolved = row.urlCommand === undefined
      ? Promise.resolve(forwardOpenUrl(localPort, row.openPath))
      : resolveUrl(tab.deviceId, tab.devicePort).then(result => result.url)
    resolved.then(url => {
      inFlight.current.delete(tab.key)
      if (!mounted.current || !framesRef.current.has(tab.key)) return
      pendingRef.current.set(tab.key, url)
      publish(tab.key, { key: tab.key, phase: 'navigating' })
      apply(tab.key)
    }, (cause: unknown) => {
      inFlight.current.delete(tab.key)
      if (!mounted.current || !framesRef.current.has(tab.key)) return
      publish(tab.key, { key: tab.key, phase: 'failed', failureCode: cause instanceof ApiRequestError ? cause.code : 'request-failed' })
    })
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const timer of deadlines.current.values()) clearTimeout(timer)
    }
  }, [])

  // Destroy frames whose tab is gone (entry deleted, mark cleared, device
  // disabled or removed); create the active one once its entry is ready.
  useEffect(() => {
    const live = new Set(tabs.map(tab => tab.key))
    for (const key of framesRef.current.keys()) {
      if (live.has(key)) continue
      clearDeadline(key)
      pendingRef.current.delete(key)
      appliedRef.current.delete(key)
      publish(key, undefined)
    }
    const active = tabs.find(tab => tab.key === activeKey)
    if (active === undefined || active.row.state !== 'ready') return
    if (!framesRef.current.has(active.key)) {
      publish(active.key, { key: active.key, phase: 'idle' })
      launch(active)
    }
  })

  // An explicit reload (topbar menu) relaunches into the same iframe.
  useEffect(() => {
    if (reloadRequest === undefined) return
    const tab = tabsRef.current.find(candidate => candidate.key === reloadRequest.key)
    if (tab === undefined) return
    if (!framesRef.current.has(tab.key)) publish(tab.key, { key: tab.key, phase: 'idle' })
    launch(tab)
  }, [reloadRequest?.nonce])

  const onLoad = (key: string) => {
    if (!appliedRef.current.has(key)) return
    appliedRef.current.delete(key)
    clearDeadline(key)
    if (framesRef.current.get(key)?.phase === 'navigating') publish(key, { key, phase: 'loaded' })
  }

  return (
    <section className="workbench forward-tabs" data-cockpit-forward-tabs="true" style={activeKey === undefined ? { display: 'none' } : undefined}>
      {[...frames.values()].map(frame => {
        const tab = tabs.find(candidate => candidate.key === frame.key)
        if (tab === undefined) return null
        const active = frame.key === activeKey
        const notReady = tab.row.state !== 'ready'
        const failed = !notReady && frame.phase === 'failed'
        return (
          <div key={frame.key} className="workbench-frame" style={active ? undefined : { display: 'none' }} data-forward-tab-mounted={frame.key}>
            <iframe
              ref={element => {
                if (element === null) iframes.current.delete(frame.key)
                else {
                  iframes.current.set(frame.key, element)
                  apply(frame.key)
                }
              }}
              title={tab.name}
              sandbox={FRAME_SANDBOX}
              allow={FRAME_ALLOW}
              referrerPolicy="no-referrer"
              className="workbench-iframe"
              data-forward-tab={frame.key}
              data-forward-tab-phase={frame.phase}
              onLoad={() => { onLoad(frame.key) }}
            />
            {active && notReady && (
              <div className="workbench-overlay" role="status" data-forward-tab-state={tab.row.state}>
                <p className="overlay-title">{STATE_TEXT[tab.row.state]}</p>
                {tab.row.diagnostic !== undefined && <p className="overlay-diagnostic">{tab.row.diagnostic}</p>}
              </div>
            )}
            {active && failed && (
              <div className="workbench-overlay" role="status" data-forward-tab-failure={frame.failureCode}>
                <p className="overlay-title">标签页未能打开</p>
                <p className="overlay-diagnostic">{CODE_TEXT[frame.failureCode ?? ''] ?? FALLBACK_TEXT}</p>
                <button className="overlay-action" onClick={() => { launch(tab) }}>重试</button>
              </div>
            )}
          </div>
        )
      })}
      {(() => {
        // A selected tab whose entry is not ready yet has no frame: show its
        // status alone, no iframe (spec: diagnostics only until ready).
        const tab = tabs.find(candidate => candidate.key === activeKey)
        if (tab === undefined || frames.has(tab.key)) return null
        return (
          <div className="workbench-frame" data-forward-tab-unmounted={tab.key}>
            <div className="workbench-overlay" role="status" data-forward-tab-state={tab.row.state}>
              <p className="overlay-title">{STATE_TEXT[tab.row.state]}</p>
              {tab.row.diagnostic !== undefined && <p className="overlay-diagnostic">{tab.row.diagnostic}</p>}
            </div>
          </div>
        )
      })()}
    </section>
  )
}
