import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveCockpitHome,
  resolveCockpitPort,
  resolveRuntimeConfig,
  resolveSshExecutable,
} from '../src/runtime/config.js'

describe('runtime configuration', () => {
  it('uses OS home rather than HOME when no cockpit home is configured', () => {
    expect(resolveCockpitHome({}, () => 'C:\\Users\\alice')).toBe(path.join('C:\\Users\\alice', '.dsh-cockpit'))
    expect(resolveCockpitHome({ HOME: 'D:\\wrong' }, () => 'C:\\Users\\alice')).toBe(path.join('C:\\Users\\alice', '.dsh-cockpit'))
  })

  it('uses a non-empty explicit cockpit home and resolves it absolutely', () => {
    expect(resolveCockpitHome({ DSH_COCKPIT_HOME: './isolated' }, () => '/unused')).toBe(path.resolve('./isolated'))
    expect(resolveCockpitHome({ DSH_COCKPIT_HOME: '   ' }, () => '/users/alice')).toBe(path.join('/users/alice', '.dsh-cockpit'))
  })

  it('parses the port with a validated 3090 default', () => {
    expect(resolveCockpitPort({})).toBe(3090)
    expect(resolveCockpitPort({ COCKPIT_PORT: '' })).toBe(3090)
    expect(resolveCockpitPort({ COCKPIT_PORT: '43190' })).toBe(43190)
    for (const value of ['0', '65536', '-1', '1.5', 'abc']) {
      expect(() => resolveCockpitPort({ COCKPIT_PORT: value })).toThrow(`invalid COCKPIT_PORT: ${value}`)
    }
  })

  it('uses ssh from PATH unless an explicit executable is configured', () => {
    expect(resolveSshExecutable({})).toBe('ssh')
    expect(resolveSshExecutable({ DSH_COCKPIT_SSH_EXECUTABLE: '' })).toBe('ssh')
    expect(resolveSshExecutable({ DSH_COCKPIT_SSH_EXECUTABLE: 'C:\\OpenSSH\\ssh.exe' })).toBe('C:\\OpenSSH\\ssh.exe')
  })

  it('resolves all runtime values from one environment snapshot', () => {
    expect(resolveRuntimeConfig({
      DSH_COCKPIT_HOME: './home',
      COCKPIT_PORT: '43090',
      DSH_COCKPIT_SSH_EXECUTABLE: 'custom-ssh',
    })).toEqual({
      cockpitHome: path.resolve('./home'),
      port: 43090,
      sshExecutable: 'custom-ssh',
    })
  })
})
