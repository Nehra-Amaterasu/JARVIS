/**
 * Study > Papers (plan 4.2), the default in exam season: the paper list (wrapping, no sideways scroll), and for the
 * chosen paper its stage strip, topics, sheets, previous marks and the one Practice cell. The next paper is
 * preselected. Dates are tentative as ONE line, not a tilde on every row. Every number is read from the exams
 * engine, the bank listing or the harvester; a stage with nothing behind it says "not measured".
 */
import { useEffect, useMemo, useState } from 'react'
import { Banner, Button, Card, EmptyState, MasterDetail, Segmented, StageStrip, type Stage } from '../kit'
import { openOverlay } from '../frame/overlayRegistry'
import { Planned } from '../Planned'
import { kindOf, type ExamPaper, type ExamTopic, type Kind } from './api'
import { fmtDate, fmtDays, fmtMin } from './format'
import { PracticeCell } from './PracticeCell'
import { useStudy } from './studyStore'

type TopicState = ExamTopic['state']
const NEXT: Record<TopicState, TopicState> = { none: 'learned', learned: 'solid', solid: 'none' }
const WORD: Record<TopicState, string> = { none: 'to do', learned: 'learned', solid: 'solid' }
const MARK: Record<TopicState, string> = { none: '○', learned: '◐', solid: '●' }
const KIND_LABEL = { cie: 'CIE', end: 'End', other: 'Other' } as const

/** A topic: three states, one tap moves it on. aria-label names the state AND what the next tap does (the kit Chip cannot carry one). */
export function TopicChip({ t, onTap }: { t: ExamTopic; onTap: (t: ExamTopic, next: TopicState) => void }) {
  const next = NEXT[t.state]
  return (
    <button type="button" className="ww-chip ww-tap ww-topic" data-cycle-state={t.state === 'none' ? 'todo' : t.state} data-topic-state={t.state}
      aria-label={`${t.topic}: ${WORD[t.state]}. Tap for ${WORD[next]}.`} onClick={() => onTap(t, next)}>
      <span className="ww-chip-mark" aria-hidden="true">{MARK[t.state]}</span>
      <span>{t.topic}</span>
    </button>
  )
}

export function stagesFor(p: ExamPaper, opts: { bankTotal: number | undefined; paperMarks: number | null; saved: string | null }): Stage[] {
  const bankKnown = opts.bankTotal !== undefined
  const stages: Stage[] = [
    { id: 'bank', label: 'Bank', count: opts.bankTotal, state: !bankKnown ? 'unknown' : opts.bankTotal! > 0 ? 'done' : 'todo' },
    { id: 'paper', label: 'Paper', count: opts.paperMarks ?? undefined, state: opts.paperMarks !== null ? 'done' : 'todo' },
    { id: 'marks', label: 'Marks', count: p.paper_score?.score, state: p.paper_score ? 'done' : 'todo' },
    // proficiency exists only once a paper was marked; before that the tile is not a zero, it is unmeasured
    { id: 'proficiency', label: 'Proficiency', state: p.paper_score ? 'done' : 'unknown' },
    { id: 'tomorrow', label: 'Tomorrow', state: opts.saved ? 'done' : 'unknown' },
  ]
  const firstOpen = stages.findIndex((s) => s.state === 'todo')
  if (firstOpen >= 0) stages[firstOpen] = { ...stages[firstOpen], state: 'current' }
  return stages
}

function PaperRow({ p, on, onPick }: { p: ExamPaper; on: boolean; onPick: () => void }) {
  const k = kindOf(p)
  return (
    <button type="button" className="ww-paperrow ww-tap" aria-pressed={on} data-paper={p.id} onClick={onPick}>
      <span className="ww-paperrow-title">{p.title}</span>
      <span className="ww-paperrow-meta">
        <span className="ww-paperrow-kind">{KIND_LABEL[k]}</span>
        <span title={p.date}>{fmtDate(p.date)}</span>
        <span>{fmtDays(p.days_left)}</span>
      </span>
    </button>
  )
}

function Detail({ p }: { p: ExamPaper }) {
  const bank = useStudy((s) => (s.bankFor === p.subject ? s.bank : null))
  const disk = useStudy((s) => s.disk[p.subject])
  const practice = useStudy((s) => (s.practice?.paperId === p.id ? s.practice : null))
  const bankTotal = bank ? bank.sizes.total + (disk ?? 0) : undefined
  const stages = stagesFor(p, { bankTotal, paperMarks: practice?.paper && !practice.paper.empty ? practice.paper.total_marks : null, saved: practice?.saved ?? null })
  const units = useMemo(() => {
    const m = new Map<number, ExamTopic[]>()
    p.topics.forEach((t) => m.set(t.unit, [...(m.get(t.unit) ?? []), t]))
    return [...m.entries()]
  }, [p.topics])
  const weakest = useMemo(() => {
    const rank = { high: 0, med: 1, low: 2 }
    return p.topics.filter((t) => t.state === 'none').sort((a, b) => rank[a.weight] - rank[b.weight])[0]
  }, [p.topics])
  const nUnits = p.units.length || new Set(p.topics.map((t) => t.unit)).size
  const onTap = (t: ExamTopic, next: TopicState) => { void useStudy.getState().tapTopic(p.subject, t.key, next) }
  const s = p.paper_score
  return (
    <div className="ww-papers-detail" data-paper-detail={p.id}>
      <Card data-card="study-paper" title={p.title} kicker={`${KIND_LABEL[kindOf(p)]} · ${fmtDate(p.date)}${p.start ? ` · ${p.start}` : ''} · ${fmtDays(p.days_left)}`}>
        <StageStrip label="Paper stages" stages={stages} />
        <p className="ww-papers-line" data-covered="">
          Covered {p.coverage === null || !p.topics.length ? 'not measured' : `${Math.round(p.coverage * 100)} % of ${p.topics.length} topics`}
          {p.target != null ? ` · aim ${p.target} of ${p.max ?? 20}` : ''}
          {p.duration_min ? ` · ${fmtMin(p.duration_min)}` : ''}
        </p>
        <p className="ww-papers-line" data-marks="">
          Marks {s ? `${s.score} of ${s.max} (${fmtDate(s.date)})` : 'none taken yet'}
        </p>
        {weakest && <p className="ww-papers-line" data-weakest="">Weakest topic first, from your taps: {weakest.topic} (unit {weakest.unit}, {weakest.weight} weight).</p>}
        {!p.topics.length && <p className="ww-papers-line">No unit list for this subject yet.</p>}
        {units.map(([u, ts]) => (
          <div key={u} className="ww-unit">
            <p className="ww-unit-head">Unit {u}: {ts[0].unit_title}</p>
            <div className="ww-unit-chips">{ts.map((t) => <TopicChip key={t.key} t={t} onTap={onTap} />)}</div>
          </div>
        ))}
        <div className="ww-sheets" data-sheets="">
          {(p.files?.length ?? 0) > 0
            ? p.files!.map((f) => (
              <Button key={f.path} size="sm" title={f.name} onClick={() => openOverlay('reader', { kind: 'file', path: f.path, title: f.name })}>
                Read {f.name.replace(/\.(md|txt|pdf)$/i, '').replace(/-/g, ' ')}
              </Button>))
            : <Planned id="sheets-rewritten" fill={nUnits ? [0, nUnits] : undefined} />}
        </div>
      </Card>
      <PracticeCell paper={p} />
    </div>
  )
}

export function Papers() {
  const exams = useStudy((s) => s.exams)
  const failed = useStudy((s) => s.examsFailed)
  const selected = useStudy((s) => s.selected)
  const [kind, setKind] = useState<Kind>('all')
  useEffect(() => {
    const st = useStudy.getState()
    void st.loadExams()
    void st.loadHarvest()
  }, [])
  const chosen = exams?.papers.find((p) => p.id === selected)
  useEffect(() => {
    if (!chosen) return
    void useStudy.getState().loadBank(chosen.subject)
    void useStudy.getState().loadDisk(chosen.subject)
  }, [chosen?.id, chosen?.subject])   // eslint-disable-line react-hooks/exhaustive-deps

  if (failed && !exams) return <EmptyState title="The papers could not be read." body="The app did not answer. Is it running?" action={<Button size="sm" onClick={() => void useStudy.getState().loadExams()}>Try again</Button>} />
  if (!exams) return <p className="ww-papers-line" role="status">Reading the papers…</p>
  if (!exams.papers.length) return <EmptyState title="No paper on the date sheet is still ahead." body="Add the next ones in the date sheet and the plan builds itself." />
  const shown = exams.papers.filter((p) => kind === 'all' || kindOf(p) === kind)
  const tentative = exams.papers.some((p) => p.approx)
  return (
    <div className="ww-papers" data-view="papers">
      {tentative && <Banner tone="info">Dates are tentative until the final sheet.</Banner>}
      <MasterDetail
        listLabel="Papers"
        detailLabel="Chosen paper"
        selectedId={selected}
        onSelect={(id) => useStudy.getState().select(id)}
        list={(select, sel) => (
          <Card data-card="study-papers" title={`Papers (${exams.papers.length})`}>
            <Segmented<Kind> label="Show papers" variant="compact" value={kind} onChange={setKind}
              options={[{ id: 'all', label: 'All' }, { id: 'cie', label: 'CIE' }, { id: 'end', label: 'End' }, { id: 'other', label: 'Other' }]} />
            <div className="ww-paperlist">
              {shown.length === 0 && <p className="ww-papers-line">No paper of that kind is ahead.</p>}
              {shown.map((p) => <PaperRow key={p.id} p={p} on={sel === p.id} onPick={() => select(p.id)} />)}
            </div>
          </Card>
        )}
        detail={(sel) => {
          const p = exams.papers.find((x) => x.id === sel)
          return p ? <Detail key={p.id} p={p} /> : <EmptyState title="Pick a paper." />
        }}
      />
    </div>
  )
}
