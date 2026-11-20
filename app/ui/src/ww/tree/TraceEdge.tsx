// TraceEdge (T01, spec 20.8.2): the circuit traces between nodes. An edge lights only when BOTH ends hold evidence: then it is a 1.5 px
// solid line with a static tick every 24 px; an unmet one is 1 px dotted; the selected node's path to its prerequisites shows as
// "need" (a heavier dash). The stage draws all traces of one kind as ONE path (a long `d`), so 300 nodes cost three elements, not 300.
import { memo } from 'react'
import { HUB_W, busTrace, rowTrace, type Layout } from './layout'
import { RADIUS } from './SkillNode'
import { earned, type Derived } from './ledger'
import type { TreeDef } from './model'

export type EdgeKind = 'met' | 'unmet' | 'need'

export interface EdgeSets { met: string; unmet: string; need: string; bus: string }

/** The `d` strings of the traces to draw: only edges with an end among `ids` (the drawn nodes) or a drawn hub. `path` is the selected
 *  node's chain of prerequisites (ids, seed first), drawn as "need" where it is not already met. */
export function edgeSets(tree: TreeDef, layout: Layout, derived: ReadonlyMap<string, Derived>, ids: ReadonlySet<string>, hubs: ReadonlySet<number>, path: readonly string[] = []): EdgeSets {
  let met = ''
  let unmet = ''
  let need = ''
  let bus = ''
  const onPath = new Set(path)
  tree.branches.forEach((br, b) => {
    const hub = layout.hubById.get(br.id)!
    if (hubs.has(b)) bus += busTrace(hub.y, b === 0)
    br.nodes.forEach((n, i) => {
      const here = layout.byId.get(n.id)!
      const there = i === 0 ? null : layout.byId.get(br.nodes[i - 1].id)!
      if (!ids.has(n.id) && !(there && ids.has(br.nodes[i - 1].id)) && !(i === 0 && hubs.has(b))) return
      const x1 = there ? there.x : hub.x + HUB_W
      const r1 = there ? RADIUS[br.nodes[i - 1].tier] : 0
      const d = rowTrace(x1, here.x, here.y, r1, RADIUS[n.tier])
      const bothEarned = earned(derived.get(n.id)?.state ?? 'locked') && (i === 0 || earned(derived.get(br.nodes[i - 1].id)?.state ?? 'locked'))
      if (bothEarned) met += d
      else if (onPath.has(n.id) && i > 0) need += d
      else unmet += d
    })
  })
  return { met, unmet, need, bus }
}

export const TraceEdge = memo(function TraceEdge({ d, kind }: { d: string; kind: EdgeKind }) {
  if (!d) return null
  return (
    <>
      <path className={`te te-${kind}`} d={d} />
      {kind === 'met' && <path className="te-ticks" d={d} />}
    </>
  )
})

/** All traces of the stage. */
export function TraceEdges({ sets }: { sets: EdgeSets }) {
  return (
    <g className="tree-edges" aria-hidden="true">
      {sets.bus && <path className="te te-bus" d={sets.bus} />}
      <TraceEdge d={sets.unmet} kind="unmet" />
      <TraceEdge d={sets.need} kind="need" />
      <TraceEdge d={sets.met} kind="met" />
    </g>
  )
}
