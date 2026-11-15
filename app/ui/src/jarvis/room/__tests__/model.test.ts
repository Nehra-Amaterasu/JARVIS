// A.J02: the Room model. The honesty rule is the test: a key's lamp follows the BOARD's report, never the saved state; a press
// is an ask; confirmed only after the board agrees; "asked, no report" after 6 s; a flagged channel needs two acts to turn ON.
import { describe, expect, it } from 'vitest'
import { FIXTURE_MODES, fixtureAway, fixtureEnergy, fixturePresence, fixtureRoom } from '../fixtures'
import { autoOffGate, awayGate, presenceGate } from '../gates'
import {
  ASK_WINDOW_MS, SLOTS, activeAt, arcPath, heavySummary, hhmm, inWindow, keySlots, lastFiredText, minutesOf, modeStrip, needsTwoActs, onCount, onNames,
  previewLine, ruleSpans, rulesFrom, sceneGuarded, scenePreview, slotIds, snapStep, type Rule,
} from '../model'

const NOW = 1_700_000_000_000
const live = () => fixtureRoom('live')

describe('the eight keys', () => {
  it('always draws eight slots; a wall box keeps its own order and a missing relay stays as an absent key', () => {
    const v = live()
    v.devices = v.devices.filter((d) => d.id !== 'light3')
    const slots = keySlots(v, {}, NOW)
    expect(slots).toHaveLength(SLOTS)
    expect(slots.map((s) => s.id)).toEqual(['light', 'fan', 'light2', 'light3', 'light4', 'light5', null, null])
    expect(slots[3]).toMatchObject({ id: 'light3', present: false, phase: 'absent', word: 'unavailable', lamp: 'planned' })
    expect(slots[6]).toMatchObject({ present: false, word: 'unavailable' })
  })

  it('a room that is not a wall box lists its own devices, then free slots', () => {
    const v = fixtureRoom('virtual')
    v.devices = v.devices.map((d) => ({ ...d, board: 'uno' as const }))
    expect(slotIds(v).slice(0, 3)).toEqual(['light', 'fan', null])
    expect(slotIds(null)).toEqual(Array(SLOTS).fill(null))
  })

  it('the lamp follows the board report, never the saved state', () => {
    const v = live()
    // the app saved "fan on" but the board reports off: the cap is not pressed and the word is the board's
    const fan = v.devices.find((d) => d.id === 'fan')!
    fan.state.on = true
    fan.hardware_on = false
    const k = keySlots(v, {}, NOW)[1]
    expect(k).toMatchObject({ reported: false, capOn: false, lamp: 'live', phase: 'steady' })
    expect(k.word).toBe('OFF · board')
  })

  it('no board report is WAITING, never LIVE; a virtual room is SIMULATED', () => {
    const off = keySlots(fixtureRoom('offline'), {}, NOW)
    expect(off.filter((s) => s.present).every((s) => s.lamp === 'waiting')).toBe(true)
    expect(off[0].word).toBe('no report, offline')
    const wired = live()
    expect(keySlots(wired, {}, NOW)[5]).toMatchObject({ reported: null, lamp: 'waiting', word: 'not on the board' })
    const virt = keySlots(fixtureRoom('virtual'), {}, NOW)
    expect(virt[0]).toMatchObject({ lamp: 'simulated', virtual: true })
  })

  it('a press is an ask: WAITING while the board is silent, FAULT "asked, no report" after 6 s', () => {
    const v = live()
    const asked = { fan: { want: true, at: NOW } }
    const early = keySlots(v, asked, NOW + 1000)[1]
    expect(early).toMatchObject({ phase: 'asked', lamp: 'waiting', capOn: false })
    expect(early.word).toBe('asked ON, waiting')
    const edge = keySlots(v, asked, NOW + ASK_WINDOW_MS - 1)[1]
    expect(edge.phase).toBe('asked')
    const late = keySlots(v, asked, NOW + ASK_WINDOW_MS)[1]
    expect(late).toMatchObject({ phase: 'unconfirmed', lamp: 'fault', word: 'asked, no report' })
  })

  it('confirmed only when the board itself reports the asked state, with the time of that report', () => {
    const v = live()
    const asked = { fan: { want: true, at: NOW } }
    // saved state on, board still off: not confirmed
    v.devices.find((d) => d.id === 'fan')!.state.on = true
    expect(keySlots(v, asked, NOW + 500)[1].phase).toBe('asked')
    // the board reports on
    v.devices.find((d) => d.id === 'fan')!.hardware_on = true
    const k = keySlots(v, asked, NOW + 800, { fan: NOW + 700 })[1]
    expect(k).toMatchObject({ phase: 'confirmed', lamp: 'live', capOn: true })
    expect(k.word).toMatch(/^ON, confirmed by board \d\d:\d\d:\d\d$/)
  })

  it('counts and names only what the board reports on', () => {
    const slots = keySlots(live(), {}, NOW)
    expect(onCount(slots)).toBe(2)
    expect(onNames(slots)).toEqual(['Tube light', 'Cove warm'])
    expect(onCount(keySlots(fixtureRoom('offline'), {}, NOW))).toBe(0)
  })
})

describe('the heavy-load guard', () => {
  it('two acts only for a flagged channel turning ON; OFF and unflagged keys stay one press', () => {
    expect(needsTwoActs(true, true)).toBe(true)
    expect(needsTwoActs(true, false)).toBe(false)
    expect(needsTwoActs(false, true)).toBe(false)
    expect(needsTwoActs(false, false)).toBe(false)
    expect(heavySummary('Water Heater')).toBe('turns ON: water heater, mains')
  })

  it('a mode cannot skip the guard: the flagged channels it would turn ON are named', () => {
    const slots = keySlots(live(), {}, NOW)
    const relax = FIXTURE_MODES.find((m) => m.id === 'relaxation')!
    expect(sceneGuarded(relax, slots, { light3: true }).map((s) => s.id)).toEqual(['light3'])
    // a flagged channel already on, or a mode that turns it off, needs no cover
    expect(sceneGuarded(relax, slots, { light2: true })).toEqual([])
    expect(sceneGuarded(FIXTURE_MODES.find((m) => m.id === 'all_off')!, slots, { light3: true })).toEqual([])
    expect(sceneGuarded(null, slots, { light3: true })).toEqual([])
  })

  it('the dial previews the targets of the channels a mode names, and nothing else', () => {
    const slots = keySlots(live(), {}, NOW)
    const p = scenePreview(FIXTURE_MODES[0], slots)
    expect(p).toMatchObject({ light: true, fan: true, light2: false })
    expect(Object.keys(scenePreview(null, slots))).toEqual([])
    expect(modeStrip(FIXTURE_MODES[0], slotIds(live()))).toBe('# # . . . . - -')
  })
})

describe('the 24 hour ring', () => {
  const quiet: Rule = { id: 'q', label: 'Quiet hours', from: '23:00', to: '07:00', kind: 'quiet', state: 'live', holds: 'no auto-on' }
  it('reads times, wraps midnight, snaps to quarter hours', () => {
    expect(minutesOf('07:30')).toBe(450)
    expect(minutesOf('24:00')).toBeNull()
    expect(minutesOf('7')).toBeNull()
    expect(hhmm(-15)).toBe('23:45')
    expect(ruleSpans(quiet)).toEqual([[1380, 1440], [0, 420]])
    expect(ruleSpans({ from: '08:00', to: '08:00' })).toEqual([])
    expect(activeAt(quiet, 23 * 60 + 30)).toBe(true)
    expect(activeAt(quiet, 12 * 60)).toBe(false)
    expect(snapStep(22 * 60 + 7)).toBe(22 * 60)
    expect(snapStep(23 * 60 + 45, 1)).toBe(0)
    expect(snapStep(0, -1)).toBe(23 * 60 + 45)
  })

  it('the preview line says what the rules would hold, and says when none does', () => {
    expect(previewLine([quiet], 22 * 60 + 0)).toBe('PREVIEW 22:00: no rule holds')
    expect(previewLine([quiet], 23 * 60 + 15)).toBe('PREVIEW 23:15: quiet hours no auto-on')
    expect(previewLine([], 600)).toContain('no rule holds')
  })

  it('draws a full circle as two half arcs and a span as one', () => {
    expect(arcPath(140, 140, 100, 0, 1440).match(/A/g)).toHaveLength(2)
    expect(arcPath(140, 140, 100, 0, 360)).toMatch(/^M 140.00 40.00 A 100 100 0 0 1 /)
  })

  it('only the windows the app reports become rules: no channel schedule is invented', () => {
    expect(rulesFrom({})).toEqual([])
    const r = rulesFrom({ presence: fixturePresence(), energy: fixtureEnergy(true) })
    expect(r.map((x) => [x.id, x.from, x.to, x.state])).toEqual([['presence.quiet', '23:00', '07:00', 'live'], ['energy.night', '23:30', '06:30', 'live']])
    expect(rulesFrom({ presence: fixturePresence(false) })[0].state).toBe('waiting')
  })

  it('inWindow wraps midnight and refuses unreadable times', () => {
    expect(inWindow(new Date(2026, 10, 15, 23, 30), '23:00', '07:00')).toBe(true)
    expect(inWindow(new Date(2026, 10, 15, 8, 0), '23:00', '07:00')).toBe(false)
    expect(inWindow(new Date(2026, 10, 15, 8, 0), 'x', '07:00')).toBeNull()
  })
})

describe('the rule gates', () => {
  const noon = new Date(2026, 10, 15, 12, 0)
  it('a route that did not answer draws a hollow gate with the reason, never an invented firing', () => {
    for (const g of [presenceGate(null, noon), autoOffGate(null, noon)]) {
      expect(g.inputs).toEqual([])
      expect(g.state).toBe('waiting')
      expect(lastFiredText(g)).toBe('not fired yet')
    }
    expect(awayGate(null, [])).toMatchObject({ state: 'planned', inputs: [] })
  })

  it('the presence gate fires only on an acted decision; quiet hours is a NOT input read from the clock', () => {
    const g = presenceGate(fixturePresence(), noon)
    expect(g.lastFired?.text).toMatch(/keyboard input/)
    expect(g.inputs.find((i) => i.id === 'quiet')).toMatchObject({ not: true, holds: true, state: 'live' })
    expect(presenceGate(fixturePresence(), new Date(2026, 10, 15, 23, 30)).inputs.find((i) => i.id === 'quiet')?.holds).toBe(false)
    const skipped = fixturePresence()
    skipped.decision = { decision: 'skipped', reason: 'a switch was used', at: 5, guard: 'manual' } as typeof skipped.decision
    expect(presenceGate(skipped, noon).lastFired).toBeNull()
    expect(presenceGate(skipped, noon).inputs.find((i) => i.id === 'manual')?.holds).toBe(false)
    expect(presenceGate(fixturePresence(false), noon).state).toBe('waiting')
  })

  it('the auto-off gate shows the last real auto-off and no energy figure', () => {
    const e = fixtureEnergy(true)
    expect(autoOffGate(e, noon).state).toBe('live')
    e.waste.nudges = [{ id: 'n1', ts: 1_700_000_100, kind: 'empty_room', room: 'room', circuits: [], sim: false, text: 'Switched the light off.', spoken: true, spoken_at: null, status: 'auto_off', night: false, auto_off: { will_auto_off: false, targets: [], why_not: [] } }]
    expect(autoOffGate(e, noon).lastFired?.text).toBe('Switched the light off.')
    expect(JSON.stringify(autoOffGate(e, noon))).not.toMatch(/kwh|rupee|₹/i)
  })

  it('the away gate follows the phase: armed by a real sensor is LIVE, by a simulation SIMULATED, disarmed WAITING', () => {
    expect(awayGate(fixtureAway(false), []).state).toBe('waiting')
    expect(awayGate(fixtureAway(true), []).state).toBe('simulated')
    const hw = fixtureAway(true)
    hw.sensor = { source: 'hardware' }
    expect(awayGate(hw, []).state).toBe('live')
    expect(awayGate(fixtureAway(true), []).lastFired?.text).toMatch(/^armed /)
  })
})
