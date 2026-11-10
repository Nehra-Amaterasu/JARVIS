// LF2 Attendance (plan 4.6): per subject, how many classes of margin, with no taps. The taps live in the left
// column's Classes today (L3); this card only reads what they recorded, so the two never overlap.
// "Behind" is a neutral state: a hollow icon and the words, never red, and below MIN_SAMPLE tapped classes it
// is not said at all (derive.ts marginView).
//
// Three rows, most in need of attention first, then "All N subjects" in a drawer: a long timetable is a list to
// look through, not a column that pushes the Quest card off a 768 px screen.
import { useState } from 'react'
import { Circle, CircleCheck, CircleDashed, CircleDot, type LucideIcon } from 'lucide-react'
import { Button, Card, Drawer, EmptyState } from '../kit'
import { byUrgency, classProgress, marginView, percent, type AttendanceAnswer, type MarginTone, type SubjectRow } from './derive'
import type { Load } from './useLife'

/** Subjects drawn in the card. At 1366x768 the right column holds Quest (about 270 px) and this card in 597 px. */
export const VISIBLE_SUBJECTS = 3

const ICON: Record<MarginTone, LucideIcon> = { none: Circle, few: Circle, ok: CircleCheck, tight: CircleDot, behind: CircleDashed }

export function Attendance({ state, index }: { state: Load<AttendanceAnswer>; index?: number }) {
  const { data: d, error, loading, reload } = state
  const [all, setAll] = useState(false)
  const ok = d && d.status === 'ok'
  const prog = classProgress(d?.today)
  const t = d?.rule.threshold ?? 0.75
  const ordered = d ? byUrgency(d.subjects, t) : []
  const rule = d ? `${Math.round(t * 100)}% ${d.rule.scope === 'overall' ? 'overall' : 'per subject'}, ${d.rule.confirmed ? 'confirmed' : 'assumed'}` : ''
  return (
    <Card
      data-card="LF2"
      title="Attendance"
      kicker="Per subject"
      action={ok && d.subjects.length > 0 ? <span className="ww-life-rule" data-rule="">{rule}</span> : undefined}
      loading={loading && !d}
      error={!d && error ? error : undefined}
      onRetry={() => void reload()}
      index={index}
    >
      {!ok ? (
        d ? <EmptyState title="Attendance is not available." body={d.say} /> : null
      ) : d.subjects.length === 0 ? (
        <EmptyState title="No timetable yet." body="Type the week into Setup, Timetable. Classes are marked in the left column." />
      ) : (
        <div className="ww-life-attbody">
          <ul className="ww-life-att" aria-label="Attendance per subject, most in need of attention first">
            {ordered.slice(0, VISIBLE_SUBJECTS).map((r) => (
              <SubjectLine key={r.subject} r={r} threshold={t} />
            ))}
          </ul>
          <div className="ww-life-attfoot">
            {ordered.length > VISIBLE_SUBJECTS && (
              <Button size="sm" onClick={() => setAll(true)}>
                All {ordered.length} subjects
              </Button>
            )}
            {prog.pending > 0 && (
              <span className="ww-life-rule">
                {prog.pending} of {prog.total} classes today unmarked
              </span>
            )}
          </div>
          <Drawer open={all} onClose={() => setAll(false)} title="Attendance, all subjects">
            <p className="ww-life-rule">
              Rule: {rule}
              {d.rule.confirmed ? '.' : ' until you confirm it in Setup.'} {d.note ?? 'Margin is a buffer for a sick day, not a budget.'}
            </p>
            <ul className="ww-life-att" aria-label="Attendance, all subjects">
              {ordered.map((r) => (
                <SubjectLine key={r.subject} r={r} threshold={t} />
              ))}
            </ul>
          </Drawer>
        </div>
      )}
    </Card>
  )
}

function SubjectLine({ r, threshold }: { r: SubjectRow; threshold: number }) {
  const m = marginView(r, threshold)
  const Icon = ICON[m.tone]
  return (
    <li className="ww-life-attrow" data-tone={m.tone}>
      <Icon size={16} aria-hidden="true" className="ww-life-atticon" />
      <span className="ww-life-attname">{r.name}</span>
      <span className="ww-life-attfig">{r.held ? `${r.attended}/${r.held} · ${percent(r.pct)}` : 'none tapped'}</span>
      <span className="ww-life-attmargin">
        {m.text}
        {m.detail && <span className="ww-life-attdetail"> · {m.detail}</span>}
      </span>
    </li>
  )
}
