// O1 Date sheet (plan 4.13): one card per paper, every field labelled in words, dates and goals editable.
// It edits the SAME `exams` draft as Setup > Dates (setup/saveModel.ts), so "Save 2 changes" here and the
// dirty dot on the Setup page are one fact. Primary: Save N changes when something changed, else none (Close only).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePlan } from '../../germoney/game/plan'
import { EMPTY } from '../../germoney/ui'
import { Button, Field, IconButton, PrimaryButton } from '../kit'
import { registerOverlay, closeOverlay } from '../frame/overlayRegistry'
import { useSetup } from '../setup/saveModel'
import { PagerBar, usePaged } from '../setup/pager'
import type { ExamRow } from '../setup/inputs'
import './overlays.css'

const KINDS: [NonNullable<ExamRow['kind']>, string][] = [['end_sem', 'End-sem'], ['backlog', 'Backlog'], ['cie', 'CIE'], ['other', 'Other']]
const kindLabel = (k?: string) => KINDS.find(([id]) => id === k)?.[1] ?? 'Other'

/** How many papers differ from what is saved: a changed row, a new row and a removed row each count once.
 *  Rows are matched by content, not by position, so removing the first of three papers is one change, not three. */
export function countChanges(base: ExamRow[], now: ExamRow[]): number {
  const left = base.map((r) => JSON.stringify(r))
  let added = 0
  for (const r of now) {
    const k = JSON.stringify(r)
    const at = left.indexOf(k)
    if (at >= 0) left.splice(at, 1)
    else added++
  }
  // what is left in `left` was removed or edited; an edit is one removed plus one added, which is one change
  return Math.max(added, left.length)
}


/** The unit list as the person types it. Kept as text so a comma can be typed (re-reading "1," from the numbers would
 *  swallow it); the numbers are parsed on every key and the text is re-read only when the list changes from outside. */
const parseUnits = (t: string) => t.split(/[,\s]+/).map(Number).filter((n) => n > 0)
function UnitsField({ units, onUnits }: { units: number[]; onUnits: (u: number[]) => void }) {
  const [text, setText] = useState(units.join(', '))
  const mine = useRef(units.join(','))
  useEffect(() => {
    if (units.join(',') !== mine.current) { mine.current = units.join(','); setText(units.join(', ')) }
  }, [units])
  return (
    <Field label="Units covered" hint="Numbers, commas. Empty is all." value={text}
      onChange={(e) => { const u = parseUnits(e.target.value); setText(e.target.value); mine.current = u.join(','); onUnits(u) }} />
  )
}

export function DateSheet() {
  const load = useSetup((s) => s.load)
  const refresh = useSetup((s) => s.refresh)
  const base = useSetup((s) => (s.base.exams as ExamRow[] | undefined) ?? EMPTY) as ExamRow[]
  const draft = useSetup((s) => s.draft.exams as ExamRow[] | undefined)
  const edit = useSetup((s) => s.edit)
  const discard = useSetup((s) => s.discard)
  const saveAll = useSetup((s) => s.saveAll)
  const saving = useSetup((s) => s.saving)
  const report = useSetup((s) => s.report)
  const subjects = usePlan((s) => s.academics?.subjects) ?? EMPTY
  // The owner's rule is that the sheet fits without scrolling, however many papers there are. Two cards a page fitted until the
  // card became four wrapping rows on 27 Nov (a card is about 250 px; two overflowed the 1366x768 sheet by 319 px), so the page
  // size is measured: two while two fit, one when they do not. 'size' goes back to two on a resize, then is measured again.
  const rowsNow = (draft ?? base).length
  const [size, setSize] = useState(2)
  const pg = usePaged(rowsNow, size)
  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const sc = bodyRef.current?.closest('.ww-sheet-body') as HTMLElement | null
    if (size > 1 && sc && sc.scrollHeight - sc.clientHeight > 1) setSize(1)
  })
  useEffect(() => {
    const again = () => setSize(2)
    window.addEventListener('resize', again)
    return () => window.removeEventListener('resize', again)
  }, [])
  useEffect(() => {
    if (load !== 'ready') void refresh()
    void usePlan.getState().loadAcademics()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (load === 'loading') return <p className="ov-note" data-overlay="date">Reading the date sheet.</p>
  if (load === 'unavailable') {
    return (
      <div className="ov-body" data-overlay="date">
        <p className="ov-note">The date sheet did not load, so it is not editable. Nothing was changed.</p>
        <Button onClick={() => void refresh()}>Retry</Button>
      </div>
    )
  }
  const rows = draft ?? base
  const changes = draft ? countChanges(base, draft) : 0
  const set = (next: ExamRow[]) => edit('exams', next)
  const patch = (i: number, p: Partial<ExamRow>) => set(rows.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const tentative = rows.filter((r) => r.approx).length

  return (
    <div className="ov-body" ref={bodyRef} data-overlay="date" data-primary-none={changes === 0 ? '' : undefined}>
      {pg.slice(rows).map(({ item: r, index: i }) => {
        const name = subjects.find((s) => s.id === r.subject)?.name ?? (r.title || 'New paper')
        return (
          <section key={i} className="ov-paper" data-paper={i} aria-label={`${name} ${kindLabel(r.kind)}`}>
            <header className="ov-paper-head">
              <div className="ov-paper-top">
                <h3 className="ov-paper-title">{`${name}  ${kindLabel(r.kind)}`}</h3>
                <IconButton label={`Remove ${name} ${kindLabel(r.kind)}`} size="sm" onClick={() => set(rows.filter((_, j) => j !== i))}>
                  <Trash2 size={16} aria-hidden="true" />
                </IconButton>
              </div>
              <div className="ov-paper-ticks">
                <label className="ov-check">
                  <input type="checkbox" checked={!!r.approx} onChange={(e) => patch(i, { approx: e.target.checked })} />
                  Tentative
                </label>
                <label className="ov-check">
                  <input type="checkbox" checked={!!r.may_miss} onChange={(e) => patch(i, { may_miss: e.target.checked })} />
                  I may not sit this paper
                </label>
              </div>
            </header>
            {/* Four rows that wrap on their own (flex-wrap, not a six-column grid): a field never shares a column with the
                next one's label, so nothing can run under its neighbour at 360 px or at 800 px (the 25 Nov overlap). */}
            <div className="ov-row" data-row="subject">
              <div className="ov-f ov-f-wide">
                <Field label="Subject" kind="select" value={r.subject} onChange={(e) => patch(i, { subject: e.target.value, title: subjects.find((s) => s.id === e.target.value)?.name ?? r.title })}>
                  <option value="">choose a subject</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {r.subject && !subjects.some((s) => s.id === r.subject) && <option value={r.subject}>{r.subject}</option>}
                </Field>
              </div>
              <div className="ov-f">
                <Field label="Paper" kind="select" value={r.kind ?? 'other'} onChange={(e) => patch(i, { kind: e.target.value as ExamRow['kind'], max: r.max ?? (e.target.value === 'cie' ? 20 : 60) })}>
                  {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </Field>
              </div>
            </div>
            <div className="ov-row" data-row="when">
              <div className="ov-f ov-f-wide"><Field label="Date" kind="date" value={r.date} onChange={(e) => patch(i, { date: e.target.value })} /></div>
              <div className="ov-f ov-f-time"><Field label="Starts" kind="time" value={r.start ?? ''} onChange={(e) => patch(i, { start: e.target.value || null })} /></div>
              <div className="ov-f ov-f-time"><Field label="Ends" kind="time" value={r.end ?? ''} onChange={(e) => patch(i, { end: e.target.value || null })} /></div>
            </div>
            <div className="ov-row" data-row="aim">
              <div className="ov-f">
                <Field label="How hard" kind="select" value={r.difficulty ?? 'normal'} onChange={(e) => patch(i, { difficulty: e.target.value as ExamRow['difficulty'] })}>
                  <option value="easy">easy</option><option value="normal">normal</option><option value="hard">hard</option>
                </Field>
              </div>
              <div className="ov-aim ov-f ov-f-wide" role="group" aria-label="Aim for">
                <Field label="Aim for" kind="number" min={0} max={r.max ?? 20} value={r.target ?? ''} onChange={(e) => patch(i, { target: e.target.value === '' ? null : Number(e.target.value) })} />
                <span className="ov-of" aria-hidden="true">of</span>
                <Field label="Out of" kind="number" min={1} value={r.max ?? ''} onChange={(e) => patch(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
            </div>
            <div className="ov-row" data-row="units">
              <div className="ov-f ov-f-full">
                <UnitsField units={r.units} onUnits={(u) => patch(i, { units: u })} />
              </div>
            </div>
          </section>
        )
      })}
      <PagerBar p={pg} noun="papers" nounSingular="Paper" />
      <div className="ov-actions">
        <span className="ov-note ov-grow" data-date-count="">
          {rows.length === 0 ? 'No paper on the date sheet yet.' : `${rows.length} paper${rows.length === 1 ? '' : 's'}`}
          {tentative > 0 && `, ${tentative} with a tentative date (a circular, not the final sheet).`}
        </span>
        <Button onClick={() => { set([...rows, { subject: '', title: '', date: '', units: [], kind: 'end_sem', max: 60, approx: true }]); pg.jumpToLast(rows.length + 1) }}>
          <Plus size={14} aria-hidden="true" />Add a paper
        </Button>
        {changes > 0 && <Button onClick={() => discard('exams')}>Discard changes</Button>}
        <PrimaryButton claimId="date-save" rank="overlay" when={changes > 0} loading={saving} disabled={changes === 0}
          onClick={() => void saveAll(['exams']).then((r) => { if (r.failed.length === 0) closeOverlay() })}>
          {changes === 0 ? 'Save' : `Save ${changes} change${changes === 1 ? '' : 's'}`}
        </PrimaryButton>
      </div>
      {report && report.failed.length > 0 && <p className="ov-note" role="alert">{`Error: ${report.failed.map((f) => f.why).join('; ')}.`}</p>}
      {report && report.dropped.length > 0 && <p className="ov-note" role="status">{`Ignored by the server: ${report.dropped.join('; ')}`}</p>}
    </div>
  )
}

registerOverlay('date', DateSheet as never)
