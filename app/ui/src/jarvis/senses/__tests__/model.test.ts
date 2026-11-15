// The pure parts of Senses (A.J03): the terrain geometry, the arc's no-digit rule, the tape's honest blanks, the rings and
// the copy lint. No DOM, no socket, no clock: every number is computed from what the test hands in.
import { describe, expect, it } from 'vitest'
import {
  COLS, ROWS, STAGE_H, STAGE_W, TAPE_COLS, TapeStore, arcModel, bandOf, bandView, channelLevels, colAt, copyProblems, cursorText, hollowMound,
  isoOf, linkVitals, narration, planFit, ridgeGeometry, scenarioWord, sensorLamp, sourceOf, sourceReading, tapeCounts, tapeHover,
  teachRings, terrainRows, vitalText, zoneRing, FORBIDDEN_ART, SENSES_ART,
} from '../model'
import { fixtureAmps, fixtureFrameMsg, fixtureFrames, fixtureReadiness } from '../fixtures'

describe('source and lamp', () => {
  it('only the board is live; a simulation or a replay is simulated; nothing else is a source', () => {
    expect(sourceOf('hardware')).toBe('live')
    expect(sourceOf('simulation')).toBe('simulated')
    expect(sourceOf('replay')).toBe('simulated')
    expect(sourceOf('unknown')).toBe('none')
    expect(sourceOf(undefined)).toBe('none')
  })
  it('a closed socket is FAULT, a quiet hub WAITING, and a hub error FAULT with its reason', () => {
    expect(sourceReading('none', false).state).toBe('fault')
    expect(sourceReading('none', true).state).toBe('waiting')
    expect(sourceReading('live', true, 'port busy')).toMatchObject({ state: 'fault', reason: 'port busy' })
    expect(sourceReading('simulated', true).state).toBe('simulated')
  })
  it('names the scenarios in plain words and keeps unknown ids', () => {
    expect(scenarioWord('empty')).toBe('quiet')
    expect(scenarioWord('walk')).toBe('walk')
    expect(scenarioWord('other')).toBe('other')
  })
  it('a sensor row is live only when it says live', () => {
    expect(sensorLamp('live')).toBe('live')
    expect(sensorLamp('replay')).toBe('simulated')
    expect(sensorLamp('silent')).toBe('waiting')
    expect(sensorLamp('absent')).toBe('waiting')
    expect(sensorLamp(undefined)).toBe('waiting')
  })
})

describe('the terrain', () => {
  it('normalises each column across the rows kept, to 0..1, and pads nothing', () => {
    const rows = terrainRows(fixtureFrames(10))
    expect(rows).toHaveLength(10)
    expect(rows[0]).toHaveLength(COLS)
    for (let c = 0; c < COLS; c++) expect(Math.max(...rows.map((r) => r[c]))).toBeCloseTo(1, 6)
    expect(terrainRows([{ t: 0, amps: [] }])[0].every((v) => v === 0)).toBe(true)
  })
  it('keeps at most 24 rows and the latest ones', () => {
    expect(terrainRows(fixtureFrames(40))).toHaveLength(ROWS)
  })
  it('puts the latest row in front (largest depth, widest span) and every point inside the 720 x 360 canvas', () => {
    const g = ridgeGeometry(terrainRows(fixtureFrames()))
    expect(g).toHaveLength(ROWS)
    expect(g.filter((r) => r.front)).toHaveLength(1)
    const front = g[g.length - 1]
    const back = g[0]
    expect(front.depth).toBe(ROWS - 1)
    expect(front.pts[COLS - 1][0] - front.pts[0][0]).toBeGreaterThan(back.pts[COLS - 1][0] - back.pts[0][0])
    expect(front.alpha).toBeGreaterThan(back.alpha)
    for (const r of g) {
      for (const [x, y] of r.pts) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(STAGE_W)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(STAGE_H)
      }
    }
  })
  it('with fewer rows than 24 the rows keep their place at the front', () => {
    const g = ridgeGeometry(terrainRows(fixtureFrames(5)))
    expect(g.map((r) => r.depth)).toEqual([19, 20, 21, 22, 23])
  })
  it('the placeholder mound is fixed: the same shape every time', () => {
    expect(hollowMound()).toEqual(hollowMound())
    expect(hollowMound().length).toBe(7)
  })
  it('maps an x to a subcarrier and reads the cursor aloud', () => {
    expect(colAt(0)).toBe(0)
    expect(colAt(STAGE_W)).toBe(COLS - 1)
    expect(colAt(STAGE_W / 2)).toBe(25)
    expect(cursorText(fixtureFrames(3), 4)).toMatch(/^subcarrier 5 of 51, amplitude \d/)
    expect(cursorText([], 4)).toBe('subcarrier 5 of 51, no amplitude yet')
  })
})

describe('the probability arc', () => {
  it('bands the probability on the belief thresholds', () => {
    expect(bandOf(0.1)).toBe('low')
    expect(bandOf(0.5)).toBe('mid')
    expect(bandOf(0.9)).toBe('high')
    expect(bandOf(null)).toBeNull()
    expect(bandOf(Number.NaN)).toBeNull()
  })
  it('before the held-out check: a band, the word PREDICTING and never a digit', () => {
    const m = arcModel({ band: 'mid', p: 0.52, trusted: false, drillDays: 3, gateDays: 7 })
    expect(m.word).toBe('PREDICTING')
    expect(m.digits).toBeNull()
    expect(m.needle).toBe(120)
    expect(m.provenance).toBe('signal estimate, 3 of 7 drill days')
    expect(JSON.stringify(m)).not.toMatch(/\d\d? ?%/)
  })
  it('after it: the number, labelled as a model estimate, and the needle at the real value', () => {
    const m = arcModel({ band: 'high', p: 0.74, trusted: true })
    expect(m.digits).toBe('74 %')
    expect(m.needle).toBeCloseTo(0.74 * 240, 6)
    expect(m.provenance).toBe('model estimate, held-out day passed')
  })
  it('with no band there is no needle and no estimate', () => {
    const m = arcModel({ band: null, trusted: true, p: 0.9 })
    expect(m.needle).toBeNull()
    expect(m.digits).toBeNull()
    expect(m.word).toBe('NO SIGNAL')
  })
})

describe('the motion tape', () => {
  const noon = new Date(2026, 10, 15, 12, 0, 0).getTime()
  it('records seen and paused minutes; a pause never overwrites motion seen', () => {
    const t = new TapeStore()
    t.record(noon, 'seen')
    t.record(noon + 1000, 'paused')
    t.record(noon + 6 * 60000, 'paused')
    const today = t.week(noon)[6]
    expect(today.cells[144]).toBe('seen')
    expect(today.cells[145]).toBe('paused')
    expect(tapeCounts(t.week(noon))).toEqual({ seen: 1, paused: 1 })
  })
  it('seven days of 288 columns, and blank is the absence of a record', () => {
    const w = new TapeStore().week(noon)
    expect(w).toHaveLength(7)
    expect(w.every((d) => d.cells.length === TAPE_COLS && d.cells.every((c) => c === 'none'))).toBe(true)
  })
  it('reads a column aloud in the spec form', () => {
    const t = new TapeStore()
    t.record(noon, 'seen')
    const d = t.week(noon)[6]
    expect(tapeHover(d.start, 144, d.cells[144])).toBe('Sun 12:00 to 12:05, motion seen')
    expect(tapeHover(d.start, 5, 'none')).toBe('Sun 00:25 to 00:30, nothing seen')
    expect(tapeHover(d.start, 5, 'paused')).toMatch(/sensing paused by you$/)
  })
  it('survives a round trip through JSON and drops what is older than a week', () => {
    const t = new TapeStore()
    t.record(noon, 'seen')
    t.record(noon - 9 * 86400000, 'seen')
    const o = t.toJSON(noon)
    expect(Object.keys(o)).toHaveLength(1)
    const u = new TapeStore()
    u.load(o)
    u.load({ 'bad key': 'm', '1:2': 'x' })
    expect(u.size).toBe(1)
  })
})

describe('the link row and the matrix', () => {
  it('a vital is a number with a unit or the em dash, never a made-up value', () => {
    expect(vitalText(null, 1, '%')).toBe('--')
    expect(vitalText(0.43, 1, '%')).toBe('0.4 %')
    const v = linkVitals(fixtureFrameMsg(), { loss_ratio: 0.004 }, 1000, 3500)
    expect(v).toEqual({ fps: 10, lossPct: 0.4, ageS: 2.5 })
    expect(linkVitals(null, undefined, null, 5)).toEqual({ fps: null, lossPct: null, ageS: null })
  })
  it('quarters a dot from 0 to 4 by amplitude, 51 dots', () => {
    const l = channelLevels(fixtureAmps(3))
    expect(l).toHaveLength(COLS)
    expect(Math.max(...l)).toBe(4)
    expect(Math.min(...l)).toBeGreaterThanOrEqual(0)
    expect(channelLevels([]).every((v) => v === 0)).toBe(true)
  })
})

describe('the floor plan', () => {
  it('fits the room in the box and projects at 2:1', () => {
    const fit = planFit({ width: 4.2, depth: 3.4 }, 486, 196)
    expect(fit.k).toBeGreaterThan(0)
    const a = isoOf(0, 0, fit.k, fit.ox, fit.oy)
    const b = isoOf(4.2, 3.4, fit.k, fit.ox, fit.oy)
    expect(a.y).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeLessThanOrEqual(196)
    expect(planFit(null, 486, 196).k).toBeGreaterThan(0)
  })
  it('a zone ring is a centre and a radius, and a degenerate polygon is none', () => {
    expect(zoneRing([[0, 0], [2, 0], [2, 2], [0, 2]])).toMatchObject({ x: 1, y: 1 })
    expect(zoneRing([[0, 0], [1, 1]])).toBeNull()
  })
})

describe('the teach rings', () => {
  it('count real parts: the held-out ring is its own and only the gate lights it', () => {
    const r = teachRings(fixtureReadiness('partial'))
    expect(r.map((x) => [x.id, x.fill, x.of])).toEqual([['room', 0, 1], ['quiet', 1, 2], ['drill', 3, 7], ['heldout', 0, 1]])
    expect(r.every((x) => !x.done)).toBe(true)
    const all = teachRings(fixtureReadiness('ready'))
    expect(all.every((x) => x.done)).toBe(true)
  })
  it('with no readiness every ring is empty and none is done', () => {
    expect(teachRings(null).every((x) => x.fill === 0 && !x.done)).toBe(true)
  })
})

describe('the narration and the lint', () => {
  it('states a score against a threshold, with a Simulated lead for generated frames', () => {
    const f = fixtureFrameMsg()
    expect(narration(f, 'simulated')).toBe('Simulated: Motion score 3.2x against a threshold of 1.8x: movement seen on this link.')
    expect(narration(null, 'none')).toBe('No frames are arriving, so there is nothing to read.')
    const calm = { ...f, motion_detail: { ...f.motion_detail, score: 1 } }
    expect(narration(calm, 'live')).toMatch(/no movement seen on this link/)
    expect(narration({ ...f, motion_detail: { ...f.motion_detail, score: null } }, 'live')).toMatch(/warming up/)
  })
  it('every narration the template can print passes the lint', () => {
    const f = fixtureFrameMsg()
    for (const s of ['live', 'simulated', 'none'] as const) expect(copyProblems(narration(f, s))).toEqual([])
  })
  it('the lint catches present, absent, occupied and the empty-room claim', () => {
    expect(copyProblems('Someone is present')).toEqual(['present'])
    expect(copyProblems('the Empty Room and an absent person')).toEqual(['empty room', 'absent'])
    expect(copyProblems('Blank means nothing was seen, not that no one was there.')).toEqual([])
  })
  it('the band meter is calibrated against its threshold or against noise, and says which', () => {
    expect(bandView({ energy: 2, threshold: 1.6, ratio: 1.5, recent: 1, start_gate: 1.6 })).toMatchObject({ calibrated: true, gatePct: 33.3, text: '1.50x its threshold' })
    expect(bandView({ energy: 2, threshold: null, ratio: null, recent: 1, start_gate: 1.6 })?.text).toBe('2.0x noise, uncalibrated')
    expect(bandView(null)).toBeNull()
  })
  it('the art this section may draw has no eye, face, body or pose in its id', () => {
    for (const id of SENSES_ART) expect(FORBIDDEN_ART.test(id)).toBe(false)
    expect(FORBIDDEN_ART.test('art.senses.face')).toBe(true)
    expect(FORBIDDEN_ART.test('art.core.eye')).toBe(true)
  })
})
