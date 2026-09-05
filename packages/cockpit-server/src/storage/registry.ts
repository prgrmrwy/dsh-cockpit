import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { DeviceRecord } from '@dsh-cockpit/shared'

const FILE_NAME = 'devices.json'
const DIR_MODE = 0o700
const FILE_MODE = 0o600

export interface DeviceRegistrySnapshot {
  readonly version: 1
  readonly devices: readonly DeviceRecord[]
}

/** Device validation errors are fail-closed: never persist an invalid row. */
export class DeviceRegistryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'DeviceRegistryError'
  }
}

function isValidLocalPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}

function validateDevice(value: unknown): DeviceRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (
    typeof row.deviceId !== 'string' || row.deviceId === ''
    || typeof row.displayName !== 'string' || row.displayName === ''
    || (row.kind !== 'local' && row.kind !== 'remote')
    || typeof row.remoteDshPort !== 'number' || !Number.isInteger(row.remoteDshPort) || row.remoteDshPort < 1
    || (row.dshLaunchToken !== undefined && (typeof row.dshLaunchToken !== 'string' || row.dshLaunchToken === ''))
    || typeof row.enabled !== 'boolean'
    || typeof row.order !== 'number' || !Number.isInteger(row.order)
  ) return undefined
  const record: DeviceRecord = {
    deviceId: row.deviceId,
    displayName: row.displayName,
    kind: row.kind,
    remoteDshPort: row.remoteDshPort,
    enabled: row.enabled,
    order: row.order,
    ...(typeof row.sshAlias === 'string' && row.sshAlias !== '' ? { sshAlias: row.sshAlias } : {}),
    // An out-of-range port is treated as absent, not as corruption: localPort
    // is optional and a bad value simply means "no stable port yet", which the
    // next connection overwrites.
    ...(isValidLocalPort(row.localPort) ? { localPort: row.localPort } : {}),
    ...(typeof row.dshLaunchToken === 'string' ? { dshLaunchToken: row.dshLaunchToken } : {}),
  }
  if (record.kind === 'remote' && record.sshAlias === undefined) return undefined
  return record
}

/** Durable device registry. Atomic writes (tmp+rename), no-follow reads, and a
 * damaged or tampered file is never replaced by an empty configuration. */
export class DeviceRegistry {
  readonly file: string
  #queue: Promise<unknown> = Promise.resolve()

  constructor(readonly directory: string) {
    this.file = path.join(directory, FILE_NAME)
  }

  async load(): Promise<readonly DeviceRecord[]> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { devices?: unknown }).devices)) {
        throw new DeviceRegistryError('CORRUPT', 'devices registry root must be an object with a devices array')
      }
      const devices = (parsed as { devices: unknown[] }).devices
        .map(validateDevice)
        .filter((device): device is DeviceRecord => device !== undefined)
      if (devices.length !== (parsed as { devices: unknown[] }).devices.length) {
        throw new DeviceRegistryError('CORRUPT', 'devices registry contains invalid rows')
      }
      // Stable order by `order`, then deviceId.
      return [...devices].sort((a, b) => a.order - b.order || a.deviceId.localeCompare(b.deviceId))
    } catch (cause) {
      if (cause instanceof DeviceRegistryError) throw cause
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new DeviceRegistryError('CORRUPT', cause instanceof Error ? cause.message : 'devices registry is not valid JSON')
    }
  }

  async save(devices: readonly DeviceRecord[]): Promise<readonly DeviceRecord[]> {
    for (const device of devices) {
      const validated = validateDevice(device)
      if (validated === undefined) throw new DeviceRegistryError('INVALID', `invalid device record ${device.deviceId}`)
      if (device.kind === 'remote' && device.sshAlias === undefined) {
        throw new DeviceRegistryError('INVALID', `remote device ${device.deviceId} requires sshAlias`)
      }
    }
    return this.#serialize(async () => {
      await this.#writeFile(devices)
      return devices
    })
  }

  /** Record the local forward port a device's tunnel actually bound, so the
   * next connection can reuse it and keep the workbench origin stable.
   *
   * The whole read-modify-write runs inside the same serialization queue as
   * `save`, so it cannot interleave with a concurrent add/remove and clobber
   * it. An unknown device is a no-op: it may have just been deleted while its
   * tunnel was still coming up. */
  async updateLocalPort(deviceId: string, localPort: number): Promise<void> {
    if (!isValidLocalPort(localPort)) throw new DeviceRegistryError('INVALID', `invalid local port ${localPort}`)
    await this.#serialize(async () => {
      const devices = await this.load()
      const target = devices.find(device => device.deviceId === deviceId)
      if (target === undefined || target.localPort === localPort) return
      await this.#writeFile(devices.map(device => (device.deviceId === deviceId ? { ...device, localPort } : device)))
    })
  }

  async #writeFile(devices: readonly DeviceRecord[]): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: DIR_MODE })
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, FILE_MODE)
      try {
        await handle.writeFile(`${JSON.stringify({ version: 1, devices }, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temp, this.file)
    } catch (cause) {
      await rm(temp, { force: true }).catch(() => {})
      throw cause
    }
  }

  #serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(action, action)
    this.#queue = next.then(() => undefined, () => undefined)
    return next
  }
}