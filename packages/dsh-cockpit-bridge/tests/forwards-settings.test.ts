import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { ForwardsSnapshot } from '@dsh-cockpit/shared'

/** The read-only "驾驶舱转发" settings section (device-forward-registry D9).
 * The bridge test environment is `node` with no DOM library, so this asserts
 * the section's render description: the registered slot, and the plain view
 * model the component renders from (lede, rows, usage, guidance). */

const COCKPIT_ORIGIN = 'http://127.0.0.1:4317'

class FakeWindow {
  readonly parent: unknown = { postMessage: () => {} }
  readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void { this.listeners.get(type)?.delete(listener) }
  emitMessage(data: unknown): void {
    for (const listener of [...(this.listeners.get('message') ?? [])]) listener({ data, source: this.parent, origin: COCKPIT_ORIGIN })
  }
}

interface SlotRegistration {
  readonly name: string
  readonly id: string
  readonly label: () => string
  readonly inject: () => { view: () => unknown; subscribe: (listener: () => void) => () => void }
}

function fakeCtx() {
  const registrations: Array<{ options: SlotRegistration; component: (props: object) => ReactElement | null }> = []
  const slotInjects: string[] = []
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} } },
    provide: () => () => {},
    effect: (fn: () => () => void) => { fn() },
    // cordis: run the callback in a child context once the services exist.
    inject: (deps: string[], callback: (child: unknown) => void) => {
      if (deps.every(dep => dep in ctx)) callback(ctx)
    },
    slots: {
      inject: (name: string, callback: () => unknown) => { slotInjects.push(name); callback() },
      register: (options: SlotRegistration, component: (props: object) => ReactElement | null) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, registrations, slotInjects }
}

const snapshot: ForwardsSnapshot = {
  rows: [
    { kind: 'system', devicePort: 3080, state: 'ready', localPort: 52000 },
    { kind: 'additional', devicePort: 3939, state: 'ready', pinned: false, holders: ['memex-browse:default'], holderCount: 1, localPort: 54321 },
  ],
  additionalCount: 1,
  limit: 8,
}

const mainOnly: ForwardsSnapshot = {
  rows: [{ kind: 'system', devicePort: 3080, state: 'ready', localPort: 52000 }],
  additionalCount: 0,
  limit: 8,
}

beforeEach(() => {
  vi.stubGlobal('window', new FakeWindow())
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function section() {
  const fixture = fakeCtx()
  const mod = await import('../src/client/index.js')
  ;(mod.apply as (ctx: unknown) => void)(fixture.ctx)
  expect(fixture.slotInjects).toContain('settings.section')
  const registration = fixture.registrations.find(entry => entry.options.name === 'settings.section')
  expect(registration).toBeDefined()
  return { fixture, registration: registration!, injected: registration!.options.inject() }
}

/** Handshake, then deliver one snapshot, and return the resulting view. */
async function connectedView(deliver: ForwardsSnapshot) {
  const { registration, injected } = await section()
  expect(registration.options.label()).toBe('驾驶舱转发')
  const fake = window as unknown as FakeWindow
  // Like React's useSyncExternalStore, read the view inside the listener.
  const seen: unknown[] = []
  injected.subscribe(() => { seen.push(injected.view()) })
  fake.emitMessage({ type: 'dsh-cockpit:bridge-config', cockpitOrigin: COCKPIT_ORIGIN, capability: 'cap' })
  expect(injected.view()).toEqual({ kind: 'message', title: '正在读取转发表', guidance: [] })
  fake.emitMessage({ type: 'dsh-cockpit:forwards-snapshot', snapshot: deliver })
  expect(seen.at(-1)).toEqual(injected.view())
  return injected.view()
}

describe('cockpit forwards settings section', () => {
  it('lists the main channel and a held 3939 row with 1 / 8 and no mutation controls', async () => {
    const view = await connectedView(snapshot)
    expect(view).toMatchObject({
      kind: 'rows',
      usage: { count: 1, limit: 8 },
      main: [
        { key: 'system', kind: 'main', port: '3080', address: '127.0.0.1:52000', state: '就绪', stateKind: 'ready', lifetime: '主通道', holders: '', diagnostic: '' },
      ],
      additional: [
        { key: '3939', kind: 'additional', port: '3939', address: '127.0.0.1:54321', state: '就绪', stateKind: 'ready', lifetime: '随持有者', holders: 'memex-browse:default', diagnostic: '' },
      ],
      controls: [],
    })
  })

  it('explains where the local address is valid and where entries are created and deleted', async () => {
    const view = await connectedView(snapshot)
    if (view?.kind !== 'rows') throw new Error(`expected rows, got ${JSON.stringify(view)}`)
    expect(view.lede).toContain('驾驶舱')
    expect(view.lede).toContain('只在运行驾驶舱的那台机器上有效')
    expect(view.hint).toContain('驾驶舱设备面板')
    expect(view.hint).toContain('只读')
  })

  it('tells a local device that its components reach local addresses without a tunnel', async () => {
    const view = await connectedView({ rows: [], additionalCount: 0, limit: 8, local: true })
    expect(view).toEqual({
      kind: 'message',
      title: '本机设备无需转发',
      guidance: ['驾驶舱与这台 DSH 在同一台机器上，设备上的组件直接访问本地地址即可，不需要经过 SSH 隧道。'],
    })
  })

  it('invites a next step when the table holds only the main channel', async () => {
    const view = await connectedView(mainOnly)
    if (view?.kind !== 'rows') throw new Error(`expected rows, got ${JSON.stringify(view)}`)
    expect(view.usage).toEqual({ count: 0, limit: 8 })
    expect(view.additional).toEqual([])
    expect(view.emptyGuidance).toContain('组件申请')
    expect(view.emptyGuidance).toContain('常驻')
  })

  it('gives every state a word so colour is never the only signal', async () => {
    const states = ['starting', 'ready', 'retrying', 'paused'] as const
    const view = await connectedView({
      rows: [
        { kind: 'system', devicePort: 3080, state: 'ready', localPort: 52000 },
        ...states.map((state, index) => ({
          kind: 'additional' as const,
          devicePort: 6000 + index,
          state,
          pinned: false,
          holders: [],
          holderCount: 0,
          ...(state === 'ready' ? { localPort: 55000 + index } : {}),
        })),
      ],
      additionalCount: states.length,
      limit: 8,
    })
    if (view?.kind !== 'rows') throw new Error(`expected rows, got ${JSON.stringify(view)}`)
    expect(view.additional.map(row => [row.stateKind, row.state])).toEqual([
      ['starting', '建立中'],
      ['ready', '就绪'],
      ['retrying', '重试中'],
      ['paused', '暂停'],
    ])
    // A state is never carried by colour alone, so the text is always present.
    expect(view.additional.every(row => row.state !== '')).toBe(true)
  })

  it('shows not-connected text and no rows outside the cockpit', async () => {
    const { injected } = await section()
    expect(injected.view()).toEqual({
      kind: 'message',
      title: '未连接驾驶舱',
      guidance: [
        '这个区块只在设备页面运行于驾驶舱工作台内时才会填充。',
        '在驾驶舱里打开这台设备，就能在这里看到它的转发表。',
      ],
    })
  })
})
