/**
 * Progress dots of the Drill (A.Y02): one dot per question. A dot fills after Check and stays hollow when the question was skipped
 * or has not been reached. A filled dot says "answered", never "right": the dots carry no verdict, so there is nothing to read as a
 * score. The dot is 14 px; the button around it is 44 px (principle 14), and it jumps to that question. The fill changes with a
 * 160 ms opacity change (the --dur-state token); no sound, no shake, no confetti. An early end keeps every filled dot standing.
 * EL-FOCUS: the dots are a stepper, a rail of rows joined by a line, each with a state word (answered, skipped, here, open): a dot means
 * answered, never right. On the phone the same steps are a wrapping grid of 44 px dots under the card header: every step stays one touch away, none is windowed out.
 */
import type { CSSProperties } from 'react'
import type { DrillQuestion } from './ports'
import type { QResult } from './model'

export interface DrillDotsProps {
  qs: DrillQuestion[]
  res: Record<string, QResult>
  current: number
  onJump: (i: number) => void
  /** The set ended before the last question was reached: said once, in words. */
  early?: boolean
  /** `rail` is the desktop stepper (rows with a state word); `strip` the phone's horizontal row of dots. */
  variant?: 'rail' | 'strip'
}

const WORD = (r: QResult | undefined) => (!r ? 'not reached' : r.state === 'skipped' ? 'skipped' : 'answered')
/** The short word printed beside a step: the answer state, else where the student stands. */
const SHORT = (r: QResult | undefined, here: boolean) => (!r ? (here ? 'here' : 'open') : r.state === 'skipped' ? 'skipped' : 'answered')

export function DrillDots({ qs, res, current, onJump, early, variant = 'rail' }: DrillDotsProps) {
  const done = qs.filter((q) => res[q.id] && res[q.id].state !== 'skipped').length
  // two columns of steps once a set is longer than six, so ten steps still stand at 44 px each inside one canvas; the strip wraps by itself
  const cols = variant === 'rail' && qs.length > 6 ? 2 : 1
  const rows = Math.ceil(qs.length / cols)
  return (
    <div className="dd" data-variant={variant} data-early={early ? 'true' : undefined}>
      <p className="dd-count" aria-live="off"><span className="dd-n">{done}</span> <span className="dd-of">of {qs.length} answered</span></p>
      <ol className="dd-list" aria-label={`Progress, ${qs.length} questions`} style={{ '--dd-rows': rows } as CSSProperties}>
        {qs.map((q, i) => {
          const r = res[q.id]
          const kind = !r ? 'open' : r.state === 'skipped' ? 'skipped' : 'filled'
          // the joining line stops at the last step of each column
          const end = (i + 1) % rows === 0 || i === qs.length - 1
          return (
            <li key={q.id} data-end={end ? 'true' : undefined}>
              <button type="button" className="dd-btn" aria-label={`Question ${i + 1}, ${WORD(r)}`} aria-current={i === current ? 'step' : undefined}
                data-dot={kind} data-current={i === current ? 'true' : undefined} onClick={() => onJump(i)}>
                <span className="dd-dot" aria-hidden="true" />
                <span className="dd-name" aria-hidden="true">Question {i + 1}</span>
                <span className="dd-word" aria-hidden="true">{SHORT(r, i === current)}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {early && <p className="dd-note">Ended early. The filled dots stay.</p>}
    </div>
  )
}
