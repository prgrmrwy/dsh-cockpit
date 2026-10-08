// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The settings-nav glyph (design D9): the section's own row is the only thing
 * this may touch, and a row it cannot find must stay exactly as the host drew
 * it. jsdom is the environment because the whole risk lives in the selectors. */
import { registerForwardsSettingsNavIcon } from '../src/client/nav-icon.js'
import { NAV_MARKER } from '../src/client/settings-styles.js'

const LABEL = '驾驶舱转发'

function mountNav(): { ours: HTMLButtonElement; other: HTMLButtonElement; nested: HTMLButtonElement } {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const nav = document.createElement('nav')
  const ours = document.createElement('button')
  ours.innerHTML = '<svg></svg><span>驾驶舱转发</span>'
  const other = document.createElement('button')
  other.innerHTML = '<svg></svg><span>记忆</span>'
  // A row outside the settings nav must never be marked either.
  const nested = document.createElement('button')
  nested.innerHTML = '<span>驾驶舱转发</span>'
  nav.append(ours, other)
  dialog.appendChild(nav)
  const outside = document.createElement('div')
  outside.appendChild(nested)
  document.body.append(dialog, outside)
  return { ours, other, nested }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('cockpit forwards settings nav glyph', () => {
  it('marks only the row whose text is this section\'s label, and unmarks it on disposal', () => {
    const { ours, other, nested } = mountNav()
    const dispose = registerForwardsSettingsNavIcon(() => LABEL)

    expect(ours.hasAttribute(NAV_MARKER)).toBe(true)
    expect(other.hasAttribute(NAV_MARKER)).toBe(false)
    expect(nested.hasAttribute(NAV_MARKER)).toBe(false)

    // The official glyph is only hidden through the marker, so unmarking is
    // what restores the host's own icon.
    dispose()
    expect(ours.hasAttribute(NAV_MARKER)).toBe(false)
  })

  it('re-marks the row when the label or the row content changes', async () => {
    const { ours } = mountNav()
    const label = { current: '别的文案' }
    const dispose = registerForwardsSettingsNavIcon(() => label.current)
    expect(ours.hasAttribute(NAV_MARKER)).toBe(false)

    label.current = LABEL
    ours.innerHTML = '<svg></svg><span>驾驶舱转发</span>'
    await vi.waitFor(() => { expect(ours.hasAttribute(NAV_MARKER)).toBe(true) })
    dispose()
    expect(ours.hasAttribute(NAV_MARKER)).toBe(false)
  })

  it('stays silent when its row cannot be located', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const nav = document.createElement('nav')
    const other = document.createElement('button')
    other.innerHTML = '<svg></svg><span>记忆</span>'
    nav.appendChild(other)
    dialog.appendChild(nav)
    document.body.appendChild(dialog)

    const dispose = registerForwardsSettingsNavIcon(() => LABEL)
    expect(other.hasAttribute(NAV_MARKER)).toBe(false)
    expect(() => { dispose() }).not.toThrow()
  })

  it('does nothing at all without a document', () => {
    const original = globalThis.document
    // Non-browser environments (the bridge's node tests) must not crash.
    Reflect.deleteProperty(globalThis, 'document')
    try {
      expect(() => { registerForwardsSettingsNavIcon(() => LABEL)() }).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'document', { value: original, configurable: true, writable: true })
    }
  })
})
