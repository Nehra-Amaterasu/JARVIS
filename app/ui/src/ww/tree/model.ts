// The Tree's data model (T01, spec 20.8): ten trees, each a list of branches, each branch a short chain of nodes. The trees are
// authored files in `trees/` (the slot, loaded by glob; a folder named `data/` would be ignored by git, so the slot has another
// name), and this file turns them into nodes with ids, tiers and prerequisites. Pure: no DOM, no clock, no network.
import type { TreeSrc } from './trees/schema'

export type Tier = 1 | 2 | 3

export interface NodeDef {
  /** `<tree>/<branch slug>/<node slug>`; stable as long as the authored names are. */
  id: string
  tree: string
  /** Index of the branch in its tree. */
  b: number
  branch: string
  /** Index of the node in its branch. */
  i: number
  tier: Tier
  name: string
  /** The node before this one in its branch (it must hold evidence before this one opens), or null for a seed. */
  prereq: string | null
  /** Evidence weight the node needs (unlock rule, 20.8.4): a seed 1, a skill 2, a capstone 3. */
  need: number
}

export interface BranchDef {
  id: string
  name: string
  reserved: boolean
  nodes: NodeDef[]
}

export interface TreeDef {
  id: string
  name: string
  about: string
  /** Days after which the newest hard record makes a node STALE. */
  refreshDays: number
  branches: BranchDef[]
  nodes: NodeDef[]
  byId: ReadonlyMap<string, NodeDef>
}

/** What the Grove needs of one tree. `evidenced` is null while the ledger is not LIVE or SIMULATED: no number without a state. */
export interface TreeSummary {
  id: string
  name: string
  about: string
  branches: number
  nodes: number
  evidenced: number | null
  /** Newest live record date (YYYY-MM-DD) in this tree, or null. */
  last: string | null
}

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const tierOf = (i: number, n: number): Tier => (i === 0 ? 1 : i === n - 1 ? 3 : 2)
export const NEED: Record<Tier, number> = { 1: 1, 2: 2, 3: 3 }

export function buildTree(src: TreeSrc): TreeDef {
  const nodes: NodeDef[] = []
  const branches: BranchDef[] = src.branches.map((br, b) => {
    const bid = `${src.id}/${slug(br.name)}`
    const list: NodeDef[] = br.nodes.map((name, i) => {
      const tier = tierOf(i, br.nodes.length)
      return { id: `${bid}/${slug(name)}`, tree: src.id, b, branch: br.name, i, tier, name, prereq: null, need: NEED[tier] }
    })
    list.forEach((n, i) => { n.prereq = i === 0 ? null : list[i - 1].id })
    nodes.push(...list)
    return { id: bid, name: br.name, reserved: !!br.reserved, nodes: list }
  })
  return { id: src.id, name: src.name, about: src.about, refreshDays: src.refreshDays, branches, nodes, byId: new Map(nodes.map((n) => [n.id, n])) }
}

/** Every authored tree, in file order (01 to 10). A file that does not default-export a tree is skipped here and caught by the count test. */
export function loadTrees(mods: Record<string, unknown> = import.meta.glob('./trees/*.tree.ts', { eager: true })): TreeDef[] {
  return Object.keys(mods).sort().map((p) => (mods[p] as { default?: TreeSrc }).default).filter((t): t is TreeSrc => !!t && Array.isArray(t.branches)).map(buildTree)
}

let cache: TreeDef[] | null = null
export const TREES = (): TreeDef[] => (cache ??= loadTrees())

/** A node of any tree by id. */
export function findNode(id: string, trees: TreeDef[] = TREES()): NodeDef | null {
  const t = trees.find((x) => id.startsWith(`${x.id}/`))
  return t?.byId.get(id) ?? null
}

/** A synthetic tree of `branches` x `perBranch` nodes: the stress input of the DOM-count test and the gallery. Never shown as real. */
export function syntheticTree(branches: number, perBranch: number): TreeDef {
  return buildTree({
    id: 'synthetic',
    name: 'Synthetic',
    about: 'A generated tree for measuring.',
    refreshDays: 90,
    branches: Array.from({ length: branches }, (_, b) => ({ name: `Branch ${b + 1}`, nodes: Array.from({ length: perBranch }, (_, i) => `Step ${b + 1}.${i + 1}`) })),
  })
}
