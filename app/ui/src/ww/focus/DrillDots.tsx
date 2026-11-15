/**
 * Progress dots of the Drill (A.Y02): one dot per question. A dot fills after Check and stays hollow when the question was skipped
 * or has not been reached. A filled dot says "answered", never "right": the dots carry no verdict, so there is nothing to read as a
 * score. The dot is 14 px; the button around it is 44 px (principle 14), and it jumps to that question. The fill changes with a
 * 160 ms opacity change (the --dur-state token); no sound, no shake, no confetti. An early end keeps every filled dot standing.
 */
import type { DrillQuestion } from './ports'
import type { QResult } from './model'

export interface DrillDotsProps {
  qs: DrillQuestion[]
  res: Record<string, QResult>
  current: number
  onJump: (i: number) => void
  /** The set ended before the last question was reached: said once, in words. */
  early?: boolean
}

const WORD = (r: QResult | undefined) => (!r ? 'not reached' : r.state === 'skipped' ? 'skipped' : 'answered')

export function DrillDots({ qs, res, current, onJump, early }: DrillDotsProps) {
  const done = qs.filter((q) => res[q.id] && res[q.id].state !== 'skipped').length
  return (
    <div className="dd" data-early={early ? 'true' : undefined}>
      <p className="dd-count" aria-live="off"><span className="dd-n">{done}</span> of {qs.length} answered</p>
      <ol className="dd-list" aria-label={`Progress, ${qs.length} questions`}>
        {qs.map((q, i) => {
          const r = res[q.id]
          const kind = !r ? 'open' : r.state === 'skipped' ? 'skipped' : 'filled'
          return (
            <li key={q.id}>
              <button type="button" className="dd-btn" aria-label={`Question ${i + 1}, ${WORD(r)}`} aria-current={i === current ? 'step' : undefined}
                data-dot={kind} data-current={i === current ? 'true' : undefined} onClick={() => onJump(i)}>
                <span className="dd-dot" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ol>
      {early && <p className="dd-note">Ended early. The filled dots stay.</p>}
    </div>
  )
}
