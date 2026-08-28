import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BridgeIcon } from '../src/components/BridgeIcon.jsx'

afterEach(cleanup)

function svgOf(container: HTMLElement, variant: 'connected' | 'disconnected'): SVGSVGElement {
  const svg = container.querySelector(`svg[data-bridge-icon="${variant}"]`)
  expect(svg).not.toBeNull()
  return svg as unknown as SVGSVGElement
}

describe('BridgeIcon', () => {
  it('marks each variant with a stable shape hook', () => {
    const connected = render(<BridgeIcon variant="connected" />)
    expect(svgOf(connected.container, 'connected')).toBeTruthy()
    cleanup()

    const disconnected = render(<BridgeIcon variant="disconnected" />)
    expect(svgOf(disconnected.container, 'disconnected')).toBeTruthy()
  })

  it('inherits the surrounding text color instead of a hardcoded theme value', () => {
    const { container } = render(<BridgeIcon variant="connected" />)
    const svg = svgOf(container, 'connected')

    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('fill')).toBe('none')
    // A hardcoded hex/rgb anywhere in the markup would break theme following.
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}|rgba?\(/)
  })

  it('keeps both variants on the same box so switching cannot shift the layout', () => {
    const connected = render(<BridgeIcon variant="connected" />)
    const a = svgOf(connected.container, 'connected')
    const box = {
      viewBox: a.getAttribute('viewBox'),
      width: a.getAttribute('width'),
      height: a.getAttribute('height'),
    }
    cleanup()

    const disconnected = render(<BridgeIcon variant="disconnected" />)
    const b = svgOf(disconnected.container, 'disconnected')

    expect(b.getAttribute('viewBox')).toBe(box.viewBox)
    expect(b.getAttribute('width')).toBe(box.width)
    expect(b.getAttribute('height')).toBe(box.height)
  })

  it('renders geometrically different shapes for the two states', () => {
    const connected = render(<BridgeIcon variant="connected" />)
    const connectedPaths = connected.container.innerHTML
    cleanup()

    const disconnected = render(<BridgeIcon variant="disconnected" />)
    expect(disconnected.container.innerHTML).not.toBe(connectedPaths)
  })

  it('honours an explicit size while staying square', () => {
    const { container } = render(<BridgeIcon variant="connected" size={18} />)
    const svg = svgOf(container, 'connected')

    expect(svg.getAttribute('width')).toBe('18')
    expect(svg.getAttribute('height')).toBe('18')
  })

  it('is decorative by default so the labelled wrapper owns the accessible name', () => {
    const { container } = render(<BridgeIcon variant="connected" />)
    expect(svgOf(container, 'connected').getAttribute('aria-hidden')).toBe('true')
  })
})
