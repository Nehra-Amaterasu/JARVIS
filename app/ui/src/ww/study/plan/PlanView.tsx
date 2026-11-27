// The registered face of `study.plan` under shell v2 (package Y03). It reads the plan store, the exam store and the Study port and
// hands plain data to the PlanBoard. With the shell flag off the classic frame still renders ww/study/Plan.tsx; this file is never
// read there. The plan, the exams and the swap are the classic page's own calls, moved and not rewritten.
import { useEffect, useMemo, useState } from 'react'
import { usePlan } from '../../../germoney/game/plan'
import { switchWorkspace } from '../../frame/navigate'
import { showsNumber } from '../../../shared/lamp'
import { lookV3Enabled } from '../../../shell/v3'
import { LedgerFace } from '../ledger/LedgerView'
import { Faces } from '../tonight/shared'
import { STUDY_PORT, type StudyPort } from '../ports'
import { useStudy } from '../studyStore'
import { Waiting } from '../library/Waiting'
import { PlanBoard, type RetentionReading } from './PlanBoard'
import { chosenPaper, unitsOfPaper } from './model'

const NO_ENGINE: RetentionReading = { state: 'waiting', reason: 'review cards need the paper engine', dueCount: null, topics: [], dueIds: [] }

/** Cards due today, read through the port. Bands per topic arrive with the card engine; until then the orbit stays empty and says why. */
export function useRetention(port: StudyPort): RetentionReading {
  const [r, setR] = useState<RetentionReading>(NO_ENGINE)
  useEffect(() => {
    let live = true
    port.readiness().then((x) => {
      if (!live) return
      if (showsNumber(x.state) && x.data) setR({ state: x.state, reason: x.reason, dueCount: x.data.cardsDue, topics: [], dueIds: [] })
      else setR({ ...NO_ENGINE, state: x.state, reason: x.reason })
    }).catch(() => { if (live) setR({ ...NO_ENGINE, state: 'fault', reason: 'the readiness route did not answer' }) })
    return () => { live = false }
  }, [port])
  return r
}

/** Under the v3 look the Plan view has two faces (package N2): today's plan as it was, and the counted ledger of the syllabus. */
export default function PlanView({ port = STUDY_PORT }: { port?: StudyPort }) {
  if (!lookV3Enabled()) return <PlanToday port={port} />
  return (
    <Faces first="today" label="Plan faces" className="tsh-plan" faces={[
      { id: 'today', label: 'Today', node: <PlanToday port={port} /> },
      { id: 'ledger', label: 'Ledger', node: <LedgerFace /> },
    ]} />
  )
}

function PlanToday({ port }: { port: StudyPort }) {
  const today = usePlan((s) => s.today)
  const reroll = usePlan((s) => s.reroll)
  const choose = usePlan((s) => s.choose)
  const exams = useStudy((s) => s.exams)
  const [paperId, setPaperId] = useState<string | null>(null)
  const retention = useRetention(port)
  useEffect(() => { if (!useStudy.getState().exams) void useStudy.getState().loadExams() }, [])

  const paper = chosenPaper(exams?.papers ?? [], paperId)
  const units = useMemo(() => unitsOfPaper(paper), [paper])
  if (!today) return <Waiting what="Planning the day…" />
  return (
    <PlanBoard
      today={today}
      exams={exams}
      paperId={paper?.id ?? null}
      onPaper={setPaperId}
      units={units}
      unitsReading={{ state: 'waiting', reason: 'marks per unit need the paper engine' }}
      retention={retention}
      clock={today.date}
      onStart={() => void switchWorkspace('focus', 'crucible')}
      onRebuild={() => reroll()}
      onSwap={(first, alt) => choose(first, alt).then((r) => r.say)}
      onLog={(subject, minutes) => void useStudy.getState().logMinutes(subject, minutes)}
      onDrill={() => void switchWorkspace('focus', 'drill')}
    />
  )
}
