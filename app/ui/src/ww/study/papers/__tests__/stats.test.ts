// The counting and the geometry of the Paper Strata, as pure functions.
import { describe, expect, it } from 'vitest'
import { MIN_PAPERS, ONE_PAPER, TOO_FEW, countText, intervalText, patternState, wilson } from '../stats'
import { DOT_STEPS, TICK_PX, cellsOf, coverageOf, dotSize, mergeCells, setIn, topicWindow, unitsOf, walk, yearWindow } from '../strataModel'
import { PAPERS, QUESTIONS, TOPICS, YEARS } from '../fixtures'

describe('Wilson interval', () => {
  it('stays inside 0 to 1 and widens as papers get fewer', () => {
    for (const [k, n] of [[0, 6], [3, 6], [6, 6], [1, 1], [0, 1]]) {
      const w = wilson(k, n)
      expect(w.lo).toBeGreaterThanOrEqual(0)
      expect(w.hi).toBeLessThanOrEqual(1)
      expect(w.lo).toBeLessThanOrEqual(k / n)
      expect(w.hi).toBeGreaterThanOrEqual(k / n - 1e-9)
    }
    expect(wilson(3, 6).hi - wilson(3, 6).lo).toBeGreaterThan(wilson(30, 60).hi - wilson(30, 60).lo)
  })
  it('does not collapse to a point at k = n (6 of 6 still has a lower bound under 1)', () => {
    const w = wilson(6, 6)
    expect(w.hi).toBeCloseTo(1, 10)
    expect(w.lo).toBeGreaterThan(0.55)
    expect(w.lo).toBeLessThan(0.7)
  })
  it('the known value: 4 of 6 is 30 to 90 percent', () => {
    expect(intervalText(4, 6)).toBe('95% interval 30 to 90 percent')
  })
  it('n = 0 is the whole range, not a division by zero', () => expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 }))
})

describe('counts as words', () => {
  it('reads "k of N"', () => expect(countText(4, 6)).toBe('4 of 6'))
  it('under 3 papers there is no pattern', () => {
    expect(MIN_PAPERS).toBe(3)
    expect(patternState(0)).toBe('too-few')
    expect(patternState(1)).toBe('counts-only')
    expect(patternState(2)).toBe('too-few')
    expect(patternState(3)).toBe('figure')
    expect(TOO_FEW).toBe('too few papers to show a pattern')
    expect(ONE_PAPER).toBe('1 paper: counts only, no pattern yet')
  })
})

describe('dots', () => {
  it('is a tick for no marks and five steps from 4 to 26 px', () => {
    expect(dotSize(0)).toBe(TICK_PX)
    expect(DOT_STEPS).toEqual([4, 8, 13, 19, 26])
    expect([0.01, 0.07, 0.15, 0.2, 0.5].map(dotSize)).toEqual([4, 8, 13, 19, 26])
  })
  it('adds the shares of a topic set twice in one year and keeps its lowest-margin question', () => {
    const m = mergeCells([
      { year: 2020, topicId: 't1', share: 0.1, type: 'numerical', qid: 'a', tag: 'RULE', margin: 0.8 },
      { year: 2020, topicId: 't1', share: 0.15, type: 'short', qid: 'b', tag: 'MODEL', margin: 0.1 },
    ])
    expect(m).toHaveLength(1)
    expect(m[0].share).toBeCloseTo(0.25)
    expect(m[0].qid).toBe('b')
  })
})

describe('windows and counts of the fixture', () => {
  const ten = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]
  it('shows 8 years, newest window first, oldest on the left', () => {
    const w = yearWindow(ten, 0)
    expect(w.shown).toEqual([2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019])
    expect(w.pages).toBe(2)
    expect(yearWindow(ten, 1).shown).toEqual([2010, 2011])
  })
  it('pages the topics 9 at a time and filters by unit', () => {
    expect(topicWindow(TOPICS, null, 0).shown).toHaveLength(9)
    expect(topicWindow(TOPICS, null, 1).shown).toHaveLength(3)
    expect(unitsOf(TOPICS)).toEqual(['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4'])
    expect(topicWindow(TOPICS, 'Unit 2', 0).total).toBe(4)
  })
  it('counts the papers a topic was set in, once per year', () => {
    const cells = cellsOf(QUESTIONS)
    expect(setIn(cells, 't12', YEARS)).toBe(5)
    expect(setIn(cells, 't10', YEARS)).toBe(2)
  })
  it('the ledger counts come from the rows, rejected questions excluded', () => {
    const c = coverageOf(PAPERS, QUESTIONS, 5)
    expect(c.papers).toBe(6)
    expect(c.questions).toBe(42)
    expect(c.reviewed).toBe(35)
    expect(coverageOf(PAPERS, QUESTIONS.map((q, i) => (i === 0 ? { ...q, status: 'rejected' as const } : q)), null).questions).toBe(41)
  })
})

describe('the arrow walk', () => {
  it('stops at the edges and never wraps', () => {
    expect(walk(0, 0, 'ArrowLeft', 9, 8)).toEqual([0, 0])
    expect(walk(0, 0, 'ArrowUp', 9, 8)).toEqual([0, 0])
    expect(walk(8, 7, 'ArrowDown', 9, 8)).toEqual([8, 7])
    expect(walk(4, 3, 'Home', 9, 8)).toEqual([4, 0])
    expect(walk(4, 3, 'End', 9, 8)).toEqual([4, 7])
    expect(walk(4, 3, 'PageDown', 9, 8)).toEqual([8, 3])
  })
})
