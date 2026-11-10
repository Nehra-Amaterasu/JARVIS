// LF4 Quest (plan 4.6): the optional body quest of the day, set by set, and the one Log session button.
// This is the only place the quest log form is mounted (the old Today, Life and Status each had one);
// the Proof column's Quest lines only show progress. Log session takes the saffron fill once a set value
// or a proof link is typed, and gives it back to "All present" while a class is still unmarked.
import { useMemo, useState } from 'react'
import { post } from '../../lib/api'
import { usePlan, type PlanContract } from '../../germoney/game/plan'
import { Button, Card, EmptyState, Field, PrimaryButton, Segmented } from '../kit'
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

  return (
    <div className="ww-life-quest" data-quest={c.key}>
      <p className="ww-life-questline">
        <b>{c.title}</b>
        <span className="ww-life-quest-meta">
          {q.track_name} · level {q.level} of {q.max_level} · {c.minutes} min · standard {q.sets} × {q.target} {unit}
        </span>
      </p>
      <div className="ww-life-sets">
        {sets.map((v, i) => (
          <Field
            key={i}
            label={`Set ${i + 1}`}
            unit={unit}
            kind="text"
            inputMode="numeric"
            value={v}
            placeholder={String(q.target)}
            onChange={(e) => setSets(sets.map((x, k) => (k === i ? e.target.value.replace(/[^0-9]/g, '') : x)))}
            error={i === 0 ? problem : undefined}
            autoComplete="off"
          />
        ))}
      </div>
      <Field label="Proof link (optional)" kind="text" inputMode="url" value={proof} onChange={(e) => setProof(e.target.value)} autoComplete="off" />
      <div className="ww-life-quest-foot">
        <PrimaryButton claimId="life-log-session" rank="workspace" when={typed && !classPending} loading={busy} onClick={() => void submit()}>
          {c.done ? 'Log another session' : 'Log session'}
        </PrimaryButton>
        {classPending && typed && <span className="ww-life-hand">Classes first: All present takes the fill while one is unmarked.</span>}
      </div>
      {said && (
        <p className="ww-life-notice" role={said.tone === 'fault' ? 'alert' : 'status'} data-tone={said.tone}>
          <span>{said.text}</span>
          <Button size="sm" onClick={() => setSaid(null)}>
            Dismiss
          </Button>
        </p>
      )}
      <p className="ww-life-quest-note">{q.top ? 'Top level.' : `Met on ${q.hits.length} of ${q.hits.length + q.need} days needed for level ${q.level + 1}.`}</p>
    </div>
  )
}
