/**
 * Settings → "What the System knows". Edits data/notes/well-wisher/engine-inputs.json
 * section by section (PUT /api/mission/inputs/{section}), so what is typed here is
 * what the engines read: the date sheet and study time feed the exams engine; the
 * profile feeds personality and Today's 3; deadlines feed the goal ladder and career.
 * After a save the server answers what it ignored, and that is shown, not hidden.
 */
import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../lib/store'
import { usePlan } from '../game/plan'
import './exams.css'

interface ExamRow { id?: string; subject: string; title: string; code?: string; date: string; start?: string | null; end?: string | null; units: number[]; may_miss?: boolean; difficulty?: 'easy' | 'normal' | 'hard'; target?: number | null; max?: number }
interface DeadlineRow { id?: string; title?: string; item?: string; date: string; kind?: string }
interface Profile { traits?: string[]; weak_points?: string[]; prefers?: string[]; github?: string | null; [k: string]: unknown }
interface Study { weekday_minutes?: number; weekend_minutes?: number; exam_evening_minutes?: number; build_cap_exam?: number; build_cap?: number }
interface InputsAnswer { raw: { exams?: ExamRow[]; deadlines?: DeadlineRow[]; profile?: Profile; study?: Study }; inputs: { source: string; warnings: string[] } }
interface SaveAnswer { saved: string; dropped: string[] }

const lines = (v?: string[]) => (v ?? []).join('\n')
const unlines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

export function SystemInputs() {
  const [d, setD] = useState<InputsAnswer | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const toast = useStore((s) => s.toast)
  const subjects = usePlan((s) => s.academics?.subjects ?? [])
  useEffect(() => { void api<InputsAnswer>('/api/mission/inputs').then(setD).catch(() => undefined) }, [])
  if (!d) return null
  const raw = d.raw
  const save = async (section: string, value: unknown) => {
    try {
      const r = await api<SaveAnswer>(`/api/mission/inputs/${section}`, { method: 'PUT', body: { value } })
      setNote(r.dropped.length ? `Saved ${section}, but ignored: ${r.dropped.join('; ')}` : `Saved ${section}.`)
      toast(`Saved ${section}. The engines use it from now on.`, 'live')
      setD(await api<InputsAnswer>('/api/mission/inputs'))
    } catch {
      toast(`Could not save ${section}.`, 'fault')
    }
  }
  return (
    <section className="set-sec sys-inputs">
      <b>What the System knows</b>
      <p className="muted small">Saved to engine-inputs.json on this laptop. The exams plan, Today's 3, the career and personality engines read it.
        {d.inputs.source !== 'private' && ' Right now they read the fictional example: the first save here makes it yours.'}</p>
      <DateSheet rows={raw.exams ?? []} subjects={subjects} onSave={(v) => void save('exams', v)} />
      <StudyTime s={raw.study ?? {}} onSave={(v) => void save('study', v)} />
      <ProfileEdit p={raw.profile ?? {}} onSave={(v) => void save('profile', v)} />
      <Deadlines rows={raw.deadlines ?? []} onSave={(v) => void save('deadlines', v)} />
      {note && <p className="small" role="status">{note}</p>}
    </section>
  )
}

function DateSheet({ rows, subjects, onSave }: { rows: ExamRow[]; subjects: { id: string; name: string }[]; onSave: (v: ExamRow[]) => void }) {
  const [r, setR] = useState(rows)
  useEffect(() => setR(rows), [rows])
  const set = (i: number, patch: Partial<ExamRow>) => setR(r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <details open={!rows.length}>
      <summary className="small"><b>Date sheet</b> · {rows.length} paper{rows.length === 1 ? '' : 's'}</summary>
      <div className="sys-grid exams-grid" role="group" aria-label="date sheet">
        {r.length > 0 && (
          <div className="sys-row sys-head" aria-hidden>
            {['Subject', 'Date', 'Starts', 'Ends', 'Units', 'How hard', 'Target', 'Sit?', ''].map((h, j) => <span key={j}>{h}</span>)}
          </div>)}
        {r.map((x, i) => (
          <div key={i} className="sys-row">
            <select className="field sm" value={x.subject} aria-label="subject" title={x.title || undefined}
              onChange={(e) => set(i, { subject: e.target.value, title: subjects.find((s) => s.id === e.target.value)?.name ?? x.title })}>
              <option value="">subject…</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className="field sm" type="date" value={x.date} onChange={(e) => set(i, { date: e.target.value })} aria-label="date" />
            <input className="field sm" type="time" value={x.start ?? ''} onChange={(e) => set(i, { start: e.target.value || null })} aria-label="starts" />
            <input className="field sm" type="time" value={x.end ?? ''} onChange={(e) => set(i, { end: e.target.value || null })} aria-label="ends" />
            <input className="field sm" value={x.units.join(',')} placeholder="3,4" aria-label="units"
              onChange={(e) => set(i, { units: e.target.value.split(/[,\s]+/).map(Number).filter((n) => n > 0) })} />
            <select className="field sm" value={x.difficulty ?? 'normal'} aria-label="how hard" onChange={(e) => set(i, { difficulty: e.target.value as ExamRow['difficulty'] })}>
              <option value="easy">easy</option><option value="normal">normal</option><option value="hard">hard</option>
            </select>
            <input className="field sm" type="number" min={0} max={x.max ?? 20} value={x.target ?? ''} placeholder={`/${x.max ?? 20}`} aria-label="target marks"
              onChange={(e) => set(i, { target: e.target.value === '' ? null : Number(e.target.value) })} />
            <label className="check small"><input type="checkbox" checked={!!x.may_miss} onChange={(e) => set(i, { may_miss: e.target.checked })} />may not sit</label>
            <button className="icon-btn" aria-label="Remove paper" onClick={() => setR(r.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>))}
      </div>
      <div className="sys-actions">
        <button className="btn sm ghost" onClick={() => setR([...r, { subject: '', title: '', date: '', units: [] }])}><Plus size={13} />Paper</button>
        <button className="btn sm" onClick={() => onSave(r.filter((x) => x.subject && x.date))}><Save size={13} />Save date sheet</button>
      </div>
    </details>
  )
}

function StudyTime({ s, onSave }: { s: Study; onSave: (v: Study) => void }) {
  const [v, setV] = useState<Study>(s)
  useEffect(() => setV(s), [s])
  const f = (k: keyof Study, label: string, dflt: number) => (
    <label className="small">{label}<input className="field sm" type="number" min={0} max={900} value={v[k] ?? dflt}
      onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></label>)
  return (
    <details>
      <summary className="small"><b>Study time</b> · minutes you really have</summary>
      <div className="field-row">{f('weekday_minutes', 'Weekday ', 240)}{f('weekend_minutes', 'Weekend day ', 300)}{f('exam_evening_minutes', 'Evening after a paper ', 150)}</div>
      <div className="field-row">{f('build_cap_exam', 'Building per day, exam week ', 60)}{f('build_cap', 'Building per day, otherwise ', 180)}</div>
      <button className="btn sm" onClick={() => onSave(v)}><Save size={13} />Save study time</button>
    </details>
  )
}

function ProfileEdit({ p, onSave }: { p: Profile; onSave: (v: Profile) => void }) {
  const [t, setT] = useState({ traits: lines(p.traits), weak: lines(p.weak_points), prefers: lines(p.prefers), github: p.github ?? '' })
  useEffect(() => setT({ traits: lines(p.traits), weak: lines(p.weak_points), prefers: lines(p.prefers), github: p.github ?? '' }), [p])
  const area = (k: 'traits' | 'weak' | 'prefers', label: string) => (
    <label className="small sys-area">{label}<textarea className="field" rows={3} value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></label>)
  return (
    <details>
      <summary className="small"><b>About you</b> · one line each, how the plan frames work</summary>
      {area('traits', 'Traits')}{area('weak', 'Where you get stuck')}{area('prefers', 'What works for you')}
      <label className="small">GitHub username <input className="field sm" value={t.github} onChange={(e) => setT({ ...t, github: e.target.value })} /></label>
      <button className="btn sm" onClick={() => onSave({ ...p, traits: unlines(t.traits), weak_points: unlines(t.weak), prefers: unlines(t.prefers), github: t.github.trim() || null })}>
        <Save size={13} />Save about you</button>
    </details>
  )
}

function Deadlines({ rows, onSave }: { rows: DeadlineRow[]; onSave: (v: DeadlineRow[]) => void }) {
  const [r, setR] = useState(rows)
  useEffect(() => setR(rows), [rows])
  const set = (i: number, patch: Partial<DeadlineRow>) => setR(r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <details>
      <summary className="small"><b>Deadlines</b> · {rows.length}</summary>
      <div className="sys-grid dead-grid" role="group" aria-label="deadlines">
        {r.length > 0 && (
          <div className="sys-row sys-head" aria-hidden>
            {['What', 'Date', 'Kind', ''].map((h, j) => <span key={j}>{h}</span>)}
          </div>)}
        {r.map((x, i) => (
          <div key={i} className="sys-row">
            <input className="field" value={x.title ?? x.item ?? ''} placeholder="what" aria-label="deadline" onChange={(e) => set(i, { title: e.target.value, item: undefined })} />
            <input className="field sm" type="date" value={x.date} onChange={(e) => set(i, { date: e.target.value })} aria-label="date" />
            <select className="field sm" value={x.kind ?? ''} onChange={(e) => set(i, { kind: e.target.value || undefined })} aria-label="kind">
              <option value="">kind: guess</option>
              {['exam', 'internship', 'application', 'ms', 'gsoc', 'income', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button className="icon-btn" aria-label="Remove deadline" onClick={() => setR(r.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>))}
      </div>
      <div className="sys-actions">
        <button className="btn sm ghost" onClick={() => setR([...r, { title: '', date: '' }])}><Plus size={13} />Deadline</button>
        <button className="btn sm" onClick={() => onSave(r.filter((x) => (x.title || x.item) && x.date))}><Save size={13} />Save deadlines</button>
      </div>
    </details>
  )
}
