import { describe, expect, it, vi } from 'vitest'
import { DeviceEventsService } from '../src/connectivity/device-events.service.js'

const P1 = 'page-1111111111111111'
const P2 = 'page-2222222222222222'

describe('DeviceEventsService foreground tracking', () => {
  it('a device is foreground only while a connected page shows it', () => {
    const events = new DeviceEventsService()
    const off = events.subscribe(() => {}, P1)
    expect(events.isForeground('a')).toBe(false)
    events.setForeground(P1, 'a')
    expect(events.isForeground('a')).toBe(true)
    expect(events.isForeground('b')).toBe(false)
    events.setForeground(P1, 'b')
    expect(events.isForeground('a')).toBe(false)
    expect(events.isForeground('b')).toBe(true)
    events.setForeground(P1, null)
    expect(events.isForeground('b')).toBe(false)
    off()
    events.onApplicationShutdown()
  })

  it('a page whose last stream closes loses its foreground immediately', () => {
    const events = new DeviceEventsService()
    const c1 = events.subscribe(() => {}, P1)
    const c2 = events.subscribe(() => {}, P1)
    events.setForeground(P1, 'a')
    c1()
    expect(events.isForeground('a')).toBe(true)
    c2()
    expect(events.isForeground('a')).toBe(false)
    events.onApplicationShutdown()
  })

  it('a report from a page with no live stream is ignored until it connects', () => {
    const events = new DeviceEventsService()
    events.setForeground(P1, 'a')
    expect(events.isForeground('a')).toBe(false)
    events.onApplicationShutdown()
  })

  it('any connected page showing the device keeps it foreground', () => {
    const events = new DeviceEventsService()
    const c1 = events.subscribe(() => {}, P1)
    events.subscribe(() => {}, P2)
    events.setForeground(P1, 'a')
    events.setForeground(P2, 'a')
    c1()
    expect(events.isForeground('a')).toBe(true)
    events.onApplicationShutdown()
  })

  it('notifies listeners with devices that became foreground', () => {
    const events = new DeviceEventsService()
    const listener = vi.fn()
    events.onForegroundChanged(listener)
    events.subscribe(() => {}, P1)
    events.setForeground(P1, 'a')
    expect(listener).toHaveBeenLastCalledWith('a')
    listener.mockClear()
    events.setForeground(P1, 'a')
    expect(listener).not.toHaveBeenCalled()
    events.setForeground(P1, 'b')
    expect(listener).toHaveBeenLastCalledWith('b')
    events.onApplicationShutdown()
  })
})

import { BRIDGE_CALLBACK_ROUTES, classifyApiPath } from '../src/auth/token.middleware.js'

describe('foreground route auth boundary', () => {
  it('is not a bridge callback route, so device-page origins are rejected like other cockpit APIs', () => {
    expect([...BRIDGE_CALLBACK_ROUTES]).not.toContain('/api/foreground')
    expect(classifyApiPath('/api/foreground').bridgeCallback).toBe(false)
  })
})
