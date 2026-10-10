import type { SessionActivityState } from '@dsh-cockpit/shared'
import './state-dot.css'

/**
 * Official DSH session-row status glyph (StateDot), shadowed from
 * `@deepseek-ai/dsh-client-ui-primitives` 0.2.0-rc.2 (`StateDot` +
 * `StateDot.module.css`): ongoing renders the official stroked spinner
 * (low-opacity track + breathing arc, 1.5s period), the solid states a single
 * currentColor core. Colors keep the official theme semantics —
 * `--dsw-alias-state-{success,warn,error}-primary`, and the neutral
 * `--dsw-alias-label-tertiary` for the spinner, which the cockpit carries as
 * the `--state-ongoing` token in app.css.
 *
 * Two deliberate differences from the official copy:
 * - every state renders at the same 10px size (official grows ongoing to
 *   14px); the chip strip stays one height, and the small spinner gains its
 *   legibility from a slightly thicker stroke instead of a bigger box;
 * - the official `syncSpinner` phase-pinning is not replicated — the spinner
 *   is a single 10px glyph per device chip, so phase alignment buys nothing.
 *
 * The cockpit keeps this shadow copy instead of importing the DSH client
 * package, so a DSH upgrade that changes this glyph needs a re-sync here.
 * `aria-hidden`: the element is decorative; pair with an accessible label
 * (title / screen-reader text) at the call site.
 */
export function StateDot({ state, size = 10 }: { state: SessionActivityState; size?: number }) {
  if (state === 'ongoing') {
    return (
      <svg
        className="dsh-state-dot-spinner"
        data-state="ongoing"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <g className="dsh-state-dot-spinner-motion">
          <circle className="dsh-state-dot-spinner-track" cx="12" cy="12" r="9.5" />
          <circle className="dsh-state-dot-spinner-arc" cx="12" cy="12" r="9.5" />
        </g>
      </svg>
    )
  }
  return <span className="dsh-state-dot" data-state={state} aria-hidden="true" style={{ width: size, height: size }} />
}
