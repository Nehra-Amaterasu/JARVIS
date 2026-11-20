// RetentionOrbit (package Y03, spec 20.7.4): the spaced-review cards as four orbits around "today". A topic is a planet on the orbit of
// its band (fresh, settled, fading, due); due topics are hollow and sit on the outer ring. The estimate is drawn in four bands and NO
// digits, and never as a chance of an exam result. Until about 1000 reviews the figures use default parameters and the chip says
// DEFAULT. Review cards come from the Study port; with no engine the orbit is four empty rings and says WAITING with the reason.
import { useMemo, useState } from 'react'
import { Button, Chip, Lamp, TickSlider } from '../../../shared/kit'
import { showsNumber, type LampState } from '../../../shared/lamp'
import { BANDS, type Band, type OrbitTopic } from './model'

export interface RetentionOrbitProps {
  topics: readonly OrbitTopic[]
  /** Ids of the topics with cards due today. */
  dueIds: readonly string[]
  /** The count of cards due today; null while the engine has not said. */
  dueCount: number | null
  state: LampState
  reason: string
  /** Desired retention, 70 to 97 percent. Drawn only when the state may carry a number. */
  retention?: number
  onRetention?: (v: number) => void
  /** True while the figures still use the default parameters. */
  isDefault?: boolean
  onReview?: () => void
}

const S = 220
const C = S / 2
const R: Record<Band, number> = { fresh: 28, settled: 56, fading: 84, due: 104 }
const WORD: Record<Band, string> = { fresh: 'Fresh', settled: 'Settled', fading: 'Fading', due: 'Due' }

export function RetentionOrbit({ topics, dueIds, dueCount, state, reason, retention = 90, onRetention, isDefault = true, onReview }: RetentionOrbitProps) {
  const live = showsNumber(state)
  const [hidden, setHidden] = useState<string | null>(null)
  const due = useMemo(() => new Set(dueIds), [dueIds])
  const placed = useMemo(() => {
    const count: Record<Band, number> = { fresh: 0, settled: 0, fading: 0, due: 0 }
    const per: Record<Band, number> = { fresh: 0, settled: 0, fading: 0, due: 0 }
    for (const t of topics) per[t.band] += 1
    return topics.map((t) => {
      const band: Band = due.has(t.id) ? 'due' : t.band
      const k = count[band]++
      const n = Math.max(1, per[band])
      const ang = ((k / n) * 2 - 0.5) * Math.PI + BANDS.indexOf(band) * 0.7
      return { t, band, x: C + R[band] * Math.cos(ang), y: C + R[band] * Math.sin(ang), hollow: band === 'due' }
    }).filter((p) => p.t.id !== hidden)
  }, [topics, due, hidden])
  const empty = topics.length === 0
  return (
    <figure className="y3-orbit" data-component="retention-orbit" data-state={state}>
      <svg className="y3-orbit-svg" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={empty ? `Four empty orbits, ${reason}` : `Review orbit: ${placed.length} topics on four bands`}>
        {BANDS.map((b) => <circle key={b} className="y3-orbit-ring" data-band={b} cx={C} cy={C} r={R[b]} />)}
        <circle className="y3-orbit-today" cx={C} cy={C} r="7" />
        {placed.map((p) => <circle key={p.t.id} className="y3-planet" data-band={p.band} data-hollow={p.hollow ? 'true' : undefined} cx={p.x} cy={p.y} r="6" />)}
      </svg>
      <div className="y3-orbit-side">
        <ul className="y3-bands" aria-label="Bands, inner to outer">
          {BANDS.map((b) => <li key={b} data-band={b}><i aria-hidden="true" />{WORD[b]}</li>)}
        </ul>
        <p className="y3-orbit-read">
          <span className="y3-orbit-label">Cards due today</span>
          <output className="y3-orbit-num" data-hollow={live && dueCount !== null ? undefined : 'true'}>{live && dueCount !== null ? dueCount : '--'}</output>
          <span className="y3-orbit-lamp"><Lamp state={state} reason={reason} /></span>
        </p>
        {empty && <p className="y3-ascii y3-orbit-empty">{state === 'waiting' ? `Waiting: ${reason}.` : dueCount !== null && dueCount > 0 ? 'Bands arrive with the card engine.' : 'No cards yet. Cards are made from questions you miss or mark keep.'}</p>}
        {!empty && isDefault && <Chip>DEFAULT</Chip>}
        {live && !empty && onRetention && <TickSlider label="Desired retention" min={70} max={97} unit="percent" value={retention} onChange={onRetention} />}
        {live && !empty && onReview && (
          <span className="y3-orbit-acts">
            <Button size="sm" grouped onClick={onReview}>Review today</Button>
            <Button size="sm" grouped onClick={() => setHidden(placed.find((p) => p.hollow)?.t.id ?? null)}>Not today</Button>
          </span>
        )}
      </div>
    </figure>
  )
}
