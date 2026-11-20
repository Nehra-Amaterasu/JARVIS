// The unlock rule and growth (spec 20.8.4), pure functions of the evidence ledger. Nothing here is stored: delete a record and the
// next call returns the lower answer, which is the whole point ("growth is a pure function of the ledger and falls when a record
// is deleted"). No clock is read: callers pass `now` (epoch ms), so a test and the gallery's fixture day agree.
import { HARD_KINDS, type EvidenceRecord, type LedgerReading } from './ports'
import { type NodeDef, type TreeDef, type TreeSummary } from './model'
import { showsNumber } from '../../shared/lamp'

export type NodeState = 'locked' | 'open' | 'progress' | 'claimed' | 'evidenced' | 'stale'

export const STATE_WORD: Record<NodeState, string> = {
  locked: 'LOCKED', open: 'OPEN', progress: 'IN PROGRESS', claimed: 'CLAIMED', evidenced: 'EVIDENCED', stale: 'STALE',
}

/** One line of what each state means, for the legend and the drawer. */
export const STATE_MEANS: Record<NodeState, string> = {
  locked: 'The step before it holds no evidence yet.',
  open: 'Ready to work on; nothing recorded.',
  progress: 'Some evidence, not yet enough.',
  claimed: 'A self-mark: you say you can, with nothing to show yet.',
  evidenced: 'Enough evidence, including a hard record.',
  stale: 'Evidenced once; the newest hard record is old, so a refresher is due.',
}

export const STATES: readonly NodeState[] = ['locked', 'open', 'progress', 'claimed', 'evidenced', 'stale']

export interface Derived {
  state: NodeState
  /** Live (not deleted) records of this node, newest first, self-marks included. */
  records: EvidenceRecord[]
  /** One pip per record that counts as evidence (a self-mark is not one). */
  pips: number
  /** Sum of the weights that count (a self-mark counts for nothing). */
  weight: number
  /** Newest hard record date, or null. */
  hardAt: string | null
}

const DAY = 86_400_000
const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`)

const live = (r: EvidenceRecord) => r.deletedAt === null

/** The state of every node of a tree. A node's own records decide first; with none, it is OPEN when its step before holds evidence, else LOCKED. */
export function deriveTree(tree: TreeDef, records: readonly EvidenceRecord[], now: number): Map<string, Derived> {
  const by = new Map<string, EvidenceRecord[]>()
  for (const r of records) if (live(r) && r.nodeId.startsWith(`${tree.id}/`)) (by.get(r.nodeId) ?? by.set(r.nodeId, []).get(r.nodeId)!).push(r)
  const out = new Map<string, Derived>()
  // branch order is chain order, so a node's prerequisite is always derived before it
  for (const n of tree.nodes) {
    const rs = (by.get(n.id) ?? []).slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    const counting = rs.filter((r) => r.kind !== 'self')
    const weight = counting.reduce((s, r) => s + Math.max(0, r.weight), 0)
    const hard = counting.filter((r) => HARD_KINDS.includes(r.kind))
    const hardAt = hard.length ? hard[0].at : null
    let state: NodeState
    if (weight >= n.need && hard.length > 0) {
      state = hardAt !== null && now - dayMs(hardAt) > tree.refreshDays * DAY ? 'stale' : 'evidenced'
    } else if (weight > 0) state = 'progress'   // real evidence outranks a claim: a self-mark beside a drill still reads IN PROGRESS
    else if (rs.some((r) => r.kind === 'self')) state = 'claimed'
    else {
      const p = n.prereq ? out.get(n.prereq)?.state : 'evidenced'
      state = p === 'evidenced' || p === 'stale' ? 'open' : 'locked'
    }
    out.set(n.id, { state, records: rs, pips: counting.length, weight, hardAt })
  }
  return out
}

/** Evidence earned: a stale node still counts (it was earned; it asks for a refresher, it is never shamed). */
export const earned = (s: NodeState): boolean => s === 'evidenced' || s === 'stale'

export interface Growth { evidenced: number; total: number }

/** Growth of one tree: nodes earned out of nodes written. Stepped per node, a pure function of the records. */
export function growth(tree: TreeDef, derived: ReadonlyMap<string, Derived>): Growth {
  let evidenced = 0
  for (const n of tree.nodes) if (earned(derived.get(n.id)?.state ?? 'locked')) evidenced += 1
  return { evidenced, total: tree.nodes.length }
}

/** How many of `steps` rungs of the spine are drawn filled: the earned share of the nodes, stepped (never a smooth percentage). */
export function filledSteps(g: Growth, steps: number): number {
  if (g.total <= 0 || steps <= 0) return 0
  return Math.min(steps, Math.floor((g.evidenced * steps) / g.total))
}

/** Per-branch earned counts, for the Branches list and the "6 of 14" line. */
export function branchGrowth(tree: TreeDef, derived: ReadonlyMap<string, Derived>): { id: string; name: string; earned: number; total: number; done: boolean }[] {
  return tree.branches.map((b) => {
    const e = b.nodes.filter((n) => earned(derived.get(n.id)?.state ?? 'locked')).length
    return { id: b.id, name: b.name, earned: e, total: b.nodes.length, done: e === b.nodes.length }
  })
}

/** The Grove's summary of every tree. A number is carried only when the ledger's state may show one. */
export function summarise(trees: TreeDef[], reading: LedgerReading, now: number): TreeSummary[] {
  const numbers = showsNumber(reading.state)
  return trees.map((t) => {
    const d = deriveTree(t, reading.records, now)
    const last = reading.records.filter((r) => live(r) && r.nodeId.startsWith(`${t.id}/`)).map((r) => r.at).sort().pop() ?? null
    return { id: t.id, name: t.name, about: t.about, branches: t.branches.length, nodes: t.nodes.length, evidenced: numbers ? growth(t, d).evidenced : null, last: numbers ? last : null }
  })
}

/** The single node the rules pick next: the open node that has been open longest (a seed has been open since the start; a later
 *  node since its step before earned its newest record). Ties go by tree and branch order. A Career gap would come first once the
 *  Career section writes one; none exists yet. */
export function nextUp(trees: TreeDef[], reading: LedgerReading, now: number): { node: NodeDef; tree: TreeDef } | null {
  let best: { node: NodeDef; tree: TreeDef; since: string } | null = null
  for (const t of trees) {
    const d = deriveTree(t, reading.records, now)
    for (const n of t.nodes) {
      if (d.get(n.id)?.state !== 'open') continue
      const since = n.prereq ? (d.get(n.prereq)?.records[0]?.at ?? '9999') : ''
      if (!best || since < best.since) best = { node: n, tree: t, since }
    }
  }
  return best ? { node: best.node, tree: best.tree } : null
}

const KIND_SHORT: Record<string, string> = { drill: 'drill', timed: 'timed', artefact: 'artefact', session: 'session', certificate: 'certificate', witness: 'witness', self: 'self-mark' }

/** The last `n` live records as terminal lines: `2026-11-12 drill held-out 8/10 -> Number systems`. */
export function ledgerLines(records: readonly EvidenceRecord[], nameOf: (nodeId: string) => string | null, n = 3): string[] {
  return records.filter(live).slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1)).slice(0, n)
    .map((r) => `${r.at} ${KIND_SHORT[r.kind] ?? r.kind} ${r.detail} -> ${nameOf(r.nodeId) ?? r.nodeId}`)
}
