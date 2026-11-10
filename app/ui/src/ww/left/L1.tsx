/**
 * L1: Countdown in exam season, Horizon in normal season (plan 3.3 state rules, 4.1). It is ONE card whose
 * title and body swap; the element is never remounted and its minimum height does not change, so the
 * column does not jump when the season pill is moved (left.css `.ww-l1`).
 *
 * Countdown: the nearest sitting, the CIE / End / Other counts, the next sittings earliest first with
 * "+N more" instead of a cut, ONE "dates tentative" line, and Edit, which opens the date sheet (O1).
 */
import { memo } from 'react'
import { Button, Card, Section } from '../kit'
import { openOverlay } from '../frame/overlayRegistry'
import { buildL1 } from './model'
import { bump } from './renders'
import { useHorizon } from './hooks'
import { useLeft } from './store'

export const L1Card = memo(function L1Card({ leftTop }: { leftTop: 'countdown' | 'horizon' }) {
  bump('L1')
  const papers = useLeft((s) => s.papers)
  const phase = useLeft((s) => s.phase.exams)
  const horizon = useHorizon()
  const m = buildL1({ season: { left_top: leftTop, now_card: 'now' }, papers, horizon })
  const waiting = leftTop === 'countdown' && papers === null
  return (
    <Section id="L1" hint="The next sitting and how many are ahead (exam season), or the next application (normal season)" className="ww-left-sec">
      <Card
        data-card="L1"
        title={m.title}
        loading={waiting && phase === 'loading'}
        error={waiting && phase === 'error' ? 'Could not read the date sheet.' : undefined}
        onRetry={() => void useLeft.getState().loadSlice('exams')}
        className="ww-l1"
        action={
          m.variant === 'countdown' ? (
            <Button size="sm" onClick={() => openOverlay('date')} aria-label="Edit the date sheet">
              Edit
            </Button>
          ) : undefined
        }
      >
        <p className="ww-left-head">{m.headline}</p>
        {m.variant === 'countdown' ? (
          <>
            {m.counts && (
              <p className="ww-left-meta" aria-label="Papers ahead by kind">
                CIE {m.counts.cie} · End {m.counts.end} · Other {m.counts.other}
              </p>
            )}
            {m.rows.length > 0 && (
              <ul className="ww-l1-rows" aria-label="Later sittings">
                {m.rows.map((r) => (
                  <li key={r.id}>
                    <span className="ww-l1-name">{r.title}</span>
                    <span className="ww-left-meta">{r.when}</span>
                  </li>
                ))}
              </ul>
            )}
            {m.more > 0 && <p className="ww-left-meta">+{m.more} more</p>}
            {m.tentative && <p className="ww-left-note">Dates tentative until the circular.</p>}
          </>
        ) : (
          <>
            {m.step && <p className="ww-left-meta">First step: {m.step}</p>}
            {m.rung && <p className="ww-left-meta">Goal this week: {m.rung}</p>}
          </>
        )}
      </Card>
    </Section>
  )
})
