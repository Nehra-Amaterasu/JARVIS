// MemoryConstellation (spec 20.9.4, D-V2-25): the store as a map, not a reward. SVG, at most 120 nodes (more and the stage shows
// one cluster per source with its count; a click zooms in), golden-angle wedges, radius by age rank with the newest in the
// middle, a layout that is a pure function of the store (model.ts), no physics and no idle loop.
//
// No node carries stored text: a node is a ring and, when it is large enough to read, the one letter of its source tag. The
// text lives in the Detail pane and in the list that is the keyboard equivalent (Drawer in Recall.tsx). The only motion is the
// one 240 ms dotted path through the nodes a recall returned and the one 160 ms light on a node that was just written; both
// are removed under reduced motion, where the numbered path is drawn still.
//
// Keys on the stage: arrows step to the nearest neighbour in that direction, Enter selects, Delete asks, plus and minus zoom
// one level, 1 to 3 pick a ring (newest, middle, oldest), 0 or Escape clears it.
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { ArtSlot } from '../../art/ArtSlot'
import {
  RX, RY, STAGE_H, STAGE_W, groupLetter, groupWord, neighboursOf, nearestInDirection, pathThrough, type Cluster, type Layout,
} from './model'

export interface MemoryConstellationProps {
  layout: Layout
  selected?: string | null
  onSelect(id: string): void
  /** Delete pressed on a node (the caller opens the confirm). */
  onDelete?(id: string): void
  /** A cluster was opened (click, Enter or plus). */
  onZoom?(group: string): void
  onZoomOut?(): void
  /** Nodes a recall lit, in rank order; the dotted path runs through them. */
  lit?: readonly string[]
  /** Changes on every recall so the path draws again. */
  litKey?: number
  /** One node lights once for 160 ms (a fact just written). */
  flash?: string | null
  /** Draw nothing but the guides: the first-run and empty picture. */
  hollow?: boolean
  /** The reason the picture is hollow, printed inside it. */
  hollowReason?: string
  /** Stamp for a fixture. */
  simulated?: boolean
  /** Draw the branch picture in the hollow form (an empty store, not a loading one). */
  art?: boolean
}

const RINGS = [0.46, 0.74, 1]
const CX = STAGE_W / 2
const CY = STAGE_H / 2

export function MemoryConstellation({ layout, selected = null, onSelect, onDelete, onZoom, onZoomOut, lit = [], litKey = 0, flash = null, hollow, hollowReason, simulated, art }: MemoryConstellationProps) {
  const uid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [ring, setRing] = useState<0 | 1 | 2 | 3>(0)
  const clusters = layout.mode === 'clusters'
  const items = useMemo(() => (clusters
    ? layout.clusters.map((c) => ({ id: `c:${c.group}`, x: c.x, y: c.y, rank: 0 }))
    : layout.placed.map((p) => ({ id: p.id, x: p.x, y: p.y, rank: p.rank }))), [clusters, layout])
  const near = useMemo(() => neighboursOf(layout.links, hover ?? selected), [layout.links, hover, selected])
  const dimming = !!(hover || selected) && !clusters
  const byId = useMemo(() => new Map(layout.placed.map((p) => [p.id, p])), [layout.placed])
  const rank = useMemo(() => new Map(lit.map((id, i) => [id, i + 1])), [lit])
  const pathD = useMemo(() => pathThrough(layout.placed, lit), [layout.placed, lit])

  const nameOf = (id: string): string => {
    if (id.startsWith('c:')) { const c = layout.clusters.find((x) => `c:${x.group}` === id); return c ? `${groupWord(c.group)}, ${c.count} items` : id }
    const p = byId.get(id)
    return p ? `${groupWord(p.group)}, ${p.label}` : id
  }
  const act = focusId ?? selected ?? null
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : null
    if (dir) {
      e.preventDefault()
      const next = nearestInDirection(items, act ?? items[0]?.id ?? null, dir)
      if (next) setFocusId(next)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const id = act ?? items[0]?.id
      if (!id) return
      if (id.startsWith('c:')) onZoom?.(id.slice(2))
      else onSelect(id)
      return
    }
    if (e.key === 'Delete' && act && !act.startsWith('c:')) { e.preventDefault(); onDelete?.(act); return }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      if (act?.startsWith('c:')) onZoom?.(act.slice(2))
      else { const p = act ? byId.get(act) : null; if (p && layout.mode === 'nodes') onZoom?.(p.group) }
      return
    }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); onZoomOut?.(); return }
    if (e.key === '1' || e.key === '2' || e.key === '3') { e.preventDefault(); const r = Number(e.key) as 1 | 2 | 3; setRing((cur) => (cur === r ? 0 : r)); return }
    if (e.key === '0' || e.key === 'Escape') { if (ring) { e.preventDefault(); setRing(0) } }
  }

  const label = hollow
    ? `Memory constellation: ${hollowReason ?? 'nothing to draw'}`
    : clusters ? `Memory constellation: ${layout.clusters.length} sources with counts` : `Memory constellation: ${layout.drawn} items`
  return (
    <div className="jm-const" data-mode={layout.mode} data-hollow={hollow ? 'true' : undefined} data-simulated={simulated ? 'true' : undefined}>
      <svg
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} className="jm-svg" role="listbox" aria-label={label} tabIndex={0}
        aria-activedescendant={act ? `${uid}-${act}` : undefined} onKeyDown={onKey} onBlur={() => setFocusId(null)}
        onMouseLeave={() => setHover(null)} data-testid="constellation" data-ring={ring || undefined}
      >
        <defs>
          <mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x="0" y="0" width={STAGE_W} height={STAGE_H}>
            {pathD && <path key={litKey} d={pathD} className="jm-reveal" pathLength={1} fill="none" stroke="white" strokeWidth="6" />}
          </mask>
        </defs>
        {/* the guides: three rings of age (newest inside), the golden-angle spokes of the sources, a cross at the middle */}
        <g className="jm-guides" aria-hidden="true">
          {RINGS.map((k, i) => <ellipse key={k} cx={CX} cy={CY} rx={RX * k} ry={RY * k} className={`jm-guide jm-guide-${i + 1}`} data-on={ring === i + 1 ? 'true' : undefined} />)}
          {layout.groups.slice(0, 9).map((g) => {
            const a = (g.angle * Math.PI) / 180
            return <line key={g.group} x1={CX} y1={CY} x2={CX + RX * Math.cos(a)} y2={CY + RY * Math.sin(a)} className="jm-spoke" />
          })}
          <path d={`M${CX - 7} ${CY}H${CX + 7}M${CX} ${CY - 7}V${CY + 7}`} className="jm-cross" />
          {!hollow && <text x={CX + RX * 0.46 - 14} y={CY + 24} className="jm-guide-word jm-r1">1</text>}
          {!hollow && <text x={CX + RX * 0.74 - 14} y={CY + 24} className="jm-guide-word jm-r2">2</text>}
          {!hollow && <text x={CX + RX - 14} y={CY + 24} className="jm-guide-word jm-r3">3</text>}
        </g>
        {!hollow && !clusters && (
          <g className="jm-links" aria-hidden="true">
            {layout.links.map(([a, b]) => {
              const p = byId.get(a)
              const q = byId.get(b)
              if (!p || !q) return null
              const on = (hover ?? selected) && near.has(a) && near.has(b)
              return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="jm-link" data-on={on ? 'true' : undefined} />
            })}
          </g>
        )}
        {!hollow && pathD && (
          <g aria-hidden="true">
            <path d={pathD} className="jm-path" mask={`url(#${uid}-m)`} fill="none" data-testid="recall-path" />
          </g>
        )}
        {!hollow && clusters && layout.clusters.map((c: Cluster) => (
          <g key={c.group} id={`${uid}-c:${c.group}`} role="option" aria-selected={false} aria-label={nameOf(`c:${c.group}`)} className="jm-node jm-cluster"
            data-focus={act === `c:${c.group}` ? 'true' : undefined} onClick={() => onZoom?.(c.group)}>
            <circle cx={c.x} cy={c.y} r={c.r} className="jm-cl-ring" />
            <circle cx={c.x} cy={c.y} r={Math.max(3, c.r - 7)} className="jm-cl-core" />
            <text x={c.x} y={c.y + 5} textAnchor="middle" className="jm-cl-n">{c.count.toLocaleString('en-IN')}</text>
            <text x={c.x} y={c.y + c.r + 16} textAnchor="middle" className="jm-cl-w">{groupWord(c.group)}</text>
          </g>
        ))}
        {!hollow && !clusters && layout.placed.map((p) => {
          const isSel = selected === p.id
          const on = !dimming || near.has(p.id)
          const ringOff = ring !== 0 && p.ring !== ring
          const rk = rank.get(p.id)
          return (
            <g key={p.id} id={`${uid}-${p.id}`} role="option" aria-selected={isSel} aria-label={nameOf(p.id)} className="jm-node"
              data-sel={isSel ? 'true' : undefined} data-focus={act === p.id ? 'true' : undefined} data-dim={!on || ringOff ? 'true' : undefined}
              data-lit={rk ? 'true' : undefined} data-flash={flash === p.id ? 'true' : undefined} data-kind={p.kind}
              onClick={() => onSelect(p.id)} onMouseEnter={() => setHover(p.id)}>
              <circle cx={p.x} cy={p.y} r={p.r + 5} className="jm-hit" />
              <circle cx={p.x} cy={p.y} r={p.r} className="jm-ring" />
              {p.r >= 9 && <text x={p.x} y={p.y + 4} textAnchor="middle" className="jm-letter">{groupLetter(p.group)}</text>}
              {p.r < 9 && <circle cx={p.x} cy={p.y} r={2.4} className="jm-dot" />}
              {rk && (
                <g className="jm-rank">
                  <circle cx={p.x + p.r} cy={p.y - p.r} r={9.5} />
                  <text x={p.x + p.r} y={p.y - p.r + 4} textAnchor="middle">{rk}</text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
      {hollow && (
        <div className="jm-hollow" data-testid="constellation-hollow">
          {art && <div className="jm-hollow-art" aria-hidden="true"><ArtSlot id="art.memory.branch" fit="contain" ratio={1.5} /></div>}
          <span className="jm-hollow-word">{simulated ? 'SIMULATED' : 'NO MAP'}</span>
          <span className="jm-hollow-line">{hollowReason}</span>
        </div>
      )}
    </div>
  )
}
