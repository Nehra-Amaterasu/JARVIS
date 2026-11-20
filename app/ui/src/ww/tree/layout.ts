// Where things sit on the tree canvas, and what is drawn at a given zoom (spec 20.8.2). Pure, so the DOM-count test and the keyboard
// model run without a browser. A branch is one row: its hub at the left, then seed, skills, capstone running right. The hubs hang on
// one vertical bus by a 45-degree chamfered trace (the circuit look). Layout units are CSS px at zoom 1.
import type { TreeDef } from './model'

export const ROW = 88          // one branch row; a 3-line label (39 px) under a 40 px capstone still clears the next row
export const COL = 140         // node pitch; a 20-character label at 12 px is about 120 px wide
export const HUB_W = 168
export const HUB_H = 56
export const BUS_X = -16
export const X0 = HUB_W + 56   // the first node
export const LOD_HUB = 0.55    // below this zoom only the branch hubs draw (spec: sigils and hubs)
export const LOD_FULL = 1.15   // from here labels and pips draw
export const PAD = 140         // layout units drawn beyond the visible box, so a short pan shows no pop-in

export type Band = 'hub' | 'node' | 'full'
export const bandOf = (k: number): Band => (k < LOD_HUB ? 'hub' : k < LOD_FULL ? 'node' : 'full')

export interface Placed { id: string; x: number; y: number; b: number }
export interface HubPlace { id: string; b: number; x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface Layout {
  nodes: Placed[]
  hubs: HubPlace[]
  byId: ReadonlyMap<string, Placed>
  hubById: ReadonlyMap<string, HubPlace>
  bounds: Box
  /** Bounding box of one branch (its hub and nodes) with a margin, for "zoom to a branch". */
  branchBox: (b: number) => Box
}

export function layoutTree(tree: TreeDef): Layout {
  const nodes: Placed[] = []
  const hubs: HubPlace[] = []
  tree.branches.forEach((br, b) => {
    const y = b * ROW
    hubs.push({ id: br.id, b, x: 0, y })
    br.nodes.forEach((n, i) => nodes.push({ id: n.id, x: X0 + i * COL, y, b }))
  })
  const widest = Math.max(1, ...tree.branches.map((br) => br.nodes.length))
  const right = X0 + (widest - 1) * COL + COL / 2
  const bounds: Box = { x: BUS_X - 24, y: -ROW / 2 - 8, w: right - BUS_X + 48, h: tree.branches.length * ROW + 16 }
  const branchBox = (b: number): Box => {
    const n = tree.branches[b]?.nodes.length ?? 1
    return { x: BUS_X - 24, y: b * ROW - ROW / 2, w: X0 + (n - 1) * COL + COL / 2 - BUS_X + 48, h: ROW }
  }
  return { nodes, hubs, byId: new Map(nodes.map((p) => [p.id, p])), hubById: new Map(hubs.map((h) => [h.id, h])), bounds, branchBox }
}

/** The part of the layout the stage shows at view (x, y, k) on a stage of w x h px, in layout units (padded). */
export function visibleBox(view: { x: number; y: number; k: number }, size: { w: number; h: number }, pad = PAD): Box {
  const k = view.k || 1
  return { x: -view.x / k - pad, y: -view.y / k - pad, w: size.w / k + 2 * pad, h: size.h / k + 2 * pad }
}

const inside = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h

export interface DrawPlan {
  band: Band
  /** Ids of the nodes to draw (in the hub band only the focused and the open node). */
  nodes: string[]
  /** Branch indexes whose hub is drawn. */
  hubs: number[]
}

/** What the stage draws: the nodes inside the padded box, plus the ones the keyboard needs (`keep`: the focused and the open node). */
export function drawPlan(layout: Layout, view: { x: number; y: number; k: number }, size: { w: number; h: number }, keep: readonly (string | null)[] = []): DrawPlan {
  const band = bandOf(view.k)
  const box = visibleBox(view, size)
  const hubs = layout.hubs.filter((h) => inside({ x: box.x - HUB_W, y: box.y, w: box.w + HUB_W, h: box.h }, h.x, h.y)).map((h) => h.b)
  // the hub band draws the hubs of every branch and, so the keyboard never loses its place, the focused and the open node
  if (band === 'hub') return { band, nodes: keep.filter((k): k is string => !!k && layout.byId.has(k)), hubs: layout.hubs.map((h) => h.b) }
  const ids = new Set<string>()
  for (const p of layout.nodes) if (inside(box, p.x, p.y)) ids.add(p.id)
  for (const k of keep) if (k && layout.byId.has(k)) ids.add(k)
  return { band, nodes: [...ids], hubs }
}

/** A trace between two points on one row: straight, with its ends clipped to the node radius. */
export const rowTrace = (x1: number, x2: number, y: number, r1: number, r2: number): string => `M${x1 + r1},${y}H${x2 - r2}`

/** The chamfered trace from the bus to a hub: the bus runs down from the row above, then 45 degrees, then across. */
export const busTrace = (y: number, first: boolean): string => `M${BUS_X},${first ? y - 14 : y - ROW - 14}V${y - 14}l14,14H0`

export type Dir = 'left' | 'right' | 'up' | 'down'

/** The nearest focusable point in a direction (geometric: distance along the key's axis plus twice the drift off it). Hubs count. */
export function neighbour(points: readonly { id: string; x: number; y: number }[], from: { x: number; y: number }, fromId: string, dir: Dir): string | null {
  let best: string | null = null
  let bestCost = Infinity
  for (const p of points) {
    if (p.id === fromId) continue
    const dx = p.x - from.x
    const dy = p.y - from.y
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    if (along <= 1) continue
    const drift = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (drift > along * 2.5) continue   // within about 70 degrees of the key's direction
    const cost = along + 2 * drift
    if (cost < bestCost) { bestCost = cost; best = p.id }
  }
  return best
}

/** Label lines for a node name: at most `max` characters a line, breaking at spaces; a long word is split, nothing is cut or ellipsised. */
export function labelLines(name: string, max = 20): string[] {
  const out: string[] = []
  let cur = ''
  for (const w of name.trim().split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < w.length; i += max) {
      const t = w.slice(i, i + max)
      const next = cur ? `${cur} ${t}` : t
      if (next.length <= max) cur = next
      else { out.push(cur); cur = t }
    }
  }
  if (cur) out.push(cur)
  return out.length ? out : ['']
}
