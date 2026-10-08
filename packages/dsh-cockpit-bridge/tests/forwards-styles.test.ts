import { describe, expect, it } from 'vitest'
import { NAV_MARKER, SECTION_ATTRIBUTE, SECTION_CSS, injectSectionStyles, type StyleElement, type StyleHost } from '../src/client/settings-styles.js'

/** The section's stylesheet lives inside the host's settings panel, so the host
 * owns the theme: every colour must be a role mapped onto an official
 * `--dsw-alias-*` token, and nothing may be fetched. Same discipline as
 * `cockpit-web/tests/styles.test.ts`, applied to a plugin that cannot see the
 * cockpit's own tokens. A fake document keeps this in the bridge's node
 * environment without adding a DOM library. */

/** Colour-bearing properties. Deliberately enumerated: `border-radius` and
 * `border-width` are geometry, not colour. */
const COLOUR_PROPERTIES = /^(?:color|background|background-color|border|border-color|border-(?:top|right|bottom|left)(?:-color)?|outline|outline-color|fill|stroke|box-shadow|text-shadow)$/
const COLOUR_KEYWORDS = /^(?:currentColor|transparent|inherit|none)$/

/** Every `property: value` pair outside comments. */
function declarations(css: string): Array<[string, string]> {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)].map(match => [match[1], match[2].trim()])
}

/** Every rule's selector list, skipping at-rule preludes (none are used). */
function selectors(css: string): string[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...body.matchAll(/(^|})\s*([^{}@]+)\{/g)].flatMap(match => match[2].split(',').map(part => part.trim())).filter(part => part !== '')
}

function fakeDocument() {
  const created: StyleElement[] = []
  const byId = new Map<string, StyleElement>()
  const host: StyleHost = {
    head: {
      appendChild(node: StyleElement) { byId.set(node.id, node) },
    },
    createElement(): StyleElement {
      const node: StyleElement = { id: '', textContent: '', remove() { byId.delete(node.id) } }
      created.push(node)
      return node
    },
    getElementById(id: string) { return byId.get(id) ?? null },
  }
  return { host, created, byId }
}

describe('cockpit forwards settings styles', () => {
  it('maps section colours onto host theme tokens without literals or external resources', () => {
    // The only asset the sheet may carry is an inline data: URI (the nav glyph);
    // everything else is fetched or imported, and neither is allowed.
    expect(SECTION_CSS).toMatch(/url\("data:image\/svg\+xml,/)
    const inlineOnly = SECTION_CSS.replace(/url\("data:[^"]*"\)/g, 'INLINE-ASSET')
    expect(inlineOnly).not.toMatch(/url\(|@import|https?:|@font-face/i)
    // The host switches the theme; the section must not decide it.
    expect(SECTION_CSS).not.toMatch(/prefers-color-scheme/)
    // No colour is written out by hand anywhere in the sheet.
    expect(SECTION_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/)

    const colours = declarations(SECTION_CSS).filter(([property]) => COLOUR_PROPERTIES.test(property))
    expect(colours.length).toBeGreaterThan(8)
    for (const [property, value] of colours) {
      // Either a host token directly, or one of the local roles — which the
      // next test proves are themselves nothing but host tokens.
      const ok = value.includes('var(--dsw-alias-') || value.includes('var(--dshcf-') || COLOUR_KEYWORDS.test(value)
      expect(ok, `${property}: ${value}`).toBe(true)
    }
  })

  it('reads every colour through the host token namespace and stays inside its own scope', () => {
    const tokens = [...SECTION_CSS.matchAll(/var\((--dsw-alias-[a-z0-9-]+)/g)].map(match => match[1])
    expect(new Set(tokens).size).toBeGreaterThanOrEqual(8)
    for (const token of tokens) expect(token).toMatch(/^--dsw-alias-(label|border|state)-/)
    // Local role variables exist only as mappings onto those tokens (plus the
    // monospace stack, which carries no colour).
    for (const [, , value] of SECTION_CSS.matchAll(/(--dshcf-[a-z0-9-]+):([^;]+)/g)) {
      expect(value).toMatch(/var\(--dsw-alias-|^ui-monospace/)
    }
    // Rules only ever reach markup this plugin renders (its own classes) or the
    // one nav row it marked itself — never another plugin's nodes.
    expect(SECTION_ATTRIBUTE).toBe('data-dsh-cockpit-forwards')
    expect(NAV_MARKER).toBe('data-dsh-cockpit-forwards-nav')
    const rules = selectors(SECTION_CSS)
    expect(rules.length).toBeGreaterThan(5)
    for (const rule of rules) expect(rule).toMatch(new RegExp(`\\.dshcf|\\[${NAV_MARKER}\\]`))
    // The glyph is painted as a mask so it follows currentColor like the
    // official glyphs, instead of shipping a coloured image.
    const navRule = SECTION_CSS.match(new RegExp(`\\[${NAV_MARKER}\\]::before\\{[^}]*\\}`, 's'))
    expect(navRule).not.toBeNull()
    expect(navRule![0]).toMatch(/mask:/)
    expect(navRule![0]).toMatch(/background-color:\s*currentColor/)
    // The row is only restyled through the marker, so removing it restores the
    // host's own icon.
    expect(SECTION_CSS).toMatch(new RegExp(`\\[${NAV_MARKER}\\]>svg\\{display:none\\}`))
  })

  it('injects the stylesheet once and removes it again on dispose', () => {
    const { host, created, byId } = fakeDocument()
    const release = injectSectionStyles(host)
    expect(created).toHaveLength(1)
    expect(created[0].textContent).toBe(SECTION_CSS)
    expect([...byId.values()]).toHaveLength(1)

    // A second mount reuses the injected sheet and owns nothing to remove.
    const secondRelease = injectSectionStyles(host)
    expect(created).toHaveLength(1)
    secondRelease?.()
    expect([...byId.values()]).toHaveLength(1)

    release?.()
    expect([...byId.values()]).toHaveLength(0)
  })
})
