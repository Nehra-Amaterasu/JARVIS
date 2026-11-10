// LF4 Quest (plan 4.6): the optional body quest of the day, set by set, and the one Log session button.
// This is the only place the quest log form is mounted (the old Today, Life and Status each had one);
// the Proof column's Quest lines only show progress. Log session takes the saffron fill once a set value
// or a proof link is typed, and gives it back to "All present" while a class is still unmarked.
import { useMemo, useState } from 'react'
import { post } from '../../lib/api'
import { usePlan, type PlanContract } from '../../germoney/game/plan'
import { Card, EmptyState, Field, PrimaryButton, Segmented } from '../kit'
import { questSets, questTyped } from './derive'

interface Props {
  /** A class is still unmarked: the left column's All present owns the fill, so Life declares no primary. */
  classPending: boolean
  index?: number
}

const EMPTY: PlanContract[] = []

export function QuestCard({ classPending, index }: Props) {
  const contracts = usePlan((s) => s.today?.contracts) ?? EMPTY
  const loaded = usePlan((s) => s.today !== null)
  const quests = useMemo(() => contracts.filter((c) => c.source === 'quest' && c.quest), [contracts])
  const [pick, setPick] = useState('')
  const c = quests.find((q) => q.key === pick) ?? quests[0]
  return (
    <Card data-card="LF4" title="Quest" kicker="Optional" loading={!loaded} index={index}>
      {!c ? (
        <EmptyState title="No quest is on today." body="Quest lines are optional. Nothing here counts against you." />
      ) : (
        <>
          {quests.length > 1 && (
            <Segmented label="Quest line" variant="compact" value={c.key} onChange={setPick} options={quests.map((q) => ({ id: q.key, label: q.quest!.track_name }))} />
          )}
          <QuestForm key={c.key} c={c} classPending={classPending} />
        </>
      )}
    </Card>
  )
}

function QuestForm({ c, classPending }: { c: PlanContract; classPending: boolean }) {
  const q = c.quest!
  const unit = q.unit === 'seconds' ? 's' : 'reps'
  const blank = () => Array.from({ length: q.sets }, () => '')
  const [sets, setSets] = useState<string[]>(blank)
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ text: string; tone: 'info' | 'fault' } | null>(null)
  const [problem, setProblem] = useState<string | undefined>()
  const draft = { sets, proof }
  const typed = questTyped(draft)

  const submit = async () => {
    const nums = questSets(draft)
    if (!nums.length) {
      setProblem('Enter what you did in at least one set.')
      return
    }
    setProblem(undefined)
    setBusy(true)
    try {
      const r = await post<{ ok: boolean; say: string }>(`/api/mission/quest/${q.line}/log`, { track: q.track, sets: nums, proof: proof.trim() })
      setSaid({ tone: 'info', text: r.say })
      setSets(blank())
      setProof('')
      void usePlan.getState().refresh()
    } catch (e) {
      setSaid({ tone: 'fault', text: `Could not save that session: ${(e as Error).message}` })
    }
    setBusy(false)
  }

  // The one line under the button says the most pressing thing and nothing stacks: a failure, then a
  // validation message, then the result of the last log, then the hand-over to All present, then the standing note.
  // One line, so the card is the same height in every state and the right column never outgrows 768 px.
  const standing = q.top ? 'Top level.' : `Met on ${q.hits.length} of ${q.hits.length + q.need} days needed for level ${q.level + 1}.`
  const line: { text: string; role?: 'alert' | 'status' } =
    said?.tone === 'fault' ? { text: said.text, role: 'alert' }
    : problem ? { text: problem, role: 'alert' }
    : said ? { text: said.text, role: 'status' }
    : classPending && typed ? { text: 'Classes first: All present takes the fill while one is unmarked.' }
    : { text: standing }
  const touch = () => {
    setSaid(null)
    setProblem(undefined)
  }
  return (
    <div className="ww-life-quest" data-quest={c.key}>
      <p className="ww-life-questline">
        <b>{c.title}</b>
        <span className="ww-life-quest-meta">
          {q.track_name} · level {q.level} of {q.max_level} · {c.minutes} min · {q.sets} × {q.target} {unit}
        </span>
      </p>
      <div className="ww-life-sets">
        {sets.map((v, i) => (
          <Field
            key={i}
            label={`Set ${i + 1}`}
            kind="text"
            inputMode="numeric"
            value={v}
            placeholder={`${q.target} ${unit}`}
            onChange={(e) => {
              touch()
              setSets(sets.map((s, k) => (k === i ? e.target.value.replace(/[^0-9]/g, '') : s)))
            }}
            autoComplete="off"
          />
        ))}
        <Field label="Proof link" kind="text" inputMode="url" value={proof} placeholder="optional" onChange={(e) => {
            touch()
            setProof(e.target.value)
          }} autoComplete="off" className="ww-life-proof" />
      </div>
      <div className="ww-life-quest-foot">
        <PrimaryButton claimId="life-log-session" rank="workspace" when={typed && !classPending} loading={busy} onClick={() => void submit()}>
          {c.done ? 'Log another session' : 'Log session'}
        </PrimaryButton>
        <span className="ww-life-quest-note" role={line.role}>
          {line.text}
        </span>
      </div>
    </div>
  )
}
