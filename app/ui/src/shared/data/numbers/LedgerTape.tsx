// The LedgerTape (spec 20.5.2, package D01): a 320 px paper receipt, one line per entry as text with dotted leaders
// (`chai ········· 120`), a running total in Odometer wheels, a ruler of registration ticks along the head (the
// registration-mark bar of C04-35) and a torn zigzag end. Today's tape is the Capture Line's output.
// LIVE and SIMULATED print amounts. Other states print "--" for every amount and no total, and say why. A tape with no
// entries is an empty strip with one sentence. If the total handed in does not equal the sum of the lines, the tape says
// so in one line instead of quietly choosing one. At most 60 lines are drawn; older ones are counted in text.
import { Lamp, lampText, showsValue, type LampState } from '../../kit'
import { Odometer } from './Odometer'
import { TAPE_COLS, groupDigits, tapeLine, tapeSum, tapeWindow, tornEdge, tornPath, TAPE_WIDTH, TEAR_DEPTH, type TapeEntry } from './layout'
import './numbers.css'

export interface LedgerTapeProps {
  entries: { label: string; amount: number }[]
  total: number
  state: LampState
  /** A short name for the head of the tape ("today"); drawn in mono caps. */
  title?: string
  /** What the amounts are in ("INR"); named once in the foot, not on every line. */
  unit?: string
  reason?: string
  className?: string
}

export function LedgerTape({ entries, total, state, title = 'today', unit, reason, className }: LedgerTapeProps) {
  const draws = showsValue(state)
  const { shown, hidden } = tapeWindow<TapeEntry>(entries)
  const sum = tapeSum(entries)
  const mismatch = draws && entries.length > 0 && Math.round(sum) !== Math.round(total)
  const empty = draws && entries.length === 0
  const why = !draws ? lampText(state, reason ?? (state === 'waiting' ? 'no report' : undefined)) : null
  const seed = `tape:${entries.length}:${Math.round(total)}`
  return (
    <section
      className={`d1-tape${className ? ` ${className}` : ''}`}
      data-component="ledger-tape"
      data-grammar="ascii"
      data-state={state}
      data-form={draws && !empty ? 'tape' : 'hollow'}
      aria-label={`Ledger tape, ${title}`}
      style={{ ['--d1-tape-w' as string]: `${TAPE_WIDTH}px`, ['--d1-cols' as string]: TAPE_COLS }}
    >
      <div className="d1-tape-sheet">
        <header className="d1-tape-head">
          <span className="d1-tape-title">TAPE / {title.toUpperCase()}</span>
          <span className="d1-lamp"><Lamp state={state} reason={reason} bare /></span>
        </header>
        <div className="d1-tape-ruler" aria-hidden="true" />

        {draws && !empty ? (
          <ol className="d1-tape-lines">
            {hidden > 0 && <li className="d1-tape-more">{`+ ${hidden} earlier lines not drawn`}</li>}
            {shown.map((e, i) => (
              <li key={i} className="d1-tape-line" aria-label={`${e.label}, ${Number.isFinite(e.amount) ? groupDigits(e.amount) : 'no amount'}`}>
                <span aria-hidden="true">{tapeLine(e.label, Number.isFinite(e.amount) ? groupDigits(e.amount) : '--')}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="d1-tape-lines d1-tape-blank">
            <p className="d1-tape-line" aria-hidden="true">{tapeLine('', '--')}</p>
            <p className="d1-tape-line" aria-hidden="true">{tapeLine('', '--')}</p>
            <p className="d1-why">{why ?? 'nothing taped yet'}</p>
          </div>
        )}

        <div className="d1-tape-total" data-hollow={draws ? undefined : 'true'}>
          <span className="d1-tape-sum">TOTAL{unit ? ` (${unit})` : ''}</span>
          <Odometer value={total} unit="" state={state} reason={reason} size="compact" lamp={false} />
        </div>
        {mismatch && <p className="d1-why" role="note">{`the lines add up to ${groupDigits(sum)}; the total says ${groupDigits(total)}`}</p>}
        {state === 'simulated' && draws && <p className="d1-stamp d1-tape-stamp">SIMULATED</p>}
      </div>
      <svg className="d1-tape-tear" viewBox={`0 0 ${TAPE_WIDTH} ${TEAR_DEPTH}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path className="d1-tape-paper" d={tornPath(seed)} />
        <path className="d1-tape-edge" d={tornEdge(seed)} />
      </svg>
    </section>
  )
}
