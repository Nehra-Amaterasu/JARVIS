// BranchSpine (T01, spec 20.8.2): the tree's growth, drawn down the left edge as a stalk of rungs. One rung per node (at most 40, then
// each rung stands for several), filled from the bottom as the evidenced share grows. It is a pure function of the ledger
// (`filledSteps` in ledger.ts): no animation of its own, no percentage, nothing smooth. Delete a record and a rung empties. Only a
// LIVE or SIMULATED ledger fills any rung; otherwise every rung is a dotted placeholder and the caption says why.
import { showsNumber, type LampState } from '../../shared/lamp'
import { filledSteps, type Growth } from './ledger'

export const SPINE_MAX = 40

export interface BranchSpineProps {
  growth: Growth
  state: LampState
  /** Why the state is what it is (read with the caption). */
  reason: string
  name: string
}

export function BranchSpine({ growth, state, reason, name }: BranchSpineProps) {
  const steps = Math.max(1, Math.min(SPINE_MAX, growth.total))
  const filled = showsNumber(state) ? filledSteps(growth, steps) : 0
  const H = steps * 14 + 24
  return (
    <figure className="tg-spine" data-lamp={state} aria-label={`${name} growth: ${showsNumber(state) ? `${growth.evidenced} of ${growth.total} nodes evidenced` : `not counted, ${reason}`}`}>
      <svg viewBox={`0 0 56 ${H}`} width="56" height={H} aria-hidden="true">
        <path className="sp-stalk" d={`M28,10V${H - 10}`} />
        {Array.from({ length: steps }, (_, i) => {
          const y = H - 18 - i * 14   // rung 0 is the bottom one
          const on = i < filled
          // earned: a pair of leaves; not yet: a hollow bud on the stalk
          return <path key={i} className="sp-rung" data-on={on ? 'true' : 'false'} d={on ? `M28,${y}l-14,-8M28,${y}l14,-8` : `M25.5,${y}a2.5,2.5 0 1 0 5,0a2.5,2.5 0 1 0 -5,0`} />
        })}
      </svg>
      <figcaption className="sp-cap">Grows with the ledger. It falls if a record is deleted.</figcaption>
    </figure>
  )
}
