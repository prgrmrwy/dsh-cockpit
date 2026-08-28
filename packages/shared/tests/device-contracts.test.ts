import type { DeviceStatusFacts, UpdateDeviceRequest } from '../src/index.js'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Expect<Value extends true> = Value

type _DeviceConfigurationFacts = Expect<Equal<
  Pick<DeviceStatusFacts, 'sshAlias' | 'remoteDshPort'>,
  { readonly sshAlias?: string; readonly remoteDshPort: number }
>>
type _OptionalUpdateOrder = Expect<Equal<
  Pick<UpdateDeviceRequest, 'order'>,
  { readonly order?: number }
>>
// The cockpit never proxies remote writes, so outcome-unknown bookkeeping can
// never exist; the field must be gone from the facts contract entirely.
type _NoOutcomeUnknownCount = Expect<Equal<
  'outcomeUnknownCount' extends keyof DeviceStatusFacts ? true : false,
  false
>>

const remoteFacts = {
  deviceId: 'remote-1',
  displayName: 'Remote',
  kind: 'remote',
  sshAlias: 'remote-alias',
  remoteDshPort: 3080,
  enabled: true,
  order: 0,
  state: 'READY',
  runningSessionCount: 0,
  pendingInteractionCount: 0,
  sessionStatuses: [],
  compatibility: 'SUPPORTED',
  lastUpdatedAt: 1,
} satisfies DeviceStatusFacts

const localFacts = {
  deviceId: 'local-1',
  displayName: 'This Mac',
  kind: 'local',
  remoteDshPort: 3080,
  enabled: true,
  order: 1,
  state: 'READY',
  runningSessionCount: 0,
  pendingInteractionCount: 0,
  sessionStatuses: [],
  compatibility: 'SUPPORTED',
  lastUpdatedAt: 1,
} satisfies DeviceStatusFacts

const reorder = { order: 2 } satisfies UpdateDeviceRequest
const renameOnly = { displayName: 'Renamed' } satisfies UpdateDeviceRequest

if (remoteFacts.sshAlias !== 'remote-alias' || remoteFacts.remoteDshPort !== 3080) {
  throw new Error('remote device configuration facts are not preserved')
}
if ('sshAlias' in localFacts) throw new Error('local facts unexpectedly require an SSH alias')
if (reorder.order !== 2 || 'order' in renameOnly) throw new Error('update order is not optional')
