/**
 * Mission Germoney test audit (2026-10-23), the UI half: the real bank as the UI
 * loads it, property tests of the tree rules on random DAGs (fixed seeds), the
 * layout on the real tree, and the Mission tab entries. The server half and the
 * numbers are in app/tests/test_mission_audit.py and
 * docs/research/2026-10-23-test-audit-mission.md.
 */
import { describe, expect, it } from 'vitest'
import { findCycles, loadBank, mergeBank } from '../germoney/data/bank'
import { allStatuses, layoutTree, nodeStatus, prereqClosure } from '../germoney/game/tree'
import { MISSION_TABS, SCREEN_OF } from '../germoney/ui'
import { TABS } from '../lib/store'

/** mulberry32: a tiny seeded PRNG, so a failure names the seed that reproduces it. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomTree(r: () => number, n: number) {
  const nodes = []
  for (let i = 0; i < n; i++) {
    const pre = new Set<string>()
    const k = Math.floor(r() * Math.min(4, i + 1))
    for (let j = 0; j < k; j++) pre.add(`n${Math.floor(r() * i)}`)
    nodes.push({ id: `n${i}`, name: `Node ${i}`, branch: ['hdl', 'math', 'ml', 'arch'][Math.floor(r() * 4)], tier: 1,
      prereqs: [...pre], contracts: [{ id: `n${i}.c1`, title: 't', context: 'c', steps: ['s'], hint: 'h', success_check: 'ok' }] })
  }
  return mergeBank({ 'skilltree.json': { nodes } })
}

describe('the real bank, as the UI loads it', () => {
  const real = loadBank()
  it('loads with no errors and no warnings: every reference resolves', () => {
    expect(real.order.length).toBeGreaterThan(50)
    expect(real.errors).toEqual([])
    expect(real.warnings).toEqual([])
    expect(findCycles(real.nodes)).toEqual([])
  })
  it('every node has contracts with context, a hint and a success check; contract ids are global', () => {
    const seen = new Set<string>()
    for (const id of real.order) {
      expect(real.nodes[id].contracts.length, id).toBeGreaterThan(0)
      for (const c of real.nodes[id].contracts) {
        expect(c.context.trim() && c.hint.trim() && c.success_check.trim(), `${id}/${c.id}`).toBeTruthy()
        expect(seen.has(c.id), c.id).toBe(false)
        seen.add(c.id)
      }
    }
  })
  it('links are https (one documented http-only publisher PDF)', () => {
    const http = new Set(['http://ccr.sigcomm.org/online/files/p83-keshavA.pdf'])
    for (const r of Object.values(real.resources)) {
      for (const u of [r.url, r.legal_pdf_url].filter(Boolean) as string[]) expect(u.startsWith('https://') || http.has(u), u).toBe(true)
    }
  })
  it('the layout places every real node once, on its own spot', () => {
    const L = layoutTree(real)
    expect(L.nodes).toHaveLength(real.order.length)
    expect(new Set(L.nodes.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)).size).toBe(L.nodes.length)
  })
})

describe('tree rules on random DAGs (seeded)', () => {
  for (let seed = 0; seed < 25; seed++) {
    it(`seed ${seed}: status follows the prerequisites; the closure is a learning order`, () => {
      const r = rng(seed)
      const bank = randomTree(r, 5 + Math.floor(r() * 25))
      expect(bank.errors).toEqual([])
      const rec: Record<string, { status?: string }> = {}
      for (const id of bank.order) {             // master or start whatever the rules allow
        const s = nodeStatus(bank, rec, id)
        if (s === 'available' && r() < 0.5) rec[id] = { status: r() < 0.6 ? 'mastered' : 'in_progress' }
      }
      const st = allStatuses(bank, rec)
      for (const id of bank.order) {
        const prereqsMastered = bank.nodes[id].prereqs.every((p) => st[p] === 'mastered')
        if (st[id] === 'available') expect(prereqsMastered).toBe(true)
        if (st[id] === 'locked') expect(prereqsMastered).toBe(false)
        if (st[id] === 'mastered' || st[id] === 'in_progress') expect(prereqsMastered).toBe(true)
        const order = prereqClosure(bank, id)
        expect(order[order.length - 1]).toBe(id)
        const pos = new Map(order.map((x, i) => [x, i]))
        for (const x of order) for (const p of bank.nodes[x].prereqs) expect(pos.get(p)!).toBeLessThan(pos.get(x)!)
      }
    })
  }
})

describe('the Mission tab entries', () => {
  it('every mission tab lands on one of the five screens; the docked ones are exactly those five', () => {
    const mission = TABS.filter((t) => t.group === 'mission')
    for (const t of mission) expect(SCREEN_OF[t.id], t.id).toBeTruthy()
    const docked = mission.filter((t) => t.dock).map((t) => t.id).sort()
    expect(docked).toEqual(MISSION_TABS.map((t) => t.id).sort())
    for (const t of MISSION_TABS) {
      expect(SCREEN_OF[t.id]).toBe(t.screen)
      expect(TABS.find((x) => x.id === t.id)!.title).toBe(t.label)
    }
  })
})
