// TreeStage (T01, spec 20.8.2, scale 2): one tree on the canvas, with level of detail and the keyboard model.
//
//   level of detail   below zoom 0.55 only the branch hubs draw; from 0.55 the nodes in view draw (one stroked path each, no label);
//                     from 1.15 labels and pips draw. Only the nodes inside the padded view are in the DOM, so a 300-node tree
//                     stays under 400 drawn elements at every zoom (measured in the count test).
//   keyboard          the stage is one composite: one tab stop (roving tabindex); arrows move to the nearest node in that direction,
//                     Shift+arrows pan 80 px, Enter opens the node (a hub zooms to its branch), Page Up and Page Down step through branches,
//                     + and - zoom, 0 fits, Tab leaves, Esc is the page's. No loop of its own: pan and zoom are viewport.ts,
//                     which costs 0 animation frames at idle.
//   drawing           only the stage reads the ledger through `derived`; a node's state is never decided here.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type PointerEvent } from 'react'
import { showsNumber, type LampState } from '../../shared/lamp'
import { HUB_H, HUB_W, LOD_FULL, ROW, drawPlan, labelLines, layoutTree, neighbour, type Dir } from './layout'
import { STATES, STATE_WORD, branchGrowth, type Derived } from './ledger'
import type { NodeDef, TreeDef } from './model'
import { NodeGlyph, SkillNode } from './SkillNode'
import { TraceEdges, edgeSets } from './TraceEdge'
import { useViewport } from './viewport'

export interface StageApi {
  fit(): void
  zoomIn(): void
  zoomOut(): void
  pan(dx: number, dy: number): void
  toBranch(b: number): void
  goTo(id: string): void
}

export interface TreeStageProps {
  tree: TreeDef
  derived: ReadonlyMap<string, Derived>
  ledgerState: LampState
  /** The node whose drawer is open, if any. */
  openId: string | null
  onOpen: (id: string) => void
  /** A drawer covers the right of the stage (the view keeps a node clear of it). */
  occluded: boolean
  apiRef: MutableRefObject<StageApi | null>
  /** The node to centre on first (the one the rules pick next, or the first seed). */
  startId?: string | null
  /** The element that shows the zoom percentage (the page's bar); the viewport writes it with no re-render. */
  zoomEl?: HTMLElement | null
  /** Size and view before anything is measured (the count test and the gallery draw a known view). */
  initialSize?: { w: number; h: number }
  initialView?: { x: number; y: number; k: number }
  /** Draw the legend and the branch count over the stage (the classic page). The v3 page draws them as a row above the canvas, so
   *  nothing of the key ever lies on a branch row (owner, 25 Nov: the legend hid the first row's name and labels). */
  chrome?: boolean
}

const DIRS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const PAN_STEP = 80

/** The ids from the seed of a node's branch up to it. */
export function chainOf(tree: TreeDef, id: string | null): string[] {
  const out: string[] = []
  for (let n: NodeDef | undefined = id ? tree.byId.get(id) : undefined; n; n = n.prereq ? tree.byId.get(n.prereq) : undefined) out.unshift(n.id)
  return out
}

/** A branch's plate name: the authored name, else the last part of its id. */
export const hubName = (br: { id: string; name: string }): string => br.name.trim() || br.id.split('/').pop() || br.id

/** The key to the six node states and the count of finished branches: one row. The classic page lays it over the stage; the v3 page
 *  puts it in the canvas tray above the stage, where it cannot lie on a branch row. */
export function TreeKey({ earned, branches, counted, className }: { earned: number; branches: number; counted: boolean; className?: string }) {
  return (
    <>
      <ul className={`tg-legend${className ? ` ${className}` : ''}`} aria-label="Legend: six states, each told apart by shape and glyph">
        {STATES.map((st) => (
          <li key={st}><svg viewBox="-20 -20 40 40" width="28" height="28" aria-hidden="true"><NodeGlyph tier={2} state={st} /></svg><span>{STATE_WORD[st]}</span></li>
        ))}
      </ul>
      <p className="tg-count" aria-live="off">{counted ? `${earned} of ${branches} branches complete` : `Branches complete: – – of ${branches}`}</p>
    </>
  )
}

interface Hover { id: string; x: number; y: number }

export function TreeStage({ tree, derived, ledgerState, openId, onOpen, occluded, apiRef, startId = null, zoomEl = null, initialSize = { w: 846, h: 464 }, initialView, chrome = true }: TreeStageProps) {
  const layout = useMemo(() => layoutTree(tree), [tree])
  const counted = showsNumber(ledgerState)
  const occ = useRef(false)
  occ.current = occluded
  const sens = useRef(1)
  const [view, setView] = useState(initialView ?? { x: 0, y: 0, k: 1 })
  const [size, setSize] = useState(initialSize)
  const [focusId, setFocusId] = useState<string | null>(startId ?? tree.nodes[0]?.id ?? null)
  const [activeB, setActiveB] = useState<number | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const want = useRef(false)
  const vp = useViewport({
    bounds: layout.bounds, occluded: occ, sens,
    onRest: () => {
      setView({ ...vp.view.current })
      const s = vp.stage.current
      if (s && s.clientWidth > 0) setSize((z) => (z.w === s.clientWidth && z.h === s.clientHeight ? z : { w: s.clientWidth, h: s.clientHeight }))
    },
  })
  const { centerOn, fit } = vp

  // The stage's pixel size is React state that labelFits reads. It was refreshed only when a pan or zoom came to rest, and since the 27 Nov
  // fix a click no longer pans, so opening the node tray (the stage 846 -> 664 px at 1366) left `size` stale and labels the new edge cuts
  // ("Systems and") were still drawn. Watch the stage itself.
  useEffect(() => {
    const el = vp.stage.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setSize((z) => (z.w === el.clientWidth && z.h === el.clientHeight ? z : { w: el.clientWidth, h: el.clientHeight }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [vp.stage])

  /** Put a branch's row in view at zoom k: the whole row when it fits, else its left end (hub and seed first). The top edge of the stage is
   *  snapped to the boundary between two rows (the row sits about a third down, never so that the row above shows as a cut sliver), so
   *  every row that shows is whole and the first row of the tree is not half hidden (owner, 25 Nov). */
  const frameBranch = useCallback((b: number, k: number, instant = false, atX?: number) => {
    const box = layout.branchBox(b)
    const st = vp.stage.current
    const w = (st?.clientWidth || size.w) - (occ.current ? 404 : 0)
    const h = st?.clientHeight || size.h
    const vw = w / k
    // a row wider than the stage: only on a phone-width stage (under 400 px) centre on the node asked for so it and its label are whole;
    // on a laptop canvas (519 px at 1366) the hub end shows, hub whole. The old 520 px threshold put the 519 px stage on the phone path
    // and cut the hub at the left edge.
    const narrow = atX !== undefined && w < 400
    const cx = box.w <= vw ? box.x + box.w / 2 : narrow ? Math.min(box.x + box.w - vw / 2, Math.max(box.x + vw / 2, atX)) : box.x + vw / 2 - 8
    const rowsAbove = Math.floor((h * 0.3) / (ROW * k))
    const first = Math.max(0, b - rowsAbove)
    const top = first === 0 ? layout.bounds.y : first * ROW - ROW / 2
    centerOn(cx, top + h / (2 * k), k, instant)
  }, [layout, centerOn, size, vp.stage])

  /** Bring a node into view only when it is not already comfortably in it, keeping the zoom (a click on a node must never move the node
   *  from under the pointer: the old code re-framed the whole branch on every selection, a 67 px sideways jump at 1366 on the first click,
   *  so the second click landed on another node or on nothing). */
  const ensureVisible = useCallback((id: string) => {
    const p = layout.byId.get(id)
    if (!p) return
    const v = vp.view.current
    const st = vp.stage.current
    const w = (st?.clientWidth || size.w) - (occ.current ? 404 : 0)
    const h = st?.clientHeight || size.h
    const sx = p.x * v.k + v.x
    const sy = p.y * v.k + v.y
    const inside = sx >= 28 && sx <= w - 28 && sy >= 28 && sy <= h - 28   // the whole hexagon (20 units x 2.4 at most) is in; a label the edge would cut is simply not drawn
    if (inside) return
    frameBranch(p.b, Math.max(v.k, LOD_FULL), false, p.x)
  }, [layout, vp.view, vp.stage, size, frameBranch])

  // the first view: the row of the node the rules pick (or the first seed) at a readable zoom
  const placed = useRef(false)
  useEffect(() => {
    if (!vp.ready || placed.current) return
    placed.current = true
    const p = layout.byId.get(startId ?? '') ?? layout.nodes[0]
    if (p) frameBranch(p.b, 1.2, true, p.x)   // on a stage under 400 px (a phone) the node asked for is centred, else the hub end shows, plate whole
    else fit(true)
  }, [vp.ready, layout, startId, frameBranch, fit])

  // a node opened or the open one changed: move the canvas only if the node is out of view (see ensureVisible)
  useEffect(() => { if (openId) ensureVisible(openId) }, [openId]) // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => drawPlan(layout, view, size, [focusId, openId]), [layout, view, size, focusId, openId])
  const ids = useMemo(() => new Set(plan.nodes), [plan])
  const hubSet = useMemo(() => new Set(plan.hubs), [plan])
  const chain = useMemo(() => chainOf(tree, openId ?? focusId), [tree, openId, focusId])
  const sets = useMemo(() => edgeSets(tree, layout, derived, ids, hubSet, chain), [tree, layout, derived, ids, hubSet, chain])
  const groups = useMemo(() => branchGrowth(tree, derived), [tree, derived])

  const points = useMemo(() => [...layout.nodes.map((p) => ({ id: p.id, x: p.x, y: p.y })), ...layout.hubs.map((h) => ({ id: h.id, x: h.x + HUB_W / 2, y: h.y }))], [layout])
  const at = useMemo(() => new Map(points.map((p) => [p.id, p])), [points])

  /** Focus the drawn element of an id; false when it is not in the DOM yet (the effect below then does it after the render). */
  const focusEl = useCallback((id: string): boolean => {
    const el = [...(vp.svg.current?.querySelectorAll<SVGElement>('[data-id]') ?? [])].find((e) => e.getAttribute('data-id') === id)
    el?.focus({ preventScroll: true })
    return !!el
  }, [vp.svg])
  const focusTo = useCallback((id: string, centre = true) => {
    const p = at.get(id)
    if (!p) return
    want.current = true
    setFocusId(id)
    queueMicrotask(() => { if (focusEl(id)) want.current = false })
    if (!centre) return
    // pan only when the point leaves the comfortable area; the zoom stays unless it is too far out to read
    const v = vp.view.current
    const sx = p.x * v.k + v.x
    const sy = p.y * v.k + v.y
    const w = size.w - (occ.current ? 404 : 0)
    if (sx < 72 || sy < 56 || sx > w - 72 || sy > size.h - 56 || v.k < 0.7) centerOn(p.x, p.y, Math.max(v.k, 0.8))
  }, [at, centerOn, size, vp.view, focusEl])

  // a change of level of detail swaps a node's element (one path <-> a group), which drops focus on the floor: put it back on the
  // same node, but only when the stage had focus and nothing else took it
  const held = useRef(false)
  useEffect(() => {
    if (!focusId) return
    if (want.current) { if (focusEl(focusId)) want.current = false; return }
    if (held.current && !vp.svg.current?.contains(document.activeElement)) focusEl(focusId)
  }, [focusId, plan, focusEl, vp.svg])

  const toBranch = useCallback((b: number) => {
    const box = layout.branchBox(b)
    setActiveB(b)
    // never so far out that only hubs draw
    frameBranch(b, Math.min(1.6, Math.max(LOD_FULL, Math.min((size.w - (occ.current ? 404 : 0) - 48) / box.w, (size.h - 48) / box.h))))
    const first = tree.branches[b]?.nodes[0]
    if (first) { want.current = true; setFocusId(first.id) }
  }, [layout, frameBranch, tree, size])
  const pan = useCallback((dx: number, dy: number) => {
    const v = vp.view.current
    const c = vp.centreOf(v)
    centerOn(c.x + dx / v.k, c.y + dy / v.k, v.k)
  }, [vp, centerOn])

  useEffect(() => {
    apiRef.current = {
      fit: () => { setActiveB(null); fit() }, zoomIn: vp.zoomIn, zoomOut: vp.zoomOut, pan, toBranch,
      goTo: (id) => focusTo(id),
    }
  })
  useEffect(() => { vp.zoomText.current = zoomEl as HTMLSpanElement | null }, [zoomEl, vp.zoomText])

  const branchOf = (id: string): number => (id ? (tree.byId.get(id)?.b ?? tree.branches.findIndex((b) => b.id === id)) : 0)
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const el = (e.target as Element).closest('[data-id]')
    const id = el?.getAttribute('data-id') ?? focusId
    if (!id) return
    const dir = DIRS[e.key]
    if (dir) {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) { pan(dir === 'left' ? -PAN_STEP : dir === 'right' ? PAN_STEP : 0, dir === 'up' ? -PAN_STEP : dir === 'down' ? PAN_STEP : 0); return }
      const from = at.get(id)
      const to = from ? neighbour(points, from, id, dir) : null
      if (to) focusTo(to)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (tree.byId.has(id)) onOpen(id)
      else toBranch(branchOf(id))
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      // not [ and ]: the shell owns those for "previous view / next view" (shell/keymap.ts) and takes them in the capture phase
      e.preventDefault()
      const n = tree.branches.length
      toBranch((branchOf(id) + (e.key === 'PageDown' ? 1 : n - 1)) % n)
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); vp.zoomIn() }
    else if (e.key === '-') { e.preventDefault(); vp.zoomOut() }
    else if (e.key === '0' || e.key === 'f') { e.preventDefault(); setActiveB(null); fit() }
  }

  const show = (id: string, e: PointerEvent | null, el?: Element | null) => {
    const stage = vp.stage.current?.getBoundingClientRect()
    const r = el?.getBoundingClientRect()
    if (!stage) return
    setHover({ id, x: (e ? e.clientX : (r?.left ?? 0) + (r?.width ?? 0) / 2) - stage.left, y: (e ? e.clientY : (r?.top ?? 0)) - stage.top })
  }
  // the open node is told in full by the node tray, so its pointer callout (which would lie over the next row) stays off
  const hoverNode = hover && hover.id !== openId ? tree.byId.get(hover.id) ?? null : null
  const hoverD = hoverNode ? derived.get(hoverNode.id) : undefined
  const needs = hoverNode?.prereq ? tree.byId.get(hoverNode.prereq)?.name : null

  const earnedBranches = groups.filter((g) => g.done).length
  const compact = plan.band !== 'full'
  /** A label or hub name is drawn only when the whole of it lies inside the stage: a state or a name cut by the edge reads wrong
   *  (the 20 Nov sweep found "Estimation and regression" cut at the bottom). Panning shows it again once it fits. */
  const EDGE = 4
  const labelFits = (p: { x: number; y: number }, name: string, tier: 1 | 2 | 3): boolean => {
    const lines = labelLines(name)
    const k = view.k
    const hw = (Math.max(...lines.map((l) => l.length)) * 6.6) / 2 + 4
    const r = tier === 3 ? 40 : tier === 2 ? 32 : 26
    const sx = p.x * k + view.x
    const top = (p.y + r) * k + view.y
    const bottom = (p.y + r + 24 + 13 * (lines.length - 1) + 6) * k + view.y
    return sx - hw * k >= EDGE && sx + hw * k <= size.w - EDGE && top >= EDGE && bottom <= size.h - EDGE
  }
  return (
    <div className="ww-tree-stage tg-stage" ref={vp.stage} data-moving="false" data-band={plan.band}>
      <svg ref={vp.svg} className="tg-svg" {...vp.handlers} role="group" data-band={plan.band}
        aria-label="Tree. Arrow keys move between nodes, Enter opens one, Page Up and Page Down step through branches, plus and minus zoom, zero fits, Shift with arrows pans."
        onKeyDown={onKeyDown}
        onPointerOver={(e) => { const el = (e.target as Element).closest('[data-id]'); const id = el?.getAttribute('data-id'); if (id && tree.byId.has(id)) show(id, e); else setHover(null) }}
        onPointerLeave={() => setHover(null)}
        onFocus={(e) => { held.current = true; const el = (e.target as Element).closest('[data-id]'); const id = el?.getAttribute('data-id'); if (id) { setFocusId(id); if (tree.byId.has(id)) show(id, null, el); else setHover(null) } }}
        onBlur={(e) => { setHover(null); if (e.relatedTarget) held.current = false }}>
        <g ref={vp.g}>
          <TraceEdges sets={sets} />
          <g className="tree-hubs">
            {plan.hubs.map((b) => {
              const br = tree.branches[b]
              const h = layout.hubById.get(br.id)!
              const gb = groups[b]
              // a branch with no authored name shows its id's last part, plain: a row is never an unnamed plate. The name is always drawn
              // (a row cut by the stage edge is part of a pannable canvas); the old rule drew it only when the whole plate was inside the
              // stage, so the two rows at the bottom showed "3 nodes" and nothing else (owner picture, 25 Nov).
              const shown = hubName(br)
              const lines = labelLines(shown, 16).slice(0, 2)
              return (
                <g key={br.id} className="tree-hub" role="button" tabIndex={focusId === br.id ? 0 : -1} data-id={br.id} data-dim={activeB !== null && activeB !== b ? 'true' : undefined} data-reserved={br.reserved ? 'true' : undefined}
                  transform={`translate(${h.x},${h.y})`} aria-label={`${shown} branch, ${counted ? `${gb.earned} of ${gb.total} nodes evidenced` : `${gb.total} nodes, evidence not counted`}. Enter zooms to it.`}
                  onClick={() => { focusTo(br.id, false); toBranch(b) }}>
                  <rect className="hub-face" x={0} y={-HUB_H / 2} width={HUB_W} height={HUB_H} rx={16} />
                  <text className="hub-name" x={14} y={lines.length > 1 ? -12 : -4}>{lines.map((l, i) => <tspan key={i} x={14} dy={i ? 14 : 0}>{l}</tspan>)}</text>
                  <text className="hub-n" x={14} y={lines.length > 1 ? 21 : 17} data-hollow={counted ? undefined : 'true'}>{counted ? `${gb.earned}/${gb.total}` : `${gb.total} nodes`}</text>
                </g>
              )
            })}
          </g>
          <g className="tree-nodes">
            {plan.nodes.map((id) => {
              const n = tree.byId.get(id)!
              const p = layout.byId.get(id)!
              const d = derived.get(id)
              return (
                <SkillNode key={id} id={id} tier={n.tier} state={d?.state ?? 'locked'} pips={d?.pips ?? 0} label={n.name} x={p.x} y={p.y} compact={compact} hideLabel={!compact && !labelFits(p, n.name, n.tier)}
                  selected={openId === id} dim={activeB !== null && activeB !== n.b} tabIndex={focusId === id ? 0 : -1}
                  onClick={() => { focusTo(id, false); onOpen(id) }} />
              )
            })}
          </g>
        </g>
      </svg>
      {hoverNode && hover && (
        <div className="tg-callout" aria-hidden="true" style={{ left: Math.min(hover.x + 14, size.w - 236), top: Math.max(8, hover.y - 96) }} data-state={hoverD?.state ?? 'locked'}>
          <b>{hoverNode.name}</b>
          <span>{['', 'Seed', 'Skill', 'Capstone'][hoverNode.tier]} of {hoverNode.branch}</span>
          <span>{STATE_WORD[hoverD?.state ?? 'locked']}{counted ? `, ${hoverD?.pips ?? 0} record${hoverD?.pips === 1 ? '' : 's'}` : ', evidence not counted'}</span>
          {needs && <span>Needs: {needs}</span>}
        </div>
      )}
      {chrome && <TreeKey earned={earnedBranches} branches={groups.length} counted={counted} />}
    </div>
  )
}

