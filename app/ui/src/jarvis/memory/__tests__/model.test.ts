// The Memory section's pure logic (A.J04): the constellation is a function of the store, the node count equals the count the
// store reported, the strata and the trail are bounded, a fix keeps seven days of history, and a delete names its count.
import { describe, expect, it } from 'vitest'
import {
  FIX_DAYS, GOLDEN_DEG, MAX_NODES, TRAIL_ITEMS, TRAIL_MAX, addFix, alphabetical, deleteLine, ditherCells, fixesFor, groupOf, holdingsOf, layoutConstellation,
  litFromFacts, nearestInDirection, nodeCountEqualsStore, originOf, pathThrough, pruneFixes, pushRecall, relDue, removeFix, strataOf, trailLayout, twoLineDiff,
  highlightParts, queryTerms, type FixRow, type Placed,
} from '..'
import { fixtureGalaxy, fixtureNodes, fixtureStats, NOW_MS } from '../fixtures'
import type { Person } from '../types'

const day = 86_400_000

describe('the constellation layout', () => {
  const g = fixtureGalaxy(40)
  it('is a pure function of the store: the same payload gives the same picture, byte for byte', () => {
    const a = layoutConstellation(g.nodes, g.edges)
    const b = layoutConstellation(structuredClone(g.nodes), structuredClone(g.edges))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('draws every node when there are at most 120, and the drawn count equals the laid-out count', () => {
    const l = layoutConstellation(g.nodes, g.edges)
    expect(l.mode).toBe('nodes')
    expect(l.drawn).toBe(g.nodes.length)
    expect(l.placed).toHaveLength(55)
    expect(nodeCountEqualsStore(l)).toBe(true)
  })
  it('above 120 the stage shows one cluster per source with its count, and the counts add up to the nodes laid out', () => {
    const big = fixtureGalaxy(340)
    const l = layoutConstellation(big.nodes, big.edges)
    expect(l.mode).toBe('clusters')
    expect(l.placed).toHaveLength(0)
    expect(l.clusters.reduce((a, c) => a + c.count, 0)).toBe(big.nodes.length)
    expect(nodeCountEqualsStore(l)).toBe(true)
  })
  it('a zoom into one group draws that group only, at most 120 of it, and says how many older ones it did not draw', () => {
    const big = fixtureGalaxy(900)
    const grp = layoutConstellation(big.nodes, big.edges).groups[0]
    const z = layoutConstellation(big.nodes, big.edges, { zoom: grp.group })
    expect(z.mode).toBe('group')
    expect(z.placed.every((p) => p.group === grp.group)).toBe(true)
    expect(z.drawn).toBeLessThanOrEqual(MAX_NODES)
    expect(z.drawn + z.hidden).toBe(grp.count)
    expect(nodeCountEqualsStore(z)).toBe(true)
  })
  it('the topic of index i points at i x 137.5 degrees, so wedges never crowd', () => {
    const l = layoutConstellation(g.nodes, g.edges)
    l.groups.forEach((grp, i) => expect(grp.angle).toBeCloseTo((i * GOLDEN_DEG) % 360, 6))
    expect(new Set(l.groups.map((x) => Math.round(x.angle))).size).toBe(l.groups.length)
  })
  it('the newest node is the one nearest the middle (radius is age rank)', () => {
    const l = layoutConstellation(g.nodes, g.edges)
    const r = (p: Placed) => Math.hypot(p.x - 430, p.y - 235)
    const newest = l.placed.find((p) => p.rank === 0)!
    const oldest = l.placed.find((p) => p.rank === l.placed.length - 1)!
    expect(r(newest)).toBeLessThan(r(oldest))
  })
  it('keeps only links whose two ends are drawn, never twice, never to itself', () => {
    const l = layoutConstellation(g.nodes, g.edges)
    const ids = new Set(l.placed.map((p) => p.id))
    expect(l.links.every(([a, b]) => ids.has(a) && ids.has(b) && a !== b)).toBe(true)
    expect(new Set(l.links.map((x) => x.join('|'))).size).toBe(l.links.length)
  })
  it('an empty store is an empty layout, not an error', () => {
    const l = layoutConstellation([], [])
    expect(l.placed).toHaveLength(0)
    expect(l.clusters).toHaveLength(0)
    expect(nodeCountEqualsStore(l)).toBe(true)
  })
  it('groups a memory by its source and the other kinds by their kind', () => {
    expect(groupOf({ kind: 'memory', source: 'note' })).toBe('note')
    expect(groupOf({ kind: 'person', source: 'people' })).toBe('people')
    expect(groupOf({ kind: 'belief', source: 'claude' })).toBe('beliefs')
    expect(groupOf({ kind: 'topic', source: 'taste' })).toBe('taste')
  })
  it('arrow keys step to the nearest node in that direction and stop at the edge', () => {
    const pts = [{ id: 'a', x: 0, y: 0, rank: 0 }, { id: 'b', x: 50, y: 5, rank: 1 }, { id: 'c', x: 200, y: 0, rank: 2 }, { id: 'd', x: 10, y: 80, rank: 3 }]
    expect(nearestInDirection(pts, 'a', 'right')).toBe('b')
    expect(nearestInDirection(pts, 'a', 'down')).toBe('d')
    expect(nearestInDirection(pts, 'a', 'left')).toBeNull()
    expect(nearestInDirection(pts, null, 'right')).toBe('a')
  })
})

describe('recall lights nodes and draws one path', () => {
  const l = layoutConstellation(fixtureGalaxy(40).nodes, [])
  it('lights the nodes whose text starts a returned fact, in rank order, once each', () => {
    const [a, b] = l.placed.filter((p) => p.kind === 'memory')
    const ids = litFromFacts(l.placed, [{ text: b.label, source: 'n', distance: 0.1 }, { text: a.label, source: 'n', distance: 0.2 }])
    expect(ids).toEqual([b.id, a.id])
    const again = litFromFacts(l.placed, [{ text: b.label, source: 'n', distance: 0.1 }, { text: b.label, source: 'n', distance: 0.2 }])
    expect(new Set(again).size).toBe(again.length)
    expect(pathThrough(l.placed, ids).startsWith('M')).toBe(true)
  })
  it('a fact that is no node lights nothing, and one node is no path', () => {
    expect(litFromFacts(l.placed, [{ text: 'something nobody stored anywhere', source: 'n', distance: 0.1 }])).toEqual([])
    expect(pathThrough(l.placed, [l.placed[0].id])).toBe('')
  })
})

describe('strata', () => {
  it('bands are months, newest first; a quiet month is an empty band, not a missing one', () => {
    const nodes = [
      { kind: 'memory' as const, source: 'note', time: new Date(Date.UTC(2026, 10, 3)).toISOString() },
      { kind: 'memory' as const, source: 'note', time: new Date(Date.UTC(2026, 10, 9)).toISOString() },
      { kind: 'memory' as const, source: 'claude', time: new Date(Date.UTC(2026, 7, 1)).toISOString() },
      { kind: 'memory' as const, source: 'claude', time: null },
    ]
    const s = strataOf(nodes)
    expect(s.bands.map((b) => b.ym)).toEqual(['2026-11', '2026-10', '2026-09', '2026-08'])
    expect(s.bands.map((b) => b.count)).toEqual([2, 0, 0, 1])
    expect(s.undated).toBe(1)
    expect(s.total).toBe(3)
  })
  it('no dates at all is no bands', () => expect(strataOf([{ kind: 'memory', source: 'a', time: null }]).bands).toEqual([]))
  it('equal density is equal ink, and more density is never less ink', () => {
    const n = (d: number) => ditherCells(d, 40, 8).length
    expect(n(0)).toBe(0)
    expect(n(0.25)).toBeLessThanOrEqual(n(0.5))
    expect(n(0.5)).toBeLessThanOrEqual(n(1))
    expect(n(1)).toBe(40 * 8)
  })
})

describe('the trail', () => {
  it('keeps the last 30 recalls, numbered from the first', () => {
    let list: ReturnType<typeof pushRecall> = []
    for (let i = 0; i < 40; i++) list = pushRecall(list, `q${i}`, i % 9, NOW_MS + i)
    expect(list).toHaveLength(TRAIL_MAX)
    expect(list[0].n).toBe(11)
    expect(list.at(-1)!.n).toBe(40)
  })
  it('an arc passes through at most six items in rank order, numbered 1 to n', () => {
    const arcs = trailLayout([{ n: 1, q: 'x', at: 0, hits: 9 }, { n: 2, q: 'y', at: 0, hits: 0 }])
    expect(arcs[0].dots.map((d) => d.rank)).toEqual([1, 2, 3, 4, 5, 6].slice(0, TRAIL_ITEMS))
    expect(arcs[1].dots).toHaveLength(0)
    expect(arcs[1].path).toBe('')
  })
})

describe('holdings', () => {
  it('are the store\'s own counts, and no row is invented when the store did not report', () => {
    const rows = holdingsOf(fixtureStats(40), null)
    expect(rows.find((r) => r.id === 'facts')!.n).toBe(40)
    expect(rows.find((r) => r.id === 'beliefs')!.n).toBe(5)
    const none = holdingsOf(null, null)
    expect(none.every((r) => r.n === null)).toBe(true)
  })
})

describe('fix and delete', () => {
  it('the diff is two lines: removed words on the old line, added words on the new one', () => {
    const d = twoLineDiff('the key is in the blue tin', 'the key is in the red tin')
    expect(d.old.filter((s) => s.k === 'del').map((s) => s.t)).toEqual(['blue'])
    expect(d.next.filter((s) => s.k === 'add').map((s) => s.t)).toEqual(['red'])
    expect(d.old.filter((s) => s.k === 'same')).toHaveLength(6)
  })
  it('an unchanged line has no marks', () => expect(twoLineDiff('same words', 'same words').old.every((s) => s.k === 'same')).toBe(true))
  it('history rows last seven days and then go, and a row can be taken back out', () => {
    const row = (id: string, ageDays: number): FixRow => ({ id, node: 'n1', before: 'a', after: 'b', at: NOW_MS - ageDays * day })
    expect(FIX_DAYS).toBe(7)
    const rows = addFix(addFix([], row('x', 6.9), NOW_MS), row('y', 0), NOW_MS)
    expect(rows.map((r) => r.id)).toEqual(['x', 'y'])
    expect(pruneFixes(rows, NOW_MS + 2 * day).map((r) => r.id)).toEqual(['y'])
    expect(fixesFor(rows, 'n1')[0].id).toBe('y')
    expect(removeFix(rows, 'x').map((r) => r.id)).toEqual(['y'])
  })
  it('the confirm names the count and what stays, and says there is no undo', () => {
    expect(deleteLine(1, 54)).toBe('This removes 1 item from what JARVIS holds. 54 stay. There is no undo for a delete.')
    expect(deleteLine(3, null)).toContain('3 items')
  })
})

describe('chips of origin, people and words', () => {
  it('a rule, the owner\'s own hand, or the model', () => {
    expect(originOf({ source: 'rule:calendar' })).toBe('RULE')
    expect(originOf({ status: 'confirmed' })).toBe('HAND')
    expect(originOf({ source: 'authored:typed' })).toBe('HAND')
    expect(originOf({ kind: 'correction' })).toBe('HAND')
    expect(originOf({ status: 'unconfirmed', source: 'claude' })).toBe('MODEL')
  })
  it('people are alphabetical, never by closeness', () => {
    const p = (name: string, closeness: number): Person => ({ name, closeness, rank: 1, span_days: 1, n_msgs: 1, reciprocity: 0, calls: 0, share_ratio: 0, why: '' })
    expect(alphabetical([p('Cedar', 99), p('alder', 1), p('Birch', 50)]).map((x) => x.name)).toEqual(['alder', 'Birch', 'Cedar'])
  })
  it('a reminder is "in 18 min", not a clock the reader has to subtract', () => {
    expect(relDue(1000 + 18 * 60, 1000)).toBe('in 18 min')
    expect(relDue(1000 + 95 * 60, 1000)).toBe('in 1 h 35 min')
    expect(relDue(900, 1000)).toBe('due now')
  })
  it('marks the matched words and nothing else', () => {
    expect(queryTerms('what did I say about Germany')).toEqual(['germany'])
    expect(highlightParts('I love Germany in spring', ['germany']).filter((p) => p.hit).map((p) => p.t)).toEqual(['Germany'])
  })
  it('the fixture nodes carry no real text: invented sentences only', () => {
    expect(fixtureNodes(5).every((n) => n.label.length > 3)).toBe(true)
  })
})
