/**
 * L4: the day's counters, three tiles to a row, one tap adds one. "Undo last tap" takes the last add back
 * (a tile is 61 px wide at the 248 px column, so a minus button per tile does not fit). The number rolls
 * through the kit's Stat; a tile with no number from the server says "not measured yet", never 0.
 */
import { memo, useRef } from 'react'
import { WAITING_DEFAULT, Button, Card, COUNTED, EmptyState, Section, Stat } from '../kit'
import { switchWorkspace } from '../frame/navigate'
import { useBudget } from './hooks'
import { buildL4 } from './model'
import { bump } from './renders'
import { useLeft } from './store'

export const L4Card = memo(function L4Card() {
  bump('L4')
  const ref = useRef<HTMLDivElement>(null)
  const counters = useLeft((s) => s.counters)
  const phase = useLeft((s) => s.phase.life)
  const last = useLeft((s) => s.lastCount)
  const { tiles } = useBudget(ref)
  const m = buildL4({ counters })
  const shown = m.tiles.slice(0, tiles)
  const more = m.tiles.length - shown.length
  return (
    <Section id="L4" hint="The day's counters, one tap to add one" className="ww-left-sec">
      <Card
        data-card="L4"
        title={m.title}
        loading={counters === null && phase === 'loading'}
        error={counters === null && phase === 'error' ? 'Could not read the counters.' : undefined}
        onRetry={() => void useLeft.getState().loadSlice('life')}
        className="ww-l4"
      >
        <div ref={ref}>
          {m.empty ? (
            <EmptyState title={m.empty} />
          ) : (
            <ul className="ww-ctr-grid" aria-label="Counters">
              {shown.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="ww-ctr ww-tap"
                    aria-label={`${t.name}: ${t.value === null ? 'not measured yet' : `${t.value} today`}. Add one.`}
                    onClick={() => void useLeft.getState().tapCount(t.id, 1)}
                  >
                    <Stat label={t.name} value={t.value} reading={t.value === null ? WAITING_DEFAULT : COUNTED} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {more > 0 && (
            <p className="ww-left-meta">
              +{more} more in{' '}
              <button type="button" className="ww-linkbtn ww-tap" onClick={() => void switchWorkspace('life')}>
                Life
              </button>
            </p>
          )}
          {last && (
            <Button size="sm" onClick={() => void useLeft.getState().tapCount(last, -1)}>
              Undo last tap
            </Button>
          )}
        </div>
      </Card>
    </Section>
  )
})
