/**
 * The information panel for a life-tree node (money, career, Insta, LinkedIn, GitHub...).
 * Four tabs: Overview, Proof, Links, Unlocks. Proof is verified by the server: for the
 * measured kinds the panel shows what is counted and how much is left, never a "mark
 * done" button; only proof kind "link" takes a URL + note from the owner.
 */
import { Check, Crosshair, ExternalLink, Link2, Lock, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useStore } from '../../lib/store'
import type { NodeStatus } from '../game/tree'
import { followLink, openExternal, postProof, type LifeTree, type TreeLink } from './lifeTrees'

const LABEL: Record<NodeStatus, string> = { locked: 'Locked', available: 'Available', in_progress: 'In progress', mastered: 'Mastered' }
type TabId = 'overview' | 'proof' | 'links' | 'unlocks'
const TABS: { id: TabId; name: string }[] = [{ id: 'overview', name: 'Overview' }, { id: 'proof', name: 'Proof' }, { id: 'links', name: 'Links' }, { id: 'unlocks', name: 'Unlocks' }]

export function ProofMeter({ have, need, unit }: { have: number; need: number; unit: string }) {
  const p = need > 0 ? Math.min(1, have / need) : 0
  return (
    <div className="tp-meter" role="meter" aria-valuemin={0} aria-valuemax={need} aria-valuenow={have} aria-label={`${have} of ${need} ${unit}`}>
      <div className="tp-meter-bar"><span style={{ transform: `scaleX(${p})` }} /></div>
      <span className="tp-meter-text">{have} / {need} {unit}{need > have ? ` · ${need - have} to go` : ' · done'}</span>
    </div>
  )
}

export function LifePanel({ tree, id, onPick, onFocus, onClose, onTrees }: {
  tree: LifeTree; id: string; onPick: (id: string) => void; onFocus: () => void; onClose: () => void; onTrees: (t: LifeTree[]) => void
}) {
  const [tab, setTab] = useState<TabId>('overview')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const n = tree.nodes.find((x) => x.id === id)
  if (!n) return null
  const byId = Object.fromEntries(tree.nodes.map((x) => [x.id, x]))
  const unlocks = tree.nodes.filter((x) => x.prereqs.includes(id))
  const needs = n.prereqs.filter((p) => byId[p])
  const missing = needs.filter((p) => byId[p].status !== 'mastered')
  const isLink = n.proof.kind === 'link'
  const go = (l: TreeLink) => followLink(l, { selectNode: onPick })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const u = url.trim()
    if (!/^https?:\/\/\S+$/i.test(u)) { setErr('A full link, starting with https://'); return }
    setBusy(true); setErr('')
    try {
      onTrees(await postProof(tree.id, id, u, note.trim()))
      setUrl(''); setNote('')
      useStore.getState().toast?.('Proof saved.', 'live')
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not save the proof.')
    } finally { setBusy(false) }
  }

  return (
    <aside className="tree-panel node-panel" aria-label={`${n.name} details`}>
      <div className="tp-head">
        <div className="tp-top">
          <span className={`pill ${n.status === 'mastered' ? 'live' : n.status === 'in_progress' ? 'sim' : ''}`}>{LABEL[n.status]}</span>
          <div className="tp-top-actions">
            <button className="tb-btn" onClick={onFocus} aria-label="Focus: zoom closer" title="Focus (double-click a node)"><Crosshair size={14} /></button>
            <button className="tb-btn" onClick={onClose} aria-label="Close the node panel" title="Close (Esc)"><X size={15} /></button>
          </div>
        </div>
        <h2 className="np-title">{n.name}</h2>
        <p className="tp-meta">{tree.name} · tier {n.tier}</p>
        <ProofMeter have={n.proof.have} need={n.proof.need} unit={n.proof.unit} />
        <div className="tp-tabs" role="tablist" aria-label="Node sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tp-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              {t.name}{t.id === 'links' && n.links.length ? ` ${n.links.length}` : ''}{t.id === 'unlocks' && unlocks.length ? ` ${unlocks.length}` : ''}
            </button>))}
        </div>
      </div>
      <div className="tp-body" role="tabpanel">
        {tab === 'overview' && <>
          {n.status === 'locked' && missing.length > 0 && <section className="tp-sec"><span className="tp-lock-head"><Lock size={12} /> Opens when you master:</span>
            <div className="tp-links">{missing.map((p) => <button key={p} className="link-btn" onClick={() => onPick(p)}>{byId[p].name}</button>)}</div></section>}
          {n.outcomes.length > 0 && <section className="tp-sec"><span className="eyebrow">What this gets you</span><ul className="np-list">{n.outcomes.map((o) => <li key={o}>{o}</li>)}</ul></section>}
          <section className="tp-sec"><span className="eyebrow">How it is checked</span><p className="small">{n.proof.text || 'Verified by the server.'}</p></section>
          {tree.about && <section className="tp-sec"><span className="eyebrow">{tree.name}</span><p className="tp-sub">{tree.about}</p></section>}
        </>}
        {tab === 'proof' && <>
          <section className="tp-sec">
            <span className="eyebrow">{n.proof.measured === false || isLink ? 'Proof you add' : 'Measured by JARVIS'}</span>
            <p className="small">{n.proof.text}</p>
            <ProofMeter have={n.proof.have} need={n.proof.need} unit={n.proof.unit} />
            {!isLink && <p className="tp-sub">Counted automatically from your {n.proof.unit || 'records'}; there is nothing to tick here.</p>}
          </section>
          <section className="tp-sec"><span className="eyebrow">Evidence · {n.evidence.length}</span>
            {n.evidence.length === 0 && <p className="tp-sub">Nothing yet.</p>}
            {n.evidence.length > 0 && <ul className="tp-evidence">{n.evidence.map((e, i) => (
              <li key={`${e.date}-${i}`}><span className="tp-ev-date">{e.date}</span>
                {e.url ? <button className="link-inline" onClick={() => openExternal(e.url!)}>{e.text}<ExternalLink size={11} /></button> : <span>{e.text}</span>}</li>))}</ul>}
          </section>
          {isLink && <form className="tp-sec tp-proof-form" onSubmit={(e) => void submit(e)} aria-label="Add a proof link">
            <span className="eyebrow"><Link2 size={11} /> Add a link</span>
            <input className="field" type="url" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Proof URL" required />
            <input className="field" placeholder="Note (what it shows)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
            {err && <p className="tp-err" role="alert">{err}</p>}
            <button className="btn sm primary" type="submit" disabled={busy}><Check size={13} />{busy ? 'Saving…' : 'Save proof'}</button>
          </form>}
        </>}
        {tab === 'links' && <section className="tp-sec">
          {n.links.length === 0 && <p className="tp-sub">No links on this node.</p>}
          <div className="tp-linklist">{n.links.map((l, i) => (
            <button key={`${l.kind}-${l.target}-${i}`} className={`link-btn lk-${l.kind}`} data-link={l.kind} onClick={() => go(l)}>
              {l.label || l.target}{l.kind === 'url' && <ExternalLink size={11} />}</button>))}</div>
        </section>}
        {tab === 'unlocks' && <>
          <section className="tp-sec"><span className="eyebrow">Needs</span>
            {needs.length === 0 ? <p className="tp-sub">Nothing: a starting node.</p> : <div className="tp-links">{needs.map((p) => (
              <button key={p} className={`link-btn ${byId[p].status}`} onClick={() => onPick(p)}>{byId[p].status === 'mastered' ? '✓ ' : ''}{byId[p].name}</button>))}</div>}</section>
          <section className="tp-sec"><span className="eyebrow">Unlocks</span>
            {unlocks.length === 0 ? <p className="tp-sub">The top of this tree.</p> : <div className="tp-links">{unlocks.map((u) => (
              <button key={u.id} className="link-btn" onClick={() => onPick(u.id)}>{u.name}</button>))}</div>}</section>
        </>}
      </div>
    </aside>
  )
}
