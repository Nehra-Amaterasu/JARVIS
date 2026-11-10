// LF2 Attendance (plan 4.6): per subject, how many classes of margin, with no taps. The taps live in the left
// column's Classes today (L3); this card only reads what they recorded, so the two never overlap.
// "Behind" is a neutral state: a hollow icon and the words, never red, and below MIN_SAMPLE tapped classes it
// is not said at all (derive.ts marginView).
import { useState } from 'react'
import { Circle, CircleCheck, CircleDashed, CircleDot, type LucideIcon } from 'lucide-react'
import { Button, Card, Drawer, EmptyState } from '../kit'
import { classProgress, marginView, percent, type AttendanceAnswer, type MarginTone, type SubjectRow } from './derive'
import type { Load } from './useLife'

/** Subjects drawn in the card. Five rows keep the right column inside one laptop screen under the Quest card. */
export const VISIBLE_SUBJECTS = 5

const ICON: Record<MarginTone, LucideIcon> = { none: Circle, few: Circle, ok: CircleCheck, tight: CircleDot, behind: CircleDashed }

export function Attendance({ state, index }: { state: Load<AttendanceAnswer>; index?: number }) {
  const { data: d, error, loading, reload } = state
  const [all, setAll] = useState(false)
  const ok = d && d.status === 'ok'
  const prog = classProgress(d?.today)
  const t = d?.rule.threshold ?? 0.75
  return (
    <Card data-card="LF2" title="Attendance" kicker="Per subject" loading={loading && !d} error={!d && error ? error : undefined} onRetry={() => void reload()} index={index}>
      {!ok ? (
        d ? <EmptyState title="Attendance is not available." body={d.say} /> : null
      ) : d.subjects.length === 0 ? (
        <EmptyState title="No timetable yet." body="Type the week into Setup, Timetable. Classes are marked in the left column." />
      ) : (
        <div className="ww-life-attbody">
          <p className="ww-life-rule" data-rule="">
            Rule: {Math.round(t * 100)}% {d.rule.scope === 'overall' ? 'overall' : 'per subject'} ({d.rule.confirmed ? 'confirmed' : 'assumed until you confirm it in Setup'}).
            {prog.total > 0 && ` ${prog.pending} of ${prog.total} classes today are unmarked.`}
          </p>
          <ul className="ww-life-att" aria-label="Attendance per subject">
            {d.subjects.slice(0, VISIBLE_SUBJECTS).map((r) => (
              <SubjectLine key={r.subject} r={r} threshold={t} />
            ))}
          </ul>
          {d.subjects.length > VISIBLE_SUBJECTS && (
            <Button size="sm" className="ww-life-all" onClick={() => setAll(true)}>
              All {d.subjects.length} subjects
            </Button>
          )}
          <p className="ww-life-rule">{d.note ?? 'Margin is a buffer for a sick day, not a budget.'}</p>
          <Drawer open={all} onClose={() => setAll(false)} title="Attendance, all subjects">
            <ul className="ww-life-att" aria-label="Attendance, all subjects">
              {d.subjects.map((r) => (
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
      <span className="ww-life-attfig">
        {r.held ? `${r.attended}/${r.held} · ${percent(r.pct)}` : 'none tapped'}
      </span>
      <span className="ww-life-attmargin">
        {m.text}
        {m.detail && <span className="ww-life-attdetail"> · {m.detail}</span>}
      </span>
    </li>
  )
}
