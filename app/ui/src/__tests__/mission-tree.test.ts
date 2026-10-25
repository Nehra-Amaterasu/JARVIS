/**
 * Mission v2: the bank loader + validator (data/bank.ts), the skill tree as a DAG
 * and its layout (game/tree.ts). The fixtures are shared with the server's tests
 * (app/tests/test_mission_plan.py), so both loaders agree on the same files.
 */
import { describe, expect, it } from 'vitest'
import { BANK_FILES, careerWeight, findCycles, loadBank, mergeBank } from '../germoney/data/bank'
import { allStatuses, dependents, layoutTree, neighbour, nodeStatus, prereqClosure } from '../germoney/game/tree'

const RAW = import.meta.glob('./fixtures/mission-bank/*.json', { eager: true, import: 'default' }) as Record<string, unknown>
const files = (names: readonly string[] = BANK_FILES) =>
  Object.fromEntries(Object.entries(RAW).map(([p, v]) => [p.split('/').pop()!, v]).filter(([n]) => names.includes(n as string)))

describe('the bank loader', () => {
  const bank = mergeBank(files())
  it('merges every file and warns about unknown ids instead of failing', () => {
    expect(bank.order).toHaveLength(10)
    expect(bank.nodes['m-calc'].branch).toBe('math')
    const w = bank.warnings.join(' | ')
    expect(w).toContain('unknown prerequisite ghost-prereq')
    expect(w).toContain('unknown resource r-missing')
    expect(w).toContain('career vlsi: unknown node ghost-node')
    expect(w).toContain('certificate cert-nptel-verilog: unknown node nope-node')
    expect(bank.nodes.uart.prereqs).toEqual(['fsm', 'hdlbits'])
    expect(bank.errors).toEqual([])
  })
  it('reads the real-bank shapes: covers as a string, numeric credibility, resource ids used as certs, global contract ids', () => {
    expect(bank.resources['r-khan-calc'].covers).toEqual(['derivatives, chain rule'])
    expect(bank.certs['cert-nptel-verilog'].credibility).toBe(4)
    expect(bank.certs['r-khan-calc']).toMatchObject({ from_resource: true, node_ids: ['m-calc'] })
    expect(bank.contractIndex['m-calc.c02']).toBe('m-calc')
    expect(bank.nodes['hdl-verilog'].certs).toEqual(['cert-nptel-verilog'])
  })
  it('works with any subset of files', () => {
    const only = mergeBank(files(['skilltree.json']))
    expect(only.order).toHaveLength(8)
    expect(only.resources).toEqual({})
    expect(mergeBank({}).order).toEqual([])
  })
  it('a prerequisite cycle is an error; a wrong file shape is an error, not a crash', () => {
    const cyc = mergeBank({ 'skilltree.json': { nodes: [
      { id: 'a', name: 'A', branch: 'x', prereqs: ['b'] }, { id: 'b', name: 'B', branch: 'x', prereqs: ['a'] }] } })
    expect(cyc.errors[0]).toMatch(/cycle: a -> b -> a|cycle: b -> a -> b/)
    expect(mergeBank({ 'certs.json': { not: 'a list' } }).errors[0]).toContain('certs.json')
    expect(findCycles({})).toEqual([])
  })
  it('career weights: the chosen career, or the best of any when none is chosen', () => {
    expect(careerWeight(bank, 'aihw', 'ml-intro')).toBe(1)
    expect(careerWeight(bank, 'vlsi', 'ml-intro')).toBe(0.2)
    expect(careerWeight(bank, null, 'ml-intro')).toBe(1)
  })
  it('maths weights: kept when they name a node, warned and dropped otherwise', () => {
    const b = mergeBank({ 'skilltree.json': { nodes: [
      { id: 'a', name: 'A', branch: 'x', maths: { m: 0.5, ghost: 0.4, bad: 'high', zero: 0 } }, { id: 'm', name: 'M', branch: 'math' }] } })
    expect(b.nodes.a.maths).toEqual({ m: 0.5 })
    expect(b.warnings.join(' | ')).toContain('unknown maths node ghost')
    expect(b.warnings.join(' | ')).toContain('maths weight for bad is not a number')
  })
  it('the real bank v2: a DAG, monotonic tiers, no orphans, maths weights and cert links resolve', () => {
    const real = loadBank()
    if (!real.order.length) return
    expect(findCycles(real.nodes)).toEqual([])
    const needed = new Set(real.order.flatMap((id) => real.nodes[id].prereqs))
    for (const id of real.order) {
      const n = real.nodes[id]
      for (const p of n.prereqs) expect(n.tier, `${id} vs ${p}`).toBeGreaterThan(real.nodes[p].tier)
      expect(n.prereqs.length > 0 || needed.has(id), `${id} is isolated`).toBe(true)
      for (const k of Object.keys(n.maths)) expect(real.nodes[k]?.branch, `${id}: ${k}`).toBe('math')
      if (n.branch !== 'math') for (const p of n.prereqs) if (real.nodes[p].branch === 'math') expect(n.maths[p], `${id} needs ${p}`).toBeGreaterThan(0)
      for (const c of n.certs) expect(real.certs[c], `${id}: cert ${c}`).toBeTruthy()
    }
    for (const c of Object.values(real.certs)) for (const id of c.node_ids) expect(real.nodes[id], `${c.id}: ${id}`).toBeTruthy()
    expect(real.careers.map((c) => c.id)).toContain('dv_ai_accel')
  })
  it('the real bank (data/bank, committed 2026-10-23) loads with no errors', () => {
    const real = loadBank()
    if (!real.order.length) return            // the bank is optional at build time
    expect(real.errors).toEqual([])
    expect(real.careers.length).toBeGreaterThanOrEqual(2)
    for (const id of real.order) for (const p of real.nodes[id].prereqs) expect(real.nodes[p]).toBeTruthy()
  })
})

describe('the tree as a DAG', () => {
  const bank = mergeBank(files())
  it('locked → available → in progress → mastered', () => {
    const nodes: Record<string, { status?: string }> = {}
    expect(nodeStatus(bank, nodes, 'hdl-verilog')).toBe('locked')
    expect(nodeStatus(bank, nodes, 'dl-basics')).toBe('available')
    nodes['dl-basics'] = { status: 'in_progress' }
    expect(nodeStatus(bank, nodes, 'dl-basics')).toBe('in_progress')
    expect(nodeStatus(bank, nodes, 'hdl-verilog')).toBe('locked')
    nodes['dl-basics'] = { status: 'mastered' }
    expect(allStatuses(bank, nodes)['hdl-verilog']).toBe('available')
  })
  it('knows what a node needs and what it unlocks', () => {
    expect(prereqClosure(bank, 'fsm')).toEqual(['dl-basics', 'hdl-verilog', 'fsm'])
    expect(dependents(bank, 'hdl-verilog').sort()).toEqual(['fsm', 'hdlbits', 'systolic'])
  })
})

describe('the tree layout', () => {
  const bank = mergeBank(files())
  const L = layoutTree(bank)
  it('places every node once, deterministically, with an edge per prerequisite and a root edge per root', () => {
    expect(L.nodes).toHaveLength(bank.order.length)
    expect(layoutTree(bank)).toEqual(L)
    const prereqEdges = bank.order.reduce((a, id) => a + bank.nodes[id].prereqs.length, 0)
    const roots = bank.order.filter((id) => !bank.nodes[id].prereqs.length).length
    expect(L.edges).toHaveLength(prereqEdges + roots)
    expect(new Set(L.nodes.map((p) => `${p.x},${p.y}`)).size).toBe(L.nodes.length)   // no two nodes on one spot
  })
  it('branches fan out above the trunk; higher tiers sit further out', () => {
    expect(L.nodes.every((p) => p.y < 0)).toBe(true)
    const r = (id: string) => Math.hypot(L.byId[id].x, L.byId[id].y)
    expect(r('hdl-verilog')).toBeGreaterThan(r('dl-basics'))
    expect(r('uart')).toBeGreaterThan(r('fsm'))
  })
  it('arrow keys find a neighbour in that direction', () => {
    const up = neighbour(L, 'dl-basics', 'up')
    expect(up).not.toBeNull()
    expect(L.byId[up!].y).toBeLessThan(L.byId['dl-basics'].y)
    expect(neighbour(L, 'nope', 'up')).toBe(L.nodes[0].id)
  })
})
