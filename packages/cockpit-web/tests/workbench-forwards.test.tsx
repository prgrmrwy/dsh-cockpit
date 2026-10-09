import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceForwardsProjection, DeviceStatusFacts } from '@dsh-cockpit/shared'
import { Workbench } from '../src/workbench/Workbench.jsx'
import { api, PAGE_ID } from '../src/api/client.js'
import { subscribeDevices } from '../src/api/stream.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const projection = (...ports: number[]): DeviceForwardsProjection => ({
  rows: [
    { kind: 'system', devicePort: 3080, state: 'ready', localPort: 51000, pid: 7001 },
    ...ports.map(port => ({
      kind: 'additional' as const, devicePort: port, state: 'ready' as const, pinned: false,
      holders: ['memex'], holderCount: 1, createdAt: 0, stateChangedAt: 0, localPort: port + 50_000, pid: 8000 + port,
    })),
  ],
  additionalCount: ports.length,
  limit: 8,
})

const device = (overrides: Partial<DeviceStatusFacts> = {}): DeviceStatusFacts => ({
  deviceId: 'd1', displayName: 'A', kind: 'remote', sshAlias: 'vm-a', enabled: true, order: 0,
  state: 'READY', runningSessionCount: 0, pendingInteractionCount: 0, pendingInteractionObservability: 'available',
  sessionStatuses: [], compatibility: 'SUPPORTED', lastUpdatedAt: 0, endpoint: 'http://127.0.0.1:51000/',
  dshAuthConfigured: true, dshAuthState: 'ready', dshAuthAutoDiscovery: false, dshAuthGeneration: 1,
  ...overrides,
})

const capability = () => vi.fn().mockImplementation(async () => ({ capability: 'tok', expiresAt: Date.now() + 60_000 }))
const snapshots = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.filter(([message]) => (message as { type?: string }).type === 'dsh-cockpit:forwards-snapshot')

function instanceEnded(source: unknown, origin: string, instanceId = 'inst-1111111111111111'): void {
  const event = new MessageEvent('message', { data: { type: 'dsh-cockpit:bridge-instance-ended', instanceId }, origin })
  Object.defineProperty(event, 'source', { value: source })
  window.dispatchEvent(event)
}

describe('workbench forwards', () => {
  it('pushes a snapshot right after config and on each change, only to that device origin', async () => {
    const a = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:51000/', forwards: projection(3939) })
    const b = device({ deviceId: 'd2', endpoint: 'http://127.0.0.1:52000/', forwards: projection() })
    const requestBridgeCapability = capability()
    const { container, rerender } = render(<Workbench device={b} devices={[a, b]} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} />)
    rerender(<Workbench device={a} devices={[a, b]} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} />)
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const frameB = container.querySelector('iframe[data-workbench-device="d2"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')
    const postToB = vi.spyOn(frameB.contentWindow!, 'postMessage')

    // Config first, snapshot right after it, to A's exact origin.
    await waitFor(() => expect(snapshots(postToA)).toHaveLength(1))
    const types = postToA.mock.calls.map(([message]) => (message as { type: string }).type)
    expect(types.indexOf('dsh-cockpit:forwards-snapshot')).toBe(types.indexOf('dsh-cockpit:bridge-config') + 1)
    const [first, firstTarget] = snapshots(postToA)[0]!
    expect(firstTarget).toBe('http://127.0.0.1:51000')
    expect((first as { snapshot: { rows: Array<{ devicePort: number }> } }).snapshot.rows.map(row => row.devicePort)).toEqual([3080, 3939])
    // No host pid reaches the device page.
    expect(JSON.stringify(first)).not.toContain('"pid"')

    // A second entry on A: one more push, still only to A.
    postToB.mockClear()
    const a2 = { ...a, forwards: projection(3939, 5432), lastUpdatedAt: 1 }
    rerender(<Workbench device={a2} devices={[a2, b]} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} />)
    await waitFor(() => expect(snapshots(postToA)).toHaveLength(2))
    const [second, secondTarget] = snapshots(postToA)[1]!
    expect(secondTarget).toBe('http://127.0.0.1:51000')
    expect((second as { snapshot: { rows: Array<{ devicePort: number }> } }).snapshot.rows.map(row => row.devicePort)).toEqual([3080, 3939, 5432])
    expect(postToB.mock.calls.some(([message]) => JSON.stringify(message).includes('5432'))).toBe(false)

    // An unrelated status push (same projection) sends nothing new.
    const a3 = { ...a2, lastUpdatedAt: 2, runningSessionCount: 1 }
    rerender(<Workbench device={a3} devices={[a3, b]} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(snapshots(postToA)).toHaveLength(2)
  })

  it('releases the instance when a reloaded device page reports from a gone source', async () => {
    const a = device({ forwards: projection(3939) })
    const releaseForwardInstance = vi.fn().mockResolvedValue({ released: true })
    const { container } = render(<Workbench device={a} devices={[a]} enabledDeviceIds={['d1']} requestBridgeCapability={capability()} releaseForwardInstance={releaseForwardInstance} />)
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')
    await waitFor(() => expect(snapshots(postToA)).toHaveLength(1))

    // A device page reload posts during `pagehide`; by the time the parent
    // processes it the sending window is gone and `event.source` is null, so
    // identity comes from the origin this device was configured at. Without
    // that fallback the old instance's holders outlive the instance.
    instanceEnded(null, 'http://127.0.0.1:51000')
    expect(releaseForwardInstance).toHaveBeenCalledWith('d1', 'inst-1111111111111111')
  })

  it('ignores a gone-source message from an origin no mounted device was configured at', async () => {
    const a = device({ forwards: projection(3939) })
    const releaseForwardInstance = vi.fn().mockResolvedValue({ released: true })
    const { container } = render(<Workbench device={a} devices={[a]} enabledDeviceIds={['d1']} requestBridgeCapability={capability()} releaseForwardInstance={releaseForwardInstance} />)
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')
    await waitFor(() => expect(snapshots(postToA)).toHaveLength(1))

    // An origin nobody was configured at cannot claim to be this page.
    instanceEnded(null, 'http://127.0.0.1:59999')
    expect(releaseForwardInstance).not.toHaveBeenCalled()
  })

  it('forwards instance-ended from a device iframe to release-instance with the page id', async () => {
    const a = device({ forwards: projection(3939) })
    const releaseForwardInstance = vi.fn().mockResolvedValue({ released: true })
    const { container } = render(<Workbench device={a} devices={[a]} enabledDeviceIds={['d1']} requestBridgeCapability={capability()} releaseForwardInstance={releaseForwardInstance} />)
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')
    await waitFor(() => expect(snapshots(postToA)).toHaveLength(1))

    instanceEnded(frameA.contentWindow, 'http://127.0.0.1:51000')
    expect(releaseForwardInstance).toHaveBeenCalledWith('d1', 'inst-1111111111111111')

    // The api layer carries this page's id — the same one the status stream
    // and capability issue use.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await api.releaseForwardInstance('d1', 'inst-1111111111111111')
    await api.bridgeCapability('d1')
    expect(fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String((init as RequestInit).body))])).toEqual([
      ['/api/devices/d1/forwards/release-instance', { instanceId: 'inst-1111111111111111', pageId: PAGE_ID }],
      ['/api/devices/d1/bridge/capability', { pageId: PAGE_ID }],
    ])
    expect(PAGE_ID).toMatch(/^[A-Za-z0-9_-]{22,64}$/)
    const sources: string[] = []
    vi.stubGlobal('EventSource', class { onmessage = null; constructor(url: string) { sources.push(url) } close() {} })
    subscribeDevices(() => {})()
    expect(sources).toEqual([`/api/devices/stream?page=${PAGE_ID}`])
  })

  it('accepts instance-ended from a previously loaded origin after the iframe drifts', async () => {
    const releaseForwardInstance = vi.fn().mockResolvedValue({ released: true })
    const requestBridgeCapability = capability()
    const o1 = device({ endpoint: 'http://127.0.0.1:51000/', forwards: projection(3939) })
    const { container, rerender } = render(<Workbench device={o1} devices={[o1]} enabledDeviceIds={['d1']} requestBridgeCapability={requestBridgeCapability} releaseForwardInstance={releaseForwardInstance} />)
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')
    await waitFor(() => expect(snapshots(postToA)).toHaveLength(1))

    // The workbench port drifts; the frame now loads O2.
    const o2 = device({ endpoint: 'http://127.0.0.1:52999/', forwards: projection(3939), lastUpdatedAt: 1 })
    rerender(<Workbench device={o2} devices={[o2]} enabledDeviceIds={['d1']} requestBridgeCapability={requestBridgeCapability} releaseForwardInstance={releaseForwardInstance} />)
    await waitFor(() => expect(frameA.getAttribute('src')).toBe('http://127.0.0.1:52999/'))

    // The old document's pagehide still speaks from O1.
    instanceEnded(frameA.contentWindow, 'http://127.0.0.1:51000')
    expect(releaseForwardInstance).toHaveBeenCalledWith('d1', 'inst-1111111111111111')
  })

  it('ignores instance-ended from a foreign source or an origin never loaded by that iframe', async () => {
    const releaseForwardInstance = vi.fn().mockResolvedValue({ released: true })
    const a = device({ deviceId: 'd1', endpoint: 'http://127.0.0.1:51000/', forwards: projection(3939) })
    const b = device({ deviceId: 'd2', endpoint: 'http://127.0.0.1:52000/', forwards: projection() })
    const requestBridgeCapability = capability()
    const { container, rerender } = render(<Workbench device={b} devices={[a, b]} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} releaseForwardInstance={releaseForwardInstance} />)
    rerender(<Workbench device={a} devices={[a, b]} enabledDeviceIds={['d1', 'd2']} requestBridgeCapability={requestBridgeCapability} releaseForwardInstance={releaseForwardInstance} />)
    const frameA = container.querySelector('iframe[data-workbench-device="d1"]') as HTMLIFrameElement
    const frameB = container.querySelector('iframe[data-workbench-device="d2"]') as HTMLIFrameElement
    const postToA = vi.spyOn(frameA.contentWindow!, 'postMessage')
    await waitFor(() => expect(snapshots(postToA)).toHaveLength(1))

    instanceEnded({}, 'http://127.0.0.1:51000')                        // not any device iframe
    instanceEnded(frameA.contentWindow, 'http://127.0.0.1:59999')      // never loaded by A
    instanceEnded(frameA.contentWindow, 'http://127.0.0.1:52000')      // B's origin, from A's window
    instanceEnded(frameB.contentWindow, 'http://127.0.0.1:51000')      // A's origin, from B's window
    instanceEnded(frameA.contentWindow, 'http://127.0.0.1:51000', 'x') // malformed instance id
    expect(releaseForwardInstance).not.toHaveBeenCalled()
  })
})
