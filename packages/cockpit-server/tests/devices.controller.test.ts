import { describe, expect, it, vi } from 'vitest'
import { DevicesController } from '../src/devices/devices.controller.js'

describe('device update request validation', () => {
  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects non-integer order %s', async order => {
    const updateDevice = vi.fn()
    const controller = new DevicesController({ updateDevice } as never, {} as never)

    await expect(controller.update('device-1', { order } as never)).rejects.toMatchObject({ status: 400 })
    expect(updateDevice).not.toHaveBeenCalled()
  })

  it('accepts an integer target order', async () => {
    const updateDevice = vi.fn().mockResolvedValue(undefined)
    const controller = new DevicesController({ updateDevice } as never, {} as never)

    await expect(controller.update('device-1', { order: -2 } as never)).resolves.toEqual({ deviceId: 'device-1' })
    expect(updateDevice).toHaveBeenCalledWith('device-1', { order: -2 })
  })
})
