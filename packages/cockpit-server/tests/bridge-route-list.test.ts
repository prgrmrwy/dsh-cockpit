import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BRIDGE_CALLBACK_ROUTES, classifyApiPath } from '../src/auth/token.middleware.js'

/**
 * The spec requirement "bridge 回调路由名单" (cockpit-api-auth) is the single
 * authoritative list; `BRIDGE_CALLBACK_ROUTES` is its implementation. This
 * pins the two together so a route cannot be added to one and not the other.
 * While a change that modifies the requirement is active, its delta is the
 * source; otherwise the current spec is.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const REQUIREMENT = '### Requirement: bridge 回调路由名单'
const SOURCES = [
  // An active change that MODIFIES the list is ahead of the current spec
  // until it is archived; after archive the file is gone and the current
  // spec takes over.
  'openspec/changes/device-forward-registry/specs/cockpit-api-auth/spec.md',
  'openspec/specs/cockpit-api-auth/spec.md',
]

async function specRoutes(): Promise<string[]> {
  for (const source of SOURCES) {
    let text: string
    try { text = await readFile(path.join(repoRoot, source), 'utf8') } catch { continue }
    const start = text.indexOf(REQUIREMENT)
    if (start < 0) continue
    const rest = text.slice(start + REQUIREMENT.length)
    const end = rest.search(/\n#{2,4} /)
    const block = end < 0 ? rest : rest.slice(0, end)
    return [...block.matchAll(/^- `(\/api\/[^`]+)`\s*$/gm)].map(match => match[1]!)
  }
  throw new Error(`requirement not found in ${SOURCES.join(', ')}`)
}

describe('bridge callback route list', () => {
  it('matches the spec requirement exactly, in order', async () => {
    expect(await specRoutes()).toEqual([...BRIDGE_CALLBACK_ROUTES])
  })

  it('classifies only exact (case-folded) list members as bridge callbacks', () => {
    for (const route of BRIDGE_CALLBACK_ROUTES) {
      expect(classifyApiPath(route).bridgeCallback, route).toBe(true)
      expect(classifyApiPath(route.toUpperCase()).bridgeCallback, route).toBe(true)
      expect(classifyApiPath(`${route}/`).bridgeCallback, `${route}/`).toBe(false)
      expect(classifyApiPath(`${route}x`).bridgeCallback, `${route}x`).toBe(false)
    }
    expect(classifyApiPath('/api/bridge/').bridgeCallback).toBe(false)
    expect(classifyApiPath('/api/bridge/unlisted').bridgeCallback).toBe(false)
  })
})
