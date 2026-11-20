// EvidenceLedger (T01, spec 20.8.2 and 20.8.4): the one-line-per-record terminal under the canvas, in Well Wisher's own language (ASCII,
// a prompt, mono type). It prints the last three records, or says WAITING with the reason. A line is `date kind detail -> node`.
import type { LampState } from '../../shared/lamp'
import { LampWord } from '../left/LampWord'

export interface EvidenceLedgerProps {
  state: LampState
  reason: string
  /** Already formatted, newest first (`ledgerLines`). */
  lines: string[]
  className?: string
}

export function EvidenceLedger({ state, reason, lines, className }: EvidenceLedgerProps) {
  const show = (state === 'live' || state === 'simulated')
  return (
    <section className={className ? `tg-ledger ${className}` : 'tg-ledger'} data-lamp={state} aria-label={`Evidence ledger, ${state}: ${reason}`}>
      <header className="tg-ledger-head">
        <span className="tg-ascii" aria-hidden="true">+--[</span>
        <h3 className="tg-ledger-title">EVIDENCE LEDGER</h3>
        <span className="tg-ascii" aria-hidden="true">]--</span>
        <LampWord state={state} />
        <span className="tg-ledger-why">{reason}</span>
      </header>
      <ol className="tg-ledger-lines">
        {show && lines.length > 0
          ? lines.map((l, i) => <li key={i}><span className="tg-ascii" aria-hidden="true">&gt; </span>{l}</li>)
          : <li data-hollow="true"><span className="tg-ascii" aria-hidden="true">&gt; </span>{show ? 'No records yet. Log a drill, a session or an artefact and it prints here.' : 'Nothing recorded and nothing guessed. Records print here once a store is connected.'}</li>}
      </ol>
    </section>
  )
}
