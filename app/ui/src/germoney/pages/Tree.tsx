/**
 * Mission → Tree. The skill tree as a layered DAG: a trunk, one row per tier going
 * up, branches kept together, prerequisite edges. Wheel zooms around the cursor,
 * drag pans, the buttons zoom/reset; labels wrap onto two lines so they stay readable. One SVG layer; every node is a focusable button and the
 * arrow keys move between neighbours. The career overlay makes the nodes that
 * matter for the chosen career glow brighter. Click (or Enter) opens the node:
 * outcomes, resources (primary, backup, legal PDFs), certificates, the project,
 * its contracts, and what you've earned on it (certs, projects, achievements).
 */
import { Award, ExternalLink, FolderGit2, Lock, Maximize2, Pause, Play, Star, Trophy, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../../lib/store'
import { careerWeight, loadBank, type BankNode } from '../data/bank'
import { usePlan } from '../game/plan'
import { allStatuses, dependents, layoutTree, neighbour, type NodeStatus } from '../game/tree'
import { MissionHeader } from '../ui'

/** Split a name onto at most two lines of ~18 characters, at word breaks. */
export function wrapLabel(name: string, max = 18): string[] {
  if (name.length <= max) return [name]
  const words = name.split(/\s+/)
  let a = ''
  let i = 0
  while (i < words.length && (a + (a ? ' ' : '') + words[i]).length <= max) a += (a ? ' ' : '') + words[i++]
  if (!a) { a = name.slice(0, max); return [a, name.length > max * 2 ? `${name.slice(max, max * 2 - 1)}…` : name.slice(max)] }
  let b = words.slice(i).join(' ')
  if (b.length > max) b = `${b.slice(0, max - 1)}…`
  return b ? [a, b] : [a]
}

type Box = { x: number; y: number; w: number; h: number }
const parseBox = (vb: string): Box => { const [x, y, w, h] = vb.split(' ').map(Number); return { x, y, w, h } }

/** Pan and zoom for an SVG viewBox: wheel zooms around the cursor, drag pans. */
function usePanZoom(initial: string) {
  const home = useMemo(() => parseBox(initial), [initial])
  const [box, setBox] = useState<Box>(home)
  const svg = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ x: number; y: number; box: Box; moved: boolean } | null>(null)
  useEffect(() => setBox(home), [home])
  const zoomAt = (factor: number, cx?: number, cy?: number) => setBox((b) => {
    const w = Math.min(home.w * 2, Math.max(home.w / 6, b.w * factor))
    const k = w / b.w
    const px = cx ?? b.x + b.w / 2
    const py = cy ?? b.y + b.h / 2
    return { x: px - (px - b.x) * k, y: py - (py - b.y) * k, w, h: b.h * k }
  })
  // React's onWheel is passive; attach a real listener so preventDefault stops page scroll.
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setBox((b) => {
        const fx = r.width ? (e.clientX - r.left) / r.width : 0.5
        const fy = r.height ? (e.clientY - r.top) / r.height : 0.5
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
        const w = Math.min(home.w * 2, Math.max(home.w / 6, b.w * factor))
        const k = w / b.w
        const px = b.x + b.w * fx
        const py = b.y + b.h * fy
        return { x: px - (px - b.x) * k, y: py - (py - b.y) * k, w, h: b.h * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [home])
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, box, moved: false }
  }
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    const el = svg.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) { d.moved = true; el.setPointerCapture?.(e.pointerId) }
    const r = el.getBoundingClientRect()
    const s = r.width ? d.box.w / r.width : 1
    setBox({ ...d.box, x: d.box.x - dx * s, y: d.box.y - dy * s })
  }
  const dragged = useRef(false)
  const onPointerUp = () => { dragged.current = !!drag.current?.moved; drag.current = null }
  // A drag must not also count as a click on the node under the pointer.
  const onClickCapture = (e: RMouseEvent) => { if (dragged.current) { e.stopPropagation(); dragged.current = false } }
  return {
    svg, viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`, zoom: Math.round((home.w / box.w) * 100),
    zoomIn: () => zoomAt(1 / 1.3), zoomOut: () => zoomAt(1.3), reset: () => setBox(home),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerLeave: onPointerUp, onClickCapture },
  }
}

const LABEL: Record<NodeStatus, string> = { locked: 'Locked', available: 'Available', in_progress: 'In progress', mastered: 'Mastered' }

export function TreePage() {
  const bank = useMemo(() => loadBank(), [])
  const layout = useMemo(() => layoutTree(bank), [bank])
  const state = usePlan((s) => s.state)
  const setCareer = usePlan((s) => s.setCareer)
  const [sel, setSel] = useState<string | null>(null)
  const refs = useRef<Record<string, SVGGElement | null>>({})
  const career = state?.career ?? null
  const pz = usePanZoom(layout.viewBox)
  const status = useMemo(() => (state?.statuses as Record<string, NodeStatus> | undefined) ?? allStatuses(bank, state?.nodes ?? {}), [bank, state])

  const focus = (id: string | null) => {
    if (!id) return
    setSel(id)
    refs.current[id]?.focus()
  }
  const onKey = (e: KeyboardEvent, id: string) => {
    const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp']
    if (dir) {
      e.preventDefault()
      focus(neighbour(layout, id, dir))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSel(id)
    }
  }

  const counts = Object.values(status).reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {} as Record<string, number>)
  if (!bank.order.length) {
    return (
      <div className="mission-page tree">
        <MissionHeader n="M2" title="Tree" sub="The skill tree" />
        <div className="card"><div className="empty">The skill-tree bank hasn't landed yet (data/bank/*.json).</div></div>
      </div>
    )
  }
  return (
    <div className="mission-page tree">
      <MissionHeader n="M2" title="Tree" sub={`${bank.order.length} nodes · ${counts.mastered ?? 0} mastered · ${counts.in_progress ?? 0} of ${state?.wip_cap ?? 3} in progress · ${counts.available ?? 0} open`}
        right={<div className="career-pick" role="group" aria-label="Career overlay">
          {bank.careers.map((c) => (
            <button key={c.id} className={`chip ${career === c.id ? 'on' : ''}`} aria-pressed={career === c.id} title={c.summary}
              onClick={() => void setCareer(career === c.id ? null : c.id)}>{c.name.split('/')[0].trim()}</button>))}
        </div>} />
      {bank.errors.length > 0 && <div className="card warn small">The bank has errors: {bank.errors.join('; ')}</div>}
      <div className="tree-wrap">
        <div className="tree-canvas">
        <div className="tree-tools" role="toolbar" aria-label="Zoom">
          <button className="btn sm ghost" onClick={pz.zoomIn} aria-label="Zoom in"><ZoomIn size={14} /></button>
          <button className="btn sm ghost" onClick={pz.zoomOut} aria-label="Zoom out"><ZoomOut size={14} /></button>
          <button className="btn sm ghost" onClick={pz.reset} aria-label="Fit the whole tree"><Maximize2 size={14} /></button>
          <span className="mono muted small">{pz.zoom}% · wheel to zoom, drag to pan</span>
        </div>
        <svg ref={pz.svg} className="skill-tree" viewBox={pz.viewBox} {...pz.handlers} role="group" aria-label="Skill tree. Arrow keys move between nodes; Enter opens one.">
          <defs>
            <radialGradient id="glow"><stop offset="0%" stopColor="var(--tree-glow)" stopOpacity="0.9" /><stop offset="100%" stopColor="var(--tree-glow)" stopOpacity="0" /></radialGradient>
          </defs>
          <path className="tree-trunk" d={`M0,${layout.trunk.y + 60} L0,${layout.trunk.y}`} />
          {layout.edges.map((e) => (
            <path key={`${e.from}>${e.to}`} d={e.d}
              className={`tree-edge ${e.from === '__trunk' ? 'root' : status[e.from] === 'mastered' ? 'lit' : ''} ${sel && (e.to === sel || e.from === sel) ? 'sel' : ''}`} />))}
          {layout.branches.map((b) => <text key={b.name} x={b.x} y={b.y} className="tree-branch" textAnchor="middle">{b.name.replace(/_/g, ' ')}</text>)}
          {layout.nodes.map((p) => {
            const s = status[p.id] ?? 'locked'
            const w = careerWeight(bank, career, p.id)
            return (
              <g key={p.id} ref={(el) => { refs.current[p.id] = el }} transform={`translate(${p.x},${p.y})`}
                className={`tree-node ${s} ${sel === p.id ? 'sel' : ''}`} role="button" tabIndex={0}
                aria-label={`${p.node.name}: ${LABEL[s]}${career ? `, career weight ${Math.round(w * 100)}%` : ''}`}
                onClick={() => setSel(p.id)} onKeyDown={(e) => onKey(e, p.id)} onFocus={() => setSel(p.id)}>
                {w > 0.05 && <circle r={18 + w * 26} fill="url(#glow)" opacity={career ? 0.25 + w * 0.6 : 0.2} />}
                <polygon points="0,-17 15,-8.5 15,8.5 0,17 -15,8.5 -15,-8.5" />
                {s === 'mastered' && <circle r="5" className="tn-core" />}
                {s === 'locked' && <path d="M-4,1 h8 v6 h-8 z M-2.5,1 v-3 a2.5,2.5 0 0 1 5,0 v3" className="tn-lock" />}
                <title>{p.node.name}</title>
                <text y={32} textAnchor="middle" className="tn-label">{wrapLabel(p.node.name).map((line, i) => <tspan key={i} x={0} dy={i ? 13 : 0}>{line}</tspan>)}</text>
              </g>
            )
          })}
        </svg>
        </div>
        <NodePanel id={sel} status={sel ? status[sel] ?? 'locked' : 'locked'} onPick={focus} />
      </div>
    </div>
  )
}

function NodePanel({ id, status, onPick }: { id: string | null; status: NodeStatus; onPick: (id: string) => void }) {
  const bank = useMemo(() => loadBank(), [])
  const state = usePlan((s) => s.state)
  const act = usePlan((s) => s.node)
  const attribute = usePlan((s) => s.attribute)
  const toast = useStore((s) => s.toast)
  const [kind, setKind] = useState<'cert' | 'project' | 'achievement'>('project')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  if (!id || !bank.nodes[id]) return <aside className="card node-panel"><p className="muted small">Pick a node (click, or Tab then the arrow keys). Glow = weight for the chosen career.</p></aside>
  const n: BankNode = bank.nodes[id]
  const rec = state?.nodes[id]
  const done = new Set(Object.keys(state?.contracts ?? {}))
  const res = n.resources.map((r) => bank.resources[r]).filter(Boolean)
  const run = async (op: 'start' | 'pause' | 'master') => {
    const r = await act(id, op)
    toast(r.say, r.ok ? 'live' : 'info')
  }
  const addAttr = async () => {
    const r = await attribute(id, { kind, text: text.trim() || n.name, url: url.trim() })
    toast(r.say, r.ok ? 'live' : 'fault')
    setText('')
    setUrl('')
  }
  const attrs = rec?.attributes ?? {}
  return (
    <aside className="card node-panel fade-in" aria-live="polite">
      <span className={`pill ${status === 'mastered' ? 'live' : status === 'in_progress' ? 'sim' : ''}`}>{LABEL[status]}</span>
      <h2 className="np-title">{n.name}</h2>
      <p className="mono muted small">{n.branch.replace(/_/g, ' ')} · tier {n.tier} · ~{n.hours_est} h</p>
      <div className="np-actions">
        {status === 'available' && <button className="btn sm primary" onClick={() => void run('start')}><Play size={13} />Start</button>}
        {status === 'in_progress' && <button className="btn sm" onClick={() => void run('pause')}><Pause size={13} />Pause (frees a slot)</button>}
        {(status === 'available' || status === 'in_progress') && <button className="btn sm ghost" onClick={() => void run('master')}><Star size={13} />Mark mastered</button>}
        {status === 'locked' && <span className="muted small"><Lock size={12} /> Opens after: {n.prereqs.filter((p) => (state?.statuses[p] ?? '') !== 'mastered').map((p) => bank.nodes[p]?.name).join(', ')}</span>}
      </div>
      {n.outcomes.length > 0 && <><span className="eyebrow">You'll be able to</span><ul className="np-list">{n.outcomes.map((o) => <li key={o}>{o}</li>)}</ul></>}
      {res.length > 0 && <><span className="eyebrow">Resources</span>
        <ul className="np-list">{res.map((r, i) => (
          <li key={r.id}><a href={r.url} target="_blank" rel="noreferrer">{r.title}<ExternalLink size={11} /></a>
            <span className="muted small"> {i === 0 ? 'primary' : i === 1 ? 'backup' : r.kind}{r.free ? ' · free' : ' · paid'}{r.hours ? ` · ~${r.hours} h` : ''}</span>
            {r.legal_pdf_url && <> · <a href={r.legal_pdf_url} target="_blank" rel="noreferrer">legal PDF</a></>}
            {r.skip_topics.length > 0 && <span className="muted small"> · skip: {r.skip_topics.join(', ')}</span>}</li>))}</ul></>}
      {n.certs.length > 0 && <><span className="eyebrow"><Award size={11} /> Certificates</span>
        <ul className="np-list">{n.certs.map((c) => bank.certs[c]).filter(Boolean).map((c) => (
          <li key={c.id}>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
            <span className="muted small"> · {c.cost_inr ? `₹${c.cost_inr.toLocaleString('en-IN')}` : 'free'}{state?.certs[c.id] ? ' · earned ✓' : ''}</span></li>))}</ul></>}
      {n.project && <><span className="eyebrow"><FolderGit2 size={11} /> Project</span>
        <p className="small"><b>{n.project.title}</b>: {n.project.deliverable}</p>
        {n.project.linkedin_line && <p className="muted small">LinkedIn: "{n.project.linkedin_line}"</p>}</>}
      {n.contracts.length > 0 && <><span className="eyebrow">Contracts</span>
        <ul className="np-list">{n.contracts.map((c) => <li key={c.id} className={done.has(`${n.id}/${c.id}`) ? 'done' : ''}>{done.has(`${n.id}/${c.id}`) ? '✓ ' : ''}{c.title} <span className="muted small">· {c.minutes} min</span></li>)}</ul></>}
      {dependents(bank, id).length > 0 && <p className="small muted">Unlocks: {dependents(bank, id).map((d) => (
        <button key={d} className="link-btn" onClick={() => onPick(d)}>{bank.nodes[d].name}</button>))}</p>}
      <span className="eyebrow"><Trophy size={11} /> Earned here</span>
      {[...(attrs.certs ?? []), ...(attrs.projects ?? []), ...(attrs.achievements ?? [])].length === 0 && <p className="muted small">Nothing yet. A shipped repo or a certificate goes here, with its link.</p>}
      <ul className="np-list">{[...(attrs.certs ?? []).map((a) => ({ ...a, k: 'cert' })), ...(attrs.projects ?? []).map((a) => ({ ...a, k: 'project' })), ...(attrs.achievements ?? []).map((a) => ({ ...a, k: 'achievement' }))].map((a, i) => (
        <li key={i}>{a.k} · {a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.text}</a> : a.text} <span className="muted small">{a.at}</span></li>))}</ul>
      <div className="field-row">
        <select className="field sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind">
          <option value="project">Project</option><option value="cert">Certificate</option><option value="achievement">Achievement</option></select>
        <input className="field" placeholder="What (e.g. FSM suite)" value={text} onChange={(e) => setText(e.target.value)} />
        <input className="field" placeholder="GitHub / LinkedIn link" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn sm" onClick={() => void addAttr()}>Add</button>
      </div>
    </aside>
  )
}
