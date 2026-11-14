// CoverageLedger (package Y01, spec 20.7.1): the five stage chips along the top of every Study view: papers on file, questions
// extracted, reviewed, tagged by hand, last run. Each is a Readout with its lamp, so a number is drawn only when something real
// (LIVE) or openly generated (SIMULATED) reports it; otherwise the chip is hollow and says what it waits for.
import { Readout } from '../../../shared/kit'
import { sinceText, type LampState } from '../../../shared/lamp'
import { countText } from './stats'

export interface Coverage {
  papers: number
  questions: number
  reviewed: number
  taggedByHand: number
  /** Epoch ms of the last extraction run, or null when there has been none. */
  lastRun: number | null
}

export interface CoverageLedgerProps {
  coverage: Coverage
  state: LampState
  reason?: string
  /** A fixed clock for the "last run" text (tests and screenshots). */
  now?: number
}

export const EMPTY_COVERAGE: Coverage = { papers: 0, questions: 0, reviewed: 0, taggedByHand: 0, lastRun: null }

export function CoverageLedger({ coverage: c, state, reason, now }: CoverageLedgerProps) {
  const run = c.lastRun === null ? 'none yet' : sinceText({ state: 'live', since: c.lastRun, reason: '' }, now)
  return (
    <div className="pp-ledger" data-component="coverage-ledger" role="group" aria-label="Coverage of the papers on file">
      <Readout label="Papers on file" value={c.papers} state={state} reason={reason} />
      <Readout label="Questions read" value={c.questions} state={state} reason={reason} />
      <Readout label="Reviewed" value={countText(c.reviewed, c.questions)} state={state} reason={reason} />
      <Readout label="Tagged by hand" value={c.taggedByHand} state={state} reason={reason} />
      <Readout label="Last run" value={run} state={state} reason={reason} />
    </div>
  )
}
