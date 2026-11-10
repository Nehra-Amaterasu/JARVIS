/**
 * Study > Plan (plan 4.3): today's blocks from the plan engine, ONE next action, Swap inside the block row,
 * and Rebuild that asks first. Nothing here is computed in the page: blocks, contracts and alternatives are
 * /api/mission/today, the exam study blocks are /api/mission/exams.
 */
import { useEffect, useMemo, useState } from 'react'
import { usePlan } from '../../germoney/game/plan'
import type { PlanContract } from '../../germoney/game/plan'
import { Button, Card, EmptyState, Fold, Row } from '../kit'
import { switchWorkspace } from '../frame/navigate'
import { fmtMin } from './format'
import { useStudy } from './studyStore'

const SLOT_WORD: Record<string, string> = { library: 'Library', evening: 'Evening', weekend: 'Weekend', extra: 'Extra', quest: 'Quest' }

function Swap({ first }: { first: PlanContract }) {
  const alts = usePlan((s) => s.today?.alternatives) ?? []
  const choose = usePlan((s) => s.choose)
  const [say, setSay] = useState<string | null>(null)
  if (!alts.length) return null
  return (
    <Fold title={`Swap (${alts.length} other ${alts.length === 1 ? 'option' : 'options'})`} level={4}>
      <ul className="ww-swap">
        {alts.map((a) => (
          <li key={a.key}>
            <Row title={a.title} meta={`${fmtMin(a.minutes)}${a.node_name ? ` · ${a.node_name}` : ''}`}
              action={<Button size="sm" onClick={() => void choose(first.key, a.key).then((r) => setSay(r.say))}>Swap in</Button>} />
          </li>
        ))}
      </ul>
      {say && <p className="ww-papers-line" role="status">{say}</p>}
    </Fold>
  )
}

export function Plan() {
  const today = usePlan((s) => s.today)
  const reroll = usePlan((s) => s.reroll)
  const exams = useStudy((s) => s.exams)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!useStudy.getState().exams) void useStudy.getState().loadExams() }, [])

  const plan = useMemo(() => {
    if (!today) return null
    const rows = today.blocks.map((b) => ({ b, items: b.kind === 'protected' ? [] : today.contracts.filter((c) => c.slot === b.kind) }))
    const next = rows.flatMap((r) => r.items).find((c) => !c.done) ?? null
    const firstTree = today.contracts.find((c) => c.slot === 'library' && c.source === 'tree' && !c.done) ?? null
    return { rows, next, firstTree }
  }, [today])
  const slots = exams?.days.find((d) => d.date === exams.date)?.slots ?? []

  if (!today || !plan) return <p className="ww-papers-line" role="status">Planning the day…</p>
  const e = today.exam
  return (
    <div className="ww-plan" data-view="plan">
      <Card data-card="study-plan" title="Today's plan" kicker={e?.phase ? e.phase.name : e?.subject ? `Exam mode: ${e.subject.name}` : undefined}>
        {e?.advice && (
          <Fold title="Why this order?" level={3}>
            <p className="ww-papers-line">{e.advice}</p>
            {e.milestone && <p className="ww-papers-line">Next milestone: {e.milestone}</p>}
          </Fold>
        )}
        {plan.rows.length === 0 && <EmptyState title="No block is planned for today." />}
        {plan.rows.map(({ b, items }) => (
          <section key={b.id} className="ww-block" data-block={b.kind}>
            <p className="ww-block-head">{b.label} <span className="ww-block-meta">{b.start} · {fmtMin(b.minutes)}</span></p>
            {b.kind === 'protected' && <p className="ww-papers-line">Protected rest. The plan never puts work here.</p>}
            {b.kind !== 'protected' && items.length === 0 && <p className="ww-papers-line">Nothing planned here.</p>}
            {items.map((c) => {
              const isNext = plan.next?.key === c.key
              return (
                <div key={c.key} className="ww-contract" data-contract={c.key} data-next={isNext ? 'true' : undefined}>
                  <Row
                    lead={SLOT_WORD[c.slot] ?? c.slot}
                    title={c.title}
                    meta={`${fmtMin(c.minutes)}${c.node_name ? ` · ${c.node_name}` : ''}${c.hint ? ` · ${c.hint}` : ''}`}
                    state={c.done ? 'done' : 'default'}
                    action={isNext ? <Button size="sm" onClick={() => void switchWorkspace('focus', 'crucible')}>Start in Focus</Button> : undefined}
                  />
                  {plan.firstTree?.key === c.key && <Swap first={c} />}
                </div>
              )
            })}
          </section>
        ))}
        <div className="ww-rebuild">
          {!ask ? (
            <Button size="sm" onClick={() => setAsk(true)}>Rebuild today's plan</Button>
          ) : (
            <div className="ww-confirm" role="group" aria-label="Confirm rebuild">
              <p className="ww-papers-line">Rebuild today's plan? The blocks are drawn again from the bank; contracts you finished stay finished.</p>
              <Button size="sm" loading={busy} onClick={() => { setBusy(true); void reroll().finally(() => { setBusy(false); setAsk(false) }) }}>Rebuild</Button>
              <Button size="sm" onClick={() => setAsk(false)}>Keep the plan</Button>
            </div>
          )}
        </div>
      </Card>

      <Card data-card="study-exam-blocks" title="Exam study today">
        {slots.length === 0 && <p className="ww-papers-line">No exam study block is left today.</p>}
        {slots.map((s, i) => (
          <div key={i} className="ww-exslot">
            <p className="ww-block-head">{s.label} <span className="ww-block-meta">{fmtMin(s.minutes)}</span></p>
            {s.blocks.map((b) => {
              const sub = exams?.papers.find((p) => p.id === b.paper)?.subject
              return (
                <Row key={b.paper} title={b.title} meta={`${fmtMin(b.minutes)}${b.focus.length ? ` · ${b.focus.slice(0, 3).map((f) => f.title).join(', ')}` : ''}`}
                  action={sub ? (
                    <span className="ww-log-acts">
                      {[30, 60].map((m) => <Button key={m} size="sm" grouped aria-label={`Log ${m} minutes on ${b.title}`} onClick={() => void useStudy.getState().logMinutes(sub, m)}>{m} min</Button>)}
                    </span>
                  ) : undefined} />
              )
            })}
          </div>
        ))}
      </Card>
    </div>
  )
}
