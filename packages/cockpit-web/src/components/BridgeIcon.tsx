/** Bridge status icon.
 *
 * The cockpit shows whether a device's own DSH web client runs the optional
 * dsh-cockpit-bridge plugin. That state used to be the emoji "⛓", which most
 * system fonts render narrow enough to read as a pause glyph, and which looked
 * identical in both states (only the color changed).
 *
 * Here the two states carry DIFFERENT SHAPES — a closed chain vs a broken one —
 * so they stay distinguishable without relying on color at all (light theme,
 * color-vision deficiency, small sizes). Strokes use currentColor so the
 * surrounding token-driven color continues to drive theming; no theme value is
 * ever hardcoded here. Both variants share one viewBox and box size, so
 * flipping between them cannot shift the topbar layout.
 */

export type BridgeIconVariant = 'connected' | 'disconnected'

export interface BridgeIconProps {
  readonly variant: BridgeIconVariant
  readonly size?: number
}

/** Shared geometry: identical box for both variants (no layout jitter). */
const VIEW_BOX = '0 0 24 24'
const DEFAULT_SIZE = 16

/** The two chain halves, identical in both states. Only the connecting bar
 * between them appears or disappears, so "linked" reads as a completed path
 * and "not linked" as the same chain with its middle missing. */
const CHAIN_HALVES = 'M15 7h3a5 5 0 0 1 0 10h-3m-6 0H6a5 5 0 0 1 0-10h3'

export function BridgeIcon({ variant, size = DEFAULT_SIZE }: BridgeIconProps) {
  return (
    <svg
      data-bridge-icon={variant}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={VIEW_BOX}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={CHAIN_HALVES} />
      {/* Linked: the bar closes the chain. Unlinked: the gap stays open. */}
      {variant === 'connected' && <line x1="8" y1="12" x2="16" y2="12" />}
    </svg>
  )
}
