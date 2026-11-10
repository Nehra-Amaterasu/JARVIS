// Career > Plan: CA8 Ladder, CA9 Goals (read-only), CA10 Parking, CA11 Rewards (game currency only).
// Four cards in a 2 x 2 grid; each pages its own rows (plan 3.3, 4.7).
import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { usePlan } from '../../germoney/game/plan'
import { useGame } from '../../germoney/game/store'
import { useStore } from '../../lib/store'
import { Button, Card, Drawer, Field, IconButton, Row, Segmented } from '../kit'
import { switchWorkspace } from '../frame/navigate'
import { Paged } from './Paged'

type Rung = 'year' | 'quarter' | 'month' | 'week'

function ReviewDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const l = usePlan((s) => s.ladder)
  const review = usePlan((s) => s.review)
  const toast = useStore((s) => s.toast)
  const [r, setR] = useState({ went_well: '', slipped: '', next: '' })
  return (
    <Drawer open={open} onClose={onClose} title="Monthly review">
      <div className="cr-form">
        <Field label="What went well" value={r.went_well} onChange={(e) => setR({ ...r, went_well: e.target.value })} />
        <Field label="What slipped" hint="Said plainly." value={r.slipped} onChange={(e) => setR({ ...r, slipped: e.target.value })} />
        <Field label="One change for next month" value={r.next} onChange={(e) => setR({ ...r, next: e.target.value })} />
        <Button
          tone="primary"
          disabledReason={r.went_well.trim() || r.slipped.trim() || r.next.trim() ? undefined : 'Write at least one line'}
          onClick={() =>
            void review(r).then(() => {
              toast('Review saved.', 'live')
              setR({ went_well: '', slipped: '', next: '' })
              onClose()
            })
          }
        >
          Save review
        </Button>
        {(l?.reviews ?? []).slice(-3).reverse().map((x) => (
          <p key={x.month} className="cr-sub">
            {x.month}: {x.went_well}
            {x.slipped ? ` . slipped: ${x.slipped}` : ''}
            {x.next ? ` . next: ${x.next}` : ''}
          </p>
        ))}
      </div>
    </Drawer>
  )
}

function Ladder() {
  const l = usePlan((s) => s.ladder)
  const load = usePlan((s) => s.loadLadder)
  const [rung, setRung] = useState<Rung>('quarter')
  const [review, setReview] = useState(false)
  useEffect(() => {
    void load()
  }, [load])
  const goals = useMemo(() => {
    if (!l) return []
    if (rung === 'year') return (l.years.find((y) => y.year === l.year)?.milestones ?? []).map((m) => ({ id: m.id, title: m.title, serves: null as string | null }))
    const src = rung === 'quarter' ? l.quarter.goals : rung === 'month' ? l.month.goals : l.week.goals
    return src.map((g, i) => ({ id: `${rung}-${i}`, title: g.title, serves: g.serves }))
  }, [l, rung])
  const ends = l ? (rung === 'quarter' ? `${l.quarter.label}, to ${l.quarter.ends}` : rung === 'month' ? l.month.label : rung === 'week' ? `to ${l.week.ends}` : `${l.year} milestones`) : ''
  return (
    <Card
      data-card="CA8"
      title="Ladder"
      kicker={l ? `${l.vision.horizon}: ${l.vision.title}` : undefined}
      loading={!l}
      action={
        <Button size="sm" onClick={() => setReview(true)}>
          {l?.review_due ? 'Monthly review due' : 'Monthly review'}
        </Button>
      }
      className="cr-fill"
    >
      <Segmented<Rung> label="Ladder level" variant="compact" value={rung} onChange={setRung} options={[{ id: 'year', label: 'Year' }, { id: 'quarter', label: 'Quarter' }, { id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }]} />
      <p className="cr-sub">{ends}</p>
      <Paged items={goals} rowKey={(g) => g.id} row={(g) => <Row title={<span className="cr-clip" title={g.title}>{g.title}</span>} />} label="ladder goals" fallback={3} empty="Nothing derived at this level yet." />
      <ReviewDrawer open={review} onClose={() => setReview(false)} />
    </Card>
  )
}

function Goals() {
  const all = usePlan((s) => s.applications?.goals)
  const loaded = !!all
  const rows = useMemo(() => (all ?? []).filter((g) => g.kind === 'long_term').flatMap((g) => g.milestones.map((m) => ({ ...m, goal: g.title }))), [all])
  return (
    <Card
      data-card="CA9"
      title="Goals"
      kicker="read-only here"
      loading={!loaded}
      action={
        <Button size="sm" onClick={() => void switchWorkspace('setup', 'goals')}>
          Edit goals
        </Button>
      }
      className="cr-fill"
    >
      <Paged
        items={rows}
        rowKey={(m) => m.id}
        row={(m) => (
          <Row lead={<span className="cr-when">{m.by ?? ''}</span>} title={<span className="cr-clip" title={m.title}>{m.title}</span>} meta={<span className="cr-clip">{m.goal}</span>} state={m.done ? 'done' : 'default'} action={<span className="cr-cost">{Math.round(m.progress * 100)} %</span>} />
        )}
        label="goal milestones"
        fallback={3}
        empty="No milestones yet: each one links to the skill-tree nodes that earn it."
      />
    </Card>
  )
}

function Parking() {
  const parking = usePlan((s) => s.state?.parking)
  const unpark = usePlan((s) => s.unpark)
  const list = useMemo(() => (parking ?? []).slice().reverse(), [parking])
  return (
    <Card data-card="CA10" title="Parking lot" kicker="ideas waiting their turn" className="cr-fill">
      <Paged
        items={list}
        rowKey={(p) => p.id}
        row={(p) => (
          <Row
            lead={<span className="cr-when">{p.at}</span>}
            title={<span className="cr-clip" title={p.text}>{p.text}</span>}
            action={
              <IconButton label={`Remove idea: ${p.text}`} size="sm" onClick={() => void unpark(p.id)}>
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
            }
          />
        )}
        label="parked ideas"
        fallback={3}
        empty="Empty. When a new idea arrives mid-contract, park it from Today."
      />
    </Card>
  )
}

function Rewards() {
  const marks = useGame((s) => s.g.marks)
  const shop = useGame((s) => s.g.shop)
  const buy = useGame((s) => s.buy)
  const toast = useStore((s) => s.toast)
  const [pending, setPending] = useState<string | null>(null)
  const ordered = useMemo(() => [...shop.filter((i) => i.kind === 'reward'), ...shop.filter((i) => i.kind !== 'reward')], [shop])
  return (
    <Card data-card="CA11" title="Rewards" kicker={`${marks} DM to spend . you set the menu and the prices`} className="cr-fill">
      <Paged
        items={ordered}
        rowKey={(i) => i.id}
        row={(i) => (
          <Row
            title={<span className="cr-clip" title={i.label}>{i.label}</span>}
            meta={`${i.cost} DM . ${i.kind}`}
            action={
              pending === i.id ? (
                <>
                  <Button
                    size="sm"
                    tone="primary"
                    onClick={() => {
                      const e = buy(i.id)
                      setPending(null)
                      if (e) toast(e, 'fault')
                    }}
                  >
                    Spend {i.cost} DM
                  </Button>
                  <Button size="sm" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" disabledReason={marks >= i.cost ? undefined : `${i.cost - marks} DM short`} onClick={() => setPending(i.id)}>
                  Buy
                </Button>
              )
            }
          />
        )}
        label="rewards"
        fallback={3}
        empty="No rewards on the menu yet."
      />
    </Card>
  )
}

export function PlanView() {
  return (
    <div className="cr-view cr-plan" data-view="plan">
      <Ladder />
      <Goals />
      <Parking />
      <Rewards />
    </div>
  )
}
