/**
 * The Tree inspector (plan 4.5, T3): the node's head, the one primary "Study this node", three tabs
 * (Links, Evidence, Proof) and the Sharpen / De-master row. Its body is an opaque surface with at most a
 * 1 px edge: ink-3 is 3.78:1 on a 58 % tint over a lit saffron node, so text never sits on glass (5.6).
 *
 * Every number comes from a route: contracts and statuses from the plan store, the Sharpen and De-master
 * sentences from /api/mission/mastery (ww_mastery.py). Nothing is invented; an empty answer is said in words.
 */
import { Award, Crosshair, ExternalLink, FolderGit2, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../lib/store'
import { loadBank, type BankNode } from '../../germoney/data/bank'
import { usePlan } from '../../germoney/game/plan'
import { dependents, prereqClosure, type NodeStatus } from '../../germoney/game/tree'
import { LifePanel } from '../../germoney/tree/LifePanel'
import { openExternal, type LifeTree } from '../../germoney/tree/lifeTrees'
import { useStudyNode } from '../../germoney/pages/Study'
import { jumpTo } from '../frame/navigate'
import { Button, Chip, Field, HoldButton, IconButton, COUNTED, Meter, PrimaryButton, Segmented, type ChipTone } from '../kit'
import { masteryOp, useMastery, type Mastery } from './mastery'

const LABEL: Record<NodeStatus, string> = { locked: 'Locked', available: 'Available', in_progress: 'In progress', mastered: 'Mastered' }
const TONE: Record<NodeStatus, ChipTone> = { locked: 'neutral', available: 'neutral', in_progress: 'sim', mastered: 'live' }
type TabId = 'links' | 'evidence' | 'proof'
const SHOWN = 5   // rows a tab lists before it says how many more: the tabs are the paging, not a long column

/** Study this node: Study follows the Tree node (S7), and the Back chip returns here (5.7.4 #5). */
export function studyNode(id: string): void {
  useStudyNode.getState().set(id)
  void jumpTo('study', 'plan')
}

function Ext({ url, children }: { url: string; children: ReactNode }) {
  return <a href={url} onClick={(e) => { e.preventDefault(); openExternal(url) }} rel="noreferrer">{children}</a>
}

interface Common { onPick: (id: string) => void; onFocus: () => void; onClose: () => void }

export function SkillInspector({ id, statuses, onPick, onFocus, onClose }: Common & { id: string; statuses: Record<string, NodeStatus> }) {
  const bank = useMemo(() => loadBank(), [])
  const state = usePlan((s) => s.state)
  const act = usePlan((s) => s.node)
  const refresh = usePlan((s) => s.refresh)
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState<TabId>('links')
  const n: BankNode | undefined = bank.nodes[id]
  const status = statuses[id] ?? 'locked'
  const { m, reload } = useMastery(id, status)
  if (!n) return null
  const done = new Set(Object.keys(state?.contracts ?? {}))
  const doneContracts = n.contracts.filter((c) => done.has(`${n.id}/${c.id}`)).length
  const missing = n.prereqs.filter((p) => statuses[p] !== 'mastered' && bank.nodes[p])
  const toGo = prereqClosure(bank, id).filter((p) => p !== id && statuses[p] !== 'mastered').length
  const run = async (op: 'start' | 'pause' | 'master') => {
    const r = await act(id, op)
    toast(r.say, r.ok ? 'live' : 'info')
    await reload()
  }
  return (
    <aside className="ww-insp" aria-label={`${n.name} details`} data-node={id}>
      <header className="ww-insp-head">
        <div className="ww-insp-top">
          <Chip tone={TONE[status]}>{LABEL[status]}</Chip>
          <span className="ww-insp-tools">
            <IconButton label="Focus: zoom closer" size="sm" grouped onClick={onFocus}><Crosshair size={16} aria-hidden="true" /></IconButton>
            <IconButton label="Close the node panel" size="sm" grouped onClick={onClose}><X size={16} aria-hidden="true" /></IconButton>
          </span>
        </div>
        <h2 className="ww-insp-title">{n.name}</h2>
        <p className="ww-insp-meta">{n.branch.replace(/_/g, ' ')} · tier {n.tier} · about {n.hours_est} h</p>
        {n.contracts.length > 0 && (
          <div className="ww-insp-meter">
            <Meter value={doneContracts / n.contracts.length} label={`${doneContracts} of ${n.contracts.length} contracts`} reading={COUNTED} />
            <span className="ww-insp-meter-text">{doneContracts} / {n.contracts.length} contracts</span>
          </div>
        )}
        {status === 'locked' ? (
          <p className="ww-insp-lock">
            Opens when you master {missing.length === 1 ? 'this' : `these ${missing.length}`}
            {toGo > missing.length ? ` (${toGo} steps on the whole path)` : ''}:{' '}
            {missing.map((p, i) => (
              <span key={p}>{i > 0 && ', '}<button type="button" className="ww-link" onClick={() => onPick(p)}>{bank.nodes[p].name}</button></span>
            ))}
          </p>
        ) : (
          <div className="ww-insp-actions">
            <StudyPrimary id={id} label="Study this node" />
            {status === 'available' && <Button size="sm" onClick={() => void run('start')}>Start</Button>}
            {status === 'in_progress' && <Button size="sm" onClick={() => void run('pause')}>Pause (frees a slot)</Button>}
            {(status === 'available' || status === 'in_progress') && <Button size="sm" onClick={() => void run('master')}>Mark mastered</Button>}
          </div>
        )}
      </header>
      <div className="ww-insp-body">
        <Segmented<TabId>
          label="Node sections"
          variant="compact"
          value={tab}
          onChange={setTab}
          options={[{ id: 'links', label: 'Links' }, { id: 'evidence', label: 'Evidence' }, { id: 'proof', label: 'Proof' }]}
        />
        <div className="ww-insp-tab" role="group" aria-label={tab}>
          {tab === 'links' && <LinksTab n={n} id={id} statuses={statuses} onPick={onPick} />}
          {tab === 'evidence' && <EvidenceTab id={id} n={n} />}
          {tab === 'proof' && <ProofTab n={n} done={done} certsEarned={state?.certs ?? {}} />}
        </div>
        <MasteryRow m={m} status={status} onChanged={async () => { await refresh(); await reload() }} id={id} onPick={onPick} />
      </div>
    </aside>
  )
}

/** The one primary, drawn here when a node is open and in the toolbar when none is (never both). */
export function StudyPrimary({ id, label }: { id: string; label: string }) {
  return <PrimaryButton claimId="tree-study" rank="workspace" size="sm" onClick={() => studyNode(id)}>{label}</PrimaryButton>
}

function LinksTab({ n, id, statuses, onPick }: { n: BankNode; id: string; statuses: Record<string, NodeStatus>; onPick: (id: string) => void }) {
  const bank = useMemo(() => loadBank(), [])
  const res = n.resources.map((r) => bank.resources[r]).filter(Boolean)
  const unlocks = dependents(bank, id)
  return (
    <>
      <section className="ww-insp-sec">
        <h3 className="ww-kicker">Resources</h3>
        {res.length === 0 ? <p className="ww-insp-note">No resource is linked to this node.</p> : (
          <ul className="ww-insp-list">
            {res.slice(0, SHOWN).map((r, i) => (
              <li key={r.id}>
                <span className="ww-insp-tag">{i === 0 ? 'primary' : i === 1 ? 'backup' : r.kind}</span>{' '}
                {r.url ? <Ext url={r.url}>{r.title}<ExternalLink size={12} aria-hidden="true" /></Ext> : r.title}
                <span className="ww-insp-note"> · {r.free ? 'free' : 'paid'}{r.hours ? ` · about ${r.hours} h` : ''}</span>
              </li>
            ))}
            {res.length > SHOWN && <li className="ww-insp-note">+{res.length - SHOWN} more in Study</li>}
          </ul>
        )}
      </section>
      <section className="ww-insp-sec">
        <h3 className="ww-kicker">Needs</h3>
        {n.prereqs.length === 0 ? <p className="ww-insp-note">Nothing: a starting node.</p> : (
          <div className="ww-insp-chips">{n.prereqs.filter((p) => bank.nodes[p]).map((p) => (
            <Chip key={p} tone={statuses[p] === 'mastered' ? 'live' : 'neutral'} onClick={() => onPick(p)} grouped>{bank.nodes[p].name}</Chip>))}</div>
        )}
      </section>
      <section className="ww-insp-sec">
        <h3 className="ww-kicker">Unlocks</h3>
        {unlocks.length === 0 ? <p className="ww-insp-note">The top of this tree.</p> : (
          <div className="ww-insp-chips">{unlocks.slice(0, SHOWN).map((d) => <Chip key={d} onClick={() => onPick(d)} grouped>{bank.nodes[d].name}</Chip>)}
            {unlocks.length > SHOWN && <span className="ww-insp-note">+{unlocks.length - SHOWN} more</span>}</div>
        )}
      </section>
    </>
  )
}

function EvidenceTab({ id, n }: { id: string; n: BankNode }) {
  const state = usePlan((s) => s.state)
  const attribute = usePlan((s) => s.attribute)
  const toast = useStore((s) => s.toast)
  const [kind, setKind] = useState<'cert' | 'project' | 'achievement'>('project')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const attrs = state?.nodes[id]?.attributes ?? {}
  const earned = [...(attrs.certs ?? []).map((a) => ({ ...a, k: 'cert' })), ...(attrs.projects ?? []).map((a) => ({ ...a, k: 'project' })), ...(attrs.achievements ?? []).map((a) => ({ ...a, k: 'achievement' }))]
  const add = async () => {
    const r = await attribute(id, { kind, text: text.trim() || n.name, url: url.trim() })
    toast(r.say, r.ok ? 'live' : 'fault')
    setText('')
    setUrl('')
  }
  return (
    <>
      <section className="ww-insp-sec">
        <h3 className="ww-kicker">Earned here</h3>
        {earned.length === 0 ? <p className="ww-insp-note">Nothing yet. A shipped repo or a certificate goes here, with its link.</p> : (
          <ul className="ww-insp-list">
            {earned.slice(0, SHOWN).map((a, i) => (
              <li key={i}>{a.k} · {a.url ? <Ext url={a.url}>{a.text}</Ext> : a.text} <span className="ww-insp-note">{a.at}</span></li>
            ))}
            {earned.length > SHOWN && <li className="ww-insp-note">+{earned.length - SHOWN} more</li>}
          </ul>
        )}
      </section>
      <section className="ww-insp-sec ww-insp-form">
        <Field label="Kind" kind="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="project">Project</option><option value="cert">Certificate</option><option value="achievement">Achievement</option>
        </Field>
        <Field label="What" placeholder="FSM suite" value={text} onChange={(e) => setText(e.target.value)} />
        <Field label="Link" placeholder="GitHub or LinkedIn link" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button size="sm" onClick={() => void add()}>Add</Button>
      </section>
    </>
  )
}

function ProofTab({ n, done, certsEarned }: { n: BankNode; done: Set<string>; certsEarned: Record<string, unknown> }) {
  const bank = useMemo(() => loadBank(), [])
  const certs = n.certs.map((c) => bank.certs[c]).filter(Boolean)
  return (
    <>
      <section className="ww-insp-sec">
        <h3 className="ww-kicker">Contracts</h3>
        {n.contracts.length === 0 ? <p className="ww-insp-note">This node has no contracts yet.</p> : (
          <ul className="ww-insp-list">{n.contracts.slice(0, SHOWN).map((c) => {
            const ok = done.has(`${n.id}/${c.id}`)
            return <li key={c.id}>{ok ? 'Done · ' : 'Open · '}{c.title} <span className="ww-insp-note">· {c.minutes} min</span></li>
          })}{n.contracts.length > SHOWN && <li className="ww-insp-note">+{n.contracts.length - SHOWN} more</li>}</ul>
        )}
      </section>
      {n.outcomes.length > 0 && (
        <section className="ww-insp-sec"><h3 className="ww-kicker">You will be able to</h3>
          <ul className="ww-insp-list">{n.outcomes.slice(0, 3).map((o) => <li key={o}>{o}</li>)}</ul></section>
      )}
      {n.project && (
        <section className="ww-insp-sec"><h3 className="ww-kicker"><FolderGit2 size={12} aria-hidden="true" /> Project</h3>
          <p className="ww-insp-note"><b>{n.project.title}</b>: {n.project.deliverable}</p></section>
      )}
      {certs.length > 0 && (
        <section className="ww-insp-sec"><h3 className="ww-kicker"><Award size={12} aria-hidden="true" /> Certificates</h3>
          <ul className="ww-insp-list">{certs.slice(0, 3).map((c) => (
            <li key={c.id}>{c.url ? <Ext url={c.url}>{c.name}</Ext> : c.name}<span className="ww-insp-note"> · {c.cost_inr ? `Rs ${c.cost_inr.toLocaleString('en-IN')}` : 'free'}{certsEarned[c.id] ? ' · earned' : ''}</span></li>
          ))}</ul></section>
      )}
    </>
  )
}

/**
 * Sharpen and De-master, worded by the server. Sharpen is a Button with a `disabledReason` (aria-disabled,
 * focusable, the reason printed beside it); De-master is a HoldButton, because taking a mastery away is the
 * costly action `hold` exists for. Both ask the server again before changing anything, so a stale page
 * cannot de-master a node that now has a mastered node above it.
 */
export function MasteryRow({ m, status, id, onChanged, onPick }: { m: Mastery | null | 'offline'; status: NodeStatus; id: string; onChanged: () => Promise<void>; onPick: (id: string) => void }) {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const send = async (op: 'gate-solve' | 'sharpen' | 'sharpen-done' | 'demaster', body: object = {}) => {
    setBusy(true)
    try {
      const r = await masteryOp(id, op, body)
      toast(r.say, r.ok ? 'live' : 'info')
      await onChanged()
    } catch {
      toast('Could not reach the server; nothing changed.', 'fault')
    } finally {
      setBusy(false)
    }
  }
  if (m === null) return <section className="ww-insp-sec ww-mastery" aria-busy="true"><p className="ww-insp-note">Checking Sharpen and De-master…</p></section>
  if (m === 'offline') {
    return (
      <section className="ww-insp-sec ww-mastery" data-mastery="offline">
        <Button size="sm" disabledReason="The server could not be asked, so nothing is offered. Try again in a moment.">Sharpen</Button>
      </section>
    )
  }
  const s = m.sharpen
  return (
    <section className="ww-insp-sec ww-mastery" data-mastery="ready" aria-label="Sharpen and de-master">
      <div className="ww-mastery-row">
        <Button size="sm" loading={busy} disabledReason={s.allowed ? undefined : s.blocker ?? 'Not available.'} onClick={() => void send('sharpen')}>Sharpen</Button>
      </div>
      {s.active && s.check && (
        <div className="ww-sharpen" data-round={s.check.round}>
          <h3 className="ww-kicker">Round {s.check.round}: a harder check</h3>
          <ul className="ww-insp-list">{s.check.items.slice(0, 3).map((c) => <li key={c.contract}>{c.title}: {c.cap_minutes} min, cold <span className="ww-insp-note">(first time {c.minutes})</span></li>)}</ul>
          <Button size="sm" loading={busy} onClick={() => void send('sharpen-done')}>Mark re-proved</Button>
        </div>
      )}
      {!s.allowed && s.candidates.length > 0 && (
        <div className="ww-sharpen" data-candidates="">
          <h3 className="ww-kicker">GATE-tier questions on disk</h3>
          <ul className="ww-insp-list">{s.candidates.slice(0, 3).map((c) => (
            <li key={c.id}>{c.ref || c.topic}{c.matched ? '' : ' (another topic)'}{' '}
              <Button size="sm" grouped loading={busy} onClick={() => void send('gate-solve', { question_id: c.id })}>I solved this</Button></li>
          ))}</ul>
        </div>
      )}
      {s.reproved > 0 && <p className="ww-insp-note">Re-proved {s.reproved} time{s.reproved === 1 ? '' : 's'}.</p>}
      {status === 'mastered' && (
        <div className="ww-mastery-row">
          <HoldButton label="De-master" size="sm" reason={m.demaster.allowed ? undefined : m.demaster.blocker ?? 'Not available.'} onConfirm={() => void send('demaster')} />
          {!m.demaster.allowed && m.demaster.first.length > 0 && (
            <span className="ww-insp-chips">{m.demaster.blockers.filter((b) => b.now).map((b) => (
              <Chip key={b.id} grouped onClick={() => onPick(b.id)}>{b.name}</Chip>))}</span>
          )}
        </div>
      )}
    </section>
  )
}

/** A life-tree node keeps the existing LifePanel, unchanged, inside the same opaque inspector. */
export function LifeInspector({ tree, id, onPick, onFocus, onClose, onTrees }: Common & { tree: LifeTree; id: string; onTrees: (t: LifeTree[]) => void }) {
  return (
    <div className="ww-insp ww-insp-life" data-node={id}>
      <LifePanel tree={tree} id={id} onPick={onPick} onFocus={onFocus} onClose={onClose} onTrees={onTrees} />
    </div>
  )
}
