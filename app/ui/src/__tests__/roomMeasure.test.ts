import { describe, expect, it } from 'vitest'
import { NOT_SURE_WHERE, beliefLabel, readBelief, shownZones, type Belief } from '../lib/belief'
import { fromServer, learnedView, parseServerErrors, readinessLine, toPayload, type Readiness } from '../lib/roomMeasure'

const filled = () => {
  const t = fromServer({
    width: 4.2, depth: 3.15, height: 2.85,
    bed: { x: 1.53, y: 0, w: 2.08, d: 2.1 }, desk: { x: 0, y: 1.25, w: 0.48, d: 1.43 },
    board: { x: 0.3, y: 1.9, z: 0.85 }, router: { x: -5.8, y: -3.5, z: 1 },
  })
  t.doors.door = { wall: 'north', offset: '3', width: '0,9' }
  return t
}

describe('measure my room form', () => {
  it('prefills from the server and turns text into numbers (comma decimals too)', () => {
    const { body, errors } = toPayload(filled())
    expect(errors).toEqual([])
    expect(body).toMatchObject({ width: 4.2, bed: { w: 2.08 }, door: { wall: 'north', offset: 3, width: 0.9 }, board: { z: 0.85 } })
    expect(body).not.toHaveProperty('wardrobe')          // optional and blank: left out
    expect(body).not.toHaveProperty('balcony_door')
  })

  it('names the bad fields', () => {
    const t = filled()
    t.width = '420'; t.rects.desk.w = ''; t.points.router.z = 'abc'
    const f = toPayload(t).errors.map((e) => e.field)
    expect(f).toEqual(expect.arrayContaining(['width', 'desk.w', 'router.z']))
  })

  it('a half-filled optional item is checked', () => {
    const t = filled()
    t.rects.wardrobe.x = '0.05'
    expect(toPayload(t).errors.map((e) => e.field)).toContain('wardrobe.w')
  })

  it('reads the server 422 errors', () => {
    expect(parseServerErrors({ detail: { errors: [{ field: 'bed.x', error: 'outside' }] } })).toEqual([{ field: 'bed.x', error: 'outside' }])
    expect(parseServerErrors({ error: 'unauthorised' })).toEqual([])
  })
})

describe('readiness', () => {
  it('says how many things are missing', () => {
    const r: Readiness = { ready: false, zones_trusted: false, zone_floor: null, layout_measured: false, drill_days: 0, items: [], missing: ['a', 'b'] }
    expect(readinessLine(r)).toBe('Zones not trusted yet: 2 missing')
    expect(readinessLine({ ...r, ready: true, missing: [] })).toMatch(/^Zones trusted/)
  })
})

describe('honest zones in the UI', () => {
  const raw = {
    state: 'in_room', confidence: 0.95, motion: 0.1, activity: null, updated: 1, zones_trusted: false,
    zones: [{ id: 'desk', name: 'at the desk chair', p: 0.97, x: 0.5, y: 1.9, r: 0.4 }, { id: 'bed', name: 'on the bed', p: 0.03, x: 2.5, y: 1, r: 0.6 }],
  }
  it('an untrusted belief is "not sure where" and draws one room-wide zone', () => {
    const b = readBelief(raw)!
    expect(b.zonesTrusted).toBe(false)
    expect(beliefLabel(b)).toBe(NOT_SURE_WHERE)
    const z = shownZones(b)
    expect(z).toHaveLength(1)
    expect(z[0].name).toBe(NOT_SURE_WHERE)
    expect(z[0].r).toBeGreaterThan(1)
  })
  it('a trusted belief keeps its zones and names the top one', () => {
    const b = readBelief({ ...raw, zones_trusted: true })!
    expect(shownZones(b)).toHaveLength(2)
    expect(beliefLabel(b)).toBe('probably: at the desk chair · 97 %')
    const old: Belief = { ...b }
    delete old.zonesTrusted                         // an older hub: no field, zones as before
    expect(shownZones(old)).toHaveLength(2)
  })
  it('the learned card never shows desk / bed or 100 % from an untrained model', () => {
    const l = { state: 'desk', p: { desk: 1, bed: 0, room: 0, empty: 0, outside: 0 }, occupied_p: 1 }
    const v = learnedView(l, false)!
    expect(v.top).toBe('room')
    expect(v.rows.map((r) => r.id)).toEqual(['empty', 'outside', 'room'])
    expect(Math.max(...v.rows.map((r) => r.p), v.occupied)).toBeLessThanOrEqual(0.9)
    expect(learnedView(l, true)!.top).toBe('desk')
  })
})
