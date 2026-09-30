import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkPrecondition,
  findForward,
  judgeReclaim,
  judgeStable,
  parseArgs,
} from '../scripts/acceptance/forward-grace.mjs'

/** The acceptance script decides pass/fail itself; these pin its judgments
 * so a real-browser run cannot "pass" on a condition the design rejects. */

const held = { kind: 'additional', devicePort: 3939, state: 'ready', pinned: false, holderCount: 1, pid: 42 }
const payload = row => ({ device: [{ deviceId: 'vm', forwards: { rows: [{ kind: 'system', devicePort: 3080, state: 'ready' }, ...(row === undefined ? [] : [row])] } }] })

test('requires a held, ready entry with exactly one holder', () => {
  assert.equal(checkPrecondition(findForward(payload(held), 'vm', 3939), 'vm', 3939), undefined)
  assert.match(checkPrecondition(findForward(payload(held), 'other', 3939), 'other', 3939), /not found/)
  assert.match(checkPrecondition(findForward(payload(undefined), 'vm', 3939), 'vm', 3939), /no forward/)
  assert.match(checkPrecondition(findForward(payload({ ...held, pinned: true }), 'vm', 3939), 'vm', 3939), /pinned/)
  assert.match(checkPrecondition(findForward(payload({ ...held, holderCount: 2 }), 'vm', 3939), 'vm', 3939), /2 holders/)
  assert.match(checkPrecondition(findForward(payload({ ...held, state: 'retrying', pid: undefined }), 'vm', 3939), 'vm', 3939), /retrying/)
})

test('a watch window fails on a pid change or a vanished entry', () => {
  assert.equal(judgeStable([{ atMs: 0, row: held }, { atMs: 1000, row: held }], 42), undefined)
  assert.match(judgeStable([{ atMs: 3000, row: { ...held, pid: 43 } }], 42), /pid changed from 42 to 43 at \+3s/)
  assert.match(judgeStable([{ atMs: 5000, row: undefined }], 42), /disappeared at \+5s/)
})

test('reclaim must land between 30 and 40 seconds', () => {
  assert.equal(judgeReclaim(30_000), undefined)
  assert.equal(judgeReclaim(35_500), undefined)
  assert.equal(judgeReclaim(40_000), undefined)
  assert.match(judgeReclaim(29_000), /too early/)
  assert.match(judgeReclaim(41_000), /too late/)
  assert.match(judgeReclaim(undefined), /still present/)
})

test('parses --device and rejects a missing one', () => {
  assert.deepEqual(parseArgs(['--device', 'vm']), { device: 'vm', devicePort: 3939, port: undefined })
  assert.deepEqual(parseArgs(['--device', 'vm', '--device-port', '5432', '--port', '3091']), { device: 'vm', devicePort: 5432, port: 3091 })
  assert.throws(() => parseArgs([]), /--device <id> is required/)
  assert.throws(() => parseArgs(['--device', 'vm', '--device-port', '0']), /invalid --device-port/)
})
