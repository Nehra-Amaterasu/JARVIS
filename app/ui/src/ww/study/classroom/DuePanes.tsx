// The three trays of the Due view of the Classroom face: the FILTER (course, open or all, the four counts, when it was read), the
// LIST sorted by due date, and the chosen assignment with its keys, then the latest announcements and the next calendar entries.
// All three are presentational: useDue owns the data and the presses.
//
// What is said and what is not: the work word is Classroom's own (Assigned, Turned in, Returned, Unknown) and "Late" is drawn only
// when the engine says late; neither is a grade, a colour or a judgement. There is no key that turns work in, because Google does not
// let an outside app do it: "Open in Classroom" goes to the page where it happens. A count is drawn only beside the state word of the
// answer it came from, and a list that is waiting says the engine's sentence.
import { useRef } from 'react'
import { Button, Field, Segmented } from '../../../shared/kit'
import { Lamp, readingOf, showsNumber } from '../../../shared/lamp'
import { formatDay, formatStamp } from '../../../shared/stamp'
import type { GcrAnnouncement, GcrAnswer, GcrAssignment, GcrAssignmentsBody, GcrCourse, GcrEvent, GcrWork } from '../adapters/gcrTypes'
import { useBringIntoView } from './Reader'
import { NoticeLine, Pose } from './ShelfPanes'
import { ANNOUNCEMENTS_SHOWN, EVENTS_SHOWN, type Due, type DueShow } from './useDue'

/** Classroom's own words for the four states of his submission, as it reports them. */
export const WORK_WORD: Record<GcrWork, string> = { assigned: 'Assigned', turned_in: 'Turned in', returned: 'Returned', unknown: 'Unknown' }
export const NO_DUE = 'No due date'
export const NO_LINK_SENTENCE = 'The engine gave no Classroom link for this one.'
export const NO_DATE_SENTENCE = 'This assignment has no due date, so there is no default time for a reminder.'
export const TURN_IN_NOTE = 'Turning in happens in Classroom, not here.'

// formatDay and formatStamp live in shared/stamp (Setup's paper sources print the same kind of stamp); re-exported so the Classroom panes and their tests keep one door
export { formatDay, formatStamp }
export function dueText(a: Pick<GcrAssignment, 'due' | 'due_time'>): string {
  return a.due ? formatDay(a.due, a.due_time) : NO_DUE
}
/** Days as a plain count: past days are "past", not a verdict. Null (no due date) draws nothing. */
export function daysText(n: number | null): string {
  if (n === null) return ''
  if (n === 0) return 'today'
  if (n === 1) return '1 day left'
  if (n > 1) return `${n} days left`
  return `${-n} ${n === -1 ? 'day' : 'days'} past`
}

export interface DueFilterProps {
  list: GcrAnswer<GcrAssignmentsBody> | null
  courses: readonly GcrCourse[]
  course: string | null
  onCourse: (id: string | null) => void
  show: DueShow
  onShow: (s: DueShow) => void
}

const SHOWS: { id: DueShow; label: string }[] = [{ id: 'open', label: 'Open' }, { id: 'all', label: 'All' }]

export function DueFilter({ list, courses, course, onCourse, show, onShow }: DueFilterProps) {
  const c = list?.data?.counts ?? null
  const readAt = list?.data?.read_at ?? ''
  const reading = list ? readingOf({ state: list.state, since: list.since, reason: list.reason }) : readingOf({ state: 'waiting', reason: 'asking the engine' })
  return (
    <div className="cr-due-filter" data-component="classroom-due-filter">
      <Field kind="select" label="Course" value={course ?? ''} onChange={(e) => onCourse(e.target.value || null)}>
        <option value="">Every course</option>
        {courses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Field>
      <Segmented<DueShow> variant="choice" label="Show" value={show} onChange={onShow} options={SHOWS} />
      <p className="cr-state" data-component="classroom-due-state"><Lamp reading={reading} />{reading.reason && <span className="cr-why">{reading.reason}</span>}</p>
      {list && showsNumber(list.state) && c && (
        <dl className="cr-due-counts" aria-label="Counts" data-component="classroom-due-counts">
          <div><dt>open</dt><dd>{c.open}</dd></div>
          <div><dt>turned in</dt><dd>{c.turned_in}</dd></div>
          <div><dt>late</dt><dd>{c.late}</dd></div>
          <div><dt>no due date</dt><dd>{c.no_due_date}</dd></div>
        </dl>
      )}
      {list && showsNumber(list.state) && readAt && <p className="cr-note" data-component="classroom-due-read">Read at <span className="cr-due-mono">{formatStamp(readAt)}</span></p>}
    </div>
  )
}

export function DueList({ items, chosen, onChoose }: { items: readonly GcrAssignment[]; chosen: string | null; onChoose: (id: string) => void }) {
  return (
    <ul className="cr-rows" aria-label="Due" data-component="classroom-due-list">
      {items.map((a) => (
        <li key={a.id} className="cr-file cr-due-row" data-assignment={a.id}>
          <button type="button" className="cr-pick" aria-pressed={chosen === a.id} onClick={() => onChoose(a.id)}>
            <span className="cr-name">{a.title}</span>
            <span className="cr-fine">{a.course_name}</span>
            <span className="cr-fine cr-due-when">
              <span className="cr-due-mono">{dueText(a)}</span>
              {a.days_left !== null && <span className="cr-due-mono cr-due-days">{daysText(a.days_left)}</span>}
            </span>
            <span className="cr-fine cr-due-wordrow">
              <span className="cr-due-work" data-work={a.work}>{WORK_WORD[a.work]}</span>
              {a.late && <span className="cr-tag cr-due-late">Late</span>}
              {a.reminder && <span className="cr-fine cr-due-set">Reminder set</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function AnnouncementList({ r }: { r: GcrAnswer<{ items: GcrAnnouncement[] }> | null }) {
  const reading = r ? readingOf({ state: r.state, reason: r.reason }) : readingOf({ state: 'waiting', reason: 'asking the engine' })
  const items = r?.data?.items ?? []
  const rest = items.length - ANNOUNCEMENTS_SHOWN
  return (
    <section className="cr-due-block" aria-label="Announcements" data-component="classroom-announcements">
      <h4 className="cr-due-h">Announcements</h4>
      <p className="cr-state"><Lamp reading={reading} />{reading.reason && <span className="cr-why">{reading.reason}</span>}</p>
      {r && r.state === 'live' && items.length > 0 && (
        <ul className="cr-due-plain">
          {items.slice(0, ANNOUNCEMENTS_SHOWN).map((x) => (
            <li key={x.id}>
              <span className="cr-fine">{[x.course_name, x.posted ? formatStamp(x.posted) : ''].filter(Boolean).join(', ')}</span>
              <span className="cr-due-text">{x.text}</span>
            </li>
          ))}
          {rest > 0 && <li className="cr-fine">{`and ${rest} more`}</li>}
        </ul>
      )}
    </section>
  )
}

function CalendarList({ r }: { r: GcrAnswer<{ items: GcrEvent[] }> | null }) {
  const reading = r ? readingOf({ state: r.state, reason: r.reason }) : readingOf({ state: 'waiting', reason: 'asking the engine' })
  const items = r?.data?.items ?? []
  const rest = items.length - EVENTS_SHOWN
  return (
    <section className="cr-due-block" aria-label="Calendar" data-component="classroom-calendar">
      <h4 className="cr-due-h">Calendar</h4>
      <p className="cr-state"><Lamp reading={reading} />{reading.reason && <span className="cr-why">{reading.reason}</span>}</p>
      {r && r.state === 'live' && items.length > 0 && (
        <ul className="cr-due-plain">
          {items.slice(0, EVENTS_SHOWN).map((x) => (
            <li key={x.id}>
              <span className="cr-due-text">{x.title}</span>
              <span className="cr-fine cr-due-mono">{x.all_day ? `${formatDay(x.start)}, all day` : formatStamp(x.start)}</span>
            </li>
          ))}
          {rest > 0 && <li className="cr-fine">{`and ${rest} more`}</li>}
        </ul>
      )}
    </section>
  )
}

export function DueDetail({ due }: { due: Due }) {
  const { chosen: a, notice, busy } = due
  const card = useRef<HTMLDivElement>(null)
  useBringIntoView(card, a?.id ?? '')
  return (
    <div className="cr-reader cr-due-detail" ref={card} data-component="classroom-due-detail" data-assignment={a?.id}>
      <NoticeLine notice={notice} />
      {!a
        ? <Pose title="Choose an assignment to see it here." reading={readingOf({ state: 'waiting', reason: 'no assignment chosen' })} />
        : (
          <header className="cr-card">
            <h3 className="cr-card-title">{a.title}</h3>
            <p className="cr-note">{a.course_name}</p>
            <dl className="cr-due-facts">
              <div><dt>Due</dt><dd className="cr-due-mono">{dueText(a)}</dd></div>
              {a.days_left !== null && <div><dt>Days</dt><dd className="cr-due-mono">{daysText(a.days_left)}</dd></div>}
              <div><dt>Work</dt><dd>{WORK_WORD[a.work]}{a.late && <span className="cr-tag cr-due-late">Late</span>}</dd></div>
            </dl>
            <div className="cr-keys">
              <Button size="sm" grouped onClick={() => void due.open(a)} disabledReason={a.link ? undefined : NO_LINK_SENTENCE}>Open in Classroom</Button>
              {!a.reminder && <Button size="sm" grouped onClick={() => void due.remind(a)} disabledReason={!a.due ? NO_DATE_SENTENCE : busy ? 'Working.' : undefined}>Remind me</Button>}
              {a.reminder && <Button size="sm" grouped onClick={() => void due.removeReminder(a)} disabledReason={busy ? 'Working.' : undefined}>Remove reminder</Button>}
            </div>
            {a.reminder && <p className="cr-note" data-component="classroom-reminder">Reminder due <span className="cr-due-mono">{formatStamp(a.reminder.due)}</span></p>}
            <p className="cr-fine">{TURN_IN_NOTE}</p>
          </header>
        )}
      {a && (
        <>
          <AnnouncementList r={due.announcements} />
          <CalendarList r={due.calendar} />
        </>
      )}
    </div>
  )
}
