// The authoring shape of a tree (slot `data/`, spec 20.8.5). A tree is a file `data/NN-name.tree.ts` that default-exports one
// `TreeSrc`; model.ts loads every such file by glob, so a package adds or edits a tree without touching the page. A branch is a
// short chain of nodes written as `a | b | c`: the first is the seed (tier 1), the last the capstone (tier 3), the ones between
// are skills (tier 2). Every branch has at least three nodes; tree.count.test.ts asserts that, and the ten trees and 113
// branches, by machine.
export interface BranchSrc {
  name: string
  /** Node names, seed first, capstone last. */
  nodes: string[]
  /** One of the five reserved capstone branches of spec 20.8.5. */
  reserved?: boolean
}

export interface TreeSrc {
  /** Stable id (a node id is `<tree>/<branch slug>/<node slug>`). */
  id: string
  name: string
  /** One line: what the tree is for, in plain words. */
  about: string
  /** Days after which the newest hard record makes a node STALE (language 60, body 30, the rest 90: proposals of 20.8.4). */
  refreshDays: number
  branches: BranchSrc[]
}

/** `br('Calculus', 'Limits | Derivatives | Integrals')`. */
export const br = (name: string, nodes: string, reserved = false): BranchSrc => ({
  name,
  nodes: nodes.split('|').map((s) => s.trim()).filter(Boolean),
  ...(reserved ? { reserved: true } : {}),
})
