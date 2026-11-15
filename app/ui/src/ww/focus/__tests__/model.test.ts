// Y02: the Drill's rules (pure), the pause arithmetic of the session and the track host. Every promise of the brief is a check here.
import { describe, expect, it } from 'vitest'
import { FIX_QUESTIONS } from '../fixtures'
import { checkNumeric, counts, countsLine, initialState, parseNumber, reduce, weekdayOf, type Act } from '../model'
import { resumeVerdict, type Active } from '../session'
import { msToNextSessionMinute } from '../useCrucibleEngine'
import { collectTracks } from '../tracks'

const play = (acts: Act[]) => acts.reduce(reduce, initialState(FIX_QUESTIONS, 'practice set'))
const typed = (v: string): Act => ({ t: 'input', v })

describe('reading an answer (principle 18: liberal in)', () => {
  it.each([
    ['1.5', 1.5], ['1,5', 1.5], ['  -3 ', -3], ['−3', -3], ['2.2e-3', 0.0022], ['3.2 x 10^-3', 0.0032], ['3.2×10^2', 320],
    ['1/4', 0.25], ['4.7 V', 4.7], ['1,200.5', 1200.5], ['.5', 0.5],
  ])('%s reads as %s', (raw, want) => expect(parseNumber(raw)).toBeCloseTo(want, 9))
  it.each(['', 'abc', '/', 'V 4'])('%j is no number', (raw) => expect(parseNumber(raw)).toBeNull())
  it('matches within one percent unless the question says otherwise, and at zero only the exact', () => {
    expect(checkNumeric('1,92', 1.915).matches).toBe(true)
    expect(checkNumeric('2', 1.915).matches).toBe(false)
    expect(checkNumeric('2', 1.915, 0.1).matches).toBe(true)
    expect(checkNumeric('0', 0).matches).toBe(true)
    expect(checkNumeric('0.001', 0).matches).toBe(false)
  })
})

describe('the Drill reducer', () => {
  it('a hint reveal is logged and lowers nothing: the match still counts', () => {
    const s = play([{ t: 'hint' }, { t: 'hint' }, typed('1.915'), { t: 'check' }])
    expect(s.hintLog).toEqual([{ id: 'fx-1', rung: 1 }, { id: 'fx-1', rung: 2 }])
    expect(s.res['fx-1']).toMatchObject({ state: 'matched', hints: 2, shown: false })
    expect(counts(s)).toMatchObject({ attempted: 1, matched: 1, shelf: 0, hints: 2 })
  })
  it('the worked answer (the last rung) moves the question to the shelf and never counts as a match', () => {
    const s = play([{ t: 'hint' }, { t: 'hint' }, { t: 'hint' }, typed('1.915'), { t: 'check' }])
    expect(s.hintLog).toHaveLength(3)
    expect(s.res['fx-1']).toMatchObject({ state: 'missed', shown: true })
    expect(counts(s)).toMatchObject({ attempted: 1, matched: 0, shelf: 1 })
    // no fourth rung exists
    expect(reduce(s, { t: 'hint' }).hintLog).toHaveLength(3)
  })
  it('a miss is a missed state with no verdict word beyond "on the shelf"; the strip says so', () => {
    const s = play([typed('300'), { t: 'check' }])
    expect(s.res['fx-1'].state).toBe('missed')
    expect(s.strip).toContain('on the shelf')
    expect(s.strip).not.toMatch(/wrong|fail|mistake|lost|streak/i)
  })
  it('the strip changes only on a real event, never on typing', () => {
    const a = play([])
    const b = reduce(a, typed('1'))
    const c = reduce(b, typed('1.9'))
    expect(c.strip).toBe(a.strip)
    expect(reduce(c, { t: 'check' }).strip).not.toBe(a.strip)
    expect(reduce(a, { t: 'park', text: 'a thought', stored: false }).strip).toContain('parked 1')
    // a check with nothing typed is not an event either
    expect(reduce(a, { t: 'check' })).toBe(a)
  })
  it('a recall card needs the key shown, then the student marks it (marked by you)', () => {
    let s = play([{ t: 'step', d: 2 }])
    expect(reduce(s, { t: 'mark', ok: true })).toBe(s)
    s = reduce(s, { t: 'check' })
    expect(s.revealed['fx-3']).toBe(true)
    expect(s.res['fx-3']).toBeUndefined()
    s = reduce(s, { t: 'mark', ok: true })
    expect(s.res['fx-3']).toMatchObject({ state: 'matched', markedBy: 'you' })
  })
  it('a written answer is the rubric points the student ticked, counted as theirs', () => {
    let s = play([{ t: 'step', d: 3 }, { t: 'tick', idx: 0 }, { t: 'tick', idx: 1 }])
    s = reduce(s, { t: 'check' })
    expect(s.res['fx-4']).toMatchObject({ state: 'missed', marks: { got: 2, of: 3 }, markedBy: 'you' })
    let all = play([{ t: 'step', d: 3 }, { t: 'tick', idx: 0 }, { t: 'tick', idx: 1 }, { t: 'tick', idx: 2 }])
    all = reduce(all, { t: 'check' })
    expect(all.res['fx-4']).toMatchObject({ state: 'matched', marks: { got: 3, of: 3 } })
  })
  it('the set ends on counts only; an early end keeps what was answered and says it was early', () => {
    const s = play([typed('1,92'), { t: 'check' }, { t: 'step', d: 1 }, typed('300'), { t: 'check' }, { t: 'step', d: 1 }, { t: 'skip' }, { t: 'end' }])
    const c = counts(s)
    expect(countsLine(c)).toBe('2 attempted, 1 matched, 2 on the shelf')
    expect(c.skipped).toBe(1)
    expect(s.ended).toBe(true)
    expect(s.early).toBe(true)
    expect(Object.keys(s.res)).toHaveLength(3)
    expect(countsLine(c)).not.toMatch(/%|streak|mistake|score/i)
  })
  it('"Go again on the shelf" replays the missed and skipped questions with the parked thoughts kept', () => {
    const s = play([typed('1,92'), { t: 'check' }, { t: 'step', d: 1 }, typed('300'), { t: 'check' }, { t: 'park', text: 'x', stored: false }, { t: 'end' }])
    const again = reduce(s, { t: 'again' })
    expect(again.qs.map((q) => q.id)).toEqual(['fx-2'])
    expect(again.ended).toBe(false)
    expect(again.parked).toHaveLength(1)
    // with nothing on the shelf there is nothing to go again on
    const clean = play([typed('1,92'), { t: 'check' }, { t: 'end' }])
    expect(reduce(clean, { t: 'again' })).toBe(clean)
  })
  it('steps stay inside the set and a settled question cannot be settled twice', () => {
    expect(play([{ t: 'step', d: -3 }]).i).toBe(0)
    expect(play([{ t: 'step', d: 99 }]).i).toBe(FIX_QUESTIONS.length - 1)
    const s = play([typed('1,92'), { t: 'check' }])
    expect(reduce(reduce(s, typed('300')), { t: 'check' })).toMatchObject({ res: s.res })
  })
  it('names the weekday a question comes back on', () => {
    expect(weekdayOf('2026-11-19')).toBe('Thursday')
    expect(weekdayOf(undefined)).toBeNull()
    expect(weekdayOf('soon')).toBeNull()
  })
})

describe('the session clock with a pause (additive to the classic rules)', () => {
  const a = (over: Partial<Active> = {}): Active => ({ startedAt: 0, durationS: 3000, lastBeat: 0, track: 't', trackLabel: 'T', wager: false, guards: false, length: 50, ...over })
  it('a held session does not run out and does not end by the guards while held', () => {
    expect(resumeVerdict(a({ pausedAt: 1_000_000 }), 9_999_999)).toBe('running')
    expect(resumeVerdict(a({ guards: true, pausedAt: 100_000 }), 9_999_999)).toBe('running')
    expect(resumeVerdict(a({ guards: true }), 9_999_999)).toBe('ended')
    expect(resumeVerdict(a(), 3_000_001)).toBe('done')
  })
  it('the minute timeout is armed to the session\'s own next minute, never zero', () => {
    expect(msToNextSessionMinute(0, 0)).toBe(60_000)
    expect(msToNextSessionMinute(0, 59_000)).toBe(1_000)
    expect(msToNextSessionMinute(1_000, 61_500)).toBe(59_500)
  })
})

describe('the track host', () => {
  const Tr = () => null
  it('puts the Crucible first, refuses a second file for a taken id and a file with no registration', () => {
    const { tracks, errors } = collectTracks({
      './tracks/a-paper.track.tsx': { track: { id: 'paper', Session: Tr } },
      './tracks/crucible.track.tsx': { track: { id: 'crucible', Session: Tr } },
      './tracks/z-dup.track.tsx': { default: { id: 'paper', Session: Tr } },
      './tracks/bad.track.tsx': { nothing: 1 },
    })
    expect(tracks.map((t) => t.id)).toEqual(['crucible', 'paper'])
    expect(errors).toHaveLength(2)
  })
})
