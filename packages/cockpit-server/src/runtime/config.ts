import os from 'node:os'
import path from 'node:path'

export interface RuntimeConfig {
  readonly cockpitHome: string
  readonly port: number
  readonly sshExecutable: string
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export function resolveCockpitHome(
  env: RuntimeEnvironment = process.env,
  homedir: () => string = os.homedir,
): string {
  const configured = env.DSH_COCKPIT_HOME
  return configured !== undefined && configured.trim() !== ''
    ? path.resolve(configured)
    : path.join(homedir(), '.dsh-cockpit')
}

export function resolveCockpitPort(env: RuntimeEnvironment = process.env): number {
  const configured = env.COCKPIT_PORT
  if (configured === undefined || configured.trim() === '') return 3090
  if (!/^\d+$/.test(configured.trim())) throw new Error(`invalid COCKPIT_PORT: ${configured}`)
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid COCKPIT_PORT: ${configured}`)
  }
  return port
}

export function resolveSshExecutable(env: RuntimeEnvironment = process.env): string {
  const configured = env.DSH_COCKPIT_SSH_EXECUTABLE
  return configured !== undefined && configured.trim() !== '' ? configured : 'ssh'
}

export function resolveRuntimeConfig(env: RuntimeEnvironment = process.env): RuntimeConfig {
  return {
    cockpitHome: resolveCockpitHome(env),
    port: resolveCockpitPort(env),
    sshExecutable: resolveSshExecutable(env),
  }
}
