// The Core model's honesty rules (A.J01, spec 20.9.1), one place: a number only for LIVE or SIMULATED, no solid node
// without a fresh report, a ribbon fill only over a real median, every row tagged, the sigil hollow with no frame.
import { describe, expect, it } from 'vitest'
import type { CoreInfo, Turn } from '../../../lib/api'
import { VoiceSignal } from '../../voice'
import { createBusFeed, wanted } from '../busFeed'
import { anatomyRows, ORGAN_STAGE } from '../Anatomy'
import { fixtureBands, pulse } from '../fixtures'
import { sigilSnap } from '../LiveSigil'
import {
  FIT_TURNS, FRESH_MS, MEDIAN_MIN_N, SIGIL, bandAtAngle, cleanText, coreViewOf, fitTurns, glyphIndex, handoffOf, hzText, intentOf,
  median, nodeText, organReadings, ribbonFill, ribbonStages, sigilTicks, spokeRatio, stageMedians, stageSeconds, tagOf, trackSince, turnLamp, turnTime,
} from '../model'

const NOW = 1_763_000_000_000
const awake = (o: Partial<CoreInfo> = {}): CoreInfo => ({
  running: true, mode: 'voice', state: 'idle', boot_step: null, pid: 1, started_at: null, ready_at: null, uptime_s: 10, last_error: null,
  exit_code: null, timings: {}, room: {}, mqtt: null, ...o,
})
const noMed = { hear: { value: null, n: 0 }, write: { value: null, n: 0 }, think: { value: null, n: 0 }, say: { value: null, n: 0 } }
const none = { hear: null, write: null, think: null, say: null }

describe('ribbon', () => {
  it('core off: every node WAITING "core off", prints OFF, no number', () => {
    const st = ribbonStages({ core: null, stateSince: null, now: NOW, last: { hear: 1, write: 1, think: 1, say: 1 }, medians: noMed })
    expect(st.map((s) => s.state)).toEqual(['waiting', 'waiting', 'waiting', 'waiting'])
    expect(st.every((s) => s.sec === undefined)).toBe(true)
    expect(st.map((s) => nodeText(s).value)).toEqual(['OFF', 'OFF', 'OFF', 'OFF'])
  })
  it('the running stage shows elapsed seconds; others show their last value or a dash', () => {
    const st = ribbonStages({ core: awake({ state: 'thinking' }), stateSince: NOW - 3200, now: NOW, last: { ...none, hear: 0.61 }, medians: noMed })
    const think = st.find((s) => s.id === 'think')!
    expect(think).toMatchObject({ state: 'live', sec: 3.2, running: true })
    expect(nodeText(think)).toEqual({ word: 'THINK', value: '3.2 s' })
    expect(st[0]).toMatchObject({ state: 'live', sec: 0.6 })
    expect(nodeText(st[1]).value).toBe('—')
    expect(st[1].state).toBe('waiting')
  })
  it('a fill exists only for the running stage AND a real median; otherwise null (dashed)', () => {
    expect(ribbonFill({ state: 'live', sec: 1, median: 2, running: true })).toBe(0.5)
    expect(ribbonFill({ state: 'live', sec: 9, median: 2, running: true })).toBe(1)
    expect(ribbonFill({ state: 'live', sec: 1, running: true })).toBeNull()
    expect(ribbonFill({ state: 'live', sec: 1, median: 2 })).toBeNull()
    expect(ribbonFill({ state: 'waiting', sec: 1, median: 2, running: true })).toBeNull()
    expect(ribbonFill({ state: 'live', sec: 1, median: 0, running: true })).toBeNull()
  })
  it('a fault on the running stage is FAULT with the reason, never a number', () => {
    const st = ribbonStages({ core: awake({ state: 'transcribing', last_error: 'whisper died' }), stateSince: NOW - 1000, now: NOW, last: none, medians: noMed })
    expect(st[1]).toMatchObject({ state: 'fault', reason: 'whisper died' })
    expect(nodeText(st[1]).value).toBe('—')
  })
  it('medians need at least MEDIAN_MIN_N values; stage seconds come from the core keys', () => {
    const rows = [{ endpoint: 1, stt: 0.5, first_token: 2, first_audio: 3 }, { endpoint: 2 }, { endpoint: 3 }]
    const m = stageMedians(rows)
    expect(m.hear).toEqual({ value: 2, n: 3 })
    expect(m.write.value).toBeNull()
    expect(m.write.n).toBeLessThan(MEDIAN_MIN_N)
    expect(stageSeconds({ endpoint: 1, stt: 0.5, first_token: 2, first_audio: 3.5 })).toEqual({ hear: 1, write: 0.5, think: 2, say: 1.5 })
    expect(stageSeconds({ stt: -1, first_audio: 2 })).toEqual({ hear: null, write: null, think: null, say: null })
    expect(median([3, 1, 2, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('organs', () => {
  it('core off: brain and voice WAITING "core off"; nothing is LIVE', () => {
    const o = organReadings({ core: null, vitals: null, readings: {}, now: NOW })
    expect(o.map((x) => x.reading.state).includes('live')).toBe(false)
    expect(o.map((x) => x.name)).toEqual(['BRAIN', 'VOICE', 'ROOM', 'SENSE', 'MEM'])
  })
  it('a LIVE reading older than FRESH_MS falls to WAITING "no fresh report"', () => {
    const readings = { memory: { state: 'live' as const, since: NOW - FRESH_MS - 1, reason: 'ok' } }
    const mem = organReadings({ core: null, vitals: null, readings, now: NOW }).find((x) => x.id === 'mem')!
    expect(mem.reading).toMatchObject({ state: 'waiting', reason: 'no fresh report' })
    expect(mem.source).toBe('reported')
  })
  it('brain is LIVE only from a fresh /api/system report that lists the model', () => {
    const vitals = { t: NOW / 1000, ollama: [{ name: 'qwen3:4b', size_mb: 1, vram_mb: 1, expires_at: '' }], aankhen: null as never }
    const fresh = organReadings({ core: awake(), vitals, readings: {}, now: NOW }).find((x) => x.id === 'brain')!
    expect(fresh.reading.state).toBe('live')
    const stale = organReadings({ core: awake(), vitals: { ...vitals, t: (NOW - FRESH_MS - 5) / 1000 }, readings: {}, now: NOW }).find((x) => x.id === 'brain')!
    expect(stale.reading.state).toBe('waiting')
  })
  it('the board link maps to ROOM: up LIVE, down FAULT, unknown WAITING', () => {
    const room = (mqtt: boolean | null) => organReadings({ core: awake({ mqtt }), vitals: null, readings: {}, now: NOW }).find((x) => x.id === 'room')!.reading.state
    expect([room(true), room(false), room(null)]).toEqual(['live', 'fault', 'waiting'])
  })
})

describe('transcript', () => {
  const turns: Turn[] = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, role: i % 2 ? 'jarvis' : 'you', text: `line ${i}`, t: 100 + i, done: true }))
  it('fits the newest four, oldest first; the rest go to Earlier, newest first', () => {
    const f = fitTurns(turns, FIT_TURNS)
    expect(f.shown.map((t) => t.id)).toEqual([4, 5, 6, 7])
    expect(f.earlier.map((t) => t.id)).toEqual([3, 2, 1])
    expect(fitTurns(turns.slice(0, 2), FIT_TURNS).earlier).toEqual([])
  })
  it('every turn has a tag and a lamp; a streaming turn is WAITING', () => {
    expect(tagOf({ role: 'you' })).toBe('YOU')
    expect(tagOf({ role: 'jarvis' })).toBe('JRV')
    expect(turnLamp({ done: true, t: 5 }).state).toBe('live')
    expect(turnLamp({ done: false, t: 5 })).toMatchObject({ state: 'waiting', reason: 'still writing' })
  })
  it('voice accent tags are never shown; time text is HH:MM:SS or dashes', () => {
    expect(cleanText('[us]Hello[/us]  there')).toBe('Hello there')
    expect(turnTime(Number.NaN)).toBe('--:--:--')
    expect(turnTime(0)).toMatch(/^\d\d:\d\d:\d\d$/)
  })
  it('intent class: memory, command, question, small talk', () => {
    expect(intentOf('Remind me to revise Unit 3')).toBe('memory')
    expect(intentOf('turn the fan on')).toBe('command')
    expect(intentOf('what is planned for physics?')).toBe('ask')
    expect(intentOf('nice, thanks')).toBe('talk')
  })
  it('a hand-off is read only when it names a Well Wisher view', () => {
    expect(handoffOf({ handoff: { product: 'ww', target: 'ww/day.today', label: 'Day 3 Dec 18:00' } })).toEqual({ product: 'ww', target: 'ww/day.today', label: 'Day 3 Dec 18:00' })
    expect(handoffOf({ handoff: { product: 'ww', target: 'javascript:alert(1)', label: 'x' } })).toBeNull()
    expect(handoffOf({})).toBeNull()
  })
})

describe('sigil ring', () => {
  it('hollow states light nothing, whatever the bands say', () => {
    const b = fixtureBands(0)
    for (const s of ['waiting', 'planned', 'fault'] as const) expect(sigilTicks(b, s).some(Boolean)).toBe(false)
    expect(sigilTicks(b, 'live').some(Boolean)).toBe(true)
    expect(sigilTicks(b, 'live')).toHaveLength(SIGIL.TICKS)
    expect(sigilTicks([], 'live').some(Boolean)).toBe(false)
  })
  it('the band is mirrored like the ring bars: tick k and tick 96-k agree', () => {
    const lit = sigilTicks(fixtureBands(0), 'live')
    for (let k = 1; k < SIGIL.TICKS / 2; k++) expect(lit[k]).toBe(lit[SIGIL.TICKS - k])
  })
  it('glyphs are deterministic per seed and stay inside the 12-glyph alphabet', () => {
    const a = Array.from({ length: 96 }, (_, k) => glyphIndex('jarvis.core.ring', k))
    expect(a).toEqual(Array.from({ length: 96 }, (_, k) => glyphIndex('jarvis.core.ring', k)))
    expect(Math.max(...a)).toBeLessThan(SIGIL.GLYPHS)
    expect(new Set(a).size).toBeGreaterThan(6)
  })
  it('the cursor reads the band and its centre frequency', () => {
    expect(bandAtAngle(0).band).toBe(0)
    expect(bandAtAngle(180).band).toBe(23)
    expect(bandAtAngle(-90).tick).toBe(bandAtAngle(270).tick)
    expect(hzText(1234)).toBe('1.2 kHz')
    expect(hzText(250)).toBe('250 Hz')
  })
  it('sigilSnap: hollow with no frame, lit with a fresh frame, hollow again after 400 ms', () => {
    const s = new VoiceSignal()
    const core = coreViewOf(awake({ state: 'listening' }), NOW - 1000)
    expect(sigilSnap(s, core, NOW).state).toBe('waiting')
    pulse(s, 'in', 1, NOW)
    const lit = sigilSnap(s, core, NOW + 10)
    expect(lit.state).toBe('live')
    expect(lit.bands.length).toBe(24)
    expect(sigilSnap(s, core, NOW + 10, true).state).toBe('simulated')
    expect(sigilSnap(s, core, NOW + 500)).toEqual({ bands: [], state: 'waiting' })
  })
})

describe('anatomy', () => {
  it('a spoke only where a last time AND a median exist; ROOM, SENSE, MEM are never timed', () => {
    expect(spokeRatio(2, 1)).toBe(2)
    expect(spokeRatio(null, 1)).toBeNull()
    expect(spokeRatio(1, 0)).toBeNull()
    const organs = organReadings({ core: null, vitals: null, readings: {}, now: NOW })
    const rows = anatomyRows(organs, { hear: 1, write: 0.6, think: 2.8, say: null }, { hear: { value: 1, n: 5 }, write: { value: 0.5, n: 5 }, think: { value: 1.4, n: 5 }, say: { value: null, n: 0 } })
    expect(rows.map((r) => r.ratio)).toEqual([2, 1.2, null, null, null])
    expect(ORGAN_STAGE.room).toBeNull()
  })
})

describe('state since and the bus filter', () => {
  it('trackSince keeps the first time of a repeated word', () => {
    const a = trackSince(null, 'idle', 1)
    expect(trackSince(a, 'idle', 5)).toBe(a)
    expect(trackSince(a, 'thinking', 9)).toEqual({ state: 'thinking', since: 9 })
  })
  it('only the four core kinds pass; a history batch never does', () => {
    expect(wanted({ source: 'core', kind: 'level' })).toBe(true)
    expect(wanted({ source: 'core', kind: 'out_level' })).toBe(true)
    expect(wanted({ source: 'core', kind: 'timing' })).toBe(true)
    expect(wanted({ source: 'core', kind: 'turn' })).toBe(false)
    expect(wanted({ source: 'limbs', kind: 'level' })).toBe(false)
    expect(wanted({ kind: 'history', events: [] })).toBe(false)
    expect(wanted(null)).toBe(false)
  })
  it('one socket for any number of listeners; it closes with the last one', () => {
    let opened = 0
    let closed = 0
    let push: (d: unknown) => void = () => {}
    const feed = createBusFeed((on) => { opened++; push = on; return { close: () => { closed++ } } })
    const got: unknown[] = []
    const a = feed.subscribe((e) => got.push(e))
    const b = feed.subscribe(() => {})
    expect(opened).toBe(1)
    push({ source: 'core', kind: 'level', level: 1 })
    push({ source: 'core', kind: 'turn' })
    expect(got).toHaveLength(1)
    a()
    expect(closed).toBe(0)
    b()
    expect(closed).toBe(1)
    expect(feed.open()).toBe(false)
  })
})
