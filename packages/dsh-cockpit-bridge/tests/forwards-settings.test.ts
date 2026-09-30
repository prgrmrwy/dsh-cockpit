import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { ForwardsSnapshot } from '@dsh-cockpit/shared'

/** The read-only "驾驶舱转发" settings section (device-forward-registry D9).
 * The bridge test environment is `node` with no DOM library, so this asserts
 * the section's render description: the registered slot, and the plain view
 * model the component renders from (rows, usage, controls). */

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

describe('cockpit forwards settings section', () => {
  it('lists the system and 3939 rows with 1 / 8 and no mutation controls', async () => {
    const { registration, injected } = await section()
    expect(registration.options.label()).toBe('驾驶舱转发')
    const fake = window as unknown as FakeWindow
    // Like React's useSyncExternalStore, read the view inside the listener.
    const seen: unknown[] = []
    injected.subscribe(() => { seen.push(injected.view()) })
    fake.emitMessage({ type: 'dsh-cockpit:bridge-config', cockpitOrigin: COCKPIT_ORIGIN, capability: 'cap' })
    expect(injected.view()).toEqual({ kind: 'message', text: '正在读取转发表' })
    fake.emitMessage({ type: 'dsh-cockpit:forwards-snapshot', snapshot })
    expect(seen.at(-1)).toEqual(injected.view())

    expect(injected.view()).toEqual({
      kind: 'rows',
      usage: '1 / 8',
      hint: '在驾驶舱设备面板中管理',
      rows: [
        { key: 'system', port: '3080', address: '127.0.0.1:52000', state: '就绪', pinned: '系统', holders: '', diagnostic: '' },
        { key: '3939', port: '3939', address: '127.0.0.1:54321', state: '就绪', pinned: '随持有者', holders: 'memex-browse:default', diagnostic: '' },
      ],
      controls: [],
    })
  })

  it('shows not-connected text and no rows outside the cockpit', async () => {
    const { injected } = await section()
    expect(injected.view()).toEqual({ kind: 'message', text: '未连接驾驶舱' })
  })
})
