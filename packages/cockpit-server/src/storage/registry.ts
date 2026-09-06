import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { DeviceRecord, DshAuthMaterial } from '@dsh-cockpit/shared'

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

function validateDshAuth(value: unknown, legacyToken: unknown): DshAuthMaterial | undefined | null {
  if (value === undefined) {
    if (typeof legacyToken !== 'string') return undefined
    return { version: 1, launchToken: legacyToken, autoDiscovery: 'disabled', updatedAt: 0, generation: 1 }
  }
  if (typeof value !== 'object' || value === null) return null
  const auth = value as Record<string, unknown>
  if (auth.version !== 1
    || (auth.launchToken !== undefined && (typeof auth.launchToken !== 'string' || auth.launchToken === ''))
    || (auth.serverCookie !== undefined && (typeof auth.serverCookie !== 'string' || auth.serverCookie === ''))
    || (auth.cookieAuthority !== undefined && (typeof auth.cookieAuthority !== 'string' || auth.cookieAuthority === ''))
    || (auth.cookieExpiresAt !== undefined && (!Number.isSafeInteger(auth.cookieExpiresAt) || Number(auth.cookieExpiresAt) <= 0))
    || (auth.autoDiscovery !== 'disabled' && auth.autoDiscovery !== 'ohmydsh-log')
    || !Number.isSafeInteger(auth.updatedAt) || Number(auth.updatedAt) < 0
    || !Number.isSafeInteger(auth.generation) || Number(auth.generation) < 0) return null
  if ((auth.serverCookie === undefined) !== (auth.cookieAuthority === undefined)
    || (auth.serverCookie === undefined) !== (auth.cookieExpiresAt === undefined)) return null
  return {
    version: 1,
    ...(typeof auth.launchToken === 'string' ? { launchToken: auth.launchToken } : {}),
    ...(typeof auth.serverCookie === 'string' ? {
      serverCookie: auth.serverCookie,
      cookieAuthority: auth.cookieAuthority as string,
      cookieExpiresAt: auth.cookieExpiresAt as number,
    } : {}),
    autoDiscovery: auth.autoDiscovery,
    updatedAt: auth.updatedAt as number,
    generation: auth.generation as number,
  }
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
  const dshAuth = validateDshAuth(row.dshAuth, row.dshLaunchToken)
  if (dshAuth === null) return undefined
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
    ...(dshAuth === undefined ? {} : { dshAuth }),
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
    await this.mutateDevice(deviceId, target => target.localPort === localPort ? target : { ...target, localPort })
  }

  /** Serialized atomic whole-registry mutation. The callback observes the
   * latest durable snapshot, so configuration writes cannot overwrite auth
   * accepted by a concurrent connection generation. */
  async mutateDevices(update: (current: readonly DeviceRecord[]) => readonly DeviceRecord[]): Promise<readonly DeviceRecord[]> {
    return this.#serialize(async () => {
      const current = await this.load()
      const next = update(current)
      for (const device of next) {
        if (validateDevice(device) === undefined) throw new DeviceRegistryError('INVALID', `invalid device record ${device.deviceId}`)
      }
      await this.#writeFile(next)
      return next
    })
  }

  /** Serialized atomic device mutation used by configuration and auth recovery.
   * Undefined from the updater is a no-op; an unknown/deleted device also loses
   * races safely without recreating it. */
  async mutateDevice(deviceId: string, update: (current: DeviceRecord) => DeviceRecord | undefined): Promise<DeviceRecord | undefined> {
    return this.#serialize(async () => {
      const devices = await this.load()
      const index = devices.findIndex(device => device.deviceId === deviceId)
      if (index < 0) return undefined
      const next = update(devices[index]!)
      if (next === undefined || next === devices[index]) return devices[index]
      if (validateDevice(next) === undefined) throw new DeviceRegistryError('INVALID', `invalid device record ${deviceId}`)
      const replaced = [...devices]
      replaced[index] = next
      await this.#writeFile(replaced)
      return next
    })
  }

  /** Compare-and-swap a successfully recovered auth generation. */
  async commitRecoveredAuth(deviceId: string, expectedGeneration: number, auth: DshAuthMaterial, requireDiscovery = false): Promise<DeviceRecord | undefined> {
    let committed = false
    const result = await this.mutateDevice(deviceId, current => {
      if (!current.enabled || current.dshAuth?.generation !== expectedGeneration
        || (requireDiscovery && current.dshAuth.autoDiscovery !== 'ohmydsh-log')) return undefined
      committed = true
      const { dshLaunchToken: _legacy, ...withoutLegacy } = current
      return { ...withoutLegacy, ...(auth.launchToken === undefined ? {} : { dshLaunchToken: auth.launchToken }), dshAuth: auth }
    })
    return committed ? result : undefined
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