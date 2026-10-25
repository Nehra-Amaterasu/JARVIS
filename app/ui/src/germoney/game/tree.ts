/**
 * The skill tree as a real DAG, and where to draw it.
 *
 * Status (the same rule as the server's node_status):
 *   locked      a prerequisite is not mastered yet
 *   available   every prerequisite mastered; can be started
 *   in_progress started (at most 3 at once; the server enforces the cap)
 *   mastered    every contract done, or marked mastered
 *
 * Layout: a layered DAG. A trunk at the bottom, one row per tier going up (a node
 * always sits above its prerequisites), each branch kept together as a band, and
 * prerequisite edges drawn between nodes. Pure functions, so
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

const LAYER_GAP = 150  // vertical distance between layers
const COL_GAP = 175    // horizontal distance between nodes in a layer
const BASE_Y = 110     // the first layer sits this far above the trunk

export function branchesOf(bank: Bank): string[] {
  const seen: string[] = []
  for (const id of bank.order) {
    const b = bank.nodes[id].branch
    if (!seen.includes(b)) seen.push(b)
  }
  return seen
}

/**
 * Layer of a node: its tier (rebased to 0), pushed up so it always sits above every
 * prerequisite. Edges therefore always run upward and never sideways inside a layer.
 */
function layers(bank: Bank): Record<string, number> {
  const minTier = Math.min(...bank.order.map((id) => bank.nodes[id].tier))
  const out: Record<string, number> = {}
  const seen = new Set<string>()
  const walk = (id: string): number => {
    if (id in out) return out[id]
    if (seen.has(id)) return 0   // a cycle in the bank: don't loop, the bank validator reports it
    seen.add(id)
    const n = bank.nodes[id]
    let l = n.tier - minTier
    for (const p of n.prereqs) if (bank.nodes[p]) l = Math.max(l, walk(p) + 1)
    out[id] = l
    return l
  }
  for (const id of bank.order) walk(id)
  return out
}

/**
 * Deterministic layered DAG (Sugiyama-style, kept simple): one row per layer from the
 * trunk upward, nodes grouped by branch inside a row, then two barycentre sweeps so a
 * node sits near its prerequisites, which keeps edge crossings down.
 */
export function layoutTree(bank: Bank): Layout {
  const branches = branchesOf(bank)
  const bIndex = Object.fromEntries(branches.map((b, i) => [b, i]))
  const L = layers(bank)
  const rows: string[][] = []
  for (const id of bank.order) (rows[L[id]] ??= []).push(id)
  for (let i = 0; i < rows.length; i++) rows[i] ??= []
  rows.forEach((r) => r.sort((a, b) => bIndex[bank.nodes[a].branch] - bIndex[bank.nodes[b].branch] || bank.order.indexOf(a) - bank.order.indexOf(b)))
  const pos: Record<string, number> = {}
  const place = (row: string[]) => row.forEach((id, i) => { pos[id] = (i - (row.length - 1) / 2) * COL_GAP })
  rows.forEach(place)
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let li = 1; li < rows.length; li++) {
      const row = rows[li]
      const bary = (id: string) => {
        const ps = bank.nodes[id].prereqs.filter((p) => p in pos)
        return ps.length ? ps.reduce((a, p) => a + pos[p], 0) / ps.length : pos[id]
      }
      // Branch stays the primary key, so a branch reads as one band; barycentre orders inside it.
      const key = Object.fromEntries(row.map((id) => [id, bary(id)]))
      row.sort((a, b) => bIndex[bank.nodes[a].branch] - bIndex[bank.nodes[b].branch] || key[a] - key[b] || a.localeCompare(b))
      place(row)
    }
  }
  const placed: Placed[] = []
  rows.forEach((row, li) => row.forEach((id) => {
    placed.push({ id, x: Math.round(pos[id]), y: -(BASE_Y + li * LAYER_GAP), branch: bank.nodes[id].branch, tier: bank.nodes[id].tier, node: bank.nodes[id] })
  }))
  const byId = Object.fromEntries(placed.map((p) => [p.id, p]))
  const branchInfo: Layout['branches'] = branches.map((name) => {
    const mine = placed.filter((p) => p.branch === name)
    const low = Math.max(...mine.map((p) => p.y))
    const atLow = mine.filter((p) => p.y === low)
    const x = Math.round(atLow.reduce((a, p) => a + p.x, 0) / atLow.length)
    return { name, angle: 0, x, y: low + 52 }
  })
  const trunk = { x: 0, y: 40 }
  const edges: Edge[] = []
  for (const p of placed) {
    if (!p.node.prereqs.length) {
      edges.push({ from: '__trunk', to: p.id, d: curve(trunk.x, trunk.y, p.x, p.y + 20) })
      continue
    }
    for (const q of p.node.prereqs) {
      const f = byId[q]
      if (f) edges.push({ from: q, to: p.id, d: curve(f.x, f.y - 20, p.x, p.y + 20) })
    }
  }
  const xs = placed.map((p) => p.x)
  const ys = placed.map((p) => p.y)
  const pad = 110
  const minX = Math.min(-200, ...xs) - pad
  const maxX = Math.max(200, ...xs) + pad
  const minY = Math.min(-200, ...ys) - pad / 2
  const maxY = Math.max(trunk.y + 60, ...ys) + pad / 2
  return { nodes: placed, byId, edges, branches: branchInfo, trunk, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` }
}

/** A vertical S-curve from a prerequisite (below) to the node it unlocks (above). */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const my = Math.round((y1 + y2) / 2)
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
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
