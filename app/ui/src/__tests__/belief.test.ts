import { describe, expect, it } from 'vitest'
import {
  BELIEF_COLOR, DOTS, EXPERIMENTAL_CAP, MIN_P, UNTRAINED_CAP, beliefLabel, confidenceAlpha, dotCounts, dotOffsets, fallbackBelief, heightFor, layoutDots,
  readBelief, spreadFor, topZone, type Belief, type BeliefZone,
} from '../lib/belief'
import { roomPlaces, type RoomLike } from '../twin/places'

const Z = (id: string, p: number, x: number, y: number, r = 0.5): BeliefZone => ({ id, name: id, p, x, y, r })

/** Mean distance of zone dots from its centre, and the largest. */
function spreadOf(pos: Float32Array, from: number, to: number, x: number, y: number) {
  let sum = 0, max = 0
  for (let i = from; i < to; i++) {
    const d = Math.hypot(pos[i * 3] - x, pos[i * 3 + 1] - y)
    sum += d; max = Math.max(max, d)
  }
  return { mean: sum / (to - from), max }
}

describe('dot counts', () => {
  it('gives each zone dots in proportion to its probability', () => {
    const c = dotCounts([{ p: 0.6 }, { p: 0.3 }, { p: 0.1 }])
    expect(c.reduce((s, v) => s + v, 0)).toBe(DOTS)
    expect(c[0] / c[1]).toBeCloseTo(2, 1)
    expect(c[0] / c[2]).toBeCloseTo(6, 0)
    expect(c[0]).toBe(144)
  })

  it('leaves out zones at or under 3 %, and the probability that is nowhere', () => {
    const c = dotCounts([{ p: 0.5 }, { p: MIN_P }, { p: 0.01 }])
    expect(c[1]).toBe(0)
    expect(c[2]).toBe(0)
    expect(c[0]).toBe(DOTS / 2)                                     // half the mass is "away": half the dots
    expect(dotCounts([{ p: 0 }, { p: 0.02 }])).toEqual([0, 0])
    expect(dotCounts([])).toEqual([])
  })

  it('never draws more than the pool, even if a hub sends more than 1 in all', () => {
    const c = dotCounts([{ p: 0.9 }, { p: 0.9 }])
    expect(c[0] + c[1]).toBe(DOTS)
    expect(c[0]).toBe(c[1])
  })
})

describe('dot layout', () => {
  const offs = dotOffsets(DOTS)

  it('is deterministic, so dots glide between layouts instead of hopping', () => {
    expect(dotOffsets(16)).toEqual(dotOffsets(16))
    const a = new Float32Array(DOTS * 3), b = new Float32Array(DOTS * 3), la = new Float32Array(DOTS), lb = new Float32Array(DOTS)
    layoutDots([Z('desk', 0.7, 1, 1)], 0.2, offs, a, la)
    layoutDots([Z('desk', 0.7, 1, 1)], 0.2, offs, b, lb)
    expect(a).toEqual(b)
  })

  it('lights one dot per count, zone by zone, and keeps every dot inside its zone', () => {
    const pos = new Float32Array(DOTS * 3), lit = new Float32Array(DOTS)
    const zones = [Z('desk', 0.62, 0.8, 1.9, 0.4), Z('floor', 0.2, 2.6, 2.6, 0.6), Z('bed', 0.02, 2.6, 1, 0.7)]
    const n = layoutDots(zones, 1, offs, pos, lit)
    const c = dotCounts(zones)
    expect(n).toBe(c[0] + c[1])
    expect(lit.reduce((s, v) => s + v, 0)).toBe(n)
    expect(spreadOf(pos, 0, c[0], 0.8, 1.9).max).toBeLessThanOrEqual(0.4 + 1e-6)
    expect(spreadOf(pos, c[0], n, 2.6, 2.6).max).toBeLessThanOrEqual(0.6 + 1e-6)
    // densest at the centre: a uniform disc puts 25 % of its dots in the inner half-radius,
    // a Gaussian truncated at 2σ = r puts ~45 % there
    let inner = 0
    for (let i = 0; i < c[0]; i++) if (Math.hypot(pos[i * 3] - 0.8, pos[i * 3 + 1] - 1.9) < 0.2) inner++
    expect(inner / c[0]).toBeGreaterThan(0.38)
  })

  it('spreads wider and stands taller as motion grows', () => {
    expect(spreadFor(0)).toBeLessThan(spreadFor(0.5))
    expect(spreadFor(0.5)).toBeLessThan(spreadFor(1))
    expect(spreadFor(1)).toBe(1)
    expect(heightFor(0)).toBeLessThan(heightFor(1))
    const still = new Float32Array(DOTS * 3), moving = new Float32Array(DOTS * 3), lit = new Float32Array(DOTS)
    const zones = [Z('floor', 0.8, 2, 2, 0.6)]
    const n = layoutDots(zones, 0, offs, still, lit)
    layoutDots(zones, 1, offs, moving, lit)
    const s0 = spreadOf(still, 0, n, 2, 2), s1 = spreadOf(moving, 0, n, 2, 2)
    expect(s1.mean / s0.mean).toBeCloseTo(spreadFor(1) / spreadFor(0), 3)
    let z0 = 0, z1 = 0
    for (let i = 0; i < n; i++) { z0 = Math.max(z0, still[i * 3 + 2]); z1 = Math.max(z1, moving[i * 3 + 2]) }
    expect(z1).toBeGreaterThan(z0 * 2)
  })

  it('turns off the dots it does not need', () => {
    const pos = new Float32Array(DOTS * 3), lit = new Float32Array(DOTS).fill(1)
    const n = layoutDots([Z('desk', 0.25, 1, 1)], 0, offs, pos, lit)
    expect(n).toBe(60)
    expect(lit.slice(n).every((v) => v === 0)).toBe(true)
    expect(layoutDots([], 0, offs, pos, lit)).toBe(0)
  })
})

describe('reading the belief block', () => {
  it('accepts the contract and clamps it', () => {
    const b = readBelief({ state: 'in_room', confidence: 1.4, motion: -1, updated: 12,
      zones: [{ id: 'desk', name: 'at the desk chair', p: 0.62, x: 0.8, y: 1.9, r: 0.4 }, { id: 'bad', x: 'no' }],
      activity: { state: 'typing', p: 0.7 } })!
    expect(b.confidence).toBe(1)
    expect(b.motion).toBe(0)
    expect(b.zones).toHaveLength(1)
    expect(b.activity).toEqual({ state: 'typing', p: 0.7 })
  })

  it('refuses what is not one', () => {
    expect(readBelief(null)).toBeNull()
    expect(readBelief(undefined)).toBeNull()
    expect(readBelief({ state: 'maybe' })).toBeNull()
    expect(readBelief('in_room')).toBeNull()
    expect(readBelief({ state: 'empty' })!.zones).toEqual([])
  })
})

describe('fallback from the learned states (older hub)', () => {
  const ROOM: RoomLike = {
    width: 4.2, depth: 3.2,
    zones: [
      { name: 'desk', polygon: [[0.45, 1.35], [1.15, 1.35], [1.15, 2.55], [0.45, 2.55]] },
      { name: 'bed', polygon: [[1.5, 0], [3.6, 0], [3.6, 2.1], [1.5, 2.1]] },
      { name: 'door', polygon: [[0.15, 0], [1, 0], [1, 0.75], [0.15, 0.75]], is_exit: true },
      { name: 'floor', polygon: [[0, 0.75], [1.5, 0.75], [1.5, 2.1], [4.2, 2.1], [4.2, 3.2], [0, 3.2]] },
    ],
    furniture: [{ name: 'desk', x: 0, y: 1.25, w: 0.48, d: 1.45, h: 0.75 }, { name: 'bed', x: 1.5, y: 0, w: 2.1, d: 2.1, h: 0.45 }],
  }
  const places = roomPlaces(ROOM)
  const learned = (p: Record<string, number>, occ: number, act?: string) =>
    ({ t: 5, state: 'desk', p, occupied_p: occ, activity: act ? { state: act, p: { [act]: 0.8 } } : null })

  it('maps desk / bed / room / outside onto the room\'s places, keeping their probabilities', () => {
    const b = fallbackBelief(learned({ empty: 0.05, outside: 0.05, room: 0.2, desk: 0.62, bed: 0.08 }, 0.9), null, places)!
    expect(b.zones.map((z) => z.id)).toEqual(['desk', 'bed', 'floor', 'door'])
    const desk = b.zones[0]
    expect(desk.p).toBe(0.62)
    expect([desk.x, desk.y]).toEqual([places.desk!.x, places.desk!.y])
    expect(b.zones[2]).toMatchObject({ p: 0.2, x: places.room.x, y: places.room.y })
    expect(b.zones[3].p).toBe(0.05)
    expect(b.state).toBe('in_room')
    expect(b.confidence).toBeCloseTo(0.8, 6)
    expect(b.updated).toBe(5)
    // an untrained model's place is never named (2026-10-25 honesty rule)
    expect(b.zonesTrusted).toBe(false)
    expect(beliefLabel(b)).toBe('in the room, not sure where')
    expect(beliefLabel({ ...b, zonesTrusted: true })).toBe('probably: at the desk chair · 62 %')
  })

  it('reads in_room / unsure / empty off occupied_p', () => {
    const p = { empty: 0.2, outside: 0.2, room: 0.2, desk: 0.2, bed: 0.2 }
    expect(fallbackBelief(learned(p, 0.5), null, places)!.state).toBe('unsure')
    expect(fallbackBelief(learned(p, 0.5), null, places)!.confidence).toBe(0)
    expect(fallbackBelief(learned(p, 0.1), null, places)!.state).toBe('empty')
  })

  it('takes motion from the human-band energy or the activity, whichever is higher', () => {
    const p = { desk: 0.8 }
    expect(fallbackBelief(learned(p, 0.9, 'still'), null, places)!.motion).toBeLessThan(0.1)
    expect(fallbackBelief(learned(p, 0.9, 'walking'), null, places)!.motion).toBeCloseTo(0.72, 6)
    expect(fallbackBelief(learned(p, 0.9, 'still'), { recent: 30 }, places)!.motion).toBeGreaterThan(0.85)
  })

  it('has nothing to say without a learned answer or a room', () => {
    expect(fallbackBelief(null, null, places)).toBeNull()
    expect(fallbackBelief(learned({ desk: 1 }, 1), null, null)).toBeNull()
  })
})

describe('words and colour', () => {
  const B = (over: Partial<Belief>): Belief => ({ state: 'in_room', confidence: 0.8, zones: [], motion: 0, activity: null, updated: 0, ...over })

  it('names the top zone, or says it cannot tell', () => {
    expect(beliefLabel(null)).toBe("can't tell")
    expect(beliefLabel(B({ zones: [Z('a', 0.2, 0, 0), Z('b', 0.25, 1, 1)] }))).toBe("can't tell")
    expect(beliefLabel(B({ state: 'unsure', zones: [Z('at the desk', 0.41, 0, 0)] }))).toBe('probably: at the desk · 41 %')
    expect(beliefLabel(B({ state: 'empty', confidence: 0.8 }))).toBe('probably: nobody in the room · 80 %')
    expect(topZone(B({ zones: [Z('a', 0.2, 0, 0), Z('b', 0.5, 1, 1)] }))!.id).toBe('b')
  })

  it('caps the experimental CNN far below the untrained cap', () => {
    // ~26 % right on a held-out session (council 2026-10-26): never show it as 90 % sure
    const exp = (p: number) => B({ zonesTrusted: false, experimental: 'fingerprint CNN', zones: [Z('bed', p, 0, 0)] })
    expect(EXPERIMENTAL_CAP).toBeLessThan(UNTRAINED_CAP)
    expect(beliefLabel(exp(0.95))).toBe('maybe: bed · 60 % (experimental)')
    expect(beliefLabel(exp(0.45))).toBe('maybe: bed · 45 % (experimental)')
    expect(beliefLabel(exp(0.2))).toBe('in the room, not sure where')
  })

  it('is copper in the room, grey unsure, nothing when empty, and fades with confidence', () => {
    expect(BELIEF_COLOR.in_room).toMatch(/^#/)
    expect(BELIEF_COLOR.unsure).toMatch(/^#/)
    expect(BELIEF_COLOR.empty).toBeNull()
    expect(confidenceAlpha(0)).toBeCloseTo(0.22, 6)
    expect(confidenceAlpha(1)).toBeCloseTo(1, 6)
    expect(confidenceAlpha(0.3)).toBeLessThan(confidenceAlpha(0.7))
  })
})
