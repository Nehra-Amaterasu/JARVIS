// RubricChips (package Y01, spec 21.8): tickable rubric points, each a 44 px chip. In the Review Desk they show the points a
// question carries (a drafted point is dashed until accepted); in the Marking Desk (X08) the student ticks what an answer earned.
// The total is the student's own count and is labelled so. States: unmarked (nothing ticked, not marked yet), partial, full, none
// (marked, nothing earned). Nothing is coloured red for a low mark.
import type { RubricPoint } from '../ports'

export interface RubricPointView {
  id: string
  text: string
  marks: number
  origin?: RubricPoint['origin']
  accepted?: boolean
}

export interface RubricChipsProps {
  points: readonly RubricPointView[]
  /** Ids of the points ticked. */
  awarded: readonly string[]
  onToggle: (id: string) => void
  /** The student has marked this answer (so an empty tick set means "none", not "unmarked"). */
  marked?: boolean
  label?: string
  disabled?: boolean
}

export type RubricState = 'unmarked' | 'partial' | 'full' | 'none'

export function rubricState(points: readonly RubricPointView[], awarded: readonly string[], marked = false): RubricState {
  const got = points.filter((p) => awarded.includes(p.id)).length
  if (got === 0) return marked ? 'none' : 'unmarked'
  return got === points.length ? 'full' : 'partial'
}

export const rubricTotal = (points: readonly RubricPointView[], awarded: readonly string[]) => points.reduce((s, p) => s + (awarded.includes(p.id) ? p.marks : 0), 0)

export function RubricChips({ points, awarded, onToggle, marked, label = 'Rubric points', disabled }: RubricChipsProps) {
  const state = rubricState(points, awarded, marked)
  const total = points.reduce((s, p) => s + p.marks, 0)
  return (
    <div className="rv-rubric" data-component="rubric-chips" data-state={state} role="group" aria-label={label}>
      <ul className="rv-rubric-list">
        {points.map((p) => {
          const on = awarded.includes(p.id)
          const draft = p.origin === 'MODEL' && !p.accepted
          return (
            <li key={p.id}>
              <button type="button" className="rv-pt" aria-pressed={on} data-draft={draft ? 'true' : undefined} disabled={disabled} onClick={() => onToggle(p.id)}>
                <span className="rv-pt-mark" aria-hidden="true">{on ? '●' : '○'}</span>
                <span className="rv-pt-text">{p.text}</span>
                <span className="rv-pt-marks">{p.marks}</span>
                {draft && <span className="ww-sr-only">, drafted by the model, not accepted</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="rv-rubric-total">
        {points.length === 0 ? 'No points yet' : state === 'unmarked' ? `${total} marks in ${points.length} points` : `${rubricTotal(points, awarded)} of ${total} marks, marked by you`}
      </p>
    </div>
  )
}
