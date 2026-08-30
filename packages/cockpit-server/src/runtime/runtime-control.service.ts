import { randomUUID } from 'node:crypto'
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import { TokenService } from '../auth/token.js'
import { RuntimeRecordStore, type RuntimeRecord } from './runtime-record.js'

interface ActivationOptions {
  readonly port: number
  readonly repoRoot: string
  readonly shutdown: () => Promise<void>
}

@Injectable()
export class RuntimeControlService implements OnApplicationShutdown {
  #active: RuntimeRecord | undefined
  #shutdown: (() => Promise<void>) | undefined
  #shutdownRequested = false

  constructor(
    @Inject(RuntimeRecordStore) private readonly records: RuntimeRecordStore,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async activate(options: ActivationOptions): Promise<RuntimeRecord> {
    if (this.#active !== undefined) throw new Error('runtime control is already active')
    await this.tokens.resolve()
    const record: RuntimeRecord = {
      version: 1,
      app: 'dsh-cockpit',
      instanceId: randomUUID(),
      pid: process.pid,
      port: options.port,
      repoRoot: options.repoRoot,
      startedAt: Date.now(),
    }
    await this.records.write(record)
    this.#active = record
    this.#shutdown = options.shutdown
    return record
  }

  status(): RuntimeRecord {
    if (this.#active === undefined) throw new Error('runtime control is not active')
    return this.#active
  }

  requestShutdown(instanceId: string | undefined): { accepted: true } {
    const active = this.status()
    if (instanceId === undefined || instanceId !== active.instanceId) throw new Error('runtime instance mismatch')
    if (!this.#shutdownRequested) {
      this.#shutdownRequested = true
      const shutdown = this.#shutdown
      const timer = setTimeout(() => {
        void shutdown?.().catch(error => {
          process.stderr.write(`runtime shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`)
        })
      }, 25)
      timer.unref()
    }
    return { accepted: true }
  }

  async onApplicationShutdown(): Promise<void> {
    const active = this.#active
    this.#active = undefined
    if (active === undefined) return
    try {
      await this.records.removeIfOwned(active.instanceId)
    } catch (error) {
      process.stderr.write(`runtime record cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
}
