import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'

/** The settings-nav glyph (design D9). DSH 0.2.2 seats it through the official
 * `settings.section.icon` slot, so this asserts the component's own contract —
 * the official icon set's 16-unit grid, `currentColor`, the host-supplied size
 * and the transfer geometry. Whether the row keeps the host's default gear when
 * the slot is absent is the host's fallback, asserted from the registration side
 * in `forwards-settings.test.ts`. */
import { ForwardsSettingsNavIcon } from '../src/client/nav-icon.js'

/** The two opposing arrows the glyph is made of, in drawing order. */
const TRANSFER_PATHS = [
  'M1.8 5.6h11.4',
  'm10.9 3.3 2.3 2.3-2.3 2.3',
  'M14.2 10.4H2.8',
  'm5.1 8.1-2.3 2.3 2.3 2.3',
]

function glyph(size?: number): ReactElement {
  return size === undefined ? ForwardsSettingsNavIcon({}) : ForwardsSettingsNavIcon({ size })
}

describe('cockpit forwards settings nav glyph', () => {
  it('draws on the host icon set\'s 16-unit grid and follows currentColor', () => {
    const svg = glyph(16)
    expect(svg.type).toBe('svg')
    expect(svg.props).toMatchObject({
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      // Decorative: the row's own label carries the name.
      'aria-hidden': true,
    })
  })

  it('takes its size from the host seat', () => {
    expect(glyph(20).props).toMatchObject({ width: 20, height: 20 })
    expect(glyph(20).props.viewBox).toBe('0 0 16 16')
  })

  it('defaults to the 16-unit grid when the seat supplies no size', () => {
    expect(glyph().props).toMatchObject({ width: 16, height: 16 })
  })

  it('keeps the two-line, two-arrowhead transfer geometry', () => {
    const paths = glyph(16).props.children as ReactElement[]
    expect(paths).toHaveLength(TRANSFER_PATHS.length)
    expect(paths.every(path => path.type === 'path')).toBe(true)
    expect(paths.map(path => path.props.d)).toEqual(TRANSFER_PATHS)
  })

  it('renders without a document: the host owns the seat, this owns nothing else', () => {
    // The old adaptation needed jsdom (it located and marked the host's row).
    // The glyph is pure markup now, so it must survive the node test environment.
    expect(() => glyph(16)).not.toThrow()
  })
})
