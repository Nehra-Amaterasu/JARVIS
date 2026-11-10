// O1 Date sheet (plan 4.13): one card per paper, every field labelled in words, dates and goals editable.
// It edits the SAME `exams` draft as Setup > Dates (setup/saveModel.ts), so "Save 2 changes" here and the
// dirty dot on the Setup page are one fact. Primary: Save N changes when something changed, else none (Close only).
import { useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePlan } from '../../germoney/game/plan'
import { EMPTY } from '../../germoney/ui'
import { Button, Field, IconButton, PrimaryButton } from '../kit'
import { registerOverlay, closeOverlay } from '../frame/overlayRegistry'
import { useSetup } from '../setup/saveModel'
import type { ExamRow } from '../setup/inputs'
import './overlays.css'

const KINDS: [NonNullable<ExamRow['kind']>, string][] = [['end_sem', 'End-sem'], ['backlog', 'Backlog'], ['cie', 'CIE'], ['other', 'Other']]
const kindLabel = (k?: string) => KINDS.find(([id]) => id === k)?.[1] ?? 'Other'
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** How many papers differ from what is saved: a changed row, a new row and a removed row each count once. */
export function countChanges(base: ExamRow[], now: ExamRow[]): number {
  let n = 0
  const len = Math.max(base.length, now.length)
  for (let i = 0; i < len; i++) if (!same(base[i], now[i])) n++
  return n
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
    <div className="ov-body" data-overlay="date" data-primary-none={changes === 0 ? '' : undefined}>
      <p className="ov-note">
        {rows.length === 0 ? 'No paper on the date sheet yet.' : `${rows.length} paper${rows.length === 1 ? '' : 's'}`}
        {tentative > 0 && `, ${tentative} with a tentative date (a circular, not the final sheet).`}
      </p>
      {rows.map((r, i) => {
        const name = subjects.find((s) => s.id === r.subject)?.name ?? (r.title || 'New paper')
        return (
          <section key={i} className="ov-paper" data-paper={i} aria-label={`${name} ${kindLabel(r.kind)}`}>
            <header className="ov-paper-head">
              <h3 className="ov-paper-title">{`${name}  ${kindLabel(r.kind)}`}</h3>
              <IconButton label={`Remove ${name} ${kindLabel(r.kind)}`} size="sm" onClick={() => set(rows.filter((_, j) => j !== i))}>
                <Trash2 size={16} aria-hidden="true" />
              </IconButton>
            </header>
            <div className="ov-grid">
              <Field label="Subject" kind="select" value={r.subject} onChange={(e) => patch(i, { subject: e.target.value, title: subjects.find((s) => s.id === e.target.value)?.name ?? r.title })}>
                <option value="">choose a subject</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {r.subject && !subjects.some((s) => s.id === r.subject) && <option value={r.subject}>{r.subject}</option>}
              </Field>
              <Field label="Paper" kind="select" value={r.kind ?? 'other'} onChange={(e) => patch(i, { kind: e.target.value as ExamRow['kind'], max: r.max ?? (e.target.value === 'cie' ? 20 : 60) })}>
                {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Field>
              <Field label="Date" kind="date" value={r.date} onChange={(e) => patch(i, { date: e.target.value })} />
              <label className="ov-check">
                <input type="checkbox" checked={!!r.approx} onChange={(e) => patch(i, { approx: e.target.checked })} />
                Tentative
              </label>
              <Field label="Starts" kind="time" value={r.start ?? ''} onChange={(e) => patch(i, { start: e.target.value || null })} />
              <Field label="Ends" kind="time" value={r.end ?? ''} onChange={(e) => patch(i, { end: e.target.value || null })} />
              <Field label="Units covered" hint="Numbers, separated by commas. Empty means all." value={r.units.join(', ')}
                onChange={(e) => patch(i, { units: e.target.value.split(/[,\s]+/).map(Number).filter((n) => n > 0) })} />
              <Field label="How hard" kind="select" value={r.difficulty ?? 'normal'} onChange={(e) => patch(i, { difficulty: e.target.value as ExamRow['difficulty'] })}>
                <option value="easy">easy</option><option value="normal">normal</option><option value="hard">hard</option>
              </Field>
              <div className="ov-aim" role="group" aria-label="Aim for">
                <Field label="Aim for" kind="number" min={0} max={r.max ?? 20} value={r.target ?? ''} onChange={(e) => patch(i, { target: e.target.value === '' ? null : Number(e.target.value) })} />
                <span className="ov-of" aria-hidden="true">of</span>
                <Field label="Out of" kind="number" min={1} value={r.max ?? ''} onChange={(e) => patch(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <label className="ov-check">
                <input type="checkbox" checked={!!r.may_miss} onChange={(e) => patch(i, { may_miss: e.target.checked })} />
                I may not sit this paper
              </label>
            </div>
          </section>
        )
      })}
      <div className="ov-actions">
        <Button onClick={() => set([...rows, { subject: '', title: '', date: '', units: [], kind: 'end_sem', max: 60, approx: true }])}>
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
