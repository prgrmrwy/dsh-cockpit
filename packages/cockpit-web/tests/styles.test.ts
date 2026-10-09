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

  it('styles auth status with theme tokens and visible text, including keyboard focus', () => {
    expect(css).toMatch(/\.device-auth-state\s*\{[^}]*color:\s*var\(--fg\)[^}]*background:\s*var\(--surface-raised\)/s)
    expect(css).toMatch(/\.device-auth-state\[data-auth-state="ready"\]\s*\{[^}]*var\(--ok\)/s)
    expect(css).toMatch(/\.device-auth-state\[data-auth-state="recovery-required"\]\s*\{[^}]*var\(--error\)[^}]*var\(--danger-soft\)/s)
    expect(css).toMatch(/\.device-auth-option:focus-within\s*\{[^}]*var\(--focus-ring\)/s)
    for (const rule of css.match(/\.device-auth-(?:state|summary|detail|option|guidance)[^{]*\{[^}]*\}/gs) ?? []) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/)
    }
  })

  it('keeps auth controls usable in the narrow single-column layout', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*860px\)[\s\S]*?\.device-form-card\s*\{[^}]*position:\s*static/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*520px\)[\s\S]*?\.device-card-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
    expect(css).toMatch(/\.device-auth-summary\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(css).toMatch(/\.device-auth-option\s+input\[type="checkbox"\]\s*\{[^}]*flex:\s*none/s)
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

  it('keeps the completed clear chip box-identical to the other status chips', () => {
    // Decorative chips carry the same transparent border as the clickable
    // completed chip, so the button's border-box cannot exceed its siblings'.
    expect(css).toMatch(/\.session-chip\s*\{[^}]*border:\s*1px\s+solid\s+transparent/s)
    // The completed chip resets the UA button font family only: a `font: inherit`
    // here (same specificity as `.session-chip`, declared later) would override
    // font-size: 11px / line-height: 1 and render the completed status visibly
    // larger than the running/approval/question chips.
    expect(css).toMatch(/\.session-chip-clear\s*\{[^}]*background:\s*none/s)
    expect(css).toMatch(/\.session-chip-clear\s*\{[^}]*font-family:\s*inherit/s)
    expect(css).not.toMatch(/\.session-chip-clear\s*\{[^}]*font:\s*inherit/s)

    // Chip colors stay on theme tokens.
    for (const rule of css.match(/\.session-chip[^{]*\{[^}]*\}/gs) ?? []) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/)
    }
  })

  it('aligns the device action group with the card title', () => {
    // The card grew a forward list, so a stretched action column would centre
    // the buttons against the whole card: they must sit on the title line.
    expect(css).toMatch(/\.device-card\s*\{[^}]*align-items:\s*start/s)
    // Within that top-aligned column the buttons still read as one row.
    expect(css).toMatch(/\.device-card-actions\s*\{[^}]*align-items:\s*center/s)
  })

  it('dresses the forward kind badge and the create button like the rest of the card', () => {
    // The kind badge is the same pill as the card's own chips (11px / 650 /
    // accent on accent-soft), not a 12px tinted span inherited from the row.
    const kind = css.match(/\.forward-kind\s*\{([^}]*)\}/s)
    expect(kind).not.toBeNull()
    expect(kind![1]).toMatch(/min-height:\s*22px/)
    expect(kind![1]).toMatch(/font-size:\s*11px/)
    expect(kind![1]).toMatch(/font-weight:\s*650/)
    expect(kind![1]).toMatch(/color:\s*var\(--accent\)/)
    // Held-only rows are the transient kind: same pill, dimmer tone.
    expect(css).toMatch(/\.forward-kind\[data-forward-kind="held"\]\s*\{[^}]*color:\s*var\(--fg-dim\)/s)
    // The create button keeps the panel's primary colors but the card's rhythm.
    expect(css).toMatch(/\.forward-form\s+\.primary-action\s*\{[^}]*min-height:\s*30px/s)
    expect(css).toMatch(/\.forward-form\s+\.primary-action\s*\{[^}]*font-size:\s*12px/s)
    // Nothing stretches it into a full-width slab.
    expect(css).not.toMatch(/\.primary-action\s*\{[^}]*width:\s*100%/s)
    // The delete button sits in the row's second column, not in the meta line.
    expect(css).toMatch(/\.forward-row-line\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s)
    for (const rule of css.match(/\.forward-(?:kind|delete|row-line)[^{]*\{[^}]*\}/gs) ?? []) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/)
    }
  })

  it('keeps the forward rows folded as whole fields instead of a fixed column template', () => {
    // A fixed template was measured to shred the address and the pid: the
    // card's content column is ~320px wide even at a 1440px viewport.
    const row = css.match(/\.forward-row\s*\{([^}]*)\}/s)
    expect(row).not.toBeNull()
    expect(row![1]).not.toMatch(/grid-template-columns/)
    expect(row![1]).not.toMatch(/background:/)
    expect(css).toMatch(/\.forward-row-main\s*\{[^}]*flex-wrap:\s*wrap/s)
    // Values never break mid-token; a field that does not fit wraps as a whole.
    expect(css).toMatch(/\.forward-row-main\s*>\s*\*\s*\{[^}]*white-space:\s*nowrap/s)
    // Rows read as one list: hairline separators, no card per row.
    expect(css).toMatch(/\.forward-row\s*\{[^}]*border-top:\s*1px\s+solid\s+var\(--border\)/s)
    expect(css).toMatch(/\.forward-row:first-child\s*\{\s*border-top:\s*0/s)
    // Delete is placed by the row line's second column, not by a collapsing
    // grid column of its own, and it shares the line's top edge.
    expect(css).toMatch(/\.forward-delete\s*\{[^}]*align-self:\s*start/s)
    expect(css).not.toMatch(/\.forward-delete\s*\{[^}]*grid-column/s)
    // Folding needs no narrow-screen override: it is a base-rule property.
    const narrow = css.slice(css.indexOf('@media (max-width: 520px)'))
    expect(narrow).not.toMatch(/\.forward-row\s*\{/)
    expect(narrow).not.toMatch(/\.forward-form/)
  })

  it('styles the forwards list with theme tokens only and a narrow single-column fallback', () => {
    for (const rule of css.match(/\.forward-[^{]*\{[^}]*\}/gs) ?? []) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/)
    }
    expect(css).toMatch(/\.forward-row\s*\{[^}]*min-width:\s*0/s)
    expect(css).toMatch(/\.forward-diagnostic\s*\{[^}]*overflow-wrap:\s*anywhere/s)
    // The create fields stack with their names in one aligned column.
    expect(css).toMatch(/\.forward-form-row\s*\{[^}]*flex-direction:\s*column/s)
    expect(css).toMatch(/\.forward-form-row\s+label\s*>\s*span\s*\{[^}]*min-width:\s*6\.5em/s)
  })
})
