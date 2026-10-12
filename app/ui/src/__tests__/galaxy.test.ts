/**
 * The memory galaxy's data transforms (lib/galaxy.ts): what the GPU buffers, the
 * scrubber, the legend, picking and the growth chart are built from.
 */
import { describe, expect, it } from 'vitest'
import {
  areaPaths, birthsOf, buildBuffers, colorOf, countsAt, FAMILIES, groupOf, hexToRgb, legend, monthIndex, monthLabel,
  morphStart, niceTicks, pickNearest, provenanceOf, PROVENANCE_COLORS, recolor, SOURCE_COLORS, stackGrowth,
  synthPayload, visibility, visibleAt, WORLD_SCALE, type GalaxyNode, type GalaxyPayload, type Growth,
} from '../lib/galaxy'

const months = ['2024-01', '2024-02', '2024-03', '2024-04']

function node(over: Partial<GalaxyNode>): GalaxyNode {
  return { id: 'n', kind: 'memory', label: 'x', source: 'instagram', time: null, importance: 0.5, x: 0, y: 0, z: 0, ...over }
}

function payload(nodes: GalaxyNode[], edges: [number, number][] = [], g: Partial<Growth> = {}): GalaxyPayload {
  return {
    version: 1, built: '', build_ms: 0, max_memories: 8000, sampled: false,
    counts: { memories: nodes.length, memories_shown: nodes.length, people: 0, beliefs: 0, topics: 0, edges: edges.length },
    sources: {}, nodes, edges,
    growth: {
      months, families: ['instagram'], by_source: { instagram: [1, 0, 2, 0] }, undated: {}, people_new: [0, 0, 0, 0],
      beliefs_updated: [0, 0, 0, 0], ingest: [], beliefs_ingest: [], totals: { memories: 3, people: 0, beliefs: 0 }, ...g,
    },
  }
}

describe('time', () => {
  it('maps dates to month slots, undated to -1, and clamps outside the range', () => {
    expect(monthIndex(months, null)).toBe(-1)
    expect(monthIndex(months, '2024-03-31')).toBe(2)
    expect(monthIndex(months, '2019-05-01')).toBe(0)
    expect(monthIndex(months, '2030-01-01')).toBe(3)
    expect(monthIndex([], '2024-03-01')).toBe(-1)
    expect(monthLabel('2024-03')).toBe('Mar 2024')
  })

  it('counts what exists by a month; undated nodes always exist', () => {
    const p = payload([node({ time: '2024-01-02' }), node({ time: '2024-03-02', kind: 'person' }), node({ time: null })])
    const b = birthsOf(p)
    expect(Array.from(b)).toEqual([0, 2, -1])
    expect(visibleAt(b, 0)).toBe(2)
    expect(visibleAt(b, 3)).toBe(3)
    expect(countsAt(p, b, 1)).toEqual({ memory: 2, person: 0, belief: 0, topic: 0 })
  })
})

describe('provenance colour', () => {
  it('says confirmed, inferred, recorded or faded for every kind', () => {
    expect(provenanceOf(node({ source: 'authored' }))).toBe('confirmed')
    expect(provenanceOf(node({ source: 'voice' }))).toBe('inferred')       // JARVIS's own replies: unverified
    expect(provenanceOf(node({ source: 'claude' }))).toBe('recorded')
    expect(provenanceOf(node({ kind: 'person', source: 'people' }))).toBe('recorded')
    expect(provenanceOf(node({ kind: 'belief', status: 'confirmed' }))).toBe('confirmed')
    expect(provenanceOf(node({ kind: 'belief', status: 'unconfirmed' }))).toBe('inferred')
    expect(provenanceOf(node({ kind: 'belief', status: 'outdated' }))).toBe('faded')
    expect(provenanceOf(node({ kind: 'topic', source: 'taste' }))).toBe('inferred')
  })

  it('uses the app tokens for provenance and the validated palette for sources', () => {
    expect(PROVENANCE_COLORS.confirmed).toBe('#5ce1ff')              // --live
    expect(PROVENANCE_COLORS.inferred).toBe('#ffb020')               // --sim
    expect(colorOf(node({ source: 'claude' }), 'source')).toBe(SOURCE_COLORS.claude)
    expect(colorOf(node({ source: 'mystery' }), 'source')).toBe(SOURCE_COLORS.other)
    expect(colorOf(node({ kind: 'belief', status: 'unconfirmed' }), 'source')).toBe(PROVENANCE_COLORS.inferred)
    expect([...FAMILIES]).toEqual(['claude', 'note', 'instagram', 'voice', 'authored', 'other'])  // = yaadash_galaxy.FAMILIES + other
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0])
    expect(hexToRgb('#fff')).toEqual([1, 1, 1])
  })

  it('groups nodes for the legend filter by the active colouring', () => {
    const p = payload([node({ source: 'authored' }), node({ source: 'claude' }), node({ kind: 'person', source: 'people' })])
    expect(legend(p, 'provenance').map((r) => [r.key, r.count])).toEqual([['confirmed', 1], ['recorded', 2]])
    expect(legend(p, 'source').map((r) => [r.key, r.count, r.color === null])).toEqual(
      [['claude', 1, false], ['authored', 1, false], ['person', 1, true]])
    expect(groupOf(p.nodes[2], 'source')).toBe('person')
    expect(Array.from(visibility(p, 'source', new Set(['claude'])))).toEqual([1, 0, 1])
  })
})

describe('GPU buffers', () => {
  it('lays out positions, colours, sizes, births and edges', () => {
    const p = payload([
      node({ id: 'a', x: 0.1, y: 0.2, z: -0.3, time: '2024-02-01', importance: 0 }),
      node({ id: 'b', x: 1, y: 0, z: 0, time: '2024-04-01', importance: 1 }),
      node({ id: 'c', kind: 'person', source: 'people', time: null, importance: 1 }),
    ], [[0, 1], [1, 2], [0, 9]])
    const b = buildBuffers(p, 'provenance')
    expect(b.count).toBe(3)
    expect(Array.from(b.positions.slice(0, 3))).toEqual([0.1 * WORLD_SCALE, 0.2 * WORLD_SCALE, -0.3 * WORLD_SCALE].map((v) => Math.fround(v)))
    expect(b.sizes[1]).toBeGreaterThan(b.sizes[0])                    // importance -> size
    expect(b.sizes[2]).toBeGreaterThan(b.sizes[1])                    // a person is a hub
    expect(Array.from(b.births)).toEqual([1, 3, -1])
    expect(Array.from(b.kinds)).toEqual([0, 0, 1])
    expect(b.edgeCount).toBe(2)                                       // the out-of-range edge is dropped
    expect(Array.from(b.edgeBirths)).toEqual([3, 3, 3, 3])            // an edge exists once both ends do
    expect(b.radius).toBeCloseTo(WORLD_SCALE, 5)
    const recoloured = recolor(p, 'source', new Float32Array(b.colors))
    expect(Array.from(recoloured.slice(0, 3))).toEqual(hexToRgb(SOURCE_COLORS.instagram).map(Math.fround))
  })

  it('builds 10,000 nodes fast enough to rebuild on every refresh', () => {
    const p = synthPayload(10000, 7)
    const t0 = performance.now()
    const b = buildBuffers(p, 'provenance')
    const ms = performance.now() - t0
    expect(b.count).toBe(10000)
    expect(b.edgeCount).toBe(p.edges.length)
    expect(Number.isFinite(b.radius)).toBe(true)
    console.info(`[galaxy] buildBuffers(10k nodes, ${b.edgeCount} edges): ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(250)
  })

  it('makes the same synthetic galaxy for the same seed', () => {
    const a = synthPayload(500, 3)
    const b = synthPayload(500, 3)
    expect(a.nodes).toEqual(b.nodes)
    expect(synthPayload(500, 4).nodes[0]).not.toEqual(a.nodes[0])
  })
})

describe('refresh morph', () => {
  it('starts known nodes where they were and marks new ones', () => {
    const prev = payload([node({ id: 'a', x: 0 }), node({ id: 'b', x: 0.5 })])
    const next = payload([node({ id: 'b', x: 0.6 }), node({ id: 'c', x: 0.9 })])
    const pb = buildBuffers(prev, 'provenance')
    const nb = buildBuffers(next, 'provenance')
    const m = morphStart(prev, pb.positions, next, nb.positions)
    expect(m.start[0]).toBeCloseTo(0.5 * WORLD_SCALE)                 // b starts at its old x
    expect(m.start[3]).toBeCloseTo(0.9 * WORLD_SCALE)                 // c starts where it lands
    expect(Array.from(m.fresh)).toEqual([0, 1])
    expect(m.moved).toBe(1)
    expect(morphStart(null, null, next, nb.positions).fresh.every((f) => f === 0)).toBe(true)
  })
})

describe('picking', () => {
  // identity view-projection: clip = world, so screen = ((x+1)/2*w, (1-y)/2*h)
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const pos = new Float32Array([0, 0, 0, 0.5, 0.5, 0, -0.5, -0.5, 0])
  const births = new Float32Array([0, 0, 5])

  it('finds the node under the pointer within the radius', () => {
    expect(pickNearest(pos, births, null, 10, I, 200, 200, 101, 99)).toBe(0)
    expect(pickNearest(pos, births, null, 10, I, 200, 200, 150, 50)).toBe(1)
    expect(pickNearest(pos, births, null, 10, I, 200, 200, 30, 30)).toBe(-1)   // nothing near
  })

  it('ignores nodes not born yet or filtered out', () => {
    expect(pickNearest(pos, births, null, 4, I, 200, 200, 50, 150)).toBe(-1)
    expect(pickNearest(pos, births, null, 5, I, 200, 200, 50, 150)).toBe(2)
    expect(pickNearest(pos, births, new Float32Array([0, 1, 1]), 10, I, 200, 200, 100, 100)).toBe(-1)
  })

  it('picks among 10,000 points in well under a frame', () => {
    const b = buildBuffers(synthPayload(10000, 2), 'provenance')
    const t0 = performance.now()
    for (let k = 0; k < 20; k++) pickNearest(b.positions, b.births, null, 1e6, I, 800, 600, 400, 300, 14)
    const per = (performance.now() - t0) / 20
    console.info(`[galaxy] pickNearest over 10k points: ${per.toFixed(2)} ms`)
    expect(per).toBeLessThan(8)
  })
})

describe('growth chart', () => {
  const g: Growth = {
    months: ['2024-01', '2024-02', '2024-03'], families: ['claude', 'instagram'],
    by_source: { instagram: [2, 0, 1], claude: [1, 1, 0] }, undated: {}, people_new: [0, 0, 0],
    beliefs_updated: [0, 0, 0], ingest: [], beliefs_ingest: [], totals: { memories: 5, people: 0, beliefs: 0 },
  }

  it('stacks sources in a fixed order, bottom up', () => {
    const s = stackGrowth(g, false)
    expect(s.layers.map((l) => l.key)).toEqual(['claude', 'instagram'])   // order never follows the data
    expect(s.layers[0].y0).toEqual([0, 0, 0])
    expect(s.layers[1].y0).toEqual([1, 1, 0])
    expect(s.layers[1].y1).toEqual([3, 1, 1])
    expect(s.max).toBe(3)
    expect(s.layers.map((l) => l.total)).toEqual([2, 3])
  })

  it('cumulative totals never fall and end at the store size', () => {
    const s = stackGrowth(g, true)
    const top = s.layers[s.layers.length - 1].y1
    expect(top).toEqual([3, 4, 5])
    expect(s.max).toBe(5)
  })

  it('hiding a source restacks the rest and keeps their colours', () => {
    const s = stackGrowth(g, false, new Set(['claude']))
    expect(s.layers.map((l) => [l.key, l.color])).toEqual([['instagram', SOURCE_COLORS.instagram]])
    expect(s.layers[0].y0).toEqual([0, 0, 0])
  })

  it('draws each layer as a closed area between its floor and its top', () => {
    const s = stackGrowth(g, false)
    const [claude] = areaPaths(s.layers, { left: 10, top: 0, width: 100, height: 50 }, 4)
    // y1 = [1, 1, 0] along the top left to right, then y0 = [0, 0, 0] back along the floor
    expect(claude.d).toBe('M10.0,37.5L60.0,37.5L110.0,50.0L110.0,50.0L60.0,50.0L10.0,50.0Z')
    expect(claude.color).toBe(SOURCE_COLORS.claude)
  })

  it('picks round axis ticks', () => {
    expect(niceTicks(0)).toEqual([0])
    expect(niceTicks(97, 4)).toEqual([0, 50, 100])
    const t = niceTicks(1234, 3)
    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(97)
    expect(t.every((v, i) => i === 0 || v > t[i - 1])).toBe(true)
  })
})
