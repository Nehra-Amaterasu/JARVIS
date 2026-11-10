/**
 * L3: today's classes, three taps each (P present, A absent, C cancelled); a second tap on the lit one
 * clears it. This is the card the render-count test watches: a tap changes the attendance slice only.
 *
 * Why not the kit's TapGroup: its buttons carry no per-option accessible name, and a class tap must be
 * read as "<subject> at <time>: mark present" (plan 8.1). Same Button, same 44 px, same pressed fill.
 *
 * Fit: a tap target is 44 px wide and three of them need 140 px of the 200 px inside the card, so the
 * name takes a line of its own above the time and the taps (a row is about 66 px, not 44). The column
 * scrolls instead of shrinking a target. Rows past the budget are counted ("+N later today"), not hidden.
 */
import { memo, useRef } from 'react'
import { Button, Card, EmptyState, Section } from '../kit'
import { useBudget } from './hooks'
import { classLabel, buildL3, type ClassStatus, type L3Row } from './model'
import { bump } from './renders'
import { useLeft } from './store'

const TAPS: { s: ClassStatus; letter: string; word: string }[] = [
  { s: 'present', letter: 'P', word: 'present' },
  { s: 'absent', letter: 'A', word: 'absent' },
  { s: 'cancelled', letter: 'C', word: 'cancelled' },
]

function ClassRow({ r }: { r: L3Row }) {
  return (
    <li className="ww-cls" data-status={r.status ?? undefined}>
      <span className="ww-cls-name">
        {r.name}
        {r.lab && <em> lab</em>}
      </span>
      <span className="ww-cls-when">{r.when}</span>
      <span className="ww-cls-taps" role="group" aria-label={`${r.name} at ${r.when}`}>
        {TAPS.map((t) => (
          <Button
            key={t.s}
            grouped
            size="sm"
            aria-pressed={r.status === t.s}
            data-active={r.status === t.s ? 'true' : undefined}
            aria-label={classLabel(r, t.s)}
            title={t.word}
            className="ww-cls-tap"
            onClick={() => void useLeft.getState().tapClass(r.id, r.status === t.s ? 'clear' : t.s)}
          >
            {t.letter}
          </Button>
        ))}
      </span>
    </li>
  )
}

export const L3Card = memo(function L3Card() {
  bump('L3')
  const ref = useRef<HTMLDivElement>(null)
  const classes = useLeft((s) => s.classes)
  const phase = useLeft((s) => s.phase.attendance)
  const { classRows } = useBudget(ref)
  const m = buildL3({ classes })
  const shown = m.rows.slice(0, classRows)
  const later = m.rows.length - shown.length
  return (
    <Section id="L3" hint="Today's classes with present, absent and cancelled taps" className="ww-left-sec">
      <Card
        data-card="L3"
        title={m.title}
        loading={classes === null && phase === 'loading'}
        error={classes === null && phase === 'error' ? 'Could not read the classes.' : undefined}
        onRetry={() => void useLeft.getState().loadSlice('attendance')}
        className="ww-l3"
      >
        <div ref={ref}>
          {m.empty ? (
            <EmptyState title={m.empty} />
          ) : (
            <ul className="ww-cls-list" aria-label="Today's classes">
              {shown.map((r) => (
                <ClassRow key={r.id} r={r} />
              ))}
            </ul>
          )}
          {later > 0 && <p className="ww-left-meta">+{later} later today</p>}
        </div>
      </Card>
    </Section>
  )
})
