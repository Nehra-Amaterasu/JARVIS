import { describe, expect, it } from 'vitest'
import { energyToHeat, pointInPolygon, roomPlaces, type RoomLike } from '../twin/places'

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

describe('learned state -> place', () => {
  const s = roomPlaces(STUDY)

  it('puts the desk on the chair side of its zone, not on the desk', () => {
    const d = s.desk!
    expect(pointInPolygon(d.x, d.y, STUDY.zones[0].polygon)).toBe(true)
    expect(inBox(d.x, d.y, STUDY.furniture[0])).toBe(false)
    expect(d.x).toBeCloseTo(0.8, 1)
    expect(d.y).toBeCloseTo(0.95, 1)                                  // the 0.7..1.2 m strip in front of it
    expect(d.r).toBeGreaterThanOrEqual(0.25)
    expect(d.r).toBeLessThanOrEqual(0.55)
  })

  it('puts the bed on its frame, with a radius that fits it', () => {
    const b = s.bed!
    expect(b.x).toBeCloseTo(3.1, 1)
    expect(b.y).toBeCloseTo(3.0, 1)
    expect(inBox(b.x, b.y, STUDY.furniture[1])).toBe(true)
    expect(b.r).toBeLessThanOrEqual(0.9)
    expect(b.r).toBeGreaterThan(0.5)
  })

  it('puts "in the room" on open floor, clear of furniture and of the other zones', () => {
    const r = s.room
    expect(pointInPolygon(r.x, r.y, STUDY.zones[2].polygon)).toBe(true)
    for (const f of STUDY.furniture) expect(inBox(r.x, r.y, f, 0.22)).toBe(false)
    expect(r.r).toBeGreaterThanOrEqual(0.35)
  })

  it('puts "outside" at the doorway, inside the room', () => {
    const d = s.door!
    expect(pointInPolygon(d.x, d.y, STUDY.zones[3].polygon)).toBe(true)
    expect(d.r).toBeLessThanOrEqual(0.4)
  })

  it('finds the open floor of an L-shaped room, and the chair side without a posture', () => {
    const l = roomPlaces(L_ROOM)
    const floor = L_ROOM.zones[3].polygon
    expect(pointInPolygon(l.room.x, l.room.y, floor)).toBe(true)
    for (const f of L_ROOM.furniture) expect(inBox(l.room.x, l.room.y, f, 0.2)).toBe(false)
    for (const z of L_ROOM.zones.slice(0, 3)) expect(pointInPolygon(l.room.x, l.room.y, z.polygon)).toBe(false)
    expect(l.desk!.x).toBeGreaterThan(0.48)                           // off the desk at -x
  })

  it('falls back to the middle of a bare room', () => {
    const bare: RoomLike = { width: 3, depth: 3, zones: [], furniture: [] }
    const s2 = roomPlaces(bare)
    expect(s2.desk).toBeNull()
    expect(s2.bed).toBeNull()
    expect(s2.door).toBeNull()
    expect(s2.room.x).toBeCloseTo(1.5, 1)
    expect(s2.room.y).toBeCloseTo(1.5, 1)
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
})
