/**
 * Focus > Rest (A.Y02, 20.7.8): where a block ends. It says what the block was in neutral words (a session "ended", never
 * "failed"), shows the dots that were filled (an early end keeps them), says how many minutes counted (under 10 counts nothing,
 * and it says so), and offers a break once, as a plain button after a long block. A break has no countdown: nothing here wakes
 * on its own. The hill is still.
 */
import { useState } from 'react'
import { DotTimer } from '../../shared/art'
import { Button, PrimaryButton } from '../../shared/kit'
import { Hill } from './art'
import { goFocus, goToday } from './nav'
import { MIN_COUNTED_MIN } from './session'
import { useFocusViews, type LastBlock } from './store'
import './views/focus-views.css'

/** A block this long or longer is followed by one offer of a break. */
export const LONG_BLOCK_MIN = 50

const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export interface FocusRestPanelProps {
  last: LastBlock | null
  onStart: () => void
  onToday: () => void
  /** The fixture stamp, drawn when the block shown is invented. */
  simulated?: boolean
}

export function FocusRestPanel({ last, onStart, onToday, simulated }: FocusRestPanelProps) {
  const [rest, setRest] = useState(false)
  const held = last ? Math.floor(last.heldMin) : 0
  const offer = !!last && last.heldMin >= LONG_BLOCK_MIN && !rest
  return (
    <section className="fv fr" aria-label="Rest" data-kind={last?.kind ?? 'none'}>
      <div className="fr-left">
        <header className="fs-head">
          <p className="fv-kick">Focus</p>
          <h2 className="fs-title">{!last ? 'Rest' : last.kind === 'done' ? 'Block complete' : 'Block ended'}</h2>
        </header>
        {last ? (
          <>
            <p className="fr-line" role="status">{last.line}</p>
            <div className="fr-dots">
              <DotTimer plannedMin={last.length} elapsedMin={held} ended={last.kind === 'ended'} state={simulated ? 'simulated' : 'live'} caption="Minutes held" />
            </div>
            <p className="fs-sub">
              {last.counted > 0 ? `${last.counted} min logged.` : `Under ${MIN_COUNTED_MIN} minutes, so nothing was logged.`}
              {last.parked > 0 ? ` ${last.parked} thought${last.parked === 1 ? '' : 's'} parked.` : ''}
              {last.kind === 'ended' ? ` Last seen ${clock(last.at)}.` : ''}
            </p>
            {rest && <p className="fr-break" role="status">Break. Nothing counts down. Come back when you are ready.</p>}
          </>
        ) : (
          <p className="fr-line" role="status">No block has ended in this window. Nothing is counting down.</p>
        )}
        <div className="fr-actions">
          <PrimaryButton claimId="focus-rest-start" rank="workspace" size="lg" onClick={onStart}>Start another block</PrimaryButton>
          {offer && <Button size="lg" onClick={() => setRest(true)}>Take a break</Button>}
          <Button size="lg" onClick={onToday}>Back to Today</Button>
        </div>
        {simulated && <p className="fs-foot">SIMULATED block, drawn for the gallery.</p>}
      </div>
      <div className="fr-right"><Hill /></div>
    </section>
  )
}

/** The Rest view: the block that just ended, from the Crucible's hand-over. */
export function FocusRest() {
  const last = useFocusViews((s) => s.last)
  return <FocusRestPanel last={last} onStart={() => goFocus('start')} onToday={goToday} />
}
