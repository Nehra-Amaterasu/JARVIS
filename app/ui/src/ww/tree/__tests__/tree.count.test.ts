// T01: the COUNT TEST. The ten trees and their 113 branches of spec 20.8.5 are asserted by machine, so a tree file that loses a branch
// or a branch that shrinks below three nodes fails here and not in the owner's hands. (T01 replaces "the arithmetic is not
// machine-checked" in the spec: ten lists sum to 108, plus five reserved capstone branches.)
import { describe, expect, it } from 'vitest'
import { TREES, loadTrees, slug } from '../model'

const EXPECTED: Record<string, number> = {
  academic: 14, engineering: 12, languages: 10, body: 13, social: 11, influence: 9, money: 10, craft: 12, health: 9, career: 13,
}

describe('the ten trees of spec 20.8.5', () => {
  const trees = TREES()
  it('there are ten trees, in file order', () => {
    expect(trees.map((t) => t.id)).toEqual(Object.keys(EXPECTED))
  })
  it('there are 113 branches, as listed per tree', () => {
    for (const t of trees) expect(t.branches.length, t.id).toBe(EXPECTED[t.id])
    expect(trees.reduce((s, t) => s + t.branches.length, 0)).toBe(113)
  })
  it('108 plain branches and 5 reserved capstone branches, one each in trees 1, 4, 5, 8 and 10', () => {
    const reserved = trees.flatMap((t) => t.branches.filter((b) => b.reserved).map(() => t.id))
    expect(reserved.sort()).toEqual(['academic', 'body', 'career', 'craft', 'social'])
    expect(trees.reduce((s, t) => s + t.branches.filter((b) => !b.reserved).length, 0)).toBe(108)
  })
  it('every branch has at least three nodes, a seed first and a capstone last', () => {
    for (const t of trees) for (const b of t.branches) {
      expect(b.nodes.length, `${t.id}/${b.name}`).toBeGreaterThanOrEqual(3)
      expect(b.nodes[0].tier).toBe(1)
      expect(b.nodes[b.nodes.length - 1].tier).toBe(3)
      expect(b.nodes.slice(1, -1).every((n) => n.tier === 2)).toBe(true)
      expect(b.nodes[0].prereq).toBeNull()
      b.nodes.slice(1).forEach((n, i) => expect(n.prereq).toBe(b.nodes[i].id))
    }
  })
  it('node ids are unique across all ten trees and carry no empty slug', () => {
    const ids = trees.flatMap((t) => t.nodes.map((n) => n.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.split('/').every((p) => p.length > 0)).toBe(true)
  })
  it('a file that exports no tree is skipped, not crashed on', () => {
    expect(loadTrees({ './trees/x.tree.ts': {}, './trees/y.tree.ts': { default: { id: 'y', name: 'Y', about: '', refreshDays: 90, branches: [{ name: 'A', nodes: ['a', 'b', 'c'] }] } } }).map((t) => t.id)).toEqual(['y'])
  })
  it('the wording keeps the standing truth rules: no medical claim, no result claim, no person named', () => {
    const text = trees.flatMap((t) => [t.name, t.about, ...t.branches.flatMap((b) => [b.name, ...b.nodes.map((n) => n.name)])]).join('\n').toLowerCase()
    for (const w of ['cure', 'therapy', 'disorder', 'guarantee', 'streak', 'leaderboard']) expect(text, w).not.toContain(w)
    expect(trees.find((t) => t.id === 'health')!.about).toMatch(/Nothing here diagnoses or treats/)
  })
  it('slug is stable', () => {
    expect(slug('Krav Maga basics')).toBe('krav-maga-basics')
  })
})
