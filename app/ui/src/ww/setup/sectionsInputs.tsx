/**
 * Setup sections that edit engine-inputs.json: Subjects and question bank (SU2), Goals (SU3), Timetable (SU4),
 * Attendance rule (SU5), Deadlines (SU6), Study time (SU7), About you (SU8). Every one is a form over the same
 * payload the old JSON editor sent; "Advanced: JSON" stays as a closed fold. Edits go to the draft (saveModel.ts).
 */
import { Button, Field, Fold } from '../kit'
import { EMPTY } from '../../germoney/ui'
import { usePlan } from '../../germoney/game/plan'
import {
  DEFAULTS,
  type AttendanceInputs, type DeadlineRow, type GoalRow, type ProfileInputs, type StudyInputs, type SubjectRow, type TimetableInputs, type UnitRow, type BankRow, type SlotRow,
} from './inputs'
import { AddButton, AdvancedJson, FormRow, LinesField, SetupCard, drop, openOverlay, upd, useDraft } from './forms'

const num = (s: string, dflt: number | null = null) => (s === '' ? dflt : Number(s))

/* ---- SU2 Subjects and question bank ---- */
export function SubjectsSection() {
  const [rows, set] = useDraft<SubjectRow[]>('subjects')
  const list = rows ?? DEFAULTS.subjects
  const total = list.reduce((n, s) => n + (s.question_bank?.length ?? 0), 0)
  return (
    <SetupCard n="SU2" anchor="subjects" title="Subjects and question bank" dirtyId="subjects"
      hint="Subjects or unit lists you type yourself. A known id replaces the units of that subject; a new id is a new subject, and any paper on the date sheet can use it.">
      <div className="su-linkline">
        <span>{`Questions: ${total} in bank`}</span>
        <Button size="sm" onClick={() => openOverlay('add')}>Add questions</Button>
      </div>
      {list.length === 0 && <p className="su-empty">No subject typed here yet. Add one, or the engines read the academics file.</p>}
      {list.map((s, i) => (
        <div key={i} className="su-block" role="group" aria-label={`Subject ${s.name || i + 1}`}>
          <FormRow label={`subject ${s.name || i + 1}`} onRemove={() => set(drop(list, i))}>
            <Field label="Subject id" value={s.id} onChange={(e) => set(upd(list, i, { id: e.target.value }))} />
            <Field label="Subject name" value={s.name} onChange={(e) => set(upd(list, i, { name: e.target.value }))} />
          </FormRow>
          <Fold title={`Units (${s.units?.length ?? 0})`} level={4}>
            {(s.units ?? []).map((u, j) => (
              <FormRow key={j} label={`unit ${u.n || j + 1}`} onRemove={() => set(upd(list, i, { units: drop(s.units ?? [], j) }))}>
                <Field label="Unit" kind="number" min={1} value={u.n} onChange={(e) => set(upd(list, i, { units: upd<UnitRow>(s.units ?? [], j, { n: Number(e.target.value) }) }))} />
                <Field label="Unit title" value={u.title} onChange={(e) => set(upd(list, i, { units: upd<UnitRow>(s.units ?? [], j, { title: e.target.value }) }))} />
                <Field label="Weight in the exam" kind="select" value={u.exam_weight ?? 'med'} onChange={(e) => set(upd(list, i, { units: upd<UnitRow>(s.units ?? [], j, { exam_weight: e.target.value as UnitRow['exam_weight'] }) }))}>
                  <option value="high">high</option><option value="med">medium</option><option value="low">low</option>
                </Field>
                <LinesField label="Topics, one per line" value={u.topics} onChange={(v) => set(upd(list, i, { units: upd<UnitRow>(s.units ?? [], j, { topics: v }) }))} />
              </FormRow>
            ))}
            <AddButton onClick={() => set(upd(list, i, { units: [...(s.units ?? []), { n: (s.units?.length ?? 0) + 1, title: '', exam_weight: 'med', topics: [] }] }))}>Unit</AddButton>
          </Fold>
          <Fold title={`Question bank (${s.question_bank?.length ?? 0})`} level={4}>
            {(s.question_bank ?? []).map((q, j) => (
              <FormRow key={j} label={`question ${j + 1}`} onRemove={() => set(upd(list, i, { question_bank: drop(s.question_bank ?? [], j) }))}>
                <Field label="Unit" kind="number" min={1} value={q.unit ?? ''} onChange={(e) => set(upd(list, i, { question_bank: upd<BankRow>(s.question_bank ?? [], j, { unit: num(e.target.value) ?? undefined }) }))} />
                <Field label="Topic" value={q.topic ?? ''} onChange={(e) => set(upd(list, i, { question_bank: upd<BankRow>(s.question_bank ?? [], j, { topic: e.target.value }) }))} />
                <Field label="Marks" kind="number" min={0} value={q.marks ?? ''} onChange={(e) => set(upd(list, i, { question_bank: upd<BankRow>(s.question_bank ?? [], j, { marks: num(e.target.value) ?? undefined }) }))} />
                <Field label="Paper section" value={q.section ?? ''} onChange={(e) => set(upd(list, i, { question_bank: upd<BankRow>(s.question_bank ?? [], j, { section: e.target.value }) }))} />
                <Field label="Question" kind="area" hint="Maths is typed as $...$; the Reader typesets it." value={q.question} onChange={(e) => set(upd(list, i, { question_bank: upd<BankRow>(s.question_bank ?? [], j, { question: e.target.value }) }))} />
              </FormRow>
            ))}
            <AddButton onClick={() => set(upd(list, i, { question_bank: [...(s.question_bank ?? []), { question: '' }] }))}>Question</AddButton>
          </Fold>
        </div>
      ))}
      <AddButton onClick={() => set([...list, { id: '', name: '', units: [], question_bank: [] }])}>Subject</AddButton>
      <AdvancedJson id="subjects" value={list} onApply={(v) => set(v as SubjectRow[])} />
    </SetupCard>
  )
}

/* ---- SU3 Goals ---- */
const HORIZONS = ['week', 'quarter', 'year', '2year', '10year']
export function GoalsSection() {
  const [rows, set] = useDraft<GoalRow[]>('goals')
  const list = rows ?? DEFAULTS.goals
  return (
    <SetupCard n="SU3" anchor="goals" title="Goals" dirtyId="goals" hint="What you are aiming at, how it is measured and by when. The goal ladder and the career engine read these.">
      {list.length === 0 && <p className="su-empty">No goal yet. Add the first one.</p>}
      {list.map((g, i) => (
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
      <AddButton onClick={() => set([...list, { id: '', horizon: 'quarter', metric: '', target: null, deadline: null }])}>Goal</AddButton>
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
  const setSlots = (s: SlotRow[]) => set({ ...tt, slots: s })
  return (
    <SetupCard n="SU4" anchor="timetable" title="Timetable" dirtyId="timetable" hint="The weekly classes. Today's class rows and the attendance sums come from here.">
      <div className="su-row-fields">
        <Field label="Section" value={tt.section ?? ''} onChange={(e) => set({ ...tt, section: e.target.value })} />
        <Field label="Room" value={tt.room ?? ''} onChange={(e) => set({ ...tt, room: e.target.value })} />
      </div>
      {slots.length === 0 && <p className="su-empty">No class slot yet.</p>}
      {slots.map((s, i) => (
        <FormRow key={i} label={`class ${i + 1}`} onRemove={() => setSlots(drop(slots, i))}>
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
      <AddButton onClick={() => setSlots([...slots, { day: 'mon', start: '09:00', end: '10:00', subject: '', kind: 'lecture' }])}>Class</AddButton>
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
      <AdvancedJson id="attendance_rule" value={r} onApply={(v) => set(v as AttendanceInputs)} />
    </SetupCard>
  )
}

/* ---- SU6 Deadlines ---- */
const DEADLINE_KINDS = ['exam', 'internship', 'application', 'ms', 'gsoc', 'income', 'other']
export function DeadlinesSection() {
  const [rows, set] = useDraft<DeadlineRow[]>('deadlines')
  const list = rows ?? DEFAULTS.deadlines
  return (
    <SetupCard n="SU6" anchor="deadlines" title="Deadlines" dirtyId="deadlines" hint="Dates that are not exams: applications, programmes, income targets. The goal ladder counts down to them.">
      {list.length === 0 && <p className="su-empty">No deadline yet.</p>}
      {list.map((d, i) => (
        <FormRow key={i} label={`deadline ${d.title ?? d.item ?? i + 1}`} onRemove={() => set(drop(list, i))}>
          <Field label="What" value={d.title ?? d.item ?? ''} onChange={(e) => set(upd(list, i, { title: e.target.value, item: undefined }))} />
          <Field label="Date" kind="date" value={d.date} onChange={(e) => set(upd(list, i, { date: e.target.value }))} />
          <Field label="Kind" kind="select" value={d.kind ?? ''} onChange={(e) => set(upd(list, i, { kind: e.target.value || undefined }))}>
            <option value="">let the plan guess</option>
            {DEADLINE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </Field>
        </FormRow>
      ))}
      <AddButton onClick={() => set([...list, { title: '', date: '' }])}>Deadline</AddButton>
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
