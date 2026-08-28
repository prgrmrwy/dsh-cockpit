import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.resolve(here, '../src/styles/app.css'), 'utf8')

describe('cockpit visual contracts', () => {
  it('defines device-console tokens in both theme groups', () => {
    expect(css.match(/--surface-raised:/g)).toHaveLength(2)
    expect(css.match(/--accent-soft:/g)).toHaveLength(2)
    expect(css.match(/--danger-soft:/g)).toHaveLength(2)
    expect(css.match(/--shadow-panel:/g)).toHaveLength(2)
  })

  it('uses a responsive device-console grid with a single-column fallback', () => {
    expect(css).toMatch(/\.device-console\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(280px,\s*360px\)/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*860px\)[\s\S]*?\.device-console\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s)
    expect(css).toMatch(/\.device-card\s*\{[^}]*min-width:\s*0/s)
  })

  it('keeps the active device tab borderless with a separate focus indicator', () => {
    expect(css).toMatch(/\.topbar-device\.active\s*\{[^}]*border-color:\s*transparent/s)
    expect(css).toMatch(/\.topbar-device:focus-visible\s*\{[^}]*(outline|box-shadow):/s)
  })

  it('gives both bridge states one shared box and token-driven colors', () => {
    // A single shared rule guarantees the two icons cannot differ in size.
    const shared = css.match(/\.bridge-mark,\s*\n?\s*\.bridge-hint\s*\{([^}]*)\}/s)
    expect(shared).not.toBeNull()
    expect(shared![1]).toMatch(/width:\s*16px/)
    expect(shared![1]).toMatch(/height:\s*16px/)
    expect(shared![1]).toMatch(/flex:\s*none/)

    // Colors stay on tokens so the inline SVG can follow the theme.
    expect(css).toMatch(/\.bridge-mark\s*\{[^}]*color:\s*var\(--accent\)/s)
    expect(css).toMatch(/\.bridge-hint\s*\{[^}]*color:\s*var\(--fg-dim\)/s)
    for (const rule of css.match(/\.bridge-(mark|hint)[^{]*\{[^}]*\}/gs) ?? []) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}|rgba?\(/)
    }
  })
})
