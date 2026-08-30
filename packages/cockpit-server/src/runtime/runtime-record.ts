import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const FILE_NAME = 'runtime.json'

export interface RuntimeRecord {
  readonly version: 1
  readonly app: 'dsh-cockpit'
  readonly instanceId: string
  readonly pid: number
  readonly port: number
  readonly repoRoot: string
  readonly startedAt: number
}

export class RuntimeRecordError extends Error {
  constructor(readonly code: 'CORRUPT' | 'INVALID', message: string) {
    super(message)
    this.name = 'RuntimeRecordError'
  }
}

function isRuntimeRecord(value: unknown): value is RuntimeRecord {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return row.version === 1
    && row.app === 'dsh-cockpit'
    && typeof row.instanceId === 'string' && row.instanceId !== ''
    && typeof row.pid === 'number' && Number.isInteger(row.pid) && row.pid > 0
    && typeof row.port === 'number' && Number.isInteger(row.port) && row.port >= 1 && row.port <= 65_535
    && typeof row.repoRoot === 'string' && row.repoRoot !== ''
    && typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) && row.startedAt > 0
}

export class RuntimeRecordStore {
  readonly file: string

  constructor(readonly directory: string) {
    this.file = path.join(directory, FILE_NAME)
  }

  async read(): Promise<RuntimeRecord | undefined> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new RuntimeRecordError('CORRUPT', cause instanceof Error ? cause.message : 'runtime record is unreadable')
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isRuntimeRecord(parsed)) throw new RuntimeRecordError('CORRUPT', 'runtime record has invalid fields')
      return parsed
    } catch (cause) {
      if (cause instanceof RuntimeRecordError) throw cause
      throw new RuntimeRecordError('CORRUPT', cause instanceof Error ? cause.message : 'runtime record is not valid JSON')
    }
  }

  async write(record: RuntimeRecord): Promise<void> {
    if (!isRuntimeRecord(record)) throw new RuntimeRecordError('INVALID', 'invalid runtime record')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
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

  async removeIfOwned(instanceId: string): Promise<boolean> {
    const current = await this.read()
    if (current === undefined || current.instanceId !== instanceId) return false
    await rm(this.file, { force: true })
    return true
  }
}
