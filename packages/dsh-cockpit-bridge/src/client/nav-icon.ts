/**
 * The transfer glyph for this section's own row in the DSH settings navigation.
 *
 * DSH 0.2.2 renders every settings-nav row as
 * `<button><span class="navIcon"><svg/></span><span class="navLabel">…</span></button>`
 * and offers the official `settings.section.icon` slot for that seat: the shell
 * calls `renderSlot('settings.section.icon', { size, active }, { only: row.id,
 * fallback: navIcon(row.id) })`. Registering this component under the same id as
 * the section therefore replaces the fallback gear **without touching the host's
 * DOM**. On a host without that slot the declaration never appears, the
 * `slots.inject` callback simply does not run, and the host keeps its own icon —
 * the page and the section stay usable either way.
 *
 * Style is calibrated against the host's own nav icons rather than invented:
 * `dsh-client-ui-settings-shell` renders every section row through `navIcon(id)`,
 * which returns an `Icon*OutlineMedium` primitive from
 * `@deepseek-ai/dsh-client-ui-primitives` — `viewBox="0 0 16 16"`,
 * `fill="none"`, `stroke="currentColor"`, `stroke-width: ICON_MEDIUM_STROKE`
 * (= 1.3, not 1: the set ships a 1px "Regular" weight too), `aria-hidden`,
 * geometry inside the 1.5–14.5 box. Round caps/joins come from
 * `IconChevronsUpDownOutlineMedium`, the set's own arrow-shaped icon, so the
 * arrowheads match its chevrons.
 *
 * Two ports joined by an arrow was tried first and read as a dense blob at 16px;
 * one outline plus one stroke (the earlier port glyph) then read as a different
 * icon family from its neighbours. No emoji font, no image asset, no network.
 *
 * @module dsh-cockpit-bridge/client/nav-icon
 */
import { createElement, type ReactElement } from 'react'

/** The official seat always supplies the shell's icon size (16 today, matching
 * the 16-unit grid this glyph is drawn on); the default keeps a host that passes
 * nothing from rendering a zero-sized icon. */
export interface ForwardsNavIconProps {
  readonly size?: number
}

/**
 * Two opposing arrows: the conventional "traffic moves between two ends" mark.
 * It inherits the row's `currentColor` (including the active-row colour) and is
 * decorative — the row's own label carries the name.
 */
export function ForwardsSettingsNavIcon({ size = 16 }: ForwardsNavIconProps): ReactElement {
  return createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  },
  createElement('path', { d: 'M1.8 5.6h11.4' }),
  createElement('path', { d: 'm10.9 3.3 2.3 2.3-2.3 2.3' }),
  createElement('path', { d: 'M14.2 10.4H2.8' }),
  createElement('path', { d: 'm5.1 8.1-2.3 2.3 2.3 2.3' }))
}
