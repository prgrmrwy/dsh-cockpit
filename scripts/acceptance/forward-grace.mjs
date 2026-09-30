#!/usr/bin/env node
/**
 * Acceptance check (device-forward-registry, human decision): the 30 s page
 * grace period holds in a REAL browser.
 *
 * jsdom and fake timers cannot reproduce EventSource's own reconnect interval
 * or background-tab throttling, so this script watches the live cockpit while
 * an operator drives the browser. The operator only performs the browser
 * actions; pass/fail is decided here, and any unmet step exits non-zero with
 * the measured times.
 *
 * Precondition (checked, not assumed): the target device's forward table has a
 * non-pinned entry for the device port (default 3939) with exactly one holder,
 * created by a bridge consumer in the device page. The script cannot create
 * that holder itself: it has no browser page id.
 *
 * Usage: node scripts/acceptance/forward-grace.mjs --device <id>
 *          [--device-port 3939] [--port <cockpit port>]
 * Reads DSH_COCKPIT_HOME/token like bin/cockpit (default ~/.dsh-cockpit) and
 * COCKPIT_PORT (default 3090).
 */
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

export const GRACE_MIN_MS = 30_000
export const GRACE_MAX_MS = 40_000
export const OFFLINE_WATCH_MS = 60_000
export const BACKGROUND_MIN_MS = 5 * 60_000
const POLL_MS = 1_000

/** The additional row for `devicePort` on `deviceId`, or undefined. */
export function findForward(payload, deviceId, devicePort) {
  const device = payload?.device?.find(candidate => candidate.deviceId === deviceId)
  if (device === undefined) return { device: undefined, row: undefined }
  const row = device.forwards?.rows?.find(candidate => candidate.kind === 'additional' && candidate.devicePort === devicePort)
  return { device, row }
}

/** Precondition: a held (not pinned), ready entry with exactly one holder. */
export function checkPrecondition(found, deviceId, devicePort) {
  if (found.device === undefined) return `device ${deviceId} not found`
  if (found.row === undefined) return `no forward for device port ${devicePort} on ${deviceId}; create one holder from the device page first`
  if (found.row.pinned) return `forward ${devicePort} is pinned; the grace check needs a held-only entry`
  if (found.row.holderCount !== 1) return `forward ${devicePort} has ${found.row.holderCount} holders; exactly 1 is required`
  if (found.row.state !== 'ready' || typeof found.row.pid !== 'number') return `forward ${devicePort} is ${found.row.state}; wait until it is ready`
  return undefined
}

/** A watch window passes when every sample still shows the same pid. */
export function judgeStable(samples, pid) {
  for (const sample of samples) {
    if (sample.row === undefined) return `entry disappeared at +${Math.round(sample.atMs / 1000)}s`
    if (sample.row.pid !== pid) return `pid changed from ${pid} to ${sample.row.pid ?? 'none'} at +${Math.round(sample.atMs / 1000)}s`
  }
  return undefined
}

/** Reclaim must land between 30 s and 40 s after the tab closed. */
export function judgeReclaim(elapsedMs) {
  if (elapsedMs === undefined) return `entry still present after ${GRACE_MAX_MS / 1000}s`
  if (elapsedMs < GRACE_MIN_MS) return `reclaimed too early: ${(elapsedMs / 1000).toFixed(1)}s < ${GRACE_MIN_MS / 1000}s`
  if (elapsedMs > GRACE_MAX_MS) return `reclaimed too late: ${(elapsedMs / 1000).toFixed(1)}s > ${GRACE_MAX_MS / 1000}s`
  return undefined
}

export function parseArgs(argv) {
  const options = { device: undefined, devicePort: 3939, port: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--device') { options.device = value; index += 1 }
    else if (flag === '--device-port') { options.devicePort = Number(value); index += 1 }
    else if (flag === '--port') { options.port = Number(value); index += 1 }
    else throw new Error(`unknown argument ${flag}`)
  }
  if (typeof options.device !== 'string' || options.device === '') throw new Error('--device <id> is required')
  if (!Number.isInteger(options.devicePort) || options.devicePort < 1 || options.devicePort > 65_535) throw new Error('invalid --device-port')
  return options
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const home = process.env.DSH_COCKPIT_HOME?.trim() ? path.resolve(process.env.DSH_COCKPIT_HOME) : path.join(os.homedir(), '.dsh-cockpit')
  const port = options.port ?? (process.env.COCKPIT_PORT?.trim() ? Number(process.env.COCKPIT_PORT) : 3090)
  const token = (await readFile(path.join(home, 'token'), 'utf8')).trim()
  const read = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/devices`, { headers: { cookie: `cockpit_token=${token}` } })
    if (!response.ok) throw new Error(`GET /api/devices answered ${response.status}`)
    return findForward(await response.json(), options.device, options.devicePort)
  }
  const fail = message => {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  const initial = await read()
  const problem = checkPrecondition(initial, options.device, options.devicePort)
  if (problem !== undefined) fail(`precondition: ${problem}`)
  const pid = initial.row.pid
  console.log(`precondition ok: ${options.device} forward ${options.devicePort} ready, 1 holder, pid ${pid}`)

  // Step 1: a brief network drop; EventSource reconnects with the same URL.
  await rl.question('\nStep 1/3: in the cockpit tab DevTools set Network to Offline for ~5s, then back Online. Press Enter once it is Online again. ')
  const offlineSamples = []
  const offlineStart = Date.now()
  while (Date.now() - offlineStart < OFFLINE_WATCH_MS) {
    offlineSamples.push({ atMs: Date.now() - offlineStart, row: (await read()).row })
    await sleep(POLL_MS)
  }
  const offlineProblem = judgeStable(offlineSamples, pid)
  if (offlineProblem !== undefined) fail(`step 1: ${offlineProblem}`)
  console.log(`step 1 ok: pid ${pid} unchanged for ${OFFLINE_WATCH_MS / 1000}s after reconnect`)

  // Step 2: background throttling for at least five minutes.
  console.log('\nStep 2/3: switch the cockpit tab to the background (another tab) for at least 5 minutes, then switch back and press Enter.')
  const backgroundStart = Date.now()
  const backgroundSamples = []
  let returned = false
  const answer = rl.question('Press Enter after switching back… ').then(() => { returned = true })
  while (!returned) {
    backgroundSamples.push({ atMs: Date.now() - backgroundStart, row: (await read()).row })
    await Promise.race([sleep(POLL_MS), answer])
  }
  const backgroundMs = Date.now() - backgroundStart
  if (backgroundMs < BACKGROUND_MIN_MS) fail(`step 2: background period ${(backgroundMs / 1000).toFixed(0)}s is shorter than ${BACKGROUND_MIN_MS / 1000}s`)
  backgroundSamples.push({ atMs: backgroundMs, row: (await read()).row })
  const backgroundProblem = judgeStable(backgroundSamples, pid)
  if (backgroundProblem !== undefined) fail(`step 2: ${backgroundProblem}`)
  console.log(`step 2 ok: pid ${pid} unchanged across ${(backgroundMs / 1000).toFixed(0)}s in the background`)

  // Step 3: close the tab. Enter FIRST, then close within a few seconds, so
  // the measured time can only overstate (never understate) the real grace.
  await rl.question('\nStep 3/3: press Enter, then close the cockpit tab within 5 seconds. ')
  rl.close()
  const closeStart = Date.now()
  let reclaimedMs
  while (Date.now() - closeStart <= GRACE_MAX_MS + 5_000) {
    const { row } = await read()
    if (row === undefined) {
      reclaimedMs = Date.now() - closeStart
      break
    }
    if (row.pid !== pid) fail(`step 3: pid changed to ${row.pid ?? 'none'} before reclaim`)
    await sleep(POLL_MS)
  }
  const reclaimProblem = judgeReclaim(reclaimedMs)
  if (reclaimProblem !== undefined) fail(`step 3: ${reclaimProblem}`)
  console.log(`step 3 ok: reclaimed ${(reclaimedMs / 1000).toFixed(1)}s after the tab closed`)
  console.log(`\nPASS  offline-watch=${OFFLINE_WATCH_MS / 1000}s background=${(backgroundMs / 1000).toFixed(0)}s reclaim=${(reclaimedMs / 1000).toFixed(1)}s`)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
