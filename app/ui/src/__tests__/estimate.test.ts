import { describe, expect, it } from 'vitest'
import {
  BODY, EstimateHold, HOLD, SEAT_H, SHOW_P, STALE_S, blendPose, decayHeat, energyToHeat, estimateAlpha, estimateLabel,
  pointInPolygon, poseAngles, poseFor, roomSpots, sagittalHand, spotFor, targetZone, zeroPose,
  type LearnedLike, type RoomLike,
} from '../twin/estimate'

// aankhen/room.py default_room(): the 4 x 4 m study used until a layout is measured.
const STUDY: RoomLike = {
  width: 4, depth: 4,
  zones: [
    { name: 'desk', polygon: [[0, 0], [1.6, 0], [1.6, 1.2], [0, 1.2]], posture: 'seated', facing_deg: -90 },
    { name: 'bed', polygon: [[2.2, 2], [4, 2], [4, 4], [2.2, 4]], posture: 'lying', facing_deg: 90 },
    { name: 'floor', polygon: [[1.6, 0], [4, 0], [4, 2], [1.6, 2]] },
    { name: 'door', polygon: [[0, 3], [0.8, 3], [0.8, 4], [0, 4]], is_exit: true },
  ],
  furniture: [
    { name: 'desk', x: 0, y: 0, w: 1.6, d: 0.7, h: 0.75 },
    { name: 'bed', x: 2.2, y: 2, w: 1.8, d: 2, h: 0.5 },
    { name: 'wardrobe', x: 3.4, y: 0, w: 0.6, d: 1, h: 2.1 },
  ],
}

// An L-shaped floor wrapped round a bed, a wardrobe in the corner of the L, and the desk
// zone drawn INSIDE the floor polygon (zone_at picks the first match). The floor's plain
// vertex average lands in the wardrobe's margin.
const L_ROOM: RoomLike = {
  width: 4.2, depth: 3.2,
  zones: [
    { name: 'desk', polygon: [[0.45, 1.35], [1.15, 1.35], [1.15, 2.55], [0.45, 2.55]] },   // no posture, no facing
    { name: 'bed', polygon: [[1.5, 0], [3.6, 0], [3.6, 2.1], [1.5, 2.1]] },
    { name: 'door', polygon: [[0.15, 0], [1, 0], [1, 0.75], [0.15, 0.75]], is_exit: true },
    { name: 'floor', polygon: [[0, 0.75], [1.5, 0.75], [1.5, 2.1], [4.2, 2.1], [4.2, 3.2], [0, 3.2]] },
  ],
  furniture: [
    { name: 'desk', x: 0, y: 1.25, w: 0.48, d: 1.45, h: 0.75 },
    { name: 'bed', x: 1.5, y: 0, w: 2.1, d: 2.1, h: 0.45 },
    { name: 'wardrobe', x: 0.05, y: 2.8, w: 1.4, d: 0.4, h: 2.4 },
    { name: 'drawers', x: 3.65, y: 2.8, w: 0.5, d: 0.4, h: 0.75 },
  ],
}

const inBox = (x: number, y: number, f: { x: number; y: number; w: number; d: number }, m = 0) =>
  x >= f.x - m && x <= f.x + f.w + m && y >= f.y - m && y <= f.y + f.d + m
const deg = (r: number) => (r * 180) / Math.PI

describe('zone -> spot', () => {
  const s = roomSpots(STUDY)

  it('seats me on the desk zone\'s chair side, facing the desk', () => {
    const d = s.desk!
    expect(d.posture).toBe('seated')
    expect(d.base).toBe(SEAT_H)
    expect(pointInPolygon(d.x, d.y, STUDY.zones[0].polygon)).toBe(true)
    expect(inBox(d.x, d.y, STUDY.furniture[0])).toBe(false)           // not on the desk itself
    expect(d.x).toBeCloseTo(0.8, 1)
    expect(d.y).toBeCloseTo(0.95, 1)                                  // the 0.7..1.2 m strip in front of it
    expect(deg(d.facing)).toBeCloseTo(-90, 5)
  })

  it('lays me along the bed, on its top, head toward facing_deg', () => {
    const b = s.bed!
    expect(b.posture).toBe('lying')
    expect(b.base).toBe(0.5)
    expect(b.x).toBeCloseTo(3.1, 1)
    expect(b.y).toBeCloseTo(3.0, 1)
    expect(deg(b.facing)).toBeCloseTo(90, 5)
    // feet (0.92 m behind the pelvis) and head (0.8 m ahead) both on the bed
    expect(b.y - 0.92).toBeGreaterThan(2)
    expect(b.y + 0.8).toBeLessThan(4)
  })

  it('stands me on open floor, clear of furniture and of the other zones', () => {
    const r = s.room
    expect(r.posture).toBe('standing')
    expect(pointInPolygon(r.x, r.y, STUDY.zones[2].polygon)).toBe(true)
    for (const f of STUDY.furniture) expect(inBox(r.x, r.y, f, 0.22)).toBe(false)
    expect(s.wander).toBeGreaterThan(0.2)
  })

  it('stands me up beside the bed, not on it', () => {
    const b = s.stand.bed!
    expect(inBox(b.x, b.y, STUDY.furniture[1])).toBe(false)
    expect(Math.abs(b.y - 2)).toBeLessThan(0.4)                         // at the bed's edge
    expect(b.x).toBeGreaterThan(2.2)
  })

  it('puts the outside marker just past the wall nearest the door', () => {
    expect(s.door).not.toBeNull()
    const o = s.outside!
    const outside = o.x < 0 || o.x > STUDY.width || o.y < 0 || o.y > STUDY.depth
    expect(outside).toBe(true)
    expect(Math.hypot(o.x - s.door!.x, o.y - s.door!.y)).toBeLessThan(1)
  })

  it('finds the open floor of an L-shaped room, and the chair side without facing_deg', () => {
    const l = roomSpots(L_ROOM)
    const floor = L_ROOM.zones[3].polygon
    expect(pointInPolygon(l.room.x, l.room.y, floor)).toBe(true)
    for (const f of L_ROOM.furniture) expect(inBox(l.room.x, l.room.y, f, 0.2)).toBe(false)
    for (const z of L_ROOM.zones.slice(0, 3)) expect(pointInPolygon(l.room.x, l.room.y, z.polygon)).toBe(false)
    // the desk zone has no facing: I face the desk (it is at -x)
    const d = l.desk!
    expect(d.x).toBeGreaterThan(0.48)
    expect(Math.abs(Math.cos(d.facing) + 1)).toBeLessThan(0.05)
    // the bed has no facing either: lying along it, on the 0.45 m frame
    expect(l.bed!.base).toBe(0.45)
  })

  it('falls back to the open floor when the room has no desk or bed zone', () => {
    const bare: RoomLike = { width: 3, depth: 3, zones: [], furniture: [] }
    const s2 = roomSpots(bare)
    expect(s2.desk).toBeNull()
    expect(s2.bed).toBeNull()
    expect(spotFor(s2, 'desk')).toEqual(s2.room)
    expect(s2.room.x).toBeCloseTo(1.5, 1)
    expect(s2.room.y).toBeCloseTo(1.5, 1)
    expect(s2.outside).toBeNull()
  })
})

describe('state + activity -> pose', () => {
  it('maps every learned state', () => {
    expect(poseFor('desk', 'typing')).toMatchObject({ show: 'figure', posture: 'seated', motion: 'typing', focus: 'hands', at: 'desk' })
    expect(poseFor('desk', 'still')).toMatchObject({ posture: 'seated', focus: 'chest' })
    expect(poseFor('desk', 'waving')).toMatchObject({ posture: 'seated', focus: 'arm' })
    expect(poseFor('bed', 'still')).toMatchObject({ show: 'figure', posture: 'lying', focus: 'chest', at: 'bed' })
    expect(poseFor('room', 'walking')).toMatchObject({ show: 'figure', posture: 'standing', focus: 'legs', at: 'room' })
    expect(poseFor('room', 'none')).toMatchObject({ posture: 'standing', motion: 'still' })
    expect(poseFor('outside', 'none').show).toBe('outside')
    expect(poseFor('empty', 'none').show).toBe('none')
    expect(poseFor(null, null).show).toBe('none')
  })

  it('walking at the desk or bed means getting up: standing beside it', () => {
    expect(poseFor('desk', 'walking')).toMatchObject({ posture: 'standing', motion: 'walking', at: 'stand-desk' })
    expect(poseFor('bed', 'walking')).toMatchObject({ posture: 'standing', motion: 'walking', at: 'stand-bed' })
  })

  it('a seated typist\'s hands land at desk height, in front of the chest', () => {
    for (const t of [0, 0.03, 0.11, 0.5, 1.7]) {
      const p = poseAngles('seated', 'typing', t, { base: SEAT_H, travel: 0 })
      for (const side of ['L', 'R'] as const) {
        const h = sagittalHand(p, side)
        expect(h.z).toBeGreaterThan(0.7)                 // the desk top is 0.75 m
        expect(h.z).toBeLessThan(0.86)
        expect(h.x).toBeGreaterThan(0.3)                 // reaching past the 0.25-0.35 m to the desk edge
        expect(h.x).toBeLessThan(0.65)
      }
    }
    // and the fingers move: the elbow angle changes over a tap
    const a = poseAngles('seated', 'typing', 0.0, { base: SEAT_H, travel: 0 })
    const b = poseAngles('seated', 'typing', 0.06, { base: SEAT_H, travel: 0 })
    expect(Math.abs(a.elRf - b.elRf)).toBeGreaterThan(0.02)
  })

  it('rests each posture at the right height', () => {
    expect(poseAngles('standing', 'still', 0, { base: 0, travel: 0 }).pelvisZ).toBeCloseTo(BODY.hipZ, 5)
    const s = poseAngles('seated', 'still', 0, { base: SEAT_H, travel: 0 })
    expect(s.pelvisZ).toBeCloseTo(SEAT_H + 0.04, 5)
    // thighs level, shins vertical: the feet reach the floor
    expect(s.pelvisZ - BODY.shin - BODY.ankle).toBeLessThan(0.03)
    expect(poseAngles('lying', 'still', 0, { base: 0.5, travel: 0 }).pelvisZ).toBeCloseTo(0.62, 5)
    expect(BODY.thigh + BODY.shin + BODY.ankle).toBeCloseTo(BODY.hipZ, 5)
  })

  it('waves with a raised right arm, walks with the legs, breathes when still', () => {
    const w = poseAngles('standing', 'waving', 0.3, { base: 0, travel: 0 })
    expect(w.shRa).toBeGreaterThan(1.5)
    expect(w.shLa).toBeLessThan(0.3)
    const legs = [0, 0.13, 0.26, 0.39].map((t) => poseAngles('standing', 'walking', t, { base: 0, travel: 0 }).hipL)
    expect(Math.max(...legs) - Math.min(...legs)).toBeGreaterThan(0.2)
    const b0 = poseAngles('lying', 'still', 0, { base: 0.5, travel: 0 }).breathe
    const b1 = poseAngles('lying', 'still', 1, { base: 0.5, travel: 0 }).breathe     // a quarter breath later
    expect(b1).toBeGreaterThan(b0)
  })

  it('blends whole poses, so a one-hot blend is the pose itself', () => {
    const ctx = () => ({ base: SEAT_H, travel: 0 })
    const one = blendPose({ standing: 0, seated: 1, lying: 0 }, { still: 0, typing: 1, waving: 0, walking: 0 }, 0.2, ctx)
    const ref = poseAngles('seated', 'typing', 0.2, ctx())
    expect(one.elRf).toBeCloseTo(ref.elRf, 6)
    expect(one.hipL).toBeCloseTo(ref.hipL, 6)
    const half = blendPose({ standing: 0.5, seated: 0.5, lying: 0 }, { still: 1, typing: 0, waving: 0, walking: 0 }, 0, (p) => ({ base: p === 'seated' ? SEAT_H : 0, travel: 0 }))
    expect(half.hipL).toBeCloseTo(Math.PI / 4, 5)
    expect(zeroPose().pelvisZ).toBe(0)
  })
})

describe('energy -> heat', () => {
  it('reads nothing as no heat, and is safe on junk', () => {
    expect(energyToHeat(null)).toBe(0)
    expect(energyToHeat(undefined)).toBe(0)
    expect(energyToHeat({ energy: 1, recent: 1 })).toBe(0)                   // the band's own noise
    expect(energyToHeat({ energy: Number.NaN, recent: null })).toBe(0)
    expect(energyToHeat({ energy: -5 })).toBe(0)
  })

  it('maps the measured range onto 0..1 on a log scale', () => {
    const gate = energyToHeat({ recent: 1.6 })
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(0.15)                                          // motion just starting: a glimmer
    expect(energyToHeat({ recent: 4 })).toBeGreaterThan(0.25)                // typing-level
    expect(energyToHeat({ recent: 30 })).toBeGreaterThan(0.85)               // waving at the desk
    expect(energyToHeat({ recent: 1000 })).toBe(1)
    let prev = -1
    for (const e of [1, 1.2, 1.6, 2, 3, 5, 8, 13, 21, 34, 55]) {
      const h = energyToHeat({ recent: e })
      expect(h).toBeGreaterThanOrEqual(prev)
      prev = h
    }
  })

  it('prefers the last second, and falls back to the 3 s energy', () => {
    expect(energyToHeat({ energy: 2, recent: 20 })).toBeCloseTo(energyToHeat({ recent: 20 }), 9)
    expect(energyToHeat({ energy: 20, recent: 0 })).toBeCloseTo(energyToHeat({ recent: 20 }), 9)
  })

  it('rises at once and fades over a few seconds', () => {
    expect(decayHeat(0, 0.9, 0.016)).toBe(0.9)
    let h = 1
    for (let i = 0; i < 120; i++) h = decayHeat(h, 0, 1 / 60)                 // 2 s at 60 fps
    expect(h).toBeGreaterThan(0.2)
    expect(h).toBeLessThan(0.4)
    for (let i = 0; i < 180; i++) h = decayHeat(h, 0, 1 / 60)                 // 5 s in all
    expect(h).toBeLessThan(0.05)
    expect(decayHeat(0.2, 1.7, 0.1)).toBe(1)                                  // clamped
  })
})

describe('holding the estimate', () => {
  const L = (state: string, p: number, t: number, activity = 'still', occupied?: number): LearnedLike => {
    const probs: Record<string, number> = { empty: 0, outside: 0, room: 0, desk: 0, bed: 0 }
    probs[state] = p
    const rest = (1 - p) / 4
    for (const k of Object.keys(probs)) if (k !== state) probs[k] = rest
    const occ = occupied ?? (['room', 'desk', 'bed'].includes(state) ? p + 2 * rest : 3 * rest)
    return { t, state, p: probs, occupied_p: occ, activity: { state: activity, p: {} } }
  }

  it('appears fast, and ignores a one-window flicker', () => {
    const h = new EstimateHold()
    expect(h.update(L('desk', 0.8, 0), 0).zone).toBeNull()
    expect(h.update(L('desk', 0.8, 0.5), HOLD.appear).zone).toBe('desk')
    h.update(L('bed', 0.8, 1), 1.0)                                          // one flickering window
    expect(h.update(L('desk', 0.8, 1.5), 1.5).zone).toBe('desk')
    expect(h.update(L('desk', 0.8, 2), 3).zone).toBe('desk')
  })

  it('moves to a new place once it has held, and leaves more slowly', () => {
    const h = new EstimateHold()
    h.update(L('desk', 0.8, 0), 0); h.update(L('desk', 0.8, 1), 1)
    h.update(L('bed', 0.8, 2), 2)
    expect(h.update(L('bed', 0.8, 3), 2 + HOLD.move - 0.1).zone).toBe('desk')
    const held = h.update(L('bed', 0.82, 4), 2 + HOLD.move + 0.05)
    expect(held.zone).toBe('bed')
    expect(held.p).toBeCloseTo(0.82, 6)
    h.update(L('outside', 0.7, 5), 5)
    expect(h.update(L('outside', 0.7, 6), 5 + HOLD.move).zone).toBe('bed')   // leaving waits longer
    expect(h.update(L('outside', 0.7, 7), 5 + HOLD.leave + 0.01).zone).toBe('outside')
  })

  it('shows nothing when the odds I am in are not better than even', () => {
    expect(targetZone(L('desk', 0.45, 0, 'still', SHOW_P - 0.01))).toBeNull()
    expect(targetZone(L('empty', 0.9, 0))).toBeNull()
    expect(targetZone(L('outside', 0.6, 0))).toBe('outside')
    // in by better than even odds though "outside" is the single best state: the likeliest place in
    expect(targetZone({ state: 'outside', occupied_p: 0.55, p: { empty: 0.05, outside: 0.4, room: 0.1, desk: 0.3, bed: 0.15 } })).toBe('desk')
    expect(targetZone(null)).toBeNull()
  })

  it('drops the figure when the model stops answering', () => {
    const h = new EstimateHold()
    h.update(L('desk', 0.9, 10), 0); h.update(L('desk', 0.9, 10.5), 1)
    expect(h.update(L('desk', 0.9, 10.5), 1 + STALE_S - 0.1).zone).toBe('desk')
    expect(h.update(L('desk', 0.9, 10.5), 1 + STALE_S + 0.1).zone).toBeNull()
    expect(h.update(null, 20).zone).toBeNull()
  })

  it('holds the activity briefly too', () => {
    const h = new EstimateHold()
    h.update(L('desk', 0.9, 0, 'typing'), 0)
    expect(h.update(L('desk', 0.9, 0.5, 'typing'), 0.5).activity).toBe('typing')
    h.update(L('desk', 0.9, 1, 'waving'), 1)
    expect(h.update(L('desk', 0.9, 1.5, 'waving'), 1 + HOLD.activity - 0.1).activity).toBe('typing')
    expect(h.update(L('desk', 0.9, 2, 'waving'), 1 + HOLD.activity + 0.01).activity).toBe('waving')
  })
})

describe('honesty in the picture', () => {
  it('fades with the probability', () => {
    expect(estimateAlpha(0)).toBeCloseTo(0.16, 5)
    expect(estimateAlpha(1)).toBeCloseTo(1, 5)
    expect(estimateAlpha(0.5)).toBeLessThan(estimateAlpha(0.8))
    expect(estimateAlpha(0.95)).toBeGreaterThan(0.95)
  })

  it('labels the estimate in plain words', () => {
    expect(estimateLabel({ zone: 'desk', activity: 'typing', p: 0.823 })).toBe('estimate 82% · desk · typing')
    expect(estimateLabel({ zone: 'bed', activity: 'none', p: 0.6 })).toBe('estimate 60% · bed')
    expect(estimateLabel({ zone: 'outside', activity: 'none', p: 0.64 })).toBe('outside the room · 64%')
    expect(estimateLabel({ zone: null, activity: 'none', p: 0 })).toBe('')
  })
})
