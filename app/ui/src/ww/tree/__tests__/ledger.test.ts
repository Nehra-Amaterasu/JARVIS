// T01: the unlock rule and growth (spec 20.8.4) as pure functions of the ledger.
import { describe, expect, it } from 'vitest'
import { branchGrowth, deriveTree, earned, filledSteps, growth, ledgerLines, nextUp, summarise } from '../ledger'
import { TREES } from '../model'
import type { EvidenceKind, EvidenceRecord, LedgerReading } from '../ports'

const NOW = Date.UTC(2026, 10, 18)
const tree = TREES().find((t) => t.id === 'academic')!
const [seed, skill, cap] = tree.branches[0].nodes

let n = 0
const rec = (nodeId: string, kind: EvidenceKind, weight: number, at = '2026-11-10', deletedAt: string | null = null): EvidenceRecord => ({ id: `r${++n}`, nodeId, kind, at, source: 's', detail: 'd', weight, deletedAt })
const state = (records: EvidenceRecord[], id: string) => deriveTree(tree, records, NOW).get(id)!.state

describe('the unlock rule', () => {
  it('with no evidence a seed is OPEN and everything behind it LOCKED (the null adapter)', () => {
    const d = deriveTree(tree, [], NOW)
    expect(d.get(seed.id)!.state).toBe('open')
    expect(d.get(skill.id)!.state).toBe('locked')
    expect(d.get(cap.id)!.state).toBe('locked')
    expect(tree.nodes.filter((x) => x.tier === 1 && x.i === 0).every((x) => d.get(x.id)!.state === 'open')).toBe(true)
    expect([...d.values()].every((x) => x.state === 'open' || x.state === 'locked')).toBe(true)
  })
  it('a self-mark draws CLAIMED and never EVIDENCED, however many and however heavy', () => {
    expect(state([rec(seed.id, 'self', 0)], seed.id)).toBe('claimed')
    expect(state([rec(seed.id, 'self', 99), rec(seed.id, 'self', 99), rec(seed.id, 'self', 99)], seed.id)).toBe('claimed')
    expect(state([rec(skill.id, 'self', 99)], skill.id)).toBe('claimed')
  })
  it('a self-mark adds no weight and no pip, even beside a hard record (a skill needs weight 2)', () => {
    const d = deriveTree(tree, [rec(skill.id, 'drill', 1), rec(skill.id, 'self', 99)], NOW).get(skill.id)!
    expect(d.state).toBe('progress')
    expect(d.weight).toBe(1)
    expect(d.pips).toBe(1)
    expect(d.records.length).toBe(2)
  })
  it('a self-mark alone has no weight and no pip, however heavy it says it is', () => {
    const d = deriveTree(tree, [rec(skill.id, 'self', 99)], NOW).get(skill.id)!
    expect(d.weight).toBe(0)
    expect(d.pips).toBe(0)
    expect(d.state).toBe('claimed')
  })
  it('a claim does not unlock the next step', () => {
    expect(state([rec(seed.id, 'self', 0)], skill.id)).toBe('locked')
  })
  it('weight alone is not enough: at least one hard record (drill, session, certificate) is needed', () => {
    expect(state([rec(seed.id, 'artefact', 5)], seed.id)).toBe('progress')
    expect(state([rec(seed.id, 'witness', 5), rec(seed.id, 'timed', 5)], seed.id)).toBe('progress')
    expect(state([rec(seed.id, 'drill', 1)], seed.id)).toBe('evidenced')
    expect(state([rec(seed.id, 'session', 1)], seed.id)).toBe('evidenced')
    expect(state([rec(seed.id, 'certificate', 1)], seed.id)).toBe('evidenced')
  })
  it('a skill needs weight 2 and a capstone 3', () => {
    expect(state([rec(skill.id, 'drill', 1)], skill.id)).toBe('progress')
    expect(state([rec(skill.id, 'drill', 1), rec(skill.id, 'artefact', 1)], skill.id)).toBe('evidenced')
    expect(state([rec(cap.id, 'drill', 2)], cap.id)).toBe('progress')
    expect(state([rec(cap.id, 'drill', 2), rec(cap.id, 'witness', 1)], cap.id)).toBe('evidenced')
  })
  it('a prerequisite with evidence unlocks the next step as OPEN, never EVIDENCED', () => {
    expect(state([rec(seed.id, 'drill', 1)], skill.id)).toBe('open')
  })
  it('a deleted record stops counting and everything is recomputed', () => {
    expect(state([rec(seed.id, 'drill', 1, '2026-11-10', '2026-11-11')], seed.id)).toBe('open')
    expect(state([rec(seed.id, 'drill', 1, '2026-11-10', '2026-11-11')], skill.id)).toBe('locked')
  })
  it('the newest hard record older than the refresh window makes a node STALE, and stale still counts as earned', () => {
    const old = '2026-04-01'
    expect(state([rec(seed.id, 'drill', 1, old)], seed.id)).toBe('stale')
    expect(earned('stale')).toBe(true)
    expect(state([rec(seed.id, 'drill', 1, old), rec(seed.id, 'drill', 0, '2026-11-01')], seed.id)).toBe('evidenced')
    expect(state([rec(seed.id, 'drill', 1, old)], skill.id)).toBe('open')
  })
  it('is pure: the same records give the same answer, in any order', () => {
    const rs = [rec(seed.id, 'drill', 1), rec(skill.id, 'drill', 2), rec(cap.id, 'self', 0)]
    const a = JSON.stringify([...deriveTree(tree, rs, NOW)])
    const b = JSON.stringify([...deriveTree(tree, [...rs].reverse(), NOW)])
    expect(b).toBe(a)
  })
})

describe('growth is a pure function of the ledger and falls when a record is deleted', () => {
  const all = [rec(seed.id, 'drill', 1), rec(skill.id, 'drill', 2), rec(cap.id, 'drill', 3)]
  const g = (rs: EvidenceRecord[]) => growth(tree, deriveTree(tree, rs, NOW))
  it('counts earned nodes out of nodes written', () => {
    expect(g([]).evidenced).toBe(0)
    expect(g(all)).toEqual({ evidenced: 3, total: tree.nodes.length })
  })
  it('falls by one when a record is deleted, and the spine loses a rung', () => {
    const gone = all.map((r, i) => (i === 1 ? { ...r, deletedAt: '2026-11-17' } : r))
    expect(g(gone).evidenced).toBe(g(all).evidenced - 1)
    expect(filledSteps(g(gone), 40)).toBeLessThan(filledSteps(g(all), 40))
  })
  it('a self-mark adds nothing', () => {
    expect(g([...all, rec(tree.branches[1].nodes[0].id, 'self', 99)]).evidenced).toBe(3)
  })
  it('filledSteps is stepped, bounded and exact at the ends', () => {
    expect(filledSteps({ evidenced: 0, total: 42 }, 40)).toBe(0)
    expect(filledSteps({ evidenced: 42, total: 42 }, 40)).toBe(40)
    expect(filledSteps({ evidenced: 21, total: 42 }, 40)).toBe(20)
    expect(filledSteps({ evidenced: 1, total: 0 }, 40)).toBe(0)
  })
  it('branchGrowth marks a branch done only when every node is earned', () => {
    const d = deriveTree(tree, all, NOW)
    const bg = branchGrowth(tree, d)
    expect(bg[0]).toMatchObject({ earned: 3, total: 3, done: true })
    expect(bg[1].done).toBe(false)
  })
})

describe('the Grove summary and the next node', () => {
  const live = (records: EvidenceRecord[], st: LedgerReading['state'] = 'live'): LedgerReading => ({ state: st, reason: 'x', records })
  it('carries no number while the ledger is WAITING, PLANNED or FAULT', () => {
    for (const st of ['waiting', 'planned', 'fault'] as const) expect(summarise(TREES(), live([rec(seed.id, 'drill', 1)], st), NOW).every((s) => s.evidenced === null && s.last === null)).toBe(true)
  })
  it('carries the count and the last record date when LIVE or SIMULATED', () => {
    for (const st of ['live', 'simulated'] as const) {
      const s = summarise(TREES(), live([rec(seed.id, 'drill', 1, '2026-11-12')], st), NOW).find((x) => x.id === 'academic')!
      expect(s.evidenced).toBe(1)
      expect(s.last).toBe('2026-11-12')
    }
  })
  it('the next node is the open one that has waited longest: the first seed with nothing recorded', () => {
    const r = nextUp(TREES(), live([]), NOW)!
    expect(r.tree.id).toBe('academic')
    expect(r.node.id).toBe(tree.branches[0].nodes[0].id)
  })
  it('prints the last three records newest first in terminal form', () => {
    const rs = [rec(seed.id, 'drill', 1, '2026-11-01'), rec(skill.id, 'drill', 2, '2026-11-12'), rec(cap.id, 'self', 0, '2026-11-14'), rec(seed.id, 'timed', 1, '2026-10-01')]
    const lines = ledgerLines(rs, (id) => (id === skill.id ? 'Derivatives and rates' : id), 3)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('2026-11-12 drill d -> Derivatives and rates')
    expect(lines[0].startsWith('2026-11-14 self-mark')).toBe(true)
  })
})
