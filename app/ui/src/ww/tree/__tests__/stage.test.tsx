// T01: the tree canvas. The drawn-DOM count of a 300-node tree at each level of detail (a measurement, not a promise), the keyboard
// model's geometry, labels that are never cut, and the six node shapes.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { drawPlan, labelLines, layoutTree, neighbour, visibleBox, bandOf, COL, ROW, X0 } from '../layout'
import { deriveTree } from '../ledger'
import { syntheticTree, TREES } from '../model'
import { glyphD, outlineD, coreD } from '../SkillNode'
import type { EvidenceRecord } from '../ports'
import { TreeStage, chainOf, type StageApi } from '../TreeStage'

const NOW = Date.UTC(2026, 10, 18)
const big = syntheticTree(20, 15)   // 300 nodes
let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null; vi.unstubAllGlobals() })

const drawn = (view: { x: number; y: number; k: number }, tree = big, records: EvidenceRecord[] = [], size = { w: 846, h: 464 }): { dom: number; nodes: number; band: string } => {
  const apiRef = createRef<StageApi | null>() as { current: StageApi | null }
  m = mount(<TreeStage tree={tree} derived={deriveTree(tree, records, NOW)} ledgerState="waiting" openId={null} onOpen={() => {}} occluded={false} apiRef={apiRef} initialView={view} initialSize={size} />)
  const svg = m.container.querySelector('svg.tg-svg')!
  const out = { dom: svg.querySelectorAll('*').length, nodes: svg.querySelectorAll('.tree-node').length, band: svg.getAttribute('data-band')! }
  m.unmount(); m = null
  return out
}
/** A view with layout point (px, py) at the middle of an 846 x 464 stage. */
const around = (px: number, py: number, k: number) => ({ x: 423 - px * k, y: 232 - py * k, k })

describe('300 nodes under 400 drawn DOM nodes', () => {
  const mid = layoutTree(big)
  const cx = (mid.bounds.x + mid.bounds.w) / 2
  const cy = mid.bounds.h / 2
  it('hub band (fit, below 0.55): the 20 branch hubs draw, and no node but the focused one', () => {
    const r = drawn(around(cx, cy, 0.25))
    expect(r.band).toBe('hub')
    expect(r.nodes).toBeLessThanOrEqual(2)   // only the focused and the open node, so the keyboard keeps its place
    console.info(`T01 count: 300 nodes, hub band, ${r.dom} drawn DOM nodes`)
    expect(r.dom).toBeLessThan(400)
  })
  it('node band (0.55 to 1.15): the nodes in view, one path each, no labels', () => {
    const r = drawn(around(cx, cy, 0.6))
    expect(r.band).toBe('node')
    expect(r.nodes).toBeGreaterThan(40)
    console.info(`T01 count: 300 nodes, node band k 0.6, ${r.nodes} nodes, ${r.dom} drawn DOM nodes`)
    expect(r.dom).toBeLessThan(400)
    const worst = drawn(around(cx, cy, 0.56))
    console.info(`T01 count: 300 nodes, node band k 0.56, ${worst.nodes} nodes, ${worst.dom} drawn DOM nodes`)
    expect(worst.dom).toBeLessThan(400)
  })
  it('full band (1.15 and up): labels and pips draw, only for the nodes in view', () => {
    for (const k of [1.15, 1.3, 2.4]) {
      const r = drawn(around(cx, cy, k))
      expect(r.band).toBe('full')
      console.info(`T01 count: 300 nodes, full band k ${k}, ${r.nodes} nodes, ${r.dom} drawn DOM nodes`)
      expect(r.dom, `k ${k}`).toBeLessThan(400)
    }
  })
  it('the worst case: every node evidenced with three pips (a core, pips and a label each) still draws under 400', () => {
    const records: EvidenceRecord[] = big.nodes.flatMap((n, i) => [1, 2, 3].map((j) => ({ id: `w${i}-${j}`, nodeId: n.id, kind: 'drill' as const, at: '2026-11-10', source: 's', detail: 'd', weight: 1, deletedAt: null })))
    for (const k of [1.15, 1.3]) {
      const r = drawn(around(cx, cy, k), big, records)
      console.info(`T01 count: 300 nodes all evidenced with 3 pips, full band k ${k}, ${r.nodes} nodes, ${r.dom} drawn DOM nodes`)
      expect(r.dom, `k ${k}`).toBeLessThan(400)
    }
  })
  it('the same 300 nodes on a larger stage: the count grows with the stage, so the number is stated per size (846 x 464 is the one the 400 bound holds for)', () => {
    for (const size of [{ w: 846, h: 464 }, { w: 1302, h: 664 }, { w: 1840, h: 960 }]) {
      const worst = Math.max(...[0.56, 0.6, 1.15, 1.3].map((k) => drawn({ x: size.w / 2 - cx * k, y: size.h / 2 - cy * k, k }, big, [], size).dom))
      console.info(`T01 count: 300 nodes, stage ${size.w} x ${size.h}, worst of four zooms ${worst} drawn DOM nodes`)
      expect(worst).toBeGreaterThan(0)
    }
  }, 60_000)
  it('the plan never draws a node outside the padded view, except the focused and the open one', () => {
    const view = around(cx, cy, 1.2)
    const plan = drawPlan(mid, view, { w: 846, h: 464 }, [mid.nodes[0].id])
    const box = visibleBox(view, { w: 846, h: 464 })
    for (const id of plan.nodes) {
      if (id === mid.nodes[0].id) continue
      const p = mid.byId.get(id)!
      expect(p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h).toBe(true)
    }
    expect(plan.nodes).toContain(mid.nodes[0].id)
  })
  it('a real tree at its default zoom draws far less', () => {
    const t = TREES()[0]
    const r = drawn({ x: 100, y: 200, k: 1.2 }, t)
    console.info(`T01 count: ${t.nodes.length} nodes (${t.name}), full band, ${r.dom} drawn DOM nodes`)
    expect(r.dom).toBeLessThan(400)
  })
})

describe('levels of detail', () => {
  it('bands change at 0.55 and 1.15', () => {
    expect([0.1, 0.549, 0.55, 1.149, 1.15, 2.4].map(bandOf)).toEqual(['hub', 'hub', 'node', 'node', 'full', 'full'])
  })
})

describe('the keyboard model: nearest in a direction', () => {
  const t = TREES()[0]
  const layout = layoutTree(t)
  const pts = [...layout.nodes.map((p) => ({ id: p.id, x: p.x, y: p.y })), ...layout.hubs.map((h) => ({ id: h.id, x: h.x + 84, y: h.y }))]
  const first = t.branches[0].nodes
  const at = (id: string) => pts.find((p) => p.id === id)!
  it('right goes along the row, left goes back to the hub, down goes to the next branch', () => {
    expect(neighbour(pts, at(first[0].id), first[0].id, 'right')).toBe(first[1].id)
    expect(neighbour(pts, at(first[0].id), first[0].id, 'left')).toBe(t.branches[0].id)
    expect(neighbour(pts, at(first[0].id), first[0].id, 'down')).toBe(t.branches[1].nodes[0].id)
    expect(neighbour(pts, at(first[0].id), first[0].id, 'up')).toBeNull()
  })
  it('the layout is a grid of rows and columns', () => {
    expect(layout.byId.get(first[2].id)).toMatchObject({ x: X0 + 2 * COL, y: 0 })
    expect(layout.byId.get(t.branches[3].nodes[0].id)!.y).toBe(3 * ROW)
  })
  it('chainOf lists the prerequisites from the seed', () => {
    expect(chainOf(t, first[2].id)).toEqual(first.map((n) => n.id))
  })
})

describe('labels are never cut', () => {
  it('wraps at spaces and never ends in an ellipsis; a long word is split, not lost', () => {
    for (const tr of TREES()) for (const n of tr.nodes) {
      const lines = labelLines(n.name)
      expect(lines.join(' ').replace(/\s+/g, ' ')).toBe(n.name.replace(/\s+/g, ' '))
      expect(lines.every((l) => l.length <= 20)).toBe(true)
      expect(lines.join('')).not.toContain('…')
      expect(lines.length).toBeLessThanOrEqual(3)
    }
    expect(labelLines('Supercalifragilisticexpialidocious').join('')).toBe('Supercalifragilisticexpialidocious')
  })
})

describe('six states, told apart by shape and glyph', () => {
  const states = ['locked', 'open', 'progress', 'claimed', 'evidenced', 'stale'] as const
  it('each state has its own drawing on every tier (compact form), so colour is never the only cue', () => {
    for (const tier of [1, 2, 3] as const) {
      const ds = states.map((s) => outlineD(tier) + glyphD(tier, s))
      expect(new Set(ds).size, `tier ${tier}`).toBe(6)
      expect(glyphD(tier, 'locked')).not.toBe(glyphD(tier, 'open'))
    }
  })
  it('the full form fills a core for progress, evidenced and stale only', () => {
    expect(states.filter((s) => coreD(2, s) !== '')).toEqual(['progress', 'evidenced', 'stale'])
  })
  it('tiers differ in outline; a capstone is notched', () => {
    expect(new Set([1, 2, 3].map((t) => outlineD(t as 1 | 2 | 3))).size).toBe(3)
    expect(outlineD(3).split('L').length).toBeGreaterThan(outlineD(2).split('L').length)
  })
})
