import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'

export interface AuthModuleOptions {
  readonly directory: string
}

/** Loopback-only client token. The cockpit is a local tool; the token stops
 * other local processes or malicious web pages from poking the service. */
export class TokenService {
  readonly #file: string
  #token: string | undefined

  constructor(directory: string) {
    this.#file = path.join(directory, 'token')
  }

  /** Reads or generates the persistent token. */
  async resolve(): Promise<string> {
    if (this.#token !== undefined) return this.#token
    try {
      const existing = (await readFile(this.#file, 'utf8')).trim()
      if (existing !== '') { this.#token = existing; return existing }
    } catch {
      // generate below
    }
    const token = randomBytes(24).toString('base64url')
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 })
    const temp = `${this.#file}.${process.pid}.tmp`
    const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try {
      await handle.writeFile(`${token}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, this.#file)
    this.#token = token
    return token
  }

  verify(candidate: string | undefined): boolean {
    return this.#token !== undefined && candidate !== undefined && candidate === this.#token
  }
}