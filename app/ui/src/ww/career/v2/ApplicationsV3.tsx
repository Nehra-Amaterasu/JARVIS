// Career / Applications under the v3 look (R7, 25 Nov). The owner: "career is really confusing to navigate through". What confused: three
// names for one thing (Runway, flight board, pipeline), five stage columns of dots on every row, "WAITING: unconfirmed" printed on every
// row, two keys that each looked like the main one, and no plain answer to "what do I do next".
//
// One path instead: tray 1 is one list, soonest closing date first, a row = days left, the name, the programme, ONE stage chip, the
// next step as a sentence; choosing a row fills tray 2 (the stage as a five-step stepper he can move forward or back, the next step with
// its key, the closing date with its confirm action, notes and links); tray 3 is what lies ahead (the soonest dated thing, the next 120
// days, the five stage counts, the campaigns). The one main key of the view is "Add application". Nothing is removed: every function the
// older frame had (set a stage, confirm a date, do the next step, add, campaigns, the date stamp) is still here.
import { useContext, type ReactNode } from 'react'
import type { Application } from '../../../germoney/game/plan'
import { Button, Field } from '../../../shared/kit'
import { PeekCtx } from '../../../shell/v3/Sheets'
import { STAGE_WORD, STEPPER, inDays, nextStep, type Due } from '../model'
import { appCellKey } from './model'
import { STALE_WHY, cellReadFor, stampText, type Cell } from './store'
import { Stamped } from './ui'

/** A sentence from a fragment: "decide whether to apply" -> "Decide whether to apply." */
export const sentence = (t: string): string => {
  const s = t.trim()
  return s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}` : ''
}

/** The big number of a row and its unit word: days left, or why there is none. */
export function daysFace(a: Application): { big: string; unit: string } {
  const n = a.days_left
  if (n === null) return { big: 'no date', unit: '' }
  if (n < 0) return { big: 'closed', unit: '' }
  if (n === 0) return { big: 'today', unit: 'closes' }
  return { big: String(n), unit: n === 1 ? 'day left' : 'days left' }
}

/** The one quiet tag a row may carry about its closing date: said once, and only when there is something to say. */
export function dateTag(a: Application, cells: Record<string, Cell>): string {
  if (!a.closes || a.status === 'not_eligible') return ''
  const read = cellReadFor(cells, appCellKey(a.id), a.closes)
  return read.state === 'live' ? '' : read.stale ? 'date changed, check it' : 'date not confirmed'
}

// ---------------------------------------------------------------------------------------------- tray 1: the list

export function ApplicationList({ rows, cells, selected, onPick }: { rows: Application[]; cells: Record<string, Cell>; selected: string | null; onPick: (id: string) => void }) {
  // on the phone the second tray is a sheet behind a pill; choosing a row opens it, so the press has a visible answer (the shell's own
  // 700 px breakpoint). On the laptop the tray is already beside the list.
  const peek = useContext(PeekCtx)
  const pick = (id: string) => {
    onPick(id)
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 43.75rem)').matches) peek?.setOpen(2)
  }
  return (
    <ul className="t2-apps" aria-label="Applications, soonest closing date first">
      {rows.map((a) => {
        const face = daysFace(a)
        const tag = dateTag(a, cells)
        const next = a.status === 'not_eligible' ? `Ruled out: ${a.reason || 'not eligible'}.` : sentence(`next: ${nextStep(a).text}`)
        return (
          <li key={a.id} data-row={a.id}>
            <button type="button" className="t2-app" aria-pressed={selected === a.id} onClick={() => pick(a.id)}>
              <span className="t2-app-days" data-word={/^\d+$/.test(face.big) ? undefined : 'true'} data-closed={a.days_left !== null && a.days_left < 0 ? 'true' : undefined}>
                <b>{face.big}</b>
                {face.unit && <small>{face.unit}</small>}
              </span>
              <span className="t2-app-body">
                <b className="t2-app-name">{a.org}</b>
                <span className="t2-app-prog">{a.programme || 'No programme named'}</span>
                <span className="t2-app-next">{next}</span>
                {tag && <small className="t2-app-tag">{tag}</small>}
              </span>
              <span className="t2-chip" data-stage={a.status}>{STAGE_WORD[a.status]}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------- tray 2: this application

const OUTCOMES = ['idea', 'preparing', 'applied', 'interview', 'offer', 'rejected', 'not_eligible'] as const

/** What the next-step key does, in words, so the key is never a surprise. */
const DOES: Record<string, string> = {
  decide: 'Moves it to Preparing.',
  prep: 'Ticks that item off.',
}

export interface ThisActions {
  setStatus: (id: string, s: Application['status']) => void
  confirm: (id: string, closes: string) => void
  unconfirm: (id: string) => void
  nextFor: (a: Application) => void
}

export function ThisApplication({ a, cells, actions }: { a: Application | null; cells: Record<string, Cell>; actions: ThisActions }) {
  if (!a) return <p className="t2-quiet">Add an application and its next step, stage and closing date show here.</p>
  const at = STEPPER.indexOf(a.status as (typeof STEPPER)[number])
  const next = nextStep(a)
  const read = cellReadFor(cells, appCellKey(a.id), a.closes ?? '')
  const pressable = next.kind === 'decide' || next.kind === 'prep' || next.kind === 'submit'
  const does = next.kind === 'submit' ? (a.url ? 'Opens its page. Mark it Applied once it is sent.' : 'Marks it Applied.') : DOES[next.kind] ?? ''
  const back = at > 0 ? STEPPER[at - 1] : null
  const fwd = at >= 0 && at < STEPPER.length - 1 ? STEPPER[at + 1] : null
  const none = at < 0 ? `Marked ${STAGE_WORD[a.status]}.` : undefined
  return (
    <div className="t2-this" data-app={a.id}>
      <div>
        <h3 className="t2-v3-name">{a.org}</h3>
        <p className="t2-quiet">{a.programme || 'No programme named'}</p>
      </div>

      <section className="t2-this-sec" aria-label="Stage">
        <h4 className="t2-v3-h">Stage</h4>
        <ol className="t2-stepper" aria-label={`${a.org}: stage${at >= 0 ? `, step ${at + 1} of ${STEPPER.length}, ${STAGE_WORD[a.status]}` : `, ${STAGE_WORD[a.status]}`}`}>
          {STEPPER.map((s, i) => (
            <li key={s}>
              <button type="button" className="t2-step" data-state={at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo'} aria-pressed={i === at} aria-label={`${a.org}: ${STAGE_WORD[s]}`} onClick={() => actions.setStatus(a.id, s)}>
                <span aria-hidden="true">{at >= 0 && i < at ? '✓' : i === at ? '●' : '○'}</span>
                <span className="t2-step-word">{STAGE_WORD[s]}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="t2-this-keys">
          <Button size="md" disabledReason={back ? undefined : none ?? 'It is at the first step.'} onClick={() => back && actions.setStatus(a.id, back)}>{back ? `Back to ${STAGE_WORD[back]}` : 'Back'}</Button>
          <Button size="md" disabledReason={fwd ? undefined : none ?? 'It is at the last step.'} onClick={() => fwd && actions.setStatus(a.id, fwd)}>{fwd ? `On to ${STAGE_WORD[fwd]}` : 'On'}</Button>
        </div>
        <Field label="Or mark the outcome" kind="select" value={a.status} onChange={(e) => actions.setStatus(a.id, e.target.value as Application['status'])}>
          {OUTCOMES.map((s) => <option key={s} value={s}>{STAGE_WORD[s]}</option>)}
        </Field>
      </section>

      <section className="t2-this-sec" aria-label="Next step">
        <h4 className="t2-v3-h">Next step</h4>
        <p className="t2-this-next">{a.status === 'not_eligible' ? `Ruled out: ${a.reason || 'not eligible'}.` : sentence(next.text)}</p>
        {a.status !== 'not_eligible' && (
          <>
            <Button size="lg" disabledReason={pressable ? undefined : next.kind === 'closed' ? 'Nothing to do.' : `Nothing to press: ${next.text}.`} onClick={() => actions.nextFor(a)}>Do this step</Button>
            {pressable && does && <p className="t2-quiet">{does}</p>}
          </>
        )}
      </section>

      <section className="t2-this-sec" aria-label="Closing date">
        <h4 className="t2-v3-h">Closing date</h4>
        <Stamped label={`Closing date of ${a.org}`} read={a.closes ? read : { state: 'waiting', value: '', on: null }} fmt={(v) => stampText(v)} why={a.closes ? (read.stale ? STALE_WHY : 'not confirmed') : 'no date yet'} />
        {a.closes && (read.state === 'live'
          ? <Button size="md" onClick={() => actions.unconfirm(a.id)}>Take the stamp off</Button>
          : <Button size="md" onClick={() => actions.confirm(a.id, a.closes!)}>I checked this date today</Button>)}
      </section>

      {(a.url || a.notes || a.stipend || a.requirements.length > 0) && (
        <section className="t2-this-sec" aria-label="Notes and links">
          <h4 className="t2-v3-h">Notes and links</h4>
          {a.url && <p className="t2-quiet"><a href={a.url} target="_blank" rel="noreferrer">Its page</a></p>}
          {a.stipend && <p className="t2-quiet">Pay: {a.stipend}</p>}
          {a.notes && <p className="t2-quiet">{a.notes}</p>}
          {a.requirements.length > 0 && <ul className="t2-this-list">{a.requirements.map((r) => <li key={r}>{r}</li>)}</ul>}
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- tray 3: ahead

export interface AheadProps {
  top: Due | undefined
  /** The up-next date as a stamped cell, with the key to confirm it. */
  topDate: ReactNode
  onOpenTop: () => void
  onDoTop: () => void
  /** The strip of the next 120 days and the five stage counts (the flight board's drawing). */
  board: ReactNode
  campaigns: ReactNode
}

export function Ahead({ top, topDate, onOpenTop, onDoTop, board, campaigns }: AheadProps) {
  return (
    <div className="t2-ahead">
      <section className="t2-this-sec" aria-label="Closing soonest">
        <h3 className="t2-v3-h">Closing soonest</h3>
        {top ? (
          <>
            <p className="t2-upline"><b>{top.what}</b><span>{inDays(top.days)}. {top.sub}.</span></p>
            {topDate}
            {top.kind === 'application'
              ? <Button size="md" onClick={onOpenTop}>Open this application</Button>
              : <Button size="md" onClick={onDoTop}>Do next step</Button>}
          </>
        ) : <p className="t2-quiet">Nothing is dated ahead. Add an application with its closing date.</p>}
      </section>
      <section className="t2-this-sec" aria-label="The next 120 days">
        <h3 className="t2-v3-h">Closing dates in the next 120 days</h3>
        <p className="t2-quiet">Each mark is one closing date. A dashed mark is a date you have not confirmed. The five counts are how many applications are at each stage.</p>
        {board}
      </section>
      <section className="t2-this-sec" aria-label="Campaigns">
        <h3 className="t2-v3-h">Campaigns</h3>
        {campaigns}
      </section>
    </div>
  )
}
