import type { SessionActivityState } from '@dsh-cockpit/shared'
import './state-dot.css'

/** Outer 3x3 matrix cells (2px pixels on a 10px grid), clockwise from
 * top-left — copied verbatim from @deepseek-ai/dsh-client-ui-primitives
 * StateDot (official session-row status dot). */
const MATRIX_CELLS: readonly (readonly [number, number])[] = [
  [0, 0],
  [4, 0],
  [8, 0],
  [8, 4],
  [8, 8],
  [4, 8],
  [0, 8],
  [0, 4],
]

/**
 * Official DSH session-row status dot (StateDot): ongoing renders the running
 * "chase" pixel matrix (loading-like animation, brand blue); done renders a
 * static green dot; warning an amber dot; error a red dot. Colors and the
 * chase keyframes are taken from the official theme —
 * --dsw-static-deepseek-450 / --dsw-alias-state-{success,warn,error}-primary.
 *
 * aria-hidden: the element is decorative; pair with an accessible label
 * (title / screen-reader text) at the call site.
 */
export function StateDot({ state, size = 10 }: { state: SessionActivityState; size?: number }) {
  if (state === 'ongoing') {
    return (
      <svg
        className="dsh-state-dot-matrix"
        data-state="ongoing"
        width={size}
        height={size}
        viewBox="0 0 10 10"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {MATRIX_CELLS.map(([x, y], index) => (
          <rect
            key={`${x}-${y}`}
            className="dsh-state-dot-cell"
            x={x}
            y={y}
            width="2"
            height="2"
            style={{ animationDelay: `${(index - MATRIX_CELLS.length) * 125}ms` }}
          />
        ))}
      </svg>
    )
  }
  return <span className="dsh-state-dot" data-state={state} aria-hidden="true" style={{ width: size, height: size }} />
}
