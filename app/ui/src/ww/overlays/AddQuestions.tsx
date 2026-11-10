// O8 Add questions (plan 4.13): one question at a time into the typed bank of the chosen paper's subject.
// It posts to the server's add-question route (routes_mission.py bank_add), which refuses an unmatched $, a
// duplicate and a full bank in words, and those words are shown as they come. Maths is typed as $...$ and
// previewed here through MathText, the same renderer the Reader uses.
import { useEffect, useId, useMemo, useState } from 'react'
import { Banner, EmptyState, Field, PrimaryButton, Segmented } from '../kit'
import { MathText } from '../math/MathText'
import { registerOverlay } from '../frame/overlayRegistry'
import { postQuestion, type Tier } from '../study/api'
import { useStudy } from '../study/studyStore'
import './addQuestions.css'

export function AddQuestionsBody() {
  const paper = useStudy((s) => s.exams?.papers.find((p) => p.id === s.selected))
  const bank = useStudy((s) => s.bank)
  const listId = useId()
  const [stem, setStem] = useState('')
  const [marks, setMarks] = useState('')
  const [unit, setUnit] = useState('')
  const [topic, setTopic] = useState('')
  const [section, setSection] = useState('')
  const [source, setSource] = useState('')
  const [tier, setTier] = useState<Tier>('exam')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const subject = paper?.subject

  useEffect(() => { if (subject) void useStudy.getState().loadBank(subject) }, [subject])
  const units = bank?.units ?? []
  // a paper's own units first; the unit list of the subject when the paper names none
  const unitOptions = useMemo(() => {
    const scope = paper?.units?.length ? units.filter((u) => paper.units.includes(u.n)) : units
    return scope.length ? scope : units
  }, [units, paper])
  useEffect(() => { if (!unit && unitOptions.length) setUnit(String(unitOptions[0].n)) }, [unit, unitOptions])
  const topics = units.find((u) => String(u.n) === unit)?.topics ?? []

  if (!paper) return <EmptyState title="No paper is chosen." body="Pick a paper in Study > Papers first; questions are added to its subject." />
  const kind = paper.kind === 'cie' ? 'CIE' : paper.kind === 'end_sem' ? 'End-sem' : 'Other'
  const total = bank?.sizes.total

  const submit = async () => {
    setBusy(true)
    setErr(null)
    setAdded(null)
    try {
      const r = await postQuestion(paper.subject, {
        unit: Number(unit), topic: topic.trim(), question: stem.trim(), marks: Number(marks), tier,
        section: section.trim() || undefined, source: source.trim() || undefined,
      })
      useStudy.setState({ bank: bank ? { ...bank, sizes: r.sizes } : bank })
      setAdded(`Added. Bank: ${r.sizes.total} ${r.sizes.total === 1 ? 'question' : 'questions'}.`)
      setStem('')
    } catch (e) {
      setErr((e as Error).message || 'The server refused that question.')
    } finally { setBusy(false) }
  }
  const ready = stem.trim() !== '' && marks !== '' && topic.trim() !== '' && unit !== ''
  return (
    <form className="ww-add" data-overlay="add" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void submit() }}>
      <p className="ww-add-head">
        {paper.title} · {kind} · bank: {total === undefined ? 'reading…' : `${total} ${total === 1 ? 'question' : 'questions'}`}
      </p>
      <Field kind="area" label="Stem" value={stem} onChange={(e) => setStem(e.target.value)} hint="Maths is typed as $...$; the Reader typesets it." />
      {stem.trim() && (
        <div className="ww-add-preview" aria-label="Preview">
          <span className="ww-kicker">Preview</span>
          <MathText>{stem}</MathText>
        </div>
      )}
      <div className="ww-add-row">
        <Field kind="number" label="Marks" value={marks} min={0.5} max={100} step={0.5} onChange={(e) => setMarks(e.target.value)} />
        {unitOptions.length > 0 ? (
          <Field kind="select" label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {unitOptions.map((u) => <option key={u.n} value={u.n}>{`Unit ${u.n}${u.title ? `: ${u.title}` : ''}`}</option>)}
          </Field>
        ) : (
          <Field kind="number" label="Unit" value={unit} min={1} max={10} onChange={(e) => setUnit(e.target.value)} />
        )}
        <Field label="Topic" value={topic} list={listId} onChange={(e) => setTopic(e.target.value)} />
        <datalist id={listId}>{topics.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
      <div className="ww-add-row">
        <Field label="Section" value={section} maxLength={4} hint="A, B or C (optional)" onChange={(e) => setSection(e.target.value)} />
        <Field label="Source" value={source} maxLength={120} hint="Where it is from (optional)" onChange={(e) => setSource(e.target.value)} />
      </div>
      <Segmented<Tier> label="Tier" variant="choice" value={tier} onChange={setTier} options={[{ id: 'exam', label: 'Exam' }, { id: 'gate', label: 'GATE' }]} />
      {err && <Banner tone="fault">{err}</Banner>}
      {added && <p className="ww-add-ok" role="status" data-added="">{added}</p>}
      <PrimaryButton claimId="add-save" rank="overlay" when={ready} type="submit" loading={busy}
        disabledReason={ready ? undefined : 'Needs a stem, marks, a unit and a topic.'}>
        Add question
      </PrimaryButton>
    </form>
  )
}

registerOverlay('add', AddQuestionsBody as never)
