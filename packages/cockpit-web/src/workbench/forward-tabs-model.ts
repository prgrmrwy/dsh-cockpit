import type { AdditionalForwardRow, DeviceStatusFacts } from '@dsh-cockpit/shared'

/** One forward tab of a device (change forward-workbench-tab). */
export interface ForwardTab {
  /** `<deviceId>:<devicePort>`; unique because a device port is unique per device. */
  readonly key: string
  readonly deviceId: string
  readonly devicePort: number
  readonly name: string
  readonly row: AdditionalForwardRow
}

/** The device's tab-marked additional rows, in projection order. */
export function forwardTabsOf(device: DeviceStatusFacts | undefined): readonly ForwardTab[] {
  if (device === undefined) return []
  return (device.forwards?.rows ?? []).flatMap(row => row.kind === 'additional' && row.workbenchTab
    ? [{ key: `${device.deviceId}:${row.devicePort}`, deviceId: device.deviceId, devicePort: row.devicePort, name: row.label ?? `${device.displayName}:${row.devicePort}`, row }]
    : [])
}
