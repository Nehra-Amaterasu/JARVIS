/**
 * One tree on the Well Wisher canvas (plan 4.5): a flat toolbar on kit primitives, the SVG stage, the branch
 * chips and the inspector. Everything about WHICH tree is chosen lives in TreeWorkspace; this file draws one
 * tree and remembers its view and selection under its id (TREE-06).
 *
 * Layout rule (owner, 10 Nov): one laptop canvas, no page scroll. The root is a grid of three rows (toolbar,
 * stage, chips) that fills the workspace; the stage takes what is left and the inspector either floats over
 * the stage's right edge (1366) or sits beside it (container width at least 1000, about a 1500 px window).
 *
 * Speed: pan and zoom write ONE transform on one <g> (viewport.ts), React never re-renders on them, and a
 * selection lights its path by toggling classes on the memoized node layer from an effect.
 */
import { Crosshair, Maximize2, Minus, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { careerWeight, type Bank } from '../../germoney/data/bank'
import { dependents, layoutTree, prereqClosure, type Layout, type NodeStatus } from '../../germoney/game/tree'
import { LINE_H, wrapLines } from '../../germoney/tree/geometry'
import { KEY_DIR, spatialNeighbour } from '../../germoney/tree/nav'
import { PREF_SENS, readSensitivity, writePref } from '../../germoney/tree/prefs'
import { workspaceMemory } from '../frame/workspaceMemory'
import { Button, Chip, CoachMark, CursorLabel, IconButton, Popover } from '../kit'
import { StudyPrimary } from './Inspector'
import { decodeView, encodeView } from './scene'
import { K_FOCUS, parseBox, useViewport } from './viewport'

const HEX = '0,-17 15,-8.5 15,8.5 0,17 -15,8.5 -15,-8.5'
const LABEL: Record<NodeStatus, string> = { locked: 'Locked', available: 'Available', in_progress: 'In progress', mastered: 'Mastered' }

/** What to do next: the lowest node in progress, else the lowest one open. */
export function nextNode(layout: Layout, status: Record<string, NodeStatus>): string | null {
  return layout.nodes.find((p) => status[p.id] === 'in_progress')?.id ?? layout.nodes.find((p) => status[p.id] === 'available')?.id ?? null
}

export interface BranchChip { name: string; label: string; mastered: number; total: number; ids: string[] }
export function branchChips(layout: Layout, status: Record<string, NodeStatus>): BranchChip[] {
  const by = new Map<string, BranchChip>()
  for (const p of layout.nodes) {
    const c = by.get(p.branch) ?? { name: p.branch, label: p.branch.replace(/_/g, ' '), mastered: 0, total: 0, ids: [] }
    c.total += 1
    c.ids.push(p.id)
    if (status[p.id] === 'mastered') c.mastered += 1
    by.set(p.branch, c)
  }
  return [...by.values()]
}

const EdgesLayer = memo(function EdgesLayer({ layout, status }: { layout: Layout; status: Record<string, NodeStatus> }) {
  return (
    <>
      <path className="tree-trunk" d={`M0,${layout.trunk.y + 60} L0,${layout.trunk.y}`} />
      {layout.edges.map((e) => (
        <path key={`${e.from}>${e.to}`} d={e.d} className={`tree-edge ${e.from === '__trunk' ? 'root' : status[e.from] === 'mastered' ? 'lit' : ''}`} />))}
      {layout.branches.map((b) => <text key={b.name} x={b.x} y={b.y} className="tree-branch" textAnchor="middle">{b.name.replace(/_/g, ' ')}</text>)}
    </>
  )
})

interface NodesProps {
  bank: Bank; layout: Layout; status: Record<string, NodeStatus>; career: string | null
  refs: React.MutableRefObject<Record<string, SVGGElement | null>>
  onPick: (id: string) => void; onOpen: (id: string) => void; onZoom: (id: string) => void; onKey: (e: KeyboardEvent, id: string) => void
}
/** Every node, memoized: selection, hover and search are drawn elsewhere, so this layer re-renders only when a status or the career changes. */
const NodesLayer = memo(function NodesLayer({ bank, layout, status, career, refs, onPick, onOpen, onZoom, onKey }: NodesProps) {
  return (
    <>
      {layout.nodes.map((p) => {
        const s = status[p.id] ?? 'locked'
        const w = career ? careerWeight(bank, career, p.id) : 0
        return (
          <g key={p.id} ref={(el) => { refs.current[p.id] = el }} transform={`translate(${p.x},${p.y})`} data-id={p.id} data-cursor={p.node.name}
            className={`tree-node ${s}`} role="button" tabIndex={0}
            aria-label={`${p.node.name}: ${LABEL[s]}${career ? `, career weight ${Math.round(w * 100)}%` : ''}`}
            onClick={(e) => { onOpen(p.id); e.currentTarget.focus({ preventScroll: true }) }} onDoubleClick={() => onZoom(p.id)}
            onKeyDown={(e) => onKey(e, p.id)} onFocus={() => onPick(p.id)}>
            {w > 0.05 && <circle r={20 + w * 18} className="tn-halo" opacity={0.06 + w * 0.16} />}
            <polygon points={HEX} />
            {s === 'mastered' && <circle r="5" className="tn-core" />}
            {s === 'in_progress' && <circle r="3.5" className="tn-dot" />}
            {s === 'locked' && <path d="M-4,1 h8 v6 h-8 z M-2.5,1 v-3 a2.5,2.5 0 0 1 5,0 v3" className="tn-lock" />}
            <title>{`${p.node.name} · ${LABEL[s]}`}</title>
            <text y={32} textAnchor="middle" className="tn-label">{wrapLines(p.node.name).map((line, i) => <tspan key={i} x={0} dy={i ? LINE_H : 0}>{line}</tspan>)}</text>
          </g>
        )
      })}
    </>
  )
})

function LegendHex({ s }: { s: NodeStatus }) {
  return (
    <svg className={`lg-hex tree-node ${s}`} viewBox="-18 -18 36 36" width="14" height="14" aria-hidden="true">
      <polygon points={HEX} />{s === 'mastered' && <circle r="5" className="tn-core" />}{s === 'in_progress' && <circle r="3.5" className="tn-dot" />}
    </svg>
  )
}

export interface PanelApi { id: string; pick: (id: string) => void; focus: () => void; close: () => void }

export interface TreeCanvasProps {
  treeId: string
  bank: Bank
  status: Record<string, NodeStatus>
  career: string | null
  /** The tree switcher, drawn at the left of the toolbar. */
  switcher: ReactNode
  /** Extra controls for the view settings popover (the career overlay). */
  viewExtra?: ReactNode
  /** The inspector for the open node. */
  panel: (p: PanelApi) => ReactNode
  /** True when the container is wide enough for the inspector to sit beside the stage. */
  docked: boolean
  /** The skill tree: its nodes are Study nodes. A life tree has no Study to jump to, so it offers no Study button. */
  skills: boolean
  /** One line of counts, drawn at the right of the branch chips. */
  stats: string
}

export function TreeCanvas({ treeId, bank, status, career, switcher, viewExtra, panel, docked, skills, stats }: TreeCanvasProps) {
  const layout = useMemo(() => layoutTree(bank), [bank])
  const bounds = useMemo(() => parseBox(layout.viewBox), [layout])
  const remembered = useMemo(() => workspaceMemory.tree(treeId), [treeId])
  const [sel, setSel] = useState<string | null>(() => (remembered.selection && layout.byId[remembered.selection] ? remembered.selection : null))
  const [open, setOpen] = useState(() => !!(remembered.selection && layout.byId[remembered.selection]))
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState(0)
  const [menu, setMenu] = useState(false)
  const [sensUi, setSensUi] = useState(readSensitivity)
  const sens = useRef(sensUi)
  const refs = useRef<Record<string, SVGGElement | null>>({})
  const occluded = useRef(false)   // is an inspector floating over the stage? read by the fit and centre maths
  const gear = useRef<HTMLSpanElement>(null)
  const vp = useViewport({
    bounds, occluded, sens,
    onRest: (c) => workspaceMemory.setTree(treeId, { view: encodeView(c) }),
  })
  const { centerOn, fit } = vp
  const next = useMemo(() => nextNode(layout, status), [layout, status])
  occluded.current = open && !docked

  // first view: where it was left, else centred on what is next at a readable zoom, else the whole tree
  const placed = useRef(false)
  useEffect(() => {
    if (!vp.ready || placed.current || !layout.nodes.length) return
    placed.current = true
    const was = decodeView(remembered.view)
    if (was) {
      centerOn(was.x, was.y, was.k, true)
      return
    }
    const p = next ? layout.byId[next] : null
    if (p) centerOn(p.x, p.y, 1, true)
    else fit(true)
  }, [vp.ready, centerOn, fit, layout, next, remembered])

  // leaving the tree (a switch to another tree, or another workspace) keeps the view it ended on
  useEffect(() => () => {
    if (placed.current) workspaceMemory.setTree(treeId, { view: encodeView(vp.centreOf(vp.view.current)) })
  }, [treeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = useCallback((id: string | null) => {
    setSel(id)
    workspaceMemory.setTree(treeId, { selection: id })
  }, [treeId])
  /** Select (focus, keys): light the path and bring the node to the centre at a readable zoom. */
  const pick = useCallback((id: string) => {
    const p = layout.byId[id]
    if (!p) return
    choose(id)
    centerOn(p.x, p.y)
  }, [layout, centerOn, choose])
  /** Select and open the inspector (click, Enter, links). */
  const openNode = useCallback((id: string) => {
    if (!layout.byId[id]) return
    occluded.current = !docked
    setOpen(true)
    pick(id)
  }, [layout, pick, docked])
  const zoomNode = useCallback((id: string) => {
    const p = layout.byId[id]
    if (!p) return
    occluded.current = !docked
    setOpen(true)
    choose(id)
    centerOn(p.x, p.y, K_FOCUS)
  }, [layout, centerOn, choose, docked])
  /** Jump from outside the graph (search, the inspector's links, "next"): open, centre, focus. */
  const go = useCallback((id: string | null, focusNode = true) => {
    if (!id || !layout.byId[id]) return
    openNode(id)
    if (focusNode) refs.current[id]?.focus({ preventScroll: true })
  }, [layout, openNode])
  const close = useCallback(() => { setOpen(false); occluded.current = false }, [])
  const onKey = useCallback((e: KeyboardEvent, id: string) => {
    const dir = KEY_DIR[e.key]
    if (dir) {
      e.preventDefault()
      e.stopPropagation()
      const to = spatialNeighbour(layout, id, dir)
      if (to) refs.current[to]?.focus({ preventScroll: true })   // onFocus picks it and pans to it
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openNode(id)
    }
  }, [layout, openNode])

  // light the selected node's path and what it unlocks; dim the rest. Done on the DOM so the memoized node layer never re-renders.
  const lit = useMemo(() => sel ? new Set([...prereqClosure(bank, sel), ...dependents(bank, sel)]) : null, [bank, sel])
  useEffect(() => {
    for (const [id, el] of Object.entries(refs.current)) el?.classList.toggle('hl', !!lit?.has(id))
  }, [lit, layout])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => !q ? [] : layout.nodes.filter((p) => p.node.name.toLowerCase().includes(q) || p.id.includes(q) || p.branch.replace(/_/g, ' ').toLowerCase().includes(q)).map((p) => p.id), [layout, q])
  const closure = useMemo(() => new Set(sel ? prereqClosure(bank, sel) : []), [bank, sel])
  const pathEdges = useMemo(() => !sel ? [] : layout.edges.filter((e) => closure.has(e.to) && (e.from === '__trunk' || closure.has(e.from))), [layout, closure, sel])
  const outEdges = useMemo(() => !sel ? [] : layout.edges.filter((e) => e.from === sel), [layout, sel])
  const chips = useMemo(() => branchChips(layout, status), [layout, status])

  const onPageKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('input, select, textarea')) return
    if (e.key === 'Escape') { if (open) close(); else if (sel) choose(null); else return }
    else if (e.key === 'f' || e.key === '0') vp.fit()
    else if (e.key === 'n') go(next)
    else if (e.key === '+' || e.key === '=') vp.zoomIn()
    else if (e.key === '-') vp.zoomOut()
    else return
    e.preventDefault()
  }
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && matches.length) { e.preventDefault(); const i = hit % matches.length; go(matches[i], false); setHit(i + 1) }   // keep the caret: Enter again cycles
    else if (e.key === 'Escape') { setQuery(''); setHit(0) }
  }
  const setSens = (v: number) => { sens.current = v; setSensUi(v); writePref(PREF_SENS, String(v)) }

  const zoomBranch = (c: BranchChip) => {
    const ps = c.ids.map((i) => layout.byId[i])
    const x0 = Math.min(...ps.map((p) => p.x)) - 80
    const x1 = Math.max(...ps.map((p) => p.x)) + 80
    const y0 = Math.min(...ps.map((p) => p.y)) - 24
    const y1 = Math.max(...ps.map((p) => p.y)) + 72
    vp.fitBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }

  const counts = Object.values(status).reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {} as Record<string, number>)
  const selP = sel ? layout.byId[sel] : null
  const nextP = next ? layout.byId[next] : null
  const showPanel = open && !!sel && !!bank.nodes[sel]
  return (
    <div className="ww-tree" data-docked={docked ? 'true' : 'false'} data-tree={treeId} onKeyDown={onPageKey}>
      <div className="ww-tree-bar" role="toolbar" aria-label="Tree view">
        <div className="ww-tree-switch">{switcher}</div>
        <div className="ww-tree-find">
          <Search size={16} aria-hidden="true" />
          <input className="ww-input" value={query} onChange={(e) => { setQuery(e.target.value); setHit(0) }} onKeyDown={onSearchKey}
            placeholder="Find a node" aria-label="Find a node" spellCheck={false} />
          {q && <span className="ww-tree-count">{hit && matches.length ? `${((hit - 1) % matches.length) + 1}/${matches.length}` : matches.length}</span>}
          {q && <IconButton label="Clear search" size="sm" grouped onClick={() => { setQuery(''); setHit(0) }}><X size={16} aria-hidden="true" /></IconButton>}
          {q && matches.length > 0 && (
            <ul className="ww-tree-results" role="listbox" aria-label="Matches">
              {matches.slice(0, 6).map((id) => (
                <li key={id}><button type="button" className="ww-tap ww-tree-result" onClick={() => go(id)}>
                  <LegendHex s={status[id] ?? 'locked'} /><span>{bank.nodes[id].name}</span><span className="ww-tree-result-meta">{bank.nodes[id].branch.replace(/_/g, ' ')}</span></button></li>))}
              {matches.length > 6 && <li className="ww-tree-result-more">+{matches.length - 6} more · Enter cycles</li>}
            </ul>
          )}
        </div>
        <div className="ww-tree-zoom" role="group" aria-label="Zoom">
          <IconButton label="Zoom out" size="sm" grouped onClick={vp.zoomOut}><Minus size={16} aria-hidden="true" /></IconButton>
          <span className="ww-tree-zoomtext" ref={vp.zoomText} aria-live="off">100%</span>
          <IconButton label="Zoom in" size="sm" grouped onClick={vp.zoomIn}><Plus size={16} aria-hidden="true" /></IconButton>
        </div>
        <Button size="sm" grouped onClick={() => vp.fit()} title="Fit the whole tree (F or 0)"><Maximize2 size={16} aria-hidden="true" />Fit</Button>
        <Button size="sm" grouped onClick={() => go(next)} disabledReason={next ? undefined : 'Nothing is open or in progress.'} title="Jump to what is next (N)"><Crosshair size={16} aria-hidden="true" />Next</Button>
        <span ref={gear}><IconButton label="View settings" size="sm" grouped aria-expanded={menu} onClick={() => setMenu((m) => !m)}><SlidersHorizontal size={16} aria-hidden="true" /></IconButton></span>
        <Popover open={menu} onClose={() => setMenu(false)} anchor={gear} label="View settings">
          <div className="ww-tree-menu">
            <label className="ww-tree-sens">
              <span>Zoom sensitivity</span>
              <input type="range" min={0.5} max={2} step={0.1} value={sensUi} onChange={(e) => setSens(Number(e.target.value))} aria-label="Zoom sensitivity" />
              <span className="ww-tree-mono">{sensUi.toFixed(1)}x</span>
            </label>
            {viewExtra}
            <p className="ww-tree-hint">+ / − zoom · 0 fits · arrows move · Enter opens · Esc closes · double-click zooms in</p>
          </div>
        </Popover>
        {!showPanel && next && skills && <StudyPrimary id={next} label="Study this node" />}
      </div>

      <div className="ww-tree-body">
        <div className="ww-tree-stage" ref={vp.stage} data-moving="false">
          <svg ref={vp.svg} className={`tree-svg ${sel ? 'has-sel' : ''}`} {...vp.handlers} role="group"
            aria-label="Tree. Arrow keys move between nodes; Enter opens one; Esc closes; F fits, N jumps to what is next.">
            <g ref={vp.g}>
              <g className={`tree-edges ${sel ? 'dim' : ''}`}><EdgesLayer layout={layout} status={status} /></g>
              {sel && <g className="tree-path" aria-hidden="true">
                {pathEdges.map((e) => <path key={`${e.from}>${e.to}`} d={e.d} className={status[e.from] === 'mastered' || e.from === '__trunk' ? 'met' : 'need'} />)}
                {outEdges.map((e) => <path key={`${e.from}>${e.to}`} d={e.d} className="out" />)}
              </g>}
              <g className="tree-nodes"><NodesLayer bank={bank} layout={layout} status={status} career={career} refs={refs} onPick={pick} onOpen={openNode} onZoom={zoomNode} onKey={onKey} /></g>
              <g className="tree-rings" aria-hidden="true">
                {matches.map((id) => { const p = layout.byId[id]; return <circle key={id} cx={p.x} cy={p.y} r={26} className="ring-hit" /> })}
                {nextP && <g transform={`translate(${nextP.x},${nextP.y})`} className="ring-next"><circle r={24} /><text y={-30} textAnchor="middle">next</text></g>}
                {selP && <polygon transform={`translate(${selP.x},${selP.y}) scale(1.42)`} points={HEX} className="ring-sel" />}
              </g>
            </g>
          </svg>
          <div className="ww-tree-coach"><CoachMark id="tree-first-visit" text="First time here? Each hexagon is one skill step. The lit path is what to learn next." /></div>
          <div className="ww-tree-legend" aria-label="Legend">
            <span><LegendHex s="locked" />Locked {counts.locked ?? 0}</span>
            <span><LegendHex s="available" />Open {counts.available ?? 0}</span>
            <span><LegendHex s="in_progress" />In progress {counts.in_progress ?? 0}</span>
            <span><LegendHex s="mastered" />Mastered {counts.mastered ?? 0}</span>
          </div>
          <CursorLabel />
        </div>
        {(showPanel || docked) && (
          <div className="ww-tree-slot" key={sel ?? 'none'} data-float={docked ? 'false' : 'true'}>
            {showPanel && sel
              ? panel({ id: sel, pick: (id) => go(id), focus: () => zoomNode(sel), close })
              : <aside className="ww-insp ww-insp-empty" aria-label="Node details"><p className="ww-insp-note">Select a node to see what it needs, what it unlocks and how to study it.</p></aside>}
          </div>
        )}
      </div>

      <div className="ww-tree-chips" role="group" aria-label="Branches">
        <span className="ww-kicker">Branches</span>
        {chips.map((c) => <Chip key={c.name} grouped onClick={() => zoomBranch(c)}>{`${c.label} ${c.mastered}/${c.total}`}</Chip>)}
        <span className="ww-tree-stats">{stats}</span>
      </div>
    </div>
  )
}
