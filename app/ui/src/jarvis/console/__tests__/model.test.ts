// The Console's pure rules (A.J05): the health rows and their honest states, the GPU model, the job board's fraction rule,
// the closed verb list and its Tab completion, the events filter grammar, the route plates, the integrations' lamps and the
// flash gate. Every case names the rule it pins; none needs a network or a clock.
import { describe, expect, it } from 'vitest'
import type { BusEvent, Vitals } from '../../../lib/api'
import type { BoardView, JobView } from '../../../lib/board'
import type { LatencyView } from '../../../lib/settings'
import type { PlannedEntry } from '../../../shared/planned/types'
import {
  VERBS, VERB_NAMES, applyFilter, boardJobSpec, completeVerb, densityBuckets, eventLamp, flashGate, gpuModel, hearingRow, healthRows,
  integrationCounts, integrationReading, jobBoard, parseFilter, plateLine, plateSpoken, replySeries, routePlates, sourceCounts, stewardRow, tagsOf, timingRow, verbDef, wakeRow,
} from '../model'
import { BOARD_USB, BOARD_WIFI, EVENTS, FIXED_NOW, LAT_FAULT, LAT_OFF, LAT_ON, VITALS_NONE, VITALS_ON } from '../fixtures'

const crewOk = { status: 'ok' as const, view: { agents: [{ id: 'steward', name: 'Steward', role: '', state: 'idle' as const, summary: 'fine', data: {}, health: { runs: 1, errors: 0, last_error: null, avg_ms: 1, last_tick: FIXED_NOW - 20, cadence_s: 60 } }], events: [] } }

describe('the hearing row (S1)', () => {
  it('is LIVE only when the core is awake in voice mode; asleep is WAITING, never FAULT', () => {
    expect(hearingRow(LAT_ON).reading.state).toBe('live')
    expect(hearingRow(LAT_OFF).reading).toMatchObject({ state: 'waiting', reason: expect.stringContaining('asleep') })
    expect(hearingRow(null).reading.state).toBe('waiting')
  })
  it('a stored error is FAULT with the reason, in words', () => {
    expect(hearingRow(LAT_FAULT).reading).toMatchObject({ state: 'fault', reason: expect.stringContaining('out of GPU memory') })
  })
  it('text mode and booting say why he cannot hear', () => {
    const text: LatencyView = { ...LAT_ON, core: { ...LAT_ON.core, mode: 'text' } }
    const boot: LatencyView = { ...LAT_ON, core: { ...LAT_ON.core, state: 'booting' } }
    expect(hearingRow(text).reading).toMatchObject({ state: 'waiting', reason: expect.stringContaining('text mode') })
    expect(hearingRow(boot).reading).toMatchObject({ state: 'waiting', reason: 'booting' })
  })
})

describe('the wake and timing rows', () => {
  it('no wake is WAITING with its reason; a wake shows its score, the threshold and its age', () => {
    expect(wakeRow(LAT_OFF, FIXED_NOW).reading).toMatchObject({ state: 'waiting', reason: 'no wake since the app opened' })
    expect(wakeRow(LAT_ON, FIXED_NOW).text).toContain('score 0.62')
    expect(wakeRow(LAT_ON, FIXED_NOW).text).toContain('12 s ago')
  })
  it('a wake that ended in an error is FAULT', () => {
    const l: LatencyView = { ...LAT_ON, live: { ...LAT_ON.live, wakes: [{ ...LAT_ON.live.wakes[0], outcome: 'error', error: 'the mic closed' }] } }
    expect(wakeRow(l, FIXED_NOW).reading).toMatchObject({ state: 'fault', reason: 'the mic closed' })
  })
  it('timings print a median only from a real summary; none is WAITING, not a zero', () => {
    expect(timingRow(LAT_ON).text).toBe('median heard 0.7 s, first word 1.8 s, full 3.4 s, p90 3.1 s')
    expect(timingRow(LAT_OFF)).toMatchObject({ text: 'median: none yet', reading: { state: 'waiting' } })
  })
})

describe('the GPU model', () => {
  it('is hollow with no reading: no total, no fraction, no invented 6 GB', () => {
    const m = gpuModel(VITALS_NONE)
    expect(m).toMatchObject({ fraction: null, totalMb: null, usedMb: null })
    expect(m.reading.state).toBe('waiting')
    expect(gpuModel(null).reading.reason).toBe('no report')
  })
  it('reads used over total and splits the part the models hold', () => {
    const m = gpuModel(VITALS_ON)
    expect(m.fraction).toBeCloseTo(3920 / 6144, 5)
    expect(m.llmMb).toBe(3400)
    expect(m.otherMb).toBe(520)
    expect(m.reading.state).toBe('live')
  })
  it('the models never hold more than the GPU reports in use', () => {
    const v: Vitals = { ...VITALS_ON, gpu: { ...VITALS_ON.gpu!, mem_used_mb: 1000 } }
    expect(gpuModel(v).llmMb).toBe(1000)
  })
})

describe('the steward row', () => {
  it('an absent staff is WAITING, an unreachable one is FAULT with the message, an errored steward is FAULT', () => {
    expect(stewardRow({ status: 'absent' }, FIXED_NOW).reading).toMatchObject({ state: 'waiting' })
    expect(stewardRow({ status: 'error', message: 'refused' }, FIXED_NOW).reading).toMatchObject({ state: 'fault', reason: 'refused' })
    const bad = { ...crewOk, view: { ...crewOk.view, agents: [{ ...crewOk.view.agents[0], state: 'error' as const, health: { ...crewOk.view.agents[0].health, last_error: 'no brain' } }] } }
    expect(stewardRow(bad, FIXED_NOW).reading).toMatchObject({ state: 'fault', reason: 'no brain' })
  })
  it('a check older than three beats is WAITING with its age, a fresh one is LIVE', () => {
    expect(stewardRow(crewOk, FIXED_NOW).reading.state).toBe('live')
    const stale = { ...crewOk, view: { ...crewOk.view, agents: [{ ...crewOk.view.agents[0], health: { ...crewOk.view.agents[0].health, last_tick: FIXED_NOW - 900 } }] } }
    expect(stewardRow(stale, FIXED_NOW).reading.state).toBe('waiting')
  })
})

describe('healthRows', () => {
  const base = { online: true, lat: LAT_ON, crew: crewOk, vitals: VITALS_ON, now: FIXED_NOW }
  it('is seven rows with the spec tags, in reading order', () => {
    expect(healthRows(base).map((r) => r.tag)).toEqual(['HEA', 'WAK', 'TIM', 'BRN', 'GPU', 'STW', 'APP'])
  })
  it('first run: every row WAITING except the server line', () => {
    const rows = healthRows({ online: true, lat: LAT_OFF, crew: { status: 'absent' }, vitals: VITALS_NONE, now: FIXED_NOW })
    expect(rows.filter((r) => r.reading.state === 'waiting').map((r) => r.tag)).toEqual(['HEA', 'WAK', 'TIM', 'BRN', 'GPU', 'STW'])
  })
  it('a server that does not answer is [APP] server not answering, FAULT', () => {
    const app = healthRows({ ...base, online: false, lat: null, vitals: null }).at(-1)!
    expect(app).toMatchObject({ tag: 'APP', text: 'server not answering', reading: { state: 'fault' } })
    expect(healthRows({ ...base, online: null }).at(-1)!.reading.state).toBe('waiting')
  })
  it('a simulated input turns every LIVE into SIMULATED and leaves the rest', () => {
    const rows = healthRows({ ...base, simulated: true })
    expect(rows.some((r) => r.reading.state === 'live')).toBe(false)
    expect(rows.filter((r) => r.reading.state === 'simulated').length).toBe(7)
    expect(healthRows({ online: true, lat: LAT_FAULT, crew: null, vitals: null, now: FIXED_NOW, simulated: true })[0].reading.state).toBe('fault')
  })
})

describe('the reply series for the ridges', () => {
  it('is oldest first and keeps a missing value as a gap (NaN), never a zero', () => {
    const l: LatencyView = { ...LAT_ON, recent: [{ ts: 3, spoken: true, heard: 1, first_word: 3, full: 4, first_token: 1 }, { ts: 2, spoken: true, heard: 1, first_word: null, full: 4, first_token: 1 }, { ts: 1, spoken: true, heard: 1, first_word: 1, full: 2, first_token: 1 }] }
    const s = replySeries(l, 'first_word')
    expect(s[0]).toBe(1)
    expect(Number.isNaN(s[1])).toBe(true)
    expect(s[2]).toBe(3)
    expect(replySeries(null, 'full')).toEqual([])
  })
})

describe('the job board (a bar fills only to a reported fraction)', () => {
  const job = (over: Partial<JobView>): JobView => ({ id: 'j', kind: 'compile', detail: 'firmware', state: 'running', phase: 'compiling', pct: 40, lines: [], started_at: 0, finished_at: null, seconds: 0, result: {}, cmd: [], ...over })
  it('a reported percentage is a fraction; a null one is hollow', () => {
    expect(boardJobSpec(job({ pct: 40 }))).toMatchObject({ state: 'live', fraction: 0.4 })
    expect(boardJobSpec(job({ pct: null }))).toMatchObject({ state: 'hollow', fraction: undefined })
    expect(boardJobSpec(job({ pct: 140 }))).toMatchObject({ state: 'hollow', fraction: undefined })
  })
  it('finished is done and full; failed is FAULT with its reason', () => {
    expect(boardJobSpec(job({ state: 'ok', pct: 100 }))).toMatchObject({ state: 'done', fraction: 1 })
    expect(boardJobSpec(job({ state: 'failed', result: { error: 'no port' } }))).toMatchObject({ state: 'fault', reason: 'no port' })
    expect(boardJobSpec(null)).toBeNull()
  })
  it('waking the core is a hollow row (the boot reports a step, never a fraction)', () => {
    const rows = jobBoard({ bootStep: 'loading whisper', booting: true, board: null, local: [] })
    expect(rows).toEqual([expect.objectContaining({ id: 'core:boot', state: 'hollow', reason: 'loading whisper' })])
    expect(rows[0].fraction).toBeUndefined()
  })
})

describe('the closed verb list', () => {
  it('is exactly the eight verbs of the spec, and only the three that change something are heavy', () => {
    expect(VERB_NAMES).toEqual(['status', 'test hearing', 'restart brain', 'free gpu', 'export memory', 'jobs', 'plan', 'help'])
    expect(VERBS.filter((v) => v.heavy).map((v) => v.verb)).toEqual(['restart brain', 'free gpu', 'export memory'])
    expect(verbDef('rm')).toBeUndefined()
  })
  it('Tab completes a unique prefix or the shared start, and never invents a verb', () => {
    expect(completeVerb('rest')).toBe('restart brain')
    expect(completeVerb('t')).toBe('test hearing')
    expect(completeVerb('re')).toBe('restart brain')
    expect(completeVerb('f')).toBe('free gpu')
    expect(completeVerb('xyz')).toBe('xyz')
    expect(completeVerb('')).toBe('')
    expect(completeVerb('e')).toBe('export memory')
  })
})

describe('the events filter grammar', () => {
  const now = FIXED_NOW
  it('parses tags, excludes and since:', () => {
    expect(parseFilter('core !sim since:1h')).toEqual({ include: ['core'], exclude: ['sim'], sinceS: 3600, problems: [] })
    expect(parseFilter('Core  SINCE:30m').sinceS).toBe(1800)
    expect(parseFilter('since:2d').sinceS).toBe(172800)
    expect(parseFilter('').include).toEqual([])
  })
  it('a bad since: is named, not guessed', () => {
    expect(parseFilter('since:soon').problems[0]).toContain('try since:30m')
    expect(parseFilter('since:1h').problems).toEqual([])
  })
  it('includes by source or kind, excludes the simulated, limits by age', () => {
    expect(applyFilter(EVENTS, parseFilter('core'), now).every((e) => e.source === 'core')).toBe(true)
    const noSim = applyFilter(EVENTS, parseFilter('!sim'), now)
    expect(noSim.some((e) => e.sim)).toBe(false)
    expect(noSim.length).toBe(EVENTS.filter((e) => !e.sim).length)
    expect(applyFilter(EVENTS, parseFilter('since:10m'), now).every((e) => now - e.ts <= 600)).toBe(true)
    expect(applyFilter(EVENTS, parseFilter('core !sim since:1h'), now).length).toBeGreaterThan(0)
    expect(applyFilter(EVENTS, parseFilter('core limbs'), now)).toEqual([]) // every word must match
  })
  it('tags an error as fault and a simulated line as sim; the lamp follows', () => {
    const e = { source: 'core', kind: 'error', sim: false } as BusEvent
    expect(tagsOf(e)).toEqual(['core', 'error', 'fault'])
    expect(eventLamp(e)).toBe('fault')
    expect(eventLamp({ kind: 'note', sim: true })).toBe('simulated')
    expect(eventLamp({ kind: 'ready' })).toBe('live')
  })
  it('counts by source, most frequent first, ties by name', () => {
    expect(sourceCounts(EVENTS)[0]).toEqual({ source: 'core', n: 5 })
  })
  it('the density trace needs two events and a span; otherwise there is nothing honest to draw', () => {
    expect(densityBuckets([], FIXED_NOW)).toBeNull()
    expect(densityBuckets([{ ts: FIXED_NOW - 5 }], FIXED_NOW)).toBeNull()
    const d = densityBuckets(EVENTS, FIXED_NOW, 12)!
    expect(d.length).toBe(12)
    expect(d.reduce((a, b) => a + b, 0)).toBe(EVENTS.length)
  })
})

describe('the route plates', () => {
  const e = (id: string, over: Partial<PlannedEntry> = {}): PlannedEntry => ({ id, product: 'jarvis', home: 'console.crew', label: id, pattern: 'coming', line: 'a line of at least fifteen characters', needs: 'x', blocker: 'build', since: '2026-11-12', reviewBy: '2027-02-10', owner: 'ui-chat', ...over })
  it('built is passed, built-not-verified is WAITING, the rest is PLANNED, in registry order', () => {
    const p = routePlates([e('a', { built: true }), e('b', { state: 'unverified' }), e('c')])
    expect(p.map((x) => x.state)).toEqual(['passed', 'waiting', 'planned'])
    expect(p.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('a plate prints a complete short phrase: the first sentence when short, else the state phrase, never a cut sentence', () => {
    expect(plateLine('Deleting everything under one heading in one step is not built. Delete items one at a time for now.', 'planned')).toBe('Not built yet.')
    expect(plateLine('Starting a track by name is not built.', 'planned')).toBe('Starting a track by name is not built.')
    expect(plateLine('The local library panel is built and not verified yet. It stays out until a check passes.', 'waiting')).toBe('Built, not verified yet.')
    expect(plateLine('A short note without a stop', 'passed')).toBe('A short note without a stop')
    expect(plateLine('x'.repeat(80), 'passed')).toBe('Built, with a note.')
    // the limit is inclusive: 48 characters print, 49 do not
    expect(plateLine('a'.repeat(47) + '.', 'planned')).toBe('a'.repeat(47) + '.')
    expect(plateLine('a'.repeat(48) + '.', 'planned')).toBe('Not built yet.')
    // nothing to print, or only a fragment before the first stop: the state phrase, never an empty or four-letter line
    expect(plateLine('', 'planned')).toBe('Not built yet.')
    expect(plateLine('   ', 'waiting')).toBe('Built, not verified yet.')
    expect(plateLine('e.g. a second link is not built.', 'planned')).toBe('Not built yet.')
    // a stop inside a number is not the end of a sentence
    expect(plateLine('Version 1.5 is built.', 'passed')).toBe('Version 1.5 is built.')
    expect(plateLine('  Padded line is built.  ', 'passed')).toBe('Padded line is built.')
  })
  it('the accessible name always contains the printed phrase, and the whole line', () => {
    const long = 'Deleting everything under one heading in one step is not built. Delete items one at a time for now.'
    expect(plateSpoken(long, 'planned')).toBe('Not built yet. ' + long)
    expect(plateSpoken('Starting a track by name is not built.', 'planned')).toBe('Starting a track by name is not built.')
    for (const [line, state] of [[long, 'planned'], ['Short line here.', 'passed'], ['', 'waiting']] as const) expect(plateSpoken(line, state)).toContain(plateLine(line, state))
  })
  it('caps the route and keeps nothing it was not given', () => {
    expect(routePlates(Array.from({ length: 20 }, (_, i) => e(`p${i}`)), 14)).toHaveLength(14)
    expect(routePlates([])).toEqual([])
  })
})

describe('the integrations', () => {
  it('each status has one meaning: connected LIVE, installed and available WAITING, missing FAULT, planned PLANNED', () => {
    const i = (status: 'connected' | 'installed' | 'available' | 'missing' | 'planned') => ({ id: 'x', group: 'g', name: 'X', status, detail: '', next: null })
    expect(integrationReading(i('connected')).state).toBe('live')
    expect(integrationReading(i('installed')).state).toBe('waiting')
    expect(integrationReading(i('available')).state).toBe('waiting')
    expect(integrationReading(i('missing'))).toMatchObject({ state: 'fault', reason: 'not found' })
    expect(integrationReading(i('planned')).state).toBe('planned')
  })
  it('counts every status, and a null list counts zero', () => {
    expect(integrationCounts(null)).toEqual({ connected: 0, installed: 0, available: 0, missing: 0, planned: 0 })
  })
})

describe('the flash gate (firmware never offers a flash while the app holds the port)', () => {
  it('a USB link, a hub in hardware mode on a port, or a named hold each close it, with the port in the reason', () => {
    expect(flashGate(BOARD_USB)).toMatchObject({ allowed: false, reason: expect.stringContaining('COM-FIX') })
    const hub = { ...BOARD_WIFI, hub: { ...BOARD_WIFI.hub, port: 'COM-X' } } as BoardView
    expect(flashGate(hub).allowed).toBe(false)
    const hold = { ...BOARD_WIFI, hub: { ...BOARD_WIFI.hub, hold: 'a flash' } } as BoardView
    expect(flashGate(hold).allowed).toBe(false)
  })
  it('the Wi-Fi link with no held port is open, and no board reading is closed', () => {
    expect(flashGate(BOARD_WIFI)).toEqual({ allowed: true, reason: '' })
    expect(flashGate(null).allowed).toBe(false)
  })
})
