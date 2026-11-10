/**
 * The Practice cell (plan 4.2): the ONE place a practice paper is made. It is honest in four ways:
 *  - an empty bank has no Practice paper button, only Add questions (the CIE row says its shape is not set);
 *  - the Exam / GATE control disables GATE with its reason while no GATE question exists, and a GATE request
 *    that still comes back as an exam paper prints the server's tier_note, never the GATE label;
 *  - a CIE paper is the server's scaled pattern and says so;
 *  - the harvester's line is worded from its real state ("Queued: n topics (off)"; "Fetching" only while a
 *    request is in flight or finished in the last five minutes) and does not render when the route is absent.
 */
import { useEffect, useMemo, useState } from 'react'
import { Banner, Button, Card, EmptyState, PrimaryButton, Segmented } from '../kit'
import { openOverlay } from '../frame/overlayRegistry'
import { Planned } from '../Planned'
import { kindOf, queueLine, type ExamPaper, type Tier } from './api'
import { useStudy } from './studyStore'

const freshSeed = () => (Date.now() % 9000) + 1

export function PracticeCell({ paper }: { paper: ExamPaper }) {
  const practice = useStudy((s) => (s.practice?.paperId === paper.id ? s.practice : null))
  const bank = useStudy((s) => (s.bankFor === paper.subject ? s.bank : null))
  const disk = useStudy((s) => s.disk[paper.subject])
  const harvest = useStudy((s) => s.harvest)
  const [tier, setTier] = useState<Tier>('exam')
  const [seed, setSeed] = useState(freshSeed)
  useEffect(() => { setTier('exam') }, [paper.id])

  const typedTotal = bank?.sizes.total
  const typedGate = bank?.sizes.tiers.gate ?? 0
  const known = typedTotal !== undefined
  const onDisk = disk ?? 0
  const total = (typedTotal ?? 0) + onDisk
  const empty = known && total === 0
  const queued = useMemo(() => queueLine(harvest, paper.subject), [harvest, paper.subject])
  const queuedForGate = harvest ? harvest.items.filter((i) => String(i.subject).toLowerCase() === paper.subject.toLowerCase() && i.status === 'waiting' && (i.tier ?? 'gate') === 'gate').length : 0
  const gateWhy = typedGate === 0 && onDisk === 0 ? `No GATE questions yet (${queuedForGate} queued).` : undefined

  const make = async (sd: number) => {
    const p = await useStudy.getState().makePaper(paper.id, tier, sd)
    if (p && !p.empty) openOverlay('reader', { kind: 'paper' })
  }
  const paperOut = practice?.paper ?? null
  // the empty bank's Add questions is the page's primary; the one under a paper that came back empty is not
  // (two buttons must never share the fill), and cannot both show: the bank would then be known to be empty
  const addQuestions = (
    <PrimaryButton claimId="study-primary" rank="workspace" size="md" onClick={() => openOverlay('add')}>Add questions</PrimaryButton>
  )
  const addPlain = <Button size="md" onClick={() => openOverlay('add')}>Add questions</Button>
  const kind = kindOf(paper)

  return (
    <Card data-card="study-practice" title="Practice" kicker={`${paper.title}${kind === 'cie' ? ' · CIE' : ''}`} className="ww-practice">
      <div className="ww-practice-body" data-practice="">
        <Segmented<Tier> label="Question level" variant="compact" value={tier} onChange={(t) => setTier(t)}
          options={[{ id: 'exam', label: 'Exam' }, { id: 'gate', label: 'GATE', disabledReason: gateWhy }]} />

        <p className="ww-practice-bank" data-bank="">
          {!known ? 'Reading the bank…' : `Bank: ${total} ${total === 1 ? 'question' : 'questions'} for this paper${onDisk ? ` (${onDisk} on disk)` : ''}.`}
        </p>

        {empty ? (
          kind === 'cie'
            ? <Planned id="cie-practice" fill={paper.max ? [paper.max] : undefined} action={addQuestions} />
            : <EmptyState title="No questions for this paper yet." body="Add one at a time; the generator uses them at once." action={addQuestions} />
        ) : (
          <div className="ww-practice-make">
            <PrimaryButton claimId="study-primary" rank="workspace" loading={practice?.busy} onClick={() => void make(seed)}>
              Practice paper
            </PrimaryButton>
            <span className="ww-practice-hint">
              {kind === 'cie' && paper.max ? `A CIE paper is ${paper.max} marks. ` : ''}Seed {seed}. Opens in the Reader.
            </span>
          </div>
        )}

        {practice?.error && <Banner tone="fault">{practice.error}</Banner>}

        {paperOut?.empty && <EmptyState title={`No questions for ${paperOut.title} yet.`} action={addPlain} />}

        {paperOut && !paperOut.empty && (
          <div className="ww-practice-out" data-paper-out="">
            <p className="ww-practice-sum">
              {paperOut.tier === 'gate' ? 'GATE' : 'Exam'} paper · seed {paperOut.seed} · {paperOut.total_marks} marks
              {paperOut.pattern_scaled ? ', scaled pattern' : ''}
            </p>
            {paperOut.tier_note && <Banner tone="info">{paperOut.tier_note}</Banner>}
            {paperOut.pattern_missing && paperOut.pattern_note && <p className="ww-practice-note">{paperOut.pattern_note}</p>}
            <div className="ww-practice-acts">
              <Button size="sm" onClick={() => openOverlay('reader', { kind: 'paper' })}>Open in Reader</Button>
              <Button size="sm" loading={practice?.busy} onClick={() => { const n = (practice?.seed ?? seed) + 1; setSeed(n); void make(n) }}>New seed</Button>
            </div>
            {practice?.saved && <p className="ww-practice-saved" role="status" data-saved="">{practice.saved}</p>}
            {paperOut.harvest?.short && paperOut.harvest.note && <p className="ww-practice-note" data-harvest-note="">{paperOut.harvest.note}</p>}
          </div>
        )}

        {queued && <p className="ww-practice-queue" data-queue="">{queued}</p>}
      </div>
    </Card>
  )
}
