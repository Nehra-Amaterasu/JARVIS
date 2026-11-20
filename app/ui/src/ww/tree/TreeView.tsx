// The Tree under the new shell (T01, spec 20.8): three scales on one canvas, no scroll at 1366 x 768.
//   1  the Grove          ten seeds in a ring round one readout; a "Next up" plate and the last three records on the right
//   2  one tree           the stage (levels of detail, keyboard model), the growth spine, the ledger line
//   3  the node drawer    a 400 px sheet from the right; the stage beside it narrows instead of sliding under it
// Evidence comes only through the port (ports.ts); with the null adapter every node is OPEN or LOCKED, the seeds are dashed and the
// ledger says WAITING with its reason. Nothing is guessed, and a self-mark can never draw EVIDENCED (ledger.ts).
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, Crosshair, Maximize2, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconButton } from '../../shared/kit'
import { showsNumber } from '../../shared/lamp'
import { LampWord } from '../left/LampWord'
import { isReducedMotion } from '../useReducedMotion'
import { BranchSpine } from './BranchSpine'
import { EvidenceLedger } from './EvidenceLedger'
import { GroveRing } from './GroveRing'
import { NodeDrawer } from './NodeDrawer'
import { TreeStage, type StageApi } from './TreeStage'
import { BranchMenu, TreePicker } from './ShellBars'
import { branchGrowth, deriveTree, growth, ledgerLines, nextUp, summarise, STATE_WORD, type Derived } from './ledger'
import { TREES, findNode, type TreeDef } from './model'
import { TREE_PORT, useLedger, type TreePort } from './ports'
import './tree.css'
import './grove.css'

export interface TreeViewProps {
  port?: TreePort
  /** Epoch ms of "today" for the refresher rule; the gallery fixes it. */
  now?: number
  trees?: TreeDef[]
  form?: 'desk' | 'phone'
  initial?: { tree?: string; node?: string }
}

const PHONE_BELOW = 900
let grovePlayed = false
/** Test hook: the Grove draws in once per session, so a test that wants the first entry again resets it. */
export const resetGroveSession = () => { grovePlayed = false }

function usePhone(forced?: 'desk' | 'phone'): boolean {
  const q = `(max-width: ${PHONE_BELOW - 1}px)`
  const [m, setM] = useState(() => forced ? forced === 'phone' : typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    if (forced || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [forced, q])
  return forced ? forced === 'phone' : m
}

export function TreeView({ port = TREE_PORT, now: fixedNow, trees: given, form: forced, initial }: TreeViewProps) {
  const trees = useMemo(() => given ?? TREES(), [given])
  const now = useMemo(() => fixedNow ?? Date.now(), [fixedNow])
  const ledger = useLedger(port)
  const { reading } = ledger
  const phone = usePhone(forced)
  const [treeId, setTreeId] = useState<string | null>(initial?.tree ?? null)
  const [openId, setOpenId] = useState<string | null>(initial?.node ?? null)
  const [zoomEl, setZoomEl] = useState<HTMLSpanElement | null>(null)
  const api = useRef<StageApi | null>(null)
  const [draw] = useState(() => { const first = !grovePlayed; grovePlayed = true; return first && !isReducedMotion() })

  const derivedAll = useMemo(() => new Map<string, ReadonlyMap<string, Derived>>(trees.map((t) => [t.id, deriveTree(t, reading.records, now)])), [trees, reading.records, now])
  const summaries = useMemo(() => summarise(trees, reading, now), [trees, reading, now])
  const next = useMemo(() => nextUp(trees, reading, now), [trees, reading, now])
  const counted = showsNumber(reading.state)
  const tree = treeId ? trees.find((t) => t.id === treeId) ?? null : null
  const derived = tree ? derivedAll.get(tree.id)! : null
  const node = tree && openId ? tree.byId.get(openId) ?? null : null
  const nameOf = useCallback((id: string) => findNode(id, trees)?.name ?? null, [trees])
  const lines = useMemo(() => ledgerLines(reading.records, nameOf), [reading.records, nameOf])

  const openTree = (id: string, nodeId: string | null = null) => { setTreeId(id); setOpenId(nodeId) }
  /** Back to the Grove; focus returns to the seed of the tree that was open. */
  const grove = () => {
    const id = treeId
    setTreeId(null)
    setOpenId(null)
    if (id) window.setTimeout(() => document.querySelector<HTMLElement>(`.gr-seed[data-tree="${id}"]`)?.focus({ preventScroll: true }), 0)
  }
  const openNext = () => { if (next) openTree(next.tree.id, next.node.id) }
  const closeNode = useCallback(() => {
    const id = openId
    setOpenId(null)
    if (id) window.setTimeout(() => api.current?.goTo(id), 0)
  }, [openId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || (e.target as HTMLElement).closest('input, textarea, select, [role="dialog"]') || document.querySelector('.ww-tree-panel')) return   // an open list takes its own Esc
    if (openId) { e.preventDefault(); closeNode() } else if (tree) { e.preventDefault(); grove() }
  }

  const treeOptions = [
    { id: 'grove', label: 'All ten (the Grove)' },
    ...trees.map((t, i) => {
      const s = summaries[i]
      return { id: t.id, label: t.name, count: counted && s.evidenced !== null ? `${s.evidenced}/${s.nodes}` : `${s.nodes}` }
    }),
  ]
  const groups = tree && derived ? branchGrowth(tree, derived) : []
  const g = tree && derived ? growth(tree, derived) : { evidenced: 0, total: 0 }
  const startId = tree ? (next && next.tree.id === tree.id ? next.node.id : tree.nodes[0]?.id ?? null) : null

  return (
    <div className="tg" data-form={phone ? 'phone' : 'desk'} data-scale={tree ? (node ? 3 : 2) : 1} data-drawer={node ? 'open' : undefined} data-lamp={reading.state} onKeyDown={onKeyDown}>
      <header className="tg-bar ww-tree-bar" role="toolbar" aria-label="Tree view">
        {tree && <Button size="sm" grouped onClick={grove}><ChevronLeft size={16} aria-hidden="true" />Grove</Button>}
        <TreePicker value={tree?.id ?? 'grove'} options={treeOptions} onChange={(id) => (id === 'grove' ? grove() : openTree(id))} />
        {tree && <BranchMenu options={groups.map((b) => ({ id: b.id, label: b.name, count: counted ? `${b.earned}/${b.total}` : `${b.total}` }))}
          stats={counted ? `${g.evidenced} of ${g.total} nodes evidenced.` : `${g.total} nodes written. Evidence is not counted yet.`}
          onPick={(id) => api.current?.toBranch(tree.branches.findIndex((b) => b.id === id))} />}
        <Button size="sm" grouped onClick={openNext} disabledReason={next ? undefined : 'Nothing is open.'} title="Jump to the open node that has waited longest"><Crosshair size={16} aria-hidden="true" />Next</Button>
        <h2 className="tg-title"><span className="tg-ascii" aria-hidden="true">+--[ </span>{tree ? tree.name : 'GROVE'}<span className="tg-ascii" aria-hidden="true"> ]--</span></h2>
        <span className="tg-bar-lamp"><LampWord state={reading.state} /><span className="tg-bar-why">{reading.reason}</span></span>
      </header>

      {!tree ? (
        <div className="tg-grove">
          <div className="ww-tree-stage tg-grove-stage">
            <GroveRing trees={summaries} onOpen={(id) => openTree(id, null)} state={reading.state} reason={reading.reason} draw={draw} />
          </div>
          <aside className="tg-side" aria-label="Next up and the ledger">
            <section className="tg-next" data-callout="next" aria-label="Next up">
              <header className="tg-next-head"><span className="tg-ascii" aria-hidden="true">+--[</span><h3>NEXT UP</h3><span className="tg-ascii" aria-hidden="true">]--</span></header>
              {next ? (
                <>
                  <p className="tg-next-name">{next.node.name}</p>
                  <p className="tg-next-where">{next.tree.name} / {next.node.branch}</p>
                  <p className="tg-next-state"><b>{STATE_WORD.open}</b> It has been open the longest. Nothing is due and nothing counts down.</p>
                  <Button size="lg" tone="primary" onClick={openNext}>Open {next.tree.name}</Button>
                </>
              ) : <p className="tg-next-where">Nothing is open right now.</p>}
            </section>
            <EvidenceLedger state={reading.state} reason={reading.reason} lines={lines} />
          </aside>
        </div>
      ) : tree.nodes.length === 0 ? (
        <div className="tg-planned"><p>Not built yet. Branches listed, nodes not written.</p></div>
      ) : (
        <>
          <div className="tg-body">
            <BranchSpine growth={g} state={reading.state} reason={reading.reason} name={tree.name} />
            <div className="tg-stagewrap">
              <TreeStage key={tree.id} tree={tree} derived={derived!} ledgerState={reading.state} openId={openId} onOpen={setOpenId} occluded={false} apiRef={api} startId={startId} zoomEl={zoomEl} />
              <div className="tg-controls" role="group" aria-label="View">
                <IconButton label="Zoom in (plus)" size="sm" grouped onClick={() => api.current?.zoomIn()}><Plus size={16} aria-hidden="true" /></IconButton>
                <span className="tg-zoom" ref={setZoomEl} aria-live="off">100%</span>
                <IconButton label="Zoom out (minus)" size="sm" grouped onClick={() => api.current?.zoomOut()}><Minus size={16} aria-hidden="true" /></IconButton>
                <IconButton label="Fit the whole tree (0)" size="sm" grouped onClick={() => api.current?.fit()}><Maximize2 size={16} aria-hidden="true" /></IconButton>
                <IconButton label="Pan up (Shift and up arrow)" size="sm" grouped onClick={() => api.current?.pan(0, -80)}><ArrowUp size={16} aria-hidden="true" /></IconButton>
                <IconButton label="Pan down (Shift and down arrow)" size="sm" grouped onClick={() => api.current?.pan(0, 80)}><ArrowDown size={16} aria-hidden="true" /></IconButton>
                <IconButton label="Pan left (Shift and left arrow)" size="sm" grouped onClick={() => api.current?.pan(-80, 0)}><ArrowLeft size={16} aria-hidden="true" /></IconButton>
                <IconButton label="Pan right (Shift and right arrow)" size="sm" grouped onClick={() => api.current?.pan(80, 0)}><ArrowRight size={16} aria-hidden="true" /></IconButton>
              </div>
            </div>
          </div>
          <EvidenceLedger className="tg-foot" state={reading.state} reason={reading.reason} lines={lines} />
        </>
      )}

      {tree && node && derived && (
        <div className="tg-drawer">
          <NodeDrawer tree={tree} node={node} derived={derived} reading={reading} writable={port.writable} onAdd={ledger.add} onRemove={ledger.remove} onClose={closeNode} onJump={(id) => { setOpenId(id); api.current?.goTo(id) }} />
        </div>
      )}
    </div>
  )
}

export default TreeView
