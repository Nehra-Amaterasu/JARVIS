/**
 * Setup sections that edit engine-inputs.json: Subjects and question bank (SU2), Goals (SU3), Timetable (SU4),
 * Attendance rule (SU5), Deadlines (SU6), Study time (SU7), About you (SU8). Every one is a form over the same
 * payload the old JSON editor sent; "Advanced: JSON" stays as a closed fold. Edits go to the draft (saveModel.ts).
 */
import { useState } from 'react'
import { Button, Field, Segmented } from '../kit'
import { EMPTY } from '../../germoney/ui'
import { usePlan } from '../../germoney/game/plan'
import {
  DEFAULTS,
  type AttendanceInputs, type DeadlineRow, type GoalRow, type ProfileInputs, type StudyInputs, type SubjectRow, type TimetableInputs, type UnitRow, type BankRow, type SlotRow,
} from './inputs'
import { AddButton, AdvancedJson, FormPart, FormRow, LinesField, SetupCard, drop, openOverlay, upd, useDraft } from './forms'
import { PagerBar, usePaged } from './pager'

const num = (s: string, dflt: number | null = null) => (s === '' ? dflt : Number(s))

/* ---- SU2 Subjects and question bank ---- */
export function SubjectsSection() {
  const [rows, set] = useDraft<SubjectRow[]>('subjects')
  const list = rows ?? DEFAULTS.subjects
  const total = list.reduce((n, s) => n + (s.question_bank?.length ?? 0), 0)
  const pg = usePaged(list.length, 1)
  return (
    <SetupCard n="SU2" anchor="subjects" title="Subjects and question bank" dirtyId="subjects"
      hint="Subjects or unit lists you type yourself. A known id replaces the units of that subject; a new id is a new subject, and any paper on the date sheet can use it."
      action={<><span className="su-meta">{`Questions: ${total} in bank`}</span><Button size="sm" onClick={() => openOverlay('add')}>Add questions</Button></>}>
      <FormPart>
        {list.length === 0 && <p className="su-empty">No subject typed here yet. Add one, or the engines read the academics file.</p>}
        {pg.slice(list).map(({ item: s, index: i }) => (
          <SubjectBlock key={i} s={s} onChange={(patch) => set(upd(list, i, patch))} onRemove={() => set(drop(list, i))} label={s.name || String(i + 1)} />
        ))}
        <PagerBar p={pg} noun="subjects" nounSingular="Subject">
          <AddButton onClick={() => { set([...list, { id: '', name: '', units: [], question_bank: [] }]); pg.jumpToLast(list.length + 1) }}>Subject</AddButton>
        </PagerBar>
      </FormPart>
      <AdvancedJson id="subjects" value={list} onApply={(v) => set(v as SubjectRow[])} />
    </SetupCard>
  )
}

/** One subject: its id and name, then its units or its question bank, one item at a time (a subject holds dozens of each). */
function SubjectBlock({ s, label, onChange, onRemove }: { s: SubjectRow; label: string; onChange: (p: Partial<SubjectRow>) => void; onRemove: () => void }) {
  const units = s.units ?? []
  const bank = s.question_bank ?? []
  const pu = usePaged(units.length, 1)
  const pb = usePaged(bank.length, 1)
  const [tab, setTab] = useState<'units' | 'bank'>('units')
  return (
    <div className="su-block" role="group" aria-label={`Subject ${label}`}>
      <FormRow label={`subject ${label}`} onRemove={onRemove} dense>
        <Field label="Subject id" value={s.id} onChange={(e) => onChange({ id: e.target.value })} />
        <Field label="Subject name" value={s.name} onChange={(e) => onChange({ name: e.target.value })} />
      </FormRow>
      <Segmented<'units' | 'bank'> label="Show" variant="compact" value={tab} onChange={setTab}
        options={[{ id: 'units', label: `Units (${units.length})` }, { id: 'bank', label: `Question bank (${bank.length})` }]} />
      <div hidden={tab !== 'units'}>
        {pu.slice(units).map(({ item: u, index: j }) => (
          <FormRow key={j} label={`unit ${u.n || j + 1}`} onRemove={() => onChange({ units: drop(units, j) })} dense>
            <Field label="Unit" kind="number" min={1} value={u.n} onChange={(e) => onChange({ units: upd<UnitRow>(units, j, { n: Number(e.target.value) }) })} />
            <Field label="Unit title" value={u.title} onChange={(e) => onChange({ units: upd<UnitRow>(units, j, { title: e.target.value }) })} />
            <Field label="Weight in the exam" kind="select" value={u.exam_weight ?? 'med'} onChange={(e) => onChange({ units: upd<UnitRow>(units, j, { exam_weight: e.target.value as UnitRow['exam_weight'] }) })}>
              <option value="high">high</option><option value="med">medium</option><option value="low">low</option>
            </Field>
            <LinesField label="Topics, one per line" value={u.topics} onChange={(v) => onChange({ units: upd<UnitRow>(units, j, { topics: v }) })} />
          </FormRow>
        ))}
        <PagerBar p={pu} noun="units" nounSingular="Unit">
          <AddButton onClick={() => { onChange({ units: [...units, { n: units.length + 1, title: '', exam_weight: 'med', topics: [] }] }); pu.jumpToLast(units.length + 1) }}>Unit</AddButton>
        </PagerBar>
      </div>
      <div hidden={tab !== 'bank'}>
        {pb.slice(bank).map(({ item: q, index: j }) => (
          <FormRow key={j} label={`question ${j + 1}`} onRemove={() => onChange({ question_bank: drop(bank, j) })} dense>
            <Field label="Unit" kind="number" min={1} value={q.unit ?? ''} onChange={(e) => onChange({ question_bank: upd<BankRow>(bank, j, { unit: num(e.target.value) ?? undefined }) })} />
            <Field label="Topic" value={q.topic ?? ''} onChange={(e) => onChange({ question_bank: upd<BankRow>(bank, j, { topic: e.target.value }) })} />
            <Field label="Marks" kind="number" min={0} value={q.marks ?? ''} onChange={(e) => onChange({ question_bank: upd<BankRow>(bank, j, { marks: num(e.target.value) ?? undefined }) })} />
            <Field label="Paper section" value={q.section ?? ''} onChange={(e) => onChange({ question_bank: upd<BankRow>(bank, j, { section: e.target.value }) })} />
            <Field label="Question" kind="area" hint="Maths is typed as $...$; the Reader typesets it." value={q.question} onChange={(e) => onChange({ question_bank: upd<BankRow>(bank, j, { question: e.target.value }) })} />
          </FormRow>
        ))}
        <PagerBar p={pb} noun="questions" nounSingular="Question">
          <AddButton onClick={() => { onChange({ question_bank: [...bank, { question: '' }] }); pb.jumpToLast(bank.length + 1) }}>Question</AddButton>
        </PagerBar>
      </div>
    </div>
  )
}

/* ---- SU3 Goals ---- */
const HORIZONS = ['week', 'quarter', 'year', '2year', '10year']
export function GoalsSection() {
  const [rows, set] = useDraft<GoalRow[]>('goals')
  const list = rows ?? DEFAULTS.goals
  const pg = usePaged(list.length, 2)
  return (
    <SetupCard n="SU3" anchor="goals" title="Goals" dirtyId="goals" hint="What you are aiming at, how it is measured and by when. The goal ladder and the career engine read these.">
      <FormPart>
      {list.length === 0 && <p className="su-empty">No goal yet. Add the first one.</p>}
      {pg.slice(list).map(({ item: g, index: i }) => (
        <FormRow key={i} label={`goal ${g.metric || i + 1}`} onRemove={() => set(drop(list, i))}>
          <Field label="Goal id" value={g.id} onChange={(e) => set(upd(list, i, { id: e.target.value }))} />
          <Field label="Horizon" kind="select" value={g.horizon} onChange={(e) => set(upd(list, i, { horizon: e.target.value }))}>
            {HORIZONS.map((h) => <option key={h} value={h}>{h}</option>)}
          </Field>
          <Field label="What is measured" value={g.metric} onChange={(e) => set(upd(list, i, { metric: e.target.value }))} />
          <Field label="Target" value={g.target ?? ''} onChange={(e) => set(upd(list, i, { target: e.target.value === '' ? null : Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) }))} />
          <Field label="Deadline" kind="date" value={g.deadline ?? ''} onChange={(e) => set(upd(list, i, { deadline: e.target.value || null }))} />
        </FormRow>
      ))}
      <PagerBar p={pg} noun="goals" nounSingular="Goal" />
      <AddButton onClick={() => { set([...list, { id: '', horizon: 'quarter', metric: '', target: null, deadline: null }]); pg.jumpToLast(list.length + 1) }}>Goal</AddButton>
      </FormPart>
      <AdvancedJson id="goals" value={list} onApply={(v) => set(v as GoalRow[])} />
    </SetupCard>
  )
}

/* ---- SU4 Timetable ---- */
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export function TimetableSection() {
  const [t, set] = useDraft<TimetableInputs>('timetable')
  const tt = t ?? DEFAULTS.timetable
  const subjects = useDraft<SubjectRow[]>('subjects')[0] ?? EMPTY
  const acad = usePlan((s) => s.academics?.subjects) ?? EMPTY
  const ids = [...new Set([...subjects.map((s) => s.id), ...acad.map((s) => s.id)])].filter(Boolean)
  const slots = tt.slots ?? []
  const pg = usePaged(slots.length, 4)
  const setSlots = (s: SlotRow[]) => set({ ...tt, slots: s })
  return (
    <SetupCard n="SU4" anchor="timetable" title="Timetable" dirtyId="timetable" hint="The weekly classes. Today's class rows and the attendance sums come from here.">
      <FormPart>
      <div className="su-row-fields">
        <Field label="Section" value={tt.section ?? ''} onChange={(e) => set({ ...tt, section: e.target.value })} />
        <Field label="Room" value={tt.room ?? ''} onChange={(e) => set({ ...tt, room: e.target.value })} />
      </div>
      {slots.length === 0 && <p className="su-empty">No class slot yet.</p>}
      {pg.slice(slots).map(({ item: s, index: i }) => (
        <FormRow key={i} label={`class ${i + 1}`} onRemove={() => setSlots(drop(slots, i))} dense>
          <Field label="Day" kind="select" value={s.day} onChange={(e) => setSlots(upd(slots, i, { day: e.target.value }))}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Field>
          <Field label="Starts" kind="time" value={s.start} onChange={(e) => setSlots(upd(slots, i, { start: e.target.value }))} />
          <Field label="Ends" kind="time" value={s.end} onChange={(e) => setSlots(upd(slots, i, { end: e.target.value }))} />
          <Field label="Subject" kind="select" value={s.subject} onChange={(e) => setSlots(upd(slots, i, { subject: e.target.value }))}>
            <option value="">choose a subject</option>
            {ids.map((id) => <option key={id} value={id}>{id}</option>)}
            {s.subject && !ids.includes(s.subject) && <option value={s.subject}>{s.subject}</option>}
          </Field>
          <Field label="Kind" kind="select" value={s.kind ?? 'lecture'} onChange={(e) => setSlots(upd(slots, i, { kind: e.target.value }))}>
            <option value="lecture">lecture</option><option value="lab">lab</option>
          </Field>
        </FormRow>
      ))}
      <PagerBar p={pg} noun="classes" nounSingular="Class" />
      <AddButton onClick={() => { setSlots([...slots, { day: 'mon', start: '09:00', end: '10:00', subject: '', kind: 'lecture' }]); pg.jumpToLast(slots.length + 1) }}>Class</AddButton>
      </FormPart>
      <AdvancedJson id="timetable" value={tt} onApply={(v) => set(v as TimetableInputs)} />
    </SetupCard>
  )
}

/* ---- SU5 Attendance rule ---- */
export function AttendanceSection() {
  const [a, set] = useDraft<AttendanceInputs>('attendance_rule')
  const r = a ?? DEFAULTS.attendance_rule
  return (
    <SetupCard n="SU5" anchor="attendance" title="Attendance rule" dirtyId="attendance_rule"
      hint="The share of classes you must attend. It is a rule you confirm, not a guess: until confirmed, the sums say so.">
      <FormPart>
      <div className="su-row-fields">
        <Field label="Required attendance" kind="number" min={0} max={100} unit="%" value={Math.round(r.threshold * 100)} onChange={(e) => set({ ...r, threshold: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} />
        <Field label="Counted" kind="select" value={r.scope} onChange={(e) => set({ ...r, scope: e.target.value as AttendanceInputs['scope'] })}>
          <option value="per_subject">per subject</option><option value="overall">overall</option>
        </Field>
        <label className="su-check">
          <input type="checkbox" checked={!!r.confirmed} onChange={(e) => set({ ...r, confirmed: e.target.checked })} />
          I have confirmed this rule with the college
        </label>
      </div>
      </FormPart>
      <AdvancedJson id="attendance_rule" value={r} onApply={(v) => set(v as AttendanceInputs)} />
    </SetupCard>
  )
}

/* ---- SU6 Deadlines ---- */
const DEADLINE_KINDS = ['exam', 'internship', 'application', 'ms', 'gsoc', 'income', 'other']
export function DeadlinesSection() {
  const [rows, set] = useDraft<DeadlineRow[]>('deadlines')
  const list = rows ?? DEFAULTS.deadlines
  const pg = usePaged(list.length, 4)
  return (
    <SetupCard n="SU6" anchor="deadlines" title="Deadlines" dirtyId="deadlines" hint="Dates that are not exams: applications, programmes, income targets. The goal ladder counts down to them.">
      {list.length === 0 && <p className="su-empty">No deadline yet.</p>}
      {pg.slice(list).map(({ item: d, index: i }) => (
        <FormRow key={i} label={`deadline ${d.title ?? d.item ?? i + 1}`} onRemove={() => set(drop(list, i))} dense>
          <Field label="What" value={d.title ?? d.item ?? ''} onChange={(e) => set(upd(list, i, { title: e.target.value, item: undefined }))} />
          <Field label="Date" kind="date" value={d.date} onChange={(e) => set(upd(list, i, { date: e.target.value }))} />
          <Field label="Kind" kind="select" value={d.kind ?? ''} onChange={(e) => set(upd(list, i, { kind: e.target.value || undefined }))}>
            <option value="">let the plan guess</option>
            {DEADLINE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </Field>
        </FormRow>
      ))}
      <PagerBar p={pg} noun="deadlines" nounSingular="Deadline" />
      <AddButton onClick={() => { set([...list, { title: '', date: '' }]); pg.jumpToLast(list.length + 1) }}>Deadline</AddButton>
    </SetupCard>
  )
}

/* ---- SU7 Study time ---- */
const STUDY_FIELDS: [keyof StudyInputs, string, number][] = [
  ['weekday_minutes', 'Weekday', 240], ['weekend_minutes', 'Weekend day', 300], ['exam_evening_minutes', 'Evening after a paper', 150],
  ['build_cap_exam', 'Building per day, exam week', 60], ['build_cap', 'Building per day, otherwise', 180],
]
export function StudySection() {
  const [s, set] = useDraft<StudyInputs>('study')
  const v = s ?? DEFAULTS.study
  return (
    <SetupCard n="SU7" anchor="study" title="Study time" dirtyId="study" hint="The minutes you really have. The plan never schedules more than this.">
      <div className="su-row-fields">
        {STUDY_FIELDS.map(([k, label, dflt]) => (
          <Field key={k} label={label} kind="number" min={0} max={900} unit="min" value={v[k] ?? dflt} onChange={(e) => set({ ...v, [k]: Number(e.target.value) })} />
        ))}
      </div>
    </SetupCard>
  )
}

/* ---- SU8 About you ---- */
export function AboutSection() {
  const [p, set] = useDraft<ProfileInputs>('profile')
  const v = p ?? DEFAULTS.profile
  return (
    <SetupCard n="SU8" anchor="about" title="About you" dirtyId="profile" hint="One line each. How the plan frames work for you.">
      <LinesField label="Traits" value={v.traits} onChange={(x) => set({ ...v, traits: x })} />
      <LinesField label="Where you get stuck" value={v.weak_points} onChange={(x) => set({ ...v, weak_points: x })} />
      <LinesField label="What works for you" value={v.prefers} onChange={(x) => set({ ...v, prefers: x })} />
      <Field label="GitHub username" value={v.github ?? ''} onChange={(e) => set({ ...v, github: e.target.value.trim() || null })} />
    </SetupCard>
  )
}
