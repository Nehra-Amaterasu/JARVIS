/**
 * Mission → Tree. Every tree as a layered DAG on one canvas: the skill bank ("Skills")
 * and the life trees the server sends (money, career, Insta, LinkedIn, GitHub...),
 * picked with the switcher on top. One layout engine (game/tree.ts) draws them all;
 * a life tree goes through the adapter in tree/lifeTrees.ts.
 *
 * Speed (2026-10-27): pan and zoom write ONE transform attribute on one <g>, at most
 * once per animation frame, straight to the DOM; React never re-renders on a pan, a
 * zoom or a hover (hover is CSS). Wheel zoom glides: each event moves a target view and
 * a rAF loop eases toward it (30 % of the gap a frame ≈ 95 % in 140 ms at 60 Hz), so a
 * notch reads as motion, not a jump. Selection lights the path by toggling classes on
 * the memoized node layer from an effect, so a click re-renders only the overlay.
 * Labels hide below 55 % zoom, where 11 px type is under 6 px anyway.
 *
 * Keys: arrows move spatially (Left/Right in the tier, Up/Down to the nearest node of
 * the next tier) and the view follows; Enter opens the panel, Esc closes it; + / - zoom,
 * 0 or F fits, N jumps to what's next. Double-click (or the panel's Focus) zooms closer.
 */
import { Award, BookMarked, Crosshair, ExternalLink, FolderGit2, Lock, Maximize2, Minus, Pause, Play, Plus, Search, SlidersHorizontal, Star, Trophy, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { useStore } from '../../lib/store'
import { careerWeight, loadBank, type Bank, type BankNode } from '../data/bank'
import { usePlan } from '../game/plan'
import { allStatuses, dependents, layoutTree, prereqClosure, type Layout, type NodeStatus } from '../game/tree'
import { LINE_H, wrapLines } from '../tree/geometry'
import { LifePanel } from '../tree/LifePanel'
import { fetchTrees, openExternal, statusesOf, toBank, type LifeTree } from '../tree/lifeTrees'
import { KEY_DIR, spatialNeighbour } from '../tree/nav'
import { PREF_SENS, PREF_TREE, readPref, readSensitivity, writePref } from '../tree/prefs'
import { SKILLS, TreeSwitcher } from '../tree/TreeSwitcher'
import { useStudyNode } from './Study'
import './tree.css'

/** Split a name onto at most two lines of ~18 characters, at word breaks. (Kept for callers; the canvas uses wrapLines.) */
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
type View = { x: number; y: number; k: number }
const parseBox = (vb: string): Box => { const [x, y, w, h] = vb.split(' ').map(Number); return { x, y, w, h } }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const K_MAX = 2.4          // past 240 % a 34 px hexagon is bigger than the toolbar; nothing more to read
const K_SEL = 1.15         // selecting a node brings the view to at least this: 11 px labels at ≈13 px
const K_FOCUS = 1.9        // double-click / Focus: close enough to read the label and its neighbours
const LOD_K = 0.55         // 11 px labels × 0.55 ≈ 6 px: unreadable, so skip painting them
const TWEEN_MS = 240       // a selection pan: long enough to follow, short enough not to wait for
const GLIDE = 0.3          // wheel glide: share of the remaining gap closed per frame
const TOP = 56             // the toolbar overlays the top 56 px of the stage
const BOTTOM = 44          // the legend overlays the bottom 44 px
const PANEL = 404          // the open panel covers 380 px + 12 px inset + 12 px gap on wide stages
const WIDE = 760           // below this the panel covers the whole stage
const HEX = '0,-17 15,-8.5 15,8.5 0,17 -15,8.5 -15,-8.5'

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Pan and zoom without React: the view lives in a ref, wheel and pointer moves only
 * update it (or its target), and one requestAnimationFrame per frame writes the transform.
 */
function useViewport(bounds: Box, occluded: React.MutableRefObject<boolean>, sens: React.MutableRefObject<number>) {
  const stage = useRef<HTMLDivElement | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  const g = useRef<SVGGElement | null>(null)
  const zoomText = useRef<HTMLSpanElement | null>(null)
  const view = useRef<View>({ x: 0, y: 0, k: 1 })
  const target = useRef<View>({ x: 0, y: 0, k: 1 })
  const size = useRef({ w: 0, h: 0 })
  const kMin = useRef(0.1)
  const frame = useRef(0)
  const tween = useRef(0)
  const glide = useRef(0)
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const [ready, setReady] = useState(false)

  const apply = useCallback(() => {
    frame.current = 0
    const v = view.current
    g.current?.setAttribute('transform', `translate(${v.x.toFixed(1)},${v.y.toFixed(1)}) scale(${v.k.toFixed(4)})`)
    svg.current?.classList.toggle('lod-far', v.k < LOD_K)
    if (zoomText.current) zoomText.current.textContent = `${Math.round(v.k * 100)}%`
  }, [])
  const schedule = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(apply) }, [apply])
  const stopAnim = () => {
    if (tween.current) cancelAnimationFrame(tween.current)
    if (glide.current) cancelAnimationFrame(glide.current)
    tween.current = 0; glide.current = 0
  }
  /** Set the view now (drag, reduced motion): the target follows so a later glide starts from here. */
  const jump = useCallback((to: View) => { view.current = to; target.current = { ...to }; schedule() }, [schedule])

  /** The part of the stage the graph can be seen in (left of the panel, between toolbar and legend). */
  const visible = useCallback(() => {
    const { w, h } = size.current
    const vw = occluded.current && w >= WIDE ? w - PANEL : w
    return { x: 0, y: TOP, w: Math.max(1, vw), h: Math.max(1, h - TOP - BOTTOM) }
  }, [occluded])

  const fitK = useCallback(() => {
    const r = visible()
    return clamp(Math.min((r.w - 32) / bounds.w, (r.h - 16) / bounds.h), 0.05, K_MAX)
  }, [bounds, visible])

  const animateTo = useCallback((to: View) => {
    stopAnim()
    if (reducedMotion()) { jump(to); return }
    const from = { ...view.current }
    target.current = { ...to }
    const t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / TWEEN_MS)
      const e = 1 - (1 - p) ** 3   // ease-out cubic
      view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e }
      apply()
      tween.current = p < 1 ? requestAnimationFrame(step) : 0
    }
    tween.current = requestAnimationFrame(step)
  }, [apply, jump])

  /** Ease the view toward the target, one share of the gap per frame, until it is under a pixel. */
  const startGlide = useCallback(() => {
    if (reducedMotion()) { jump({ ...target.current }); return }
    if (glide.current) return
    const step = () => {
      const v = view.current
      const t = target.current
      const k = Math.exp(Math.log(v.k) + (Math.log(t.k) - Math.log(v.k)) * GLIDE)
      const x = v.x + (t.x - v.x) * GLIDE
      const y = v.y + (t.y - v.y) * GLIDE
      const done = Math.abs(t.x - x) < 0.5 && Math.abs(t.y - y) < 0.5 && Math.abs(t.k - k) < 0.0005
      view.current = done ? { ...t } : { x, y, k }
      apply()
      glide.current = done ? 0 : requestAnimationFrame(step)
    }
    glide.current = requestAnimationFrame(step)
  }, [apply, jump])

  const fit = useCallback((instant = false) => {
    const k = fitK()
    kMin.current = Math.min(k * 0.6, 0.3)
    const r = visible()
    const to = { k, x: r.x + (r.w - bounds.w * k) / 2 - bounds.x * k, y: r.y + (r.h - bounds.h * k) / 2 - bounds.y * k }
    if (instant) jump(to); else animateTo(to)
  }, [animateTo, bounds, fitK, jump, visible])

  /** Centre a layout point in the visible area, at zoom k (default: keep the zoom, but at least readable). */
  const centerOn = useCallback((px: number, py: number, k?: number, instant = false) => {
    const kk = clamp(k ?? Math.max(target.current.k, K_SEL), kMin.current, K_MAX)
    const r = visible()
    const to = { k: kk, x: r.x + r.w / 2 - px * kk, y: r.y + r.h / 2 - py * kk }
    if (instant) jump(to); else animateTo(to)
  }, [animateTo, jump, visible])

  /** Zoom around a stage point (the pointer), moving the target; the glide does the motion. */
  const zoomBy = useCallback((factor: number, sx?: number, sy?: number) => {
    if (tween.current) { cancelAnimationFrame(tween.current); tween.current = 0; target.current = { ...view.current } }
    const t = target.current
    const r = visible()
    const cx = sx ?? r.x + r.w / 2
    const cy = sy ?? r.y + r.h / 2
    const k = clamp(t.k * factor, kMin.current, K_MAX)
    const f = k / t.k
    target.current = { k, x: cx - (cx - t.x) * f, y: cy - (cy - t.y) * f }
    startGlide()
  }, [startGlide, visible])

  // Size: the stage is sized by CSS (flex: 1); watch it so fit and centring use real pixels.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      size.current = { w, h }
      kMin.current = Math.min(fitK() * 0.6, 0.3)
      setReady(true)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitK])

  // React's onWheel is passive; a real listener lets preventDefault stop the page scrolling.
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      // A mouse notch (≈100) zooms ×0.86 at 1x sensitivity; a trackpad pinch (ctrl, ≈1-10 per event) stays smooth.
      zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015) * sens.current), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy, sens])

  useEffect(() => () => { stopAnim(); if (frame.current) cancelAnimationFrame(frame.current) }, [])

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    stopAnim()
    target.current = { ...view.current }
    dragged.current = false
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y, moved: false }
  }
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) { d.moved = true; svg.current?.setPointerCapture?.(e.pointerId); svg.current?.classList.add('panning') }
    jump({ ...view.current, x: d.vx + dx, y: d.vy + dy })
  }
  const onPointerUp = () => {
    if (drag.current?.moved) dragged.current = true
    drag.current = null
    svg.current?.classList.remove('panning')
  }
  // A drag must not also count as a click on the node under the pointer.
  const onClickCapture = (e: RMouseEvent) => { if (dragged.current) { e.stopPropagation(); e.preventDefault(); dragged.current = false } }
  // No focus on mousedown: a drag that starts on a node must not open it. A real click focuses it.
  const onMouseDown = (e: RMouseEvent) => e.preventDefault()

  return {
    stage, svg, g, zoomText, ready, fit, centerOn,
    zoomIn: () => zoomBy(1.3), zoomOut: () => zoomBy(1 / 1.3),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture, onMouseDown },
  }
}

const LABEL: Record<NodeStatus, string> = { locked: 'Locked', available: 'Available', in_progress: 'In progress', mastered: 'Mastered' }

/** What to do next: the lowest node in progress, else the lowest one open. */
function nextNode(layout: Layout, status: Record<string, NodeStatus>): string | null {
  return layout.nodes.find((p) => status[p.id] === 'in_progress')?.id ?? layout.nodes.find((p) => status[p.id] === 'available')?.id ?? null
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
          <g key={p.id} ref={(el) => { refs.current[p.id] = el }} transform={`translate(${p.x},${p.y})`} data-id={p.id}
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

interface PanelApi { id: string; pick: (id: string) => void; focus: () => void; close: () => void }

/** One tree on the canvas. Keyed by tree id, so switching trees starts a fresh view. */
function TreeCanvas({ bank, status, career, panel }: { bank: Bank; status: Record<string, NodeStatus>; career: string | null; panel: (p: PanelApi) => ReactNode }) {
  const layout = useMemo(() => layoutTree(bank), [bank])
  const bounds = useMemo(() => parseBox(layout.viewBox), [layout])
  const [sel, setSel] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState(0)
  const [menu, setMenu] = useState(false)
  const [sensUi, setSensUi] = useState(readSensitivity)
  const sens = useRef(sensUi)
  const refs = useRef<Record<string, SVGGElement | null>>({})
  const occluded = useRef(false)   // is the panel open? read by fit/centre maths
  const vp = useViewport(bounds, occluded, sens)
  const { centerOn, fit } = vp
  const next = useMemo(() => nextNode(layout, status), [layout, status])

  // First view: centred on what's next (a readable zoom), or the whole tree when nothing is open.
  const placed = useRef(false)
  useEffect(() => {
    if (!vp.ready || placed.current || !layout.nodes.length) return
    placed.current = true
    const p = next ? layout.byId[next] : null
    if (p) centerOn(p.x, p.y, 1, true)
    else fit(true)
  }, [vp.ready, centerOn, fit, layout, next])

  /** Select (focus, keys): light the path and bring the node to the centre at a readable zoom. */
  const pick = useCallback((id: string) => {
    const p = layout.byId[id]
    if (!p) return
    setSel(id)
    centerOn(p.x, p.y)
  }, [layout, centerOn])
  /** Select and open the panel (click, Enter, links). */
  const openNode = useCallback((id: string) => {
    if (!layout.byId[id]) return
    occluded.current = true
    setOpen(true)
    pick(id)
  }, [layout, pick])
  const zoomNode = useCallback((id: string) => {
    const p = layout.byId[id]
    if (!p) return
    occluded.current = true
    setOpen(true)
    setSel(id)
    centerOn(p.x, p.y, K_FOCUS)
  }, [layout, centerOn])
  /** Jump from outside the graph (search, the panel's links, "next"): open, centre, focus. */
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

  // Light the selected node's path and what it unlocks; dim the rest. Done on the DOM so the memoized node layer never re-renders.
  const lit = useMemo(() => sel ? new Set([...prereqClosure(bank, sel), ...dependents(bank, sel)]) : null, [bank, sel])
  useEffect(() => {
    for (const [id, el] of Object.entries(refs.current)) el?.classList.toggle('hl', !!lit?.has(id))
  }, [lit, layout])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => !q ? [] : layout.nodes.filter((p) => p.node.name.toLowerCase().includes(q) || p.id.includes(q) || p.branch.replace(/_/g, ' ').toLowerCase().includes(q)).map((p) => p.id), [layout, q])
  const closure = useMemo(() => new Set(sel ? prereqClosure(bank, sel) : []), [bank, sel])
  const pathEdges = useMemo(() => !sel ? [] : layout.edges.filter((e) => closure.has(e.to) && (e.from === '__trunk' || closure.has(e.from))), [layout, closure, sel])
  const outEdges = useMemo(() => !sel ? [] : layout.edges.filter((e) => e.from === sel), [layout, sel])

  const onPageKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('input, select, textarea')) return
    if (e.key === 'Escape') { if (open) close(); else if (sel) setSel(null); else return }
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

  const counts = Object.values(status).reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {} as Record<string, number>)
  const selP = sel ? layout.byId[sel] : null
  const nextP = next ? layout.byId[next] : null
  return (
    <div className="tree-stage" ref={vp.stage} onKeyDown={onPageKey}>
      <svg ref={vp.svg} className={`tree-svg ${sel ? 'has-sel' : ''}`} {...vp.handlers} role="group" aria-label="Tree. Arrow keys move between nodes; Enter opens one; Esc closes; F fits, N jumps to what's next.">
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

      <div className="tree-bar" role="toolbar" aria-label="Tree view">
        <div className="tb-group tb-search">
          <Search size={13} aria-hidden="true" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setHit(0) }} onKeyDown={onSearchKey}
            placeholder="Find a node" aria-label="Find a node" spellCheck={false} />
          {q && <span className="tb-count">{hit && matches.length ? `${((hit - 1) % matches.length) + 1}/${matches.length}` : matches.length}</span>}
          {q && <button className="tb-btn" onClick={() => { setQuery(''); setHit(0) }} aria-label="Clear search"><X size={13} /></button>}
          {q && matches.length > 0 && <ul className="tb-results" role="listbox" aria-label="Matches">
            {matches.slice(0, 8).map((id) => (
              <li key={id}><button onClick={() => go(id)} className={`tb-result ${status[id] ?? 'locked'}`}>
                <LegendHex s={status[id] ?? 'locked'} /><span className="tr-name">{bank.nodes[id].name}</span><span className="tr-meta">{bank.nodes[id].branch.replace(/_/g, ' ')}</span></button></li>))}
            {matches.length > 8 && <li className="tr-more">+{matches.length - 8} more · Enter cycles</li>}
          </ul>}
        </div>
        <div className="tb-group">
          <button className="tb-btn" onClick={vp.zoomOut} aria-label="Zoom out" title="Zoom out (−)"><Minus size={14} /></button>
          <span className="tb-zoom" ref={vp.zoomText} aria-live="off">100%</span>
          <button className="tb-btn" onClick={vp.zoomIn} aria-label="Zoom in" title="Zoom in (+)"><Plus size={14} /></button>
        </div>
        <div className="tb-group">
          <button className="tb-btn wide" onClick={() => vp.fit()} title="Fit the whole tree (F or 0)"><Maximize2 size={13} />Fit</button>
          <button className="tb-btn wide" onClick={() => go(next)} disabled={!next} title="Jump to what's next (N)"><Crosshair size={13} />Next</button>
        </div>
        <div className="tb-group tb-view">
          <button className="tb-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="View settings" title="View settings"><SlidersHorizontal size={14} /></button>
          {menu && <div className="tb-menu" role="dialog" aria-label="View settings">
            <label className="tb-menu-row">
              <span>Zoom sensitivity</span>
              <input type="range" min={0.5} max={2} step={0.1} value={sensUi} onChange={(e) => setSens(Number(e.target.value))} aria-label="Zoom sensitivity" />
              <span className="mono">{sensUi.toFixed(1)}x</span>
            </label>
            <p className="tb-menu-hint">+ / − zoom · 0 fits · arrows move · Enter opens · Esc closes · double-click zooms in</p>
          </div>}
        </div>
      </div>

      <div className="tree-legend" aria-label="Legend">
        <span className="lg-item"><LegendHex s="locked" />Locked {counts.locked ?? 0}</span>
        <span className="lg-item"><LegendHex s="available" />Open {counts.available ?? 0}</span>
        <span className="lg-item"><LegendHex s="in_progress" />In progress {counts.in_progress ?? 0}</span>
        <span className="lg-item"><LegendHex s="mastered" />Mastered {counts.mastered ?? 0}</span>
        <span className="lg-item lg-hint">drag to pan · wheel to zoom{career ? ' · halo = career weight' : ''}</span>
      </div>

      {open && sel && bank.nodes[sel] && <div className="tree-panel-slot" key={sel}>{panel({ id: sel, pick: (id) => go(id), focus: () => zoomNode(sel), close })}</div>}
    </div>
  )
}

export function TreePage() {
  const bank = useMemo(() => loadBank(), [])
  const state = usePlan((s) => s.state)
  const setCareer = usePlan((s) => s.setCareer)
  const [trees, setTrees] = useState<LifeTree[]>([])
  const [loaded, setLoaded] = useState(false)
  const [active, setActive] = useState(() => readPref(PREF_TREE) ?? SKILLS)
  useEffect(() => {
    let live = true
    void fetchTrees().then((t) => { if (live) { setTrees(t); setLoaded(true) } })
    return () => { live = false }
  }, [])
  const career = state?.career ?? null
  const skillStatus = useMemo(() => (state?.statuses as Record<string, NodeStatus> | undefined) ?? allStatuses(bank, state?.nodes ?? {}), [bank, state])
  // A remembered tree that the server no longer sends falls back to Skills (only once the list has arrived).
  const tree = trees.find((t) => t.id === active) ?? null
  const shown = tree ? tree.id : loaded || active === SKILLS ? SKILLS : null
  const lifeBank = useMemo(() => tree ? toBank(tree) : null, [tree])
  const lifeStatus = useMemo(() => tree ? statusesOf(tree) : null, [tree])
  const pickTree = (id: string) => { setActive(id); writePref(PREF_TREE, id) }

  const counts = Object.values(tree ? lifeStatus! : skillStatus).reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {} as Record<string, number>)
  const total = tree ? tree.nodes.length : bank.order.length
  const head = (
    <header className="tree-head">
      <span className="mono th-n">M2</span>
      <h1>Tree</h1>
      <TreeSwitcher trees={trees} active={shown ?? active} onPick={pickTree} />
      <span className="th-stats">{total} nodes · {counts.mastered ?? 0} mastered · {counts.in_progress ?? 0}{tree ? '' : `/${state?.wip_cap ?? 3}`} in progress · {counts.available ?? 0} open</span>
      {!tree && bank.careers.length > 0 && <div className="career-pick" role="group" aria-label="Career overlay">
        {bank.careers.map((c) => (
          <button key={c.id} className={`chip ${career === c.id ? 'on' : ''}`} aria-pressed={career === c.id} title={c.summary}
            onClick={() => void setCareer(career === c.id ? null : c.id)}>{c.name.split('/')[0].trim()}</button>))}
      </div>}
    </header>
  )
  if (shown === null) return <div className="mission-page tree tree-page">{head}<div className="card"><div className="empty">Loading the trees…</div></div></div>
  if (tree && lifeBank && lifeStatus) {
    return (
      <div className="mission-page tree tree-page">
        {head}
        {tree.nodes.length === 0 ? <div className="card"><div className="empty">This tree has no nodes yet.</div></div>
          : <TreeCanvas key={tree.id} bank={lifeBank} status={lifeStatus} career={null}
              panel={(p) => <LifePanel tree={tree} id={p.id} onPick={p.pick} onFocus={p.focus} onClose={p.close} onTrees={setTrees} />} />}
      </div>
    )
  }
  if (!bank.order.length) {
    return (
      <div className="mission-page tree tree-page">
        {head}
        <div className="card"><div className="empty">The skill-tree bank hasn't landed yet (data/bank/*.json).</div></div>
      </div>
    )
  }
  return (
    <div className="mission-page tree tree-page">
      {head}
      {bank.errors.length > 0 && <div className="card warn small">The bank has errors: {bank.errors.join('; ')}</div>}
      <TreeCanvas key={SKILLS} bank={bank} status={skillStatus} career={career}
        panel={(p) => <NodePanel id={p.id} status={skillStatus} onPick={p.pick} onFocus={p.focus} onClose={p.close} />} />
    </div>
  )
}

/** An external link that opens in the app's own browser window (pywebview), never navigating the app away. */
function Ext({ url, children }: { url: string; children: ReactNode }) {
  return <a href={url} onClick={(e) => { e.preventDefault(); openExternal(url) }} rel="noreferrer">{children}</a>
}

function NodePanel({ id, status: all, onPick, onFocus, onClose }: { id: string; status: Record<string, NodeStatus>; onPick: (id: string) => void; onFocus: () => void; onClose: () => void }) {
  const bank = useMemo(() => loadBank(), [])
  const state = usePlan((s) => s.state)
  const act = usePlan((s) => s.node)
  const attribute = usePlan((s) => s.attribute)
  const toast = useStore((s) => s.toast)
  const [kind, setKind] = useState<'cert' | 'project' | 'achievement'>('project')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const n: BankNode = bank.nodes[id]
  const status = all[id] ?? 'locked'
  const rec = state?.nodes[id]
  const done = new Set(Object.keys(state?.contracts ?? {}))
  const res = n.resources.map((r) => bank.resources[r]).filter(Boolean)
  const missing = n.prereqs.filter((p) => all[p] !== 'mastered' && bank.nodes[p])
  const toGo = prereqClosure(bank, id).filter((p) => p !== id && all[p] !== 'mastered').length
  const unlocks = dependents(bank, id)
  const certs = n.certs.map((c) => bank.certs[c]).filter(Boolean)
  const doneContracts = n.contracts.filter((c) => done.has(`${n.id}/${c.id}`)).length
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
  const earned = [...(attrs.certs ?? []).map((a) => ({ ...a, k: 'cert' })), ...(attrs.projects ?? []).map((a) => ({ ...a, k: 'project' })), ...(attrs.achievements ?? []).map((a) => ({ ...a, k: 'achievement' }))]
  return (
    <aside className="tree-panel node-panel" aria-label={`${n.name} details`}>
      <div className="tp-head">
        <div className="tp-top">
          <span className={`pill ${status === 'mastered' ? 'live' : status === 'in_progress' ? 'sim' : ''}`}>{LABEL[status]}</span>
          <div className="tp-top-actions">
            <button className="tb-btn" onClick={onFocus} aria-label="Focus: zoom closer" title="Focus (double-click a node)"><Crosshair size={14} /></button>
            <button className="tb-btn" onClick={onClose} aria-label="Close the node panel" title="Close (Esc)"><X size={15} /></button>
          </div>
        </div>
        <h2 className="np-title">{n.name}</h2>
        <p className="tp-meta">{n.branch.replace(/_/g, ' ')} · tier {n.tier} · ~{n.hours_est} h</p>
        {n.contracts.length > 0 && <div className="tp-meter" role="meter" aria-valuemin={0} aria-valuemax={n.contracts.length} aria-valuenow={doneContracts} aria-label={`${doneContracts} of ${n.contracts.length} contracts`}>
          <div className="tp-meter-bar"><span style={{ transform: `scaleX(${doneContracts / n.contracts.length})` }} /></div>
          <span className="tp-meter-text">{doneContracts} / {n.contracts.length} contracts</span>
        </div>}
        {status === 'locked'
          ? <div className="tp-locked">
              <span className="tp-lock-head"><Lock size={12} /> Opens when you master {missing.length === 1 ? 'this' : `these ${missing.length}`}{toGo > missing.length ? ` (${toGo} steps on the whole path)` : ''}:</span>
              <div className="tp-links">{missing.map((p) => <button key={p} className="link-btn" onClick={() => onPick(p)}>{bank.nodes[p].name}</button>)}</div>
            </div>
          : <div className="np-actions">
              <button className="btn primary tp-study" onClick={() => { useStudyNode.getState().set(id); useStore.getState().setTab('schedule') }}><BookMarked size={14} />Study this</button>
              {status === 'available' && <button className="btn sm" onClick={() => void run('start')}><Play size={13} />Start</button>}
              {status === 'in_progress' && <button className="btn sm" onClick={() => void run('pause')}><Pause size={13} />Pause (frees a slot)</button>}
              {(status === 'available' || status === 'in_progress') && <button className="btn sm ghost" onClick={() => void run('master')}><Star size={13} />Mark mastered</button>}
            </div>}
      </div>
      <div className="tp-body">
        {n.outcomes.length > 0 && <section className="tp-sec"><span className="eyebrow">You'll be able to</span><ul className="np-list">{n.outcomes.map((o) => <li key={o}>{o}</li>)}</ul></section>}
        {res.length > 0 && <section className="tp-sec"><span className="eyebrow">Resources</span>
          <ul className="tp-res">{res.map((r, i) => (
            <li key={r.id}>
              <span className={`tp-tag ${i === 0 ? 'primary' : ''}`}>{i === 0 ? 'primary' : i === 1 ? 'backup' : r.kind}</span>
              <div className="tp-res-main">
                {r.url ? <Ext url={r.url}>{r.title}<ExternalLink size={11} /></Ext> : <span>{r.title}</span>}
                <span className="tp-sub">{r.free ? 'free' : 'paid'}{r.hours ? ` · ~${r.hours} h` : ''}{r.legal_pdf_url && <> · <Ext url={r.legal_pdf_url}>legal PDF</Ext></>}{r.skip_topics.length > 0 && ` · skip: ${r.skip_topics.join(', ')}`}</span>
              </div>
            </li>))}</ul></section>}
        {n.contracts.length > 0 && <section className="tp-sec"><span className="eyebrow">Contracts · {doneContracts}/{n.contracts.length} done</span>
          <ul className="np-list">{n.contracts.map((c) => <li key={c.id} className={done.has(`${n.id}/${c.id}`) ? 'done' : ''}>{done.has(`${n.id}/${c.id}`) ? '✓ ' : ''}{c.title} <span className="tp-sub">· {c.minutes} min</span></li>)}</ul></section>}
        {certs.length > 0 && <section className="tp-sec"><span className="eyebrow"><Award size={11} /> Certificates</span>
          <ul className="np-list">{certs.map((c) => (
            <li key={c.id}>{c.url ? <Ext url={c.url}>{c.name}</Ext> : c.name}
              <span className="tp-sub"> · {c.cost_inr ? `₹${c.cost_inr.toLocaleString('en-IN')}` : 'free'}{state?.certs[c.id] ? ' · earned ✓' : ''}</span></li>))}</ul></section>}
        {n.project && <section className="tp-sec"><span className="eyebrow"><FolderGit2 size={11} /> Project</span>
          <p className="small"><b>{n.project.title}</b>: {n.project.deliverable}</p>
          {n.project.linkedin_line && <p className="tp-sub">LinkedIn: "{n.project.linkedin_line}"</p>}</section>}
        {unlocks.length > 0 && <section className="tp-sec"><span className="eyebrow">Unlocks</span>
          <div className="tp-links">{unlocks.map((d) => <button key={d} className="link-btn" onClick={() => onPick(d)}>{bank.nodes[d].name}</button>)}</div></section>}
        <section className="tp-sec"><span className="eyebrow"><Trophy size={11} /> Earned here</span>
          {earned.length === 0 && <p className="tp-sub">Nothing yet. A shipped repo or a certificate goes here, with its link.</p>}
          {earned.length > 0 && <ul className="np-list">{earned.map((a, i) => (
            <li key={i}>{a.k} · {a.url ? <Ext url={a.url}>{a.text}</Ext> : a.text} <span className="tp-sub">{a.at}</span></li>))}</ul>}
          <div className="field-row">
            <select className="field sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind">
              <option value="project">Project</option><option value="cert">Certificate</option><option value="achievement">Achievement</option></select>
            <input className="field" placeholder="What (e.g. FSM suite)" value={text} onChange={(e) => setText(e.target.value)} />
            <input className="field" placeholder="GitHub / LinkedIn link" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn sm" onClick={() => void addAttr()}>Add</button>
          </div>
        </section>
      </div>
    </aside>
  )
}
