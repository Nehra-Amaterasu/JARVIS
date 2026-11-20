// Career / Ladder (spec 20.8.6, package T02), and Path as its second state. Ladder: the long goals as rungs of a stepped ladder, the
// derived quarter, month and week goals as the classic Plan page had them, the monthly review, the parking lot and the rewards in
// two drawers. Path: a constellation of the roles the student wrote or imported, each star as bright as the share of its skills that
// stand on EVIDENCED Tree nodes, and a gap list ranked by how many roles each missing node unlocks. The spec's one sentence about what
// these matches are (MATCH_NOTE in model.ts) sits with both faces.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { usePlan, type Ladder as LadderData, type Goal } from '../../../germoney/game/plan'
import { useGame } from '../../../germoney/game/store'
import { useStore } from '../../../lib/store'
import { loadBank } from '../../../germoney/data/bank'
import { useShell } from '../../../shell/store'
import { switchWorkspace } from '../../frame/navigate'
import { Button, Drawer, Field, IconButton, PrimaryButton } from '../../../shared/kit'
import { LampWord } from '../../left/LampWord'
import { MATCH_NOTE, gapList, treeNodes, matchJd, nodePoints, readRoles, starPoints, type Gap, type RoleRead } from './model'
import { slug, useCareerLocal, type RoleProfile } from './store'
import { Choice, Frame, Plate, useWidth, PHONE_BELOW } from './ui'

type Face = 'ladder' | 'path'
type Rung = 'year' | 'quarter' | 'month' | 'week'
export interface NodeName { id: string; name: string }

export interface LadderProps {
  ladder: LadderData | null
  goals: Goal[] | null
  roles: RoleProfile[]
  tagNode: Record<string, string>
  /** Node ids that are EVIDENCED; null while the plan state has not answered (WAITING). */
  evidenced: ReadonlySet<string> | null
  nodes: NodeName[]
  parking: ReactNodeLike
  rewards: ReactNodeLike
  review: ReactNodeLike
  onAddRole: (r: RoleProfile, tagNode: Record<string, string>) => void
  onRemoveRole: (id: string) => void
  onOpenGap: (g: Gap) => void
  onGoals: () => void
  reviewDue?: boolean
  width?: number
  initialFace?: Face
  initialDrawer?: string | null
  initialPick?: string | null
  simulated?: boolean
}
type ReactNodeLike = import('react').ReactNode

const RUNGS: { id: Rung; label: string }[] = [{ id: 'year', label: 'Year' }, { id: 'quarter', label: 'Quarter' }, { id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }]

function LadderFace({ ladder, goals, onGoals }: { ladder: LadderData | null; goals: Goal[] | null; onGoals: () => void }) {
  const [rung0, setRung] = useState<Rung | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const first = ladder?.year ?? new Date().getFullYear()
  // five rungs, this year and the four after it; a year with no milestone is a hollow rung, never an invented one
  const years = Array.from({ length: 5 }, (_, i) => ladder?.years.find((y) => y.year === first + i) ?? { year: first + i, milestones: [] as { id: string; title: string; kind?: string }[] })
  const sel = year ?? first
  // open on the first level that has something to say, so the page never opens on an empty list when another level is full
  const filled: Rung = !ladder ? 'quarter' : ladder.quarter.goals.length ? 'quarter' : ladder.month.goals.length ? 'month' : ladder.week.goals.length ? 'week' : 'year'
  const rung = rung0 ?? filled
  const rows = useMemo(() => {
    if (!ladder) return []
    if (rung === 'year') return (ladder.years.find((y) => y.year === sel)?.milestones ?? []).map((m) => ({ id: m.id, title: m.title, serves: null as string | null }))
    const src = rung === 'quarter' ? ladder.quarter.goals : rung === 'month' ? ladder.month.goals : ladder.week.goals
    return src.map((g, i) => ({ id: `${rung}-${i}`, title: g.title, serves: g.serves }))
  }, [ladder, rung, sel])
  const ends = ladder ? (rung === 'quarter' ? `${ladder.quarter.label}, to ${ladder.quarter.ends}` : rung === 'month' ? ladder.month.label : rung === 'week' ? `to ${ladder.week.ends}` : `${sel} milestones`) : ''
  const longGoals = (goals ?? []).filter((g) => g.kind === 'long_term')
  const state = ladder ? 'live' : 'waiting'
  return (
    <div className="t2-ladder">
      <Plate id="rungs" label="THE LADDER" state={state} reason={ladder ? `your own plan: ${ladder.vision.title}` : 'the plan has not answered'} className="t2-rungsplate">
        {!ladder ? <p className="t2-quiet">WAITING: the plan has not answered, so no rung is drawn.</p> : (
          <ol className="t2-rungs" aria-label="Yearly rungs, lowest first">
            {years.map((y, i) => {
              const linked = longGoals.flatMap((g) => g.milestones).filter((m) => (m.by ?? '').startsWith(String(y.year)))
              const nodeN = new Set(linked.flatMap((m) => m.linked_nodes)).size
              return (
                <li key={y.year} style={{ ['--step' as string]: i }}>
                  <button type="button" className="t2-rung" data-empty={y.milestones.length === 0 ? 'true' : undefined} aria-pressed={sel === y.year && rung === 'year'} onClick={() => { setYear(y.year); setRung('year') }}>
                    <b>{y.year}</b>
                    <span>{y.milestones.length ? `${y.milestones.length} milestone${y.milestones.length === 1 ? '' : 's'}` : 'no milestone yet'}</span>
                    <small>{y.milestones.length ? `${nodeN} tree node${nodeN === 1 ? '' : 's'} tied` : 'PLANNED'}</small>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
        <p className="t2-note">{MATCH_NOTE}</p>
      </Plate>
      <Plate id="goals" label="GOALS" state={state} reason={ends || 'waiting'} className="t2-goalsplate" corner={<Choice<Rung> label="Ladder level" value={rung} onChange={setRung} options={RUNGS} />}>
        {!ladder ? <p className="t2-quiet">WAITING: nothing derived yet.</p> : rows.length === 0 ? <p className="t2-quiet">Nothing derived at this level yet.</p> : (
          <ul className="t2-goals" aria-label={`Goals, ${ends}`}>
            {rows.slice(0, 6).map((g) => <li key={g.id}><b>{g.title}</b>{g.serves && <small>serves {g.serves}</small>}</li>)}
          </ul>
        )}
        {longGoals.length > 0 && (
          <div className="t2-milestones">
            <p className="t2-quiet">Long goals, read only <LampWord state="live" /></p>
            <ul aria-label="Long goal milestones">
              {longGoals.flatMap((g) => g.milestones.map((m) => ({ ...m, goal: g.title }))).slice(0, 4).map((m) => (
                <li key={m.id} data-done={m.done ? 'true' : undefined}><span>{m.by ?? ''}</span><b>{m.title}</b><output>{Math.round(m.progress * 100)} %</output></li>
              ))}
            </ul>
            <Button size="md" onClick={onGoals}>Edit goals</Button>
          </div>
        )}
      </Plate>
    </div>
  )
}

function Hex() {
  return <svg className="t2-hex" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><polygon points="7,1 12.5,4 12.5,10 7,13 1.5,10 1.5,4" /></svg>
}

function PathFace({ p, reads, gaps, pick, setPick, live, nodeName }: {
  p: LadderProps; reads: RoleRead[]; gaps: Gap[]; pick: string | null; setPick: (id: string | null) => void; live: boolean; nodeName: (id: string) => string
}) {
  const stars = starPoints(reads.length, 100, 100)
  const nodeIds = [...new Set(reads.flatMap((r) => r.needs.map((n) => n.node).filter((n): n is string => !!n)))]
  const nodes = nodePoints(nodeIds, 100, 100)
  const chosen = reads.find((r) => r.id === pick) ?? null
  const needed = new Set(chosen?.needs.map((n) => n.node).filter(Boolean) as string[])
  const [gapAt, setGapAt] = useState<string | null>(null)
  const starRefs = useRef<(HTMLButtonElement | null)[]>([])
  const roveStar = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    starRefs.current[(i + d + reads.length) % reads.length]?.focus()
  }
  const gap = gaps.find((g) => g.key === gapAt) ?? gaps[0] ?? null
  return (
    <div className="t2-path">
      <Plate id="constellation" label="ROLE CONSTELLATION" state={reads.length === 0 ? 'waiting' : live ? 'live' : 'waiting'} reason={reads.length === 0 ? 'no role yet: import one job description' : live ? 'brightness is the share of skills evidenced' : 'the plan has not answered, so no share is shown'} className="t2-skyplate">
        {reads.length === 0 ? (
          <div className="t2-sky-empty">
            <p className="t2-quiet">No role profile yet. Write one, or paste one job description: it is read on this computer and matched to your Tree nodes by keyword, in a table you can edit.</p>
            <Button size="lg" tone="primary" onClick={() => p.onOpenGap({ key: '', label: '', node: null, unlocks: 0, roles: [] })}>Import a job description</Button>
          </div>
        ) : (
          <div className="t2-sky" role="group" aria-label="Roles as stars, skills on the outer ring">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              {reads.flatMap((r, i) => r.needs.filter((n) => n.node && nodes[n.node]).map((n) => (
                <line key={`${r.id}:${n.tag}`} x1={stars[i].x} y1={stars[i].y} x2={nodes[n.node!].x} y2={nodes[n.node!].y} vectorEffect="non-scaling-stroke" data-lit={n.evidenced ? 'true' : 'false'} data-pick={pick === r.id ? 'true' : undefined} />
              )))}
            </svg>
            {nodeIds.map((id) => (
              <span key={id} className="t2-skill" data-on={needed.has(id) ? 'true' : undefined} data-evidenced={p.evidenced?.has(id) ? 'true' : 'false'} style={{ left: `${nodes[id].x}%`, top: `${nodes[id].y}%` }}>
                {p.evidenced?.has(id) ? <i aria-hidden="true" /> : <Hex />}
                <span className="t2-skill-name" data-side={nodes[id].x < 50 ? 'l' : 'r'}>{nodeName(id)}</span>
              </span>
            ))}
            {reads.map((r, i) => (
              <button
                key={r.id} type="button" className="t2-star" ref={(el) => { starRefs.current[i] = el }} onKeyDown={(e) => roveStar(e, i)} style={{ left: `${stars[i].x}%`, top: `${stars[i].y}%`, ['--lit' as string]: live ? r.share : 0 }} aria-pressed={pick === r.id} data-lit={live && r.share > 0 ? 'true' : 'false'}
                aria-label={live ? `${r.title}: ${Math.round(r.share * 100)} percent of skills evidenced, ${r.evidencedN} of ${r.total}, LIVE` : `${r.title}: WAITING, no share until the plan answers`}
                onClick={() => setPick(pick === r.id ? null : r.id)}
              >
                <i aria-hidden="true" style={{ width: `${18 + (live ? r.share : 0) * 14}px`, height: `${18 + (live ? r.share : 0) * 14}px` }} />
                <b>{r.title}</b>
                <small>{live ? `${Math.round(r.share * 100)} % ${r.evidencedN} of ${r.total}` : '-- waiting'}</small>
              </button>
            ))}
          </div>
        )}
        <p className="t2-note">{MATCH_NOTE}</p>
      </Plate>
      <Plate id="gaps" label="GAP LIST" state={reads.length === 0 ? 'waiting' : live ? 'live' : 'waiting'} reason="ranked by roles unlocked" className="t2-gapplate">
        {chosen && (
          <div className="t2-needs" aria-label={`Skills of ${chosen.title}`}>
            <p className="t2-quiet"><b>{chosen.title}</b> needs:</p>
            <ul>
              {chosen.needs.map((n) => <li key={n.tag} data-evidenced={n.evidenced ? 'true' : 'false'}>{n.evidenced ? <i aria-hidden="true" /> : <Hex />}<span>{n.tag}</span><small>{n.evidenced ? 'evidenced' : n.node ? 'gap' : 'not linked to a node'}</small></li>)}
            </ul>
          </div>
        )}
        {gaps.length === 0 ? <p className="t2-quiet">{reads.length === 0 ? 'No gap to list until a role is added.' : live ? 'Every skill of every role is evidenced.' : 'WAITING: no gap is listed until the plan answers.'}</p> : (
          <ul className="t2-gaplist" aria-label="Missing skills">
            {gaps.slice(0, 5).map((g) => (
              <li key={g.key} data-sel={gap?.key === g.key ? 'true' : undefined}>
                <button type="button" onClick={() => { setGapAt(g.key); p.onOpenGap(g) }} onFocus={() => setGapAt(g.key)} aria-label={`${g.label}: unlocks ${g.unlocks} role${g.unlocks === 1 ? '' : 's'}. Enter opens it on the Tree`}>
                  <Hex /><span>{g.label}</span><output>{g.unlocks}</output>
                </button>
              </li>
            ))}
          </ul>
        )}
        {gap && (
          <span className="t2-planned">
            <Button size="md" disabledReason="Life blocks from a gap are PLANNED: the Day port has no write route">Plan this gap</Button>
            <LampWord state="planned" />
          </span>
        )}
      </Plate>
    </div>
  )
}

export function LadderView(p: LadderProps) {
  const [rootRef, w] = useWidth<HTMLDivElement>(p.width)
  const phone = w < PHONE_BELOW
  const [face, setFace] = useState<Face>(p.initialFace ?? 'ladder')
  const [drawer, setDrawer] = useState<string | null>(p.initialDrawer ?? null)
  const [pick, setPick] = useState<string | null>(p.initialPick ?? null)
  const nameOf = useMemo(() => new Map(p.nodes.map((n) => [n.id, n.name])), [p.nodes])
  const nodeName = (id: string) => nameOf.get(id) ?? id
  const live = p.evidenced !== null
  const reads = useMemo(() => readRoles(p.roles, p.tagNode, p.evidenced ?? new Set()), [p.roles, p.tagNode, p.evidenced])
  const gaps = useMemo(() => (live ? gapList(reads, nodeName) : []), [reads, live]) // eslint-disable-line react-hooks/exhaustive-deps
  const openImport = (g: Gap) => { if (g.key === '' ) setDrawer('import'); else p.onOpenGap(g) }
  return (
    <Frame
      simulated={p.simulated} view="ladder" ruler="LADDER" title={face === 'ladder' ? 'Ladder' : 'Path'} form={phone ? 'phone' : 'desk'} rootRef={rootRef} state={face === 'ladder' ? (p.ladder ? 'live' : 'waiting') : live ? 'live' : 'waiting'}
      sub={face === 'ladder' ? 'The long goals as rungs and what each level asks of the next month. Your own plan, read from the plan store.' : 'Roles you wrote or imported, matched to your Tree nodes by keyword. A star is as bright as the share of its skills with evidence.'}
      keys={
        <>
          <Choice<Face> label="Ladder or Path" value={face} onChange={setFace} options={[{ id: 'ladder', label: 'Ladder' }, { id: 'path', label: 'Path' }]} />
          <Button size="lg" onClick={() => setDrawer('parking')}>Parking and rewards</Button>
          {face === 'ladder'
            ? <PrimaryButton claimId="career-ladder" rank="workspace" size="lg" onClick={() => setDrawer('review')}>{p.reviewDue ? 'Review is due' : 'Monthly review'}</PrimaryButton>
            : <PrimaryButton claimId="career-ladder" rank="workspace" size="lg" onClick={() => setDrawer('import')}>Add a role</PrimaryButton>}
        </>
      }
      extra={
        <>
          <Drawer open={drawer === 'review'} onClose={() => setDrawer(null)} title="Monthly review" className="t2-drawer">{p.review}</Drawer>
          <Drawer open={drawer === 'parking'} onClose={() => setDrawer(null)} title="Parking and rewards" className="t2-drawer">{p.parking}{p.rewards}</Drawer>
          <ImportDrawer open={drawer === 'import'} onClose={() => setDrawer(null)} nodes={p.nodes} roles={p.roles} onAdd={p.onAddRole} onRemove={p.onRemoveRole} />
        </>
      }
    >
      {face === 'ladder'
        ? <LadderFace ladder={p.ladder} goals={p.goals} onGoals={p.onGoals} />
        : <PathFace p={{ ...p, onOpenGap: openImport }} reads={reads} gaps={gaps} pick={pick} setPick={setPick} live={live} nodeName={nodeName} />}
    </Frame>
  )
}

function ImportDrawer({ open, onClose, nodes, roles, onAdd, onRemove }: { open: boolean; onClose: () => void; nodes: NodeName[]; roles: RoleProfile[]; onAdd: LadderProps['onAddRole']; onRemove: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<{ tag: string; node: string }[]>([])
  const [manual, setManual] = useState('')
  const match = () => setRows(matchJd(text, nodes))
  const save = () => {
    const tags = [...rows.map((r) => r.tag), ...manual.split(',').map((t) => t.trim()).filter(Boolean)]
    const map: Record<string, string> = {}
    for (const r of rows) map[r.tag] = r.node
    onAdd({ id: slug(title) || `role-${Date.now().toString(36)}`, title: title.trim(), tags: [...new Set(tags)] }, map)
    setTitle(''); setText(''); setRows([]); setManual('')
    onClose()
  }
  return (
    <Drawer open={open} onClose={onClose} title="Add a role" className="t2-drawer">
      <div className="t2-form">
        <p className="t2-quiet">{MATCH_NOTE}</p>
        <Field label="Role title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Field label="A job description you pasted" kind="area" value={text} onChange={(e) => setText(e.target.value)} hint="Read on this computer only. Nothing is sent anywhere." />
        <Button size="md" disabledReason={text.trim() ? undefined : 'Paste a description first'} onClick={match}>Match to my nodes</Button>
        {rows.length > 0 && (
          <ul className="t2-matches" aria-label="Keyword matches, edit them">
            {rows.map((r) => <li key={r.tag}><span>{r.tag}</span><IconButton label={`Drop the match ${r.tag}`} size="md" onClick={() => setRows(rows.filter((x) => x.tag !== r.tag))}><Trash2 size={16} aria-hidden="true" /></IconButton></li>)}
          </ul>
        )}
        {text.trim() && rows.length === 0 && <p className="t2-quiet">No keyword matched a node. Add the skills by hand below.</p>}
        <Field label="More skills, separated by commas" value={manual} onChange={(e) => setManual(e.target.value)} hint="A skill with no node yet stays a gap until you link it on the Tree." />
        <Button tone="primary" size="lg" disabledReason={title.trim() && (rows.length > 0 || manual.trim()) ? undefined : 'Type a title and at least one skill'} onClick={save}>Add the role</Button>
        {roles.length > 0 && (
          <ul className="t2-matches" aria-label="Your roles">
            {roles.map((r) => <li key={r.id}><span>{r.title}</span><IconButton label={`Remove the role ${r.title}`} size="md" onClick={() => onRemove(r.id)}><Trash2 size={16} aria-hidden="true" /></IconButton></li>)}
          </ul>
        )}
      </div>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------------------------- panels that keep the classic Plan page's features

function ReviewPanel() {
  const l = usePlan((s) => s.ladder)
  const review = usePlan((s) => s.review)
  const toast = useStore((s) => s.toast)
  const [r, setR] = useState({ went_well: '', slipped: '', next: '' })
  return (
    <div className="t2-form">
      <Field label="What went well" value={r.went_well} onChange={(e) => setR({ ...r, went_well: e.target.value })} />
      <Field label="What slipped" hint="Said plainly." value={r.slipped} onChange={(e) => setR({ ...r, slipped: e.target.value })} />
      <Field label="One change for next month" value={r.next} onChange={(e) => setR({ ...r, next: e.target.value })} />
      <Button tone="primary" size="lg" disabledReason={r.went_well.trim() || r.slipped.trim() || r.next.trim() ? undefined : 'Write at least one line'} onClick={() => void review(r).then(() => { toast('Review saved.', 'live'); setR({ went_well: '', slipped: '', next: '' }) })}>Save review</Button>
      {(l?.reviews ?? []).slice(-3).reverse().map((x) => (
        <p key={x.month} className="t2-quiet">{x.month}: {x.went_well}{x.slipped ? `. Slipped: ${x.slipped}` : ''}{x.next ? `. Next: ${x.next}` : ''}</p>
      ))}
    </div>
  )
}

function ParkingPanel() {
  const parking = usePlan((s) => s.state?.parking)
  const unpark = usePlan((s) => s.unpark)
  const list = useMemo(() => (parking ?? []).slice().reverse(), [parking])
  return (
    <div className="t2-form">
      <p className="t2-quiet"><b>Parking lot.</b> Ideas waiting their turn. When a new idea arrives mid-contract, park it from Today.</p>
      {list.length === 0 && <p className="t2-quiet">Empty.</p>}
      {list.map((x) => (
        <p key={x.id} className="t2-park"><span>{x.at}</span><b>{x.text}</b><IconButton label={`Remove idea: ${x.text}`} size="md" onClick={() => void unpark(x.id)}><Trash2 size={16} aria-hidden="true" /></IconButton></p>
      ))}
    </div>
  )
}

function RewardsPanel() {
  const marks = useGame((s) => s.g.marks)
  const shop = useGame((s) => s.g.shop)
  const buy = useGame((s) => s.buy)
  const toast = useStore((s) => s.toast)
  const [pending, setPending] = useState<string | null>(null)
  const ordered = useMemo(() => [...shop.filter((i) => i.kind === 'reward'), ...shop.filter((i) => i.kind !== 'reward')], [shop])
  return (
    <div className="t2-form">
      <p className="t2-quiet"><b>Rewards.</b> {marks} DM to spend. You set the menu and the prices; this is game currency, not money.</p>
      {ordered.length === 0 && <p className="t2-quiet">No rewards on the menu yet.</p>}
      {ordered.map((i) => (
        <p key={i.id} className="t2-park"><b>{i.label}</b><span>{i.cost} DM, {i.kind}</span>
          {pending === i.id
            ? <span className="t2-camp-keys"><Button size="md" onClick={() => { const e = buy(i.id); setPending(null); if (e) toast(e, 'fault') }}>Spend {i.cost} DM</Button><Button size="md" onClick={() => setPending(null)}>Cancel</Button></span>
            : <Button size="md" disabledReason={marks >= i.cost ? undefined : `${i.cost - marks} DM short`} onClick={() => setPending(i.id)}>Buy</Button>}
        </p>
      ))}
    </div>
  )
}

export default function Ladder() {
  const ladder = usePlan((s) => s.ladder)
  const loadLadder = usePlan((s) => s.loadLadder)
  const loadApps = usePlan((s) => s.loadApplications)
  const loadRoad = usePlan((s) => s.loadRoad)
  const goals = usePlan((s) => s.applications?.goals ?? null)
  const state = usePlan((s) => s.state)
  const campaigns = usePlan((s) => s.campaigns)
  const apps = usePlan((s) => s.applications)
  const roles = useCareerLocal((s) => s.roles)
  const tagNode = useCareerLocal((s) => s.tagNode)
  const addRole = useCareerLocal((s) => s.addRole)
  const removeRole = useCareerLocal((s) => s.removeRole)
  const setTagNode = useCareerLocal((s) => s.setTagNode)
  useEffect(() => { void loadLadder(); void loadApps(); if (usePlan.getState().state === null) void loadRoad() }, [loadLadder, loadApps, loadRoad])
  const evidenced = useMemo(() => {
    if (!state) return null
    const s = new Set<string>()
    for (const [id, rec] of Object.entries(state.nodes)) {
      const a = rec.attributes
      if (rec.status === 'mastered' || (a && ((a.certs?.length ?? 0) + (a.projects?.length ?? 0) + (a.achievements?.length ?? 0)) > 0)) s.add(id)
    }
    return s
  }, [state])
  const nodes = useMemo(() => {
    const names: Record<string, string> = {}
    for (const [id, n] of Object.entries(loadBank().nodes)) names[id] = n.name
    const fallback = [
      ...(campaigns?.campaigns ?? []).flatMap((c) => c.path.map((n) => ({ id: n.id, name: n.name }))),
      ...(apps?.applications ?? []).flatMap((a) => a.nodes.map((n) => ({ id: n.id, name: n.name }))),
    ]
    return treeNodes(Object.keys(state?.nodes ?? {}), names, fallback)
  }, [state, campaigns, apps])
  const go = (section: string, view: string) => useShell.getState().go({ product: 'ww', section, view })
  return (
    <LadderView
      ladder={ladder} goals={goals} roles={roles} tagNode={tagNode} evidenced={evidenced} nodes={nodes}
      parking={<><ParkingPanel /><RewardsPanel /></>} rewards={null} review={<ReviewPanel />} reviewDue={ladder?.review_due}
      onAddRole={(r, map) => { addRole(r); for (const [t, n] of Object.entries(map)) setTagNode(t, n) }}
      onRemoveRole={removeRole}
      onOpenGap={() => go('tree', 'tree')}
      onGoals={() => { void switchWorkspace('setup', 'goals') }}
    />
  )
}
