/**
 * Styles for the read-only “驾驶舱转发” settings section (design D9).
 *
 * The section lives inside the host's settings panel, so the **host owns the
 * theme**: every colour below is a role mapped onto an official `--dsw-alias-*`
 * token, and the section contributes structure, scale and one memorable device
 * instead of a palette of its own. That is why nothing here hard-codes a colour
 * or reads `prefers-color-scheme` — dark and light are the host's to switch.
 *
 * The memorable device is the eight-slot occupancy meter: the additional-entry
 * pool really is bounded at eight, so drawing the slots answers “how much room
 * is left” without asking anyone to remember the number.
 *
 * Rules only ever match this plugin's own `dshcf-` classes (the section carries
 * {@link SECTION_ATTRIBUTE}), so the sheet cannot reach another plugin's row.
 * No webfonts, no images, no network.
 *
 * @module dsh-cockpit-bridge/client/settings-styles
 */

/** Marks the section root, so the stylesheet and the injected node stay ours. */
export const SECTION_ATTRIBUTE = 'data-dsh-cockpit-forwards'

/** Marks this section's own row in the settings navigation (see `nav-icon.ts`):
 * the slot projects no icon field, so the row is identified by its label and
 * then drawn by the sheet below. */
export const NAV_MARKER = 'data-dsh-cockpit-forwards-nav'

/**
 * A 16px transfer glyph: two opposing arrows, the conventional "traffic moves
 * between two ends" mark, drawn as a mask so it inherits `currentColor` like the
 * official glyphs.
 *
 * Style is calibrated against the host's own nav icons rather than invented:
 * `dsh-client-ui-settings-shell` renders every section row through
 * `navIcon(id)`, which returns an `Icon*OutlineMedium` primitive from
 * `@deepseek-ai/dsh-client-ui-primitives` — `viewBox="0 0 16 16"`, `fill="none"`,
 * `stroke="currentColor"`, `stroke-width: ICON_MEDIUM_STROKE` (= 1.3, not 1: the
 * set ships a 1px "Regular" weight too), `aria-hidden`, geometry inside the
 * 1.5–14.5 box. Round caps/joins come from `IconChevronsUpDownOutlineMedium`,
 * the set's own arrow-shaped icon, so the arrowheads match its chevrons.
 *
 * Two ports joined by an arrow was tried first and read as a dense blob at
 * 16px; one outline plus one stroke (the earlier port glyph) then read as a
 * different icon family from its neighbours. No emoji font, no image asset, no
 * network.
 */
const TRANSFER_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M1.8 5.6h11.4"/>'
  + '<path d="m10.9 3.3 2.3 2.3-2.3 2.3"/>'
  + '<path d="M14.2 10.4H2.8"/>'
  + '<path d="m5.1 8.1-2.3 2.3 2.3 2.3"/>'
  + '</svg>',
)}")`

const STYLE_ID = 'dsh-cockpit-forwards-styles'

/** The section's whole stylesheet. */
export const SECTION_CSS = `
.dshcf{
  --dshcf-ink:var(--dsw-alias-label-primary,inherit);
  --dshcf-ink-2:var(--dsw-alias-label-secondary,inherit);
  --dshcf-ink-3:var(--dsw-alias-label-tertiary,inherit);
  --dshcf-rule:var(--dsw-alias-border-l2,currentColor);
  --dshcf-rule-weak:var(--dsw-alias-border-l1,currentColor);
  --dshcf-rule-strong:var(--dsw-alias-border-l3,currentColor);
  --dshcf-accent:var(--dsw-alias-state-business-primary,currentColor);
  --dshcf-ok:var(--dsw-alias-state-success-primary,currentColor);
  --dshcf-warn:var(--dsw-alias-state-warn-primary,currentColor);
  --dshcf-error:var(--dsw-alias-state-error-primary,currentColor);
  --dshcf-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  display:flex;flex-direction:column;gap:10px;
  color:var(--dshcf-ink);font-size:12px;line-height:1.55;
}
/* Prose explains; it never runs the width of a wide panel. */
.dshcf-lede{margin:0;max-width:62ch;color:var(--dshcf-ink-2)}
.dshcf-title{margin:0;font-size:13px;font-weight:500}
.dshcf-guidance{margin:0;max-width:62ch;color:var(--dshcf-ink-2)}
/* The pool is a section of its own: the meter governs the rows under it. */
.dshcf-pool{display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--dshcf-rule-strong);padding-top:10px}
.dshcf-usage{display:flex;align-items:center;gap:8px}
.dshcf-usage-label{color:var(--dshcf-ink-3);font-size:11px}
.dshcf-meter{display:inline-flex;gap:2px;margin-left:auto}
/* An unused slot must still be visible: the pool size is the information. */
.dshcf-seg{width:14px;height:4px;border-radius:1px;background:var(--dsw-alias-state-idle-primary,currentColor)}
.dshcf-seg[data-filled="true"]{background:var(--dshcf-accent)}
.dshcf-usage-count{font-family:var(--dshcf-mono);font-size:11px;color:var(--dshcf-ink-3);font-variant-numeric:tabular-nums}
.dshcf-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
/* One row is the object itself: device port becomes a local address. Ports and
   addresses are monospace because one misread digit costs real debugging time. */
.dshcf-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;padding:7px 0}
.dshcf-row+.dshcf-row{border-top:1px solid var(--dshcf-rule-weak)}
.dshcf-port{font-family:var(--dshcf-mono);font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
.dshcf-arrow{color:var(--dshcf-ink-3)}
.dshcf-address{font-family:var(--dshcf-mono);color:var(--dshcf-ink-2)}
.dshcf-state{font-size:11px;color:var(--dshcf-ink-2);margin-left:auto}
.dshcf-row[data-state="ready"] .dshcf-state{color:var(--dshcf-ok)}
.dshcf-row[data-state="retrying"] .dshcf-state{color:var(--dshcf-warn)}
.dshcf-row[data-state="starting"] .dshcf-state{color:var(--dshcf-ink-3)}
.dshcf-row[data-state="paused"] .dshcf-state{color:var(--dshcf-ink-3)}
/* Lifetime is the one filled chip: whether an entry survives its holders is the
   single thing a row must say at a glance. */
.dshcf-life{font-size:11px;padding:0 6px;border:1px solid var(--dshcf-rule);border-radius:4px;color:var(--dshcf-ink-3);white-space:nowrap}
.dshcf-row[data-kind="main"] .dshcf-life{border-color:transparent;background:var(--dshcf-rule);color:var(--dshcf-ink-2)}
.dshcf-holders{flex-basis:100%;font-family:var(--dshcf-mono);font-size:11px;color:var(--dshcf-ink-3);overflow-wrap:anywhere}
/* A diagnostic is labelled and gets its own line; it is never mixed into the
   holder labels it would otherwise look like. */
.dshcf-diag{flex-basis:100%;margin:2px 0 0;display:flex;gap:6px;font-size:11px;color:var(--dshcf-error);overflow-wrap:anywhere}
.dshcf-diag-label{flex:none;color:var(--dshcf-ink-3)}
.dshcf-empty{margin:4px 0 0;max-width:62ch;color:var(--dshcf-ink-3)}
.dshcf-hint{margin:0;border-top:1px solid var(--dshcf-rule);padding-top:8px;max-width:62ch;color:var(--dshcf-ink-3)}
/* Nav row glyph. Both rules are scoped to the marker, which only ever lands on
   the row whose visible text is this section's label, so the sheet cannot reach
   another plugin's row. The replacement is an explicit inline-block rather than
   an anonymous inline box: if the host row is not a flex container, an inline
   ::before would ignore width/height and the row would lose its icon entirely
   (the official svg is hidden by the rule above it). This way the worst case is
   a slightly off alignment instead of no icon at all. */
[${NAV_MARKER}]>svg{display:none}
[${NAV_MARKER}]::before{content:'';display:inline-block;vertical-align:-3px;flex:none;width:16px;height:16px;
  background-color:currentColor;
  -webkit-mask:${TRANSFER_MASK} center/16px 16px no-repeat;mask:${TRANSFER_MASK} center/16px 16px no-repeat}
`

/** The smallest surface {@link injectSectionStyles} needs, so the injector can
 * be driven by a fake document in tests. */
export interface StyleElement {
  id: string
  textContent: string
  remove(): void
}

export interface StyleHost {
  readonly head: { appendChild(node: StyleElement): void }
  createElement(tagName: 'style'): StyleElement
  getElementById(id: string): StyleElement | null
}

/**
 * Inject the section stylesheet, once per page.
 *
 * Returns the disposer that removes it again, or `undefined` when there is no
 * document to inject into (non-browser environments). The first injector owns
 * the sheet: a second mount reuses the node and returns a no-op disposer, so
 * unloading one mount can never strip the styles from another.
 */
export function injectSectionStyles(host: StyleHost | undefined = globalThis.document as StyleHost | undefined): (() => void) | undefined {
  if (host === undefined) return undefined
  if (host.getElementById(STYLE_ID) !== null) return () => {}
  const style = host.createElement('style')
  style.id = STYLE_ID
  style.textContent = SECTION_CSS
  host.head.appendChild(style)
  let removed = false
  return () => {
    if (removed) return
    removed = true
    style.remove()
  }
}
