/**
 * The skill tree as a real DAG, and where to draw it.
 *
 * Status (the same rule as the server's node_status):
 *   locked      a prerequisite is not mastered yet
 *   available   every prerequisite mastered; can be started
 *   in_progress started (at most 3 at once; the server enforces the cap)
 *   mastered    every contract done, or marked mastered
 *
 * Layout: the Assassin's Creed Origins / Cyberpunk 2077 shape. A trunk at the
 * bottom, one branch per discipline fanning out above it, tiers as rings of
 * increasing radius, prerequisite edges drawn between nodes. Pure functions, so
 * the page renders one SVG from them and the tests check them.
 */
import type { Bank, BankNode } from '../data/bank'

export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'mastered'
export interface NodeRecord { status?: string; started?: string; mastered?: string; last?: string; attributes?: NodeAttributes }
export interface NodeAttributes {
  certs?: { text: string; url: string; at: string; cert?: string | null }[]
  projects?: { text: string; url: string; at: string }[]
  achievements?: { text: string; url: string; at: string }[]
}

export function nodeStatus(bank: Bank, nodes: Record<string, NodeRecord>, id: string): NodeStatus {
  const rec = nodes[id]
  if (rec?.status === 'mastered') return 'mastered'
  if (rec?.status === 'in_progress') return 'in_progress'
  const n = bank.nodes[id]
  if (!n) return 'locked'
  return n.prereqs.every((p) => nodes[p]?.status === 'mastered') ? 'available' : 'locked'
}

export function allStatuses(bank: Bank, nodes: Record<string, NodeRecord>): Record<string, NodeStatus> {
  return Object.fromEntries(bank.order.map((id) => [id, nodeStatus(bank, nodes, id)]))
}

/** The nodes a node unlocks (the reverse edges). */
export function dependents(bank: Bank, id: string): string[] {
  return bank.order.filter((k) => bank.nodes[k].prereqs.includes(id))
}

/** id and everything it needs, prerequisites first. */
export function prereqClosure(bank: Bank, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (u: string) => {
    if (seen.has(u) || !bank.nodes[u]) return
    seen.add(u)
    for (const p of bank.nodes[u].prereqs) walk(p)
    out.push(u)
  }
  walk(id)
  return out
}

/* ======================================================================= layout */
export interface Placed { id: string; x: number; y: number; branch: string; tier: number; node: BankNode }
export interface Edge { from: string; to: string; d: string }
export interface Layout {
  nodes: Placed[]
  byId: Record<string, Placed>
  edges: Edge[]
  branches: { name: string; angle: number; x: number; y: number }[]
  viewBox: string
  trunk: { x: number; y: number }
}

const R0 = 150       // radius of tier 0
const DR = 115       // ring spacing
const FAN = 150      // degrees the branches span

export function branchesOf(bank: Bank): string[] {
  const seen: string[] = []
  for (const id of bank.order) {
    const b = bank.nodes[id].branch
    if (!seen.includes(b)) seen.push(b)
  }
  return seen
}

/** Deterministic: the same bank always draws the same tree. */
export function layoutTree(bank: Bank): Layout {
  const branches = branchesOf(bank)
  const B = Math.max(1, branches.length)
  const sector = FAN / B
  const placed: Placed[] = []
  const branchInfo: Layout['branches'] = []
  branches.forEach((name, bi) => {
    const centre = -FAN / 2 + sector * (bi + 0.5)
    const ids = bank.order.filter((id) => bank.nodes[id].branch === name)
    const tiers = new Map<number, string[]>()
    for (const id of ids) {
      const t = bank.nodes[id].tier
      tiers.set(t, [...(tiers.get(t) ?? []), id])
    }
    // Compress the tiers a branch uses, so a branch starting at tier 2 still sits on the first ring.
    const used = [...tiers.keys()].sort((a, b) => a - b)
    used.forEach((t, ring) => {
      const row = tiers.get(t)!
      const r = R0 + DR * ring
      // Spread a ring's nodes across most of the sector, never wider than ~95px apart.
      const span = Math.min(sector * 0.8, (row.length - 1) * (95 / r) * (180 / Math.PI))
      row.forEach((id, i) => {
        const a = centre + (row.length > 1 ? -span / 2 + (span * i) / (row.length - 1) : 0)
        const rad = (a * Math.PI) / 180
        placed.push({ id, x: Math.round(r * Math.sin(rad)), y: Math.round(-r * Math.cos(rad)), branch: name, tier: t, node: bank.nodes[id] })
      })
    })
    const rad = (centre * Math.PI) / 180
    branchInfo.push({ name, angle: centre, x: Math.round((R0 - 62) * Math.sin(rad)), y: Math.round(-(R0 - 62) * Math.cos(rad)) })
  })
  const byId = Object.fromEntries(placed.map((p) => [p.id, p]))
  const trunk = { x: 0, y: 40 }
  const edges: Edge[] = []
  for (const p of placed) {
    if (!p.node.prereqs.length) {
      // Roots grow from the trunk.
      edges.push({ from: '__trunk', to: p.id, d: curve(trunk.x, trunk.y, p.x, p.y) })
      continue
    }
    for (const q of p.node.prereqs) {
      const f = byId[q]
      if (f) edges.push({ from: q, to: p.id, d: curve(f.x, f.y, p.x, p.y) })
    }
  }
  const xs = placed.map((p) => p.x)
  const ys = placed.map((p) => p.y)
  const pad = 90
  const minX = Math.min(-200, ...xs) - pad
  const maxX = Math.max(200, ...xs) + pad
  const minY = Math.min(-200, ...ys) - pad
  const maxY = Math.max(trunk.y + 60, ...ys) + pad / 2
  return { nodes: placed, byId, edges, branches: branchInfo, trunk, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` }
}

/** A gentle curve that bends toward the trunk, like a branch, not a wire. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  // Pull the control point toward the trunk axis (x = 0) a little.
  const cx = mx * 0.8
  const cy = my + Math.abs(x2 - x1) * 0.15
  return `M${x1},${y1} Q${Math.round(cx)},${Math.round(cy)} ${x2},${y2}`
}

/** Keyboard navigation: the nearest node in a direction (arrow keys). */
export function neighbour(layout: Layout, fromId: string, dir: 'up' | 'down' | 'left' | 'right'): string | null {
  const from = layout.byId[fromId]
  if (!from) return layout.nodes[0]?.id ?? null
  let best: { id: string; s: number } | null = null
  for (const p of layout.nodes) {
    if (p.id === fromId) continue
    const dx = p.x - from.x
    const dy = p.y - from.y
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy)
    if (along <= 4) continue
    const s = along + across * 2
    if (!best || s < best.s) best = { id: p.id, s }
  }
  return best?.id ?? null
}
