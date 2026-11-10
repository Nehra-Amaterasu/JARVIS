/**
 * The Tree workspace (plan 4.5, chunk 10): which tree is on the canvas, the stats line, the career overlay,
 * and the loading and empty answers. It wraps germoney/tree/* unchanged (the layout engine, the life-tree
 * adapter, LifePanel, the prefs) and replaces only the page around them.
 *
 * The frame draws the one h1 ("Tree"); this page has none. One canvas: the page fills the workspace and
 * nothing in it scrolls (the stage, the inspector tabs and the chips row share the height).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { loadBank } from '../../germoney/data/bank'
import { usePlan } from '../../germoney/game/plan'
import { allStatuses, type NodeStatus } from '../../germoney/game/tree'
import { fetchTrees, statusesOf, toBank, type LifeTree } from '../../germoney/tree/lifeTrees'
import { PREF_TREE, readPref, writePref } from '../../germoney/tree/prefs'
import { SKILLS } from '../../germoney/tree/TreeSwitcher'
import { useWorkspaceValue } from '../frame/workspaceMemory'
import { Banner, EmptyState, Segmented, Skeleton } from '../kit'
import { LifeInspector, SkillInspector } from './Inspector'
import { TreeCanvas } from './TreeCanvas'
import './tree.css'
import '../../germoney/pages/tree.css'

const WHOLE = 'whole'
const WHOLE_REASON = 'One canvas for all six trees is not built. Each tree opens on its own for now.'

/** The container width: a ResizeObserver on the workspace root; the window width before layout. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1000 : window.innerWidth - 400))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const first = el.getBoundingClientRect().width
    if (first > 0) setW(first)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((es) => {
      const n = es[0]?.contentRect.width
      if (typeof n === 'number' && n > 0) setW(Math.round(n))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export const DOCK_WIDTH = 1000

export function WwTreePage() {
  const root = useRef<HTMLDivElement>(null)
  const width = useWidth(root)
  const bank = useMemo(() => loadBank(), [])
  const state = usePlan((s) => s.state)
  const setCareer = usePlan((s) => s.setCareer)
  const [trees, setTrees] = useState<LifeTree[]>([])
  const [loaded, setLoaded] = useState(false)
  const [active, setActiveRaw] = useWorkspaceValue('tree', 'active', readPref(PREF_TREE) ?? SKILLS)
  useEffect(() => {
    let live = true
    void fetchTrees().then((t) => { if (live) { setTrees(t); setLoaded(true) } })
    return () => { live = false }
  }, [])
  const career = state?.career ?? null
  const skillStatus = useMemo(() => (state?.statuses as Record<string, NodeStatus> | undefined) ?? allStatuses(bank, state?.nodes ?? {}), [bank, state])
  // a remembered tree the server no longer sends falls back to Skills (only once the list has arrived)
  const tree = trees.find((t) => t.id === active) ?? null
  const shown = tree ? tree.id : loaded || active === SKILLS ? SKILLS : null
  const lifeBank = useMemo(() => (tree ? toBank(tree) : null), [tree])
  const lifeStatus = useMemo(() => (tree ? statusesOf(tree) : null), [tree])
  const pick = (id: string) => { setActiveRaw(id); writePref(PREF_TREE, id) }
  const docked = width >= DOCK_WIDTH

  const switcher = (
    <Segmented<string>
      label="Which tree"
      variant="compact"
      value={shown ?? SKILLS}
      onChange={pick}
      options={[
        { id: SKILLS, label: `Skills ${Object.values(skillStatus).filter((s) => s === 'mastered').length}/${bank.order.length}` },
        ...trees.map((t) => ({ id: t.id, label: `${t.name} ${t.progress.mastered}/${t.progress.total}` })),
        { id: WHOLE, label: 'Whole me', disabledReason: WHOLE_REASON },
      ]}
    />
  )

  const counts = Object.values(tree ? lifeStatus ?? {} : skillStatus).reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {} as Record<string, number>)
  const total = tree ? tree.nodes.length : bank.order.length
  const stats = `${total} nodes · ${counts.mastered ?? 0} mastered · ${counts.in_progress ?? 0}${tree ? '' : `/${state?.wip_cap ?? 3}`} in progress · ${counts.available ?? 0} open`

  const careerPick = !tree && bank.careers.length > 0 && (
    <div className="ww-tree-career">
      <Segmented<string>
        label="Career overlay"
        variant="compact"
        value={career ?? 'none'}
        onChange={(id) => void setCareer(id === 'none' ? null : id)}
        options={[{ id: 'none', label: 'No halo' }, ...bank.careers.map((c) => ({ id: c.id, label: c.name.split('/')[0].trim() }))]}
      />
    </div>
  )

  let body
  if (shown === null) body = <div className="ww-tree-fill"><Skeleton /></div>
  else if (tree && lifeBank && lifeStatus) {
    body = tree.nodes.length === 0
      ? <div className="ww-tree-fill"><EmptyState title="This tree has no nodes yet." /></div>
      : <TreeCanvas key={tree.id} treeId={tree.id} bank={lifeBank} status={lifeStatus} career={null} switcher={switcher} docked={docked} skills={false} stats={stats}
          panel={(p) => <LifeInspector tree={tree} id={p.id} onPick={p.pick} onFocus={p.focus} onClose={p.close} onTrees={setTrees} />} />
  } else if (!bank.order.length) {
    body = <div className="ww-tree-fill"><EmptyState title="The skill-tree bank has not landed yet." reason="data/bank/*.json has no nodes." /></div>
  } else {
    body = (
      <>
        {bank.errors.length > 0 && <Banner tone="fault">The bank has errors: {bank.errors.join('; ')}</Banner>}
        <TreeCanvas key={SKILLS} treeId={SKILLS} bank={bank} status={skillStatus} career={career} switcher={switcher} viewExtra={careerPick || undefined} docked={docked} skills stats={stats}
          panel={(p) => <SkillInspector id={p.id} statuses={skillStatus} onPick={p.pick} onFocus={p.focus} onClose={p.close} />} />
      </>
    )
  }
  return (
    <div className="ww-tree-page" ref={root} data-ws="tree">
      {body}
    </div>
  )
}
