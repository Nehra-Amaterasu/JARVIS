// SkillNode (T01, spec 20.8.2): one node of a tree. Shape carries the tier (a seed 28 px, a skill 34 px, a capstone 40 px with a notched
// top and a sigil ring); the state is carried by shape and glyph, never by colour alone:
//   LOCKED      dashed outline, a padlock
//   OPEN        solid outline, empty core
//   IN PROGRESS half-filled core
//   CLAIMED     a hollow double ring (a self-mark, nothing to show)
//   EVIDENCED   filled core, one pip per record (at most five drawn, then "5+")
//   STALE       the core is filled but a ring with a gap sits round it: a refresher is due, nobody is shamed
// It draws inside an <svg> (the stage or a swatch); `compact` is the zoomed-out form: one stroked path, no label, no pips.
import { memo, type KeyboardEventHandler, type MouseEventHandler } from 'react'
import { labelLines } from './layout'
import type { NodeState } from './ledger'
import { STATE_WORD } from './ledger'
import type { Tier } from './model'

export const RADIUS: Record<Tier, number> = { 1: 14, 2: 17, 3: 20 }
export const PIP_MAX = 5

const f = (n: number) => Math.round(n * 100) / 100

/** A pointy-top hexagon of circumradius r; a capstone's top vertex is notched. */
export function hexD(r: number, notch = false): string {
  const pts: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const a = (-90 + 60 * i) * (Math.PI / 180)
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  if (notch) {
    const [top, ...rest] = pts
    const q = r * 0.2
    return `M${f(top[0] - q)},${f(top[1] + q * 0.4)}L${f(top[0])},${f(top[1] + q * 1.1)}L${f(top[0] + q)},${f(top[1] + q * 0.4)}L${rest.map((p) => `${f(p[0])},${f(p[1])}`).join('L')}Z`
  }
  return `M${pts.map((p) => `${f(p[0])},${f(p[1])}`).join('L')}Z`
}

/** The outline of a tier (a capstone's notch included). */
export const outlineD = (tier: Tier): string => hexD(RADIUS[tier], tier === 3)

const circle = (r: number) => `M${-r},0a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0`

/** The stroked glyph of a state, drawn inside the outline. `filled` leaves the core to the separate filled path. */
export function glyphD(tier: Tier, state: NodeState, filled = false): string {
  const r = RADIUS[tier]
  switch (state) {
    case 'locked': return `M-5,0h10v8h-10zM-3,0v-3a3,3 0 0 1 6,0v3`
    case 'progress': return circle(r * 0.42)
    case 'claimed': return hexD(r * 0.58)
    case 'evidenced': return filled ? '' : hexD(r * 0.28)
    case 'stale': {
      // a ring that stops short: 300 degrees of arc, then a gap
      const g = r * 0.66
      const p = (deg: number) => `${f(g * Math.cos((deg * Math.PI) / 180))},${f(g * Math.sin((deg * Math.PI) / 180))}`
      return `M${p(20)}A${f(g)},${f(g)} 0 1 1 ${p(320)}${filled ? '' : hexD(r * 0.24)}`
    }
    default: return ''
  }
}

/** The filled core, for the states that have one (the full form only; the compact form strokes a small hexagon instead). */
export function coreD(tier: Tier, state: NodeState): string {
  const r = RADIUS[tier]
  if (state === 'evidenced' || state === 'stale') return hexD(r * 0.34)
  if (state === 'progress') { const c = r * 0.42; return `M0,${-c}A${c},${c} 0 0 0 0,${c}Z` }
  return ''
}

/** The sigil ring of a capstone, dashed, outside the notched hexagon. */
export const sigilD = (): string => circle(RADIUS[3] + 6)

export interface SkillNodeProps {
  tier: Tier
  state: NodeState
  /** Records that count as evidence on this node. */
  pips: number
  label: string
  x?: number
  y?: number
  id?: string
  /** The zoomed-out form: one path, no label, no pips. */
  compact?: boolean
  /** Leave the label out (the stage's edge would cut it); the node's aria-label still names it. */
  hideLabel?: boolean
  selected?: boolean
  /** Dimmed by a branch filter. */
  dim?: boolean
  tabIndex?: number
  onClick?: MouseEventHandler<SVGElement>
  onKeyDown?: KeyboardEventHandler<SVGElement>
  onFocus?: () => void
}

export const stateLabel = (label: string, tier: Tier, state: NodeState, pips: number): string =>
  `${label}, tier ${tier}, ${STATE_WORD[state]}${pips > 0 ? `, ${pips} record${pips === 1 ? '' : 's'}` : ''}`

const pipsD = (n: number, r: number): string => {
  const k = Math.min(n, PIP_MAX)
  return Array.from({ length: k }, (_, i) => `M${f((i - (k - 1) / 2) * 7)},${r + 8}h0`).join('')
}

function SkillNodeView({ tier, state, pips, label, x = 0, y = 0, id, compact = false, hideLabel = false, selected = false, dim = false, tabIndex = -1, onClick, onKeyDown, onFocus }: SkillNodeProps) {
  const r = RADIUS[tier]
  const common = {
    role: 'button' as const, tabIndex, 'data-id': id, 'data-tier': tier, 'data-state': state, 'data-selected': selected ? 'true' : undefined, 'data-dim': dim ? 'true' : undefined,
    'aria-label': stateLabel(label, tier, state, pips), 'aria-pressed': selected, onClick, onKeyDown, onFocus,
  }
  if (compact) {
    return <path className="tree-node sn sn-compact" transform={`translate(${x},${y})`} d={outlineD(tier) + glyphD(tier, state)} {...common} />
  }
  const core = coreD(tier, state)
  const glyph = glyphD(tier, state, core !== '')
  const lines = labelLines(label)
  return (
    <g className="tree-node sn" transform={`translate(${x},${y})`} {...common}>
      <path className="sn-ring" d={outlineD(tier)} />
      {selected && <path className="sn-tint" d={outlineD(tier)} />}
      {selected && <path className="sn-halo" d={hexD(r + 6, tier === 3)} />}
      {glyph && <path className="sn-glyph" d={glyph} />}
      {tier === 3 && <path className="sn-sigil" d={sigilD()} />}
      {core && <path className="sn-core" d={core} />}
      {pips > 0 && <path className="sn-pips" d={pipsD(pips, r)} />}
      {pips > PIP_MAX && <text className="sn-more" x={f(PIP_MAX * 3.5 + 8)} y={r + 11}>{PIP_MAX}+</text>}
      {!hideLabel && <text className="sn-label" textAnchor="middle" y={r + 24}>{lines.map((l, i) => <tspan key={i} x={0} dy={i ? 13 : 0}>{l}</tspan>)}</text>}
    </g>
  )
}

export const SkillNode = memo(SkillNodeView)

/** The drawing alone, with no role and no focus: for a legend swatch or the drawer's header (an <svg> parent supplies the viewBox). */
export function NodeGlyph({ tier, state, x = 0, y = 0 }: { tier: Tier; state: NodeState; x?: number; y?: number }) {
  return <path className="sn sn-compact" data-state={state} data-tier={tier} transform={`translate(${x},${y})`} d={outlineD(tier) + glyphD(tier, state)} />
}
