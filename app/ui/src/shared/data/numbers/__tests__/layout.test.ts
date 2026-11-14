import { describe, expect, it } from 'vitest'
import {
  COMPACT_H, DASH_PATH, GLYPH_COLS, GLYPH_ROWS, HERO_H, MAX_CELLS, MIN_CELLS, NOTCH_AT, PX, ROLL_MS, ROLL_STEPS, SLOT_H, SLOT_W, STRIP_HEIGHT, STRIP_PATH,
  TAPE_COLS, TAPE_MAX_LINES, TAPE_WIDTH, TEARS, cellCount, deltaText, digitsOf, dumbbellLayout, fmt, gapText, glyphPath, groupDigits, jarGeometry, jarLine,
  leadingZeros, overflows, placeOn, rulerValues, tapeLine, tapeSum, tapeWindow, tornEdge, tornPath,
} from '../layout'

describe('the pixel numerals', () => {
  it('a glyph is 40 x 56 units inside a 50 x 70 slot, the spec sizes', () => {
    expect(GLYPH_COLS * PX).toBe(40)
    expect(GLYPH_ROWS * PX).toBe(56)
    expect(SLOT_W).toBe(50)
    expect(SLOT_H).toBe(70)
    expect(STRIP_HEIGHT).toBe(700)
  })
  it('merges runs: a full row of five lit pixels is one sub-path', () => {
    expect(glyphPath(['11111'], 0, 0, 8)).toBe('M0 0h40v8h-40z')
    expect(glyphPath(['10101'], 0, 0, 8).match(/M/g)).toHaveLength(3)
    expect(glyphPath(['00000'], 0, 0)).toBe('')
  })
  it('draws all ten digits in one path and one dash', () => {
    expect(STRIP_PATH.length).toBeGreaterThan(500)
    expect(DASH_PATH).toMatch(/^M\d+ \d+h40v8h-40z$/)
  })
  it('a roll is 140 ms in 4 steps, which leaves 3 stops between', () => {
    expect(ROLL_MS).toBe(140)
    expect(ROLL_STEPS - 1).toBe(3)
    expect(HERO_H).toBe(72)
    expect(COMPACT_H).toBe(28)
  })
})

describe('digits and cells', () => {
  it('pads to the rack width', () => {
    expect(digitsOf(41, 4)).toEqual([0, 0, 4, 1])
    expect(digitsOf(0, 4)).toEqual([0, 0, 0, 0])
    expect(digitsOf(1280, 4)).toEqual([1, 2, 8, 0])
  })
  it('refuses what it cannot draw: negative, NaN, null', () => {
    expect(digitsOf(-1, 4)).toBeNull()
    expect(digitsOf(Number.NaN, 4)).toBeNull()
    expect(digitsOf(null, 4)).toBeNull()
    expect(digitsOf(Infinity, 4)).toBeNull()
  })
  it('a value past the rack reads as the cap and says so', () => {
    expect(digitsOf(123456, 4)).toEqual([9, 9, 9, 9])
    expect(overflows(123456, 4)).toBe(true)
    expect(overflows(9999, 4)).toBe(false)
  })
  it('the rack grows from 4 to at most 7 wells', () => {
    expect(cellCount(3)).toBe(MIN_CELLS)
    expect(cellCount(99999)).toBe(5)
    expect(cellCount(10 ** 12)).toBe(MAX_CELLS)
    expect(cellCount(null)).toBe(4)
  })
  it('counts padding zeros but keeps the last digit lit', () => {
    expect(leadingZeros([0, 0, 4, 1])).toBe(2)
    expect(leadingZeros([0, 0, 0, 0])).toBe(3)
    expect(leadingZeros([1, 0, 0, 0])).toBe(0)
  })
  it('groups thousands', () => {
    expect(groupDigits(1280)).toBe('1,280')
    expect(groupDigits(7)).toBe('7')
    expect(groupDigits(-1234567)).toBe('-1,234,567')
  })
  it('the delta is ASCII: signed, or "no change"', () => {
    expect(deltaText(3, '09:00')).toBe('+3 since 09:00')
    expect(deltaText(-2, '09:00')).toBe('-2 since 09:00')
    expect(deltaText(0, '09:00')).toBe('no change since 09:00')
    expect(deltaText(Number.NaN, '09:00')).toBe('')
  })
})

describe('the dumbbell layout', () => {
  it('places values on the ruler in percent and holds off-scale values at an end', () => {
    expect(placeOn(40, [0, 80])).toEqual({ pct: 50, off: false })
    expect(placeOn(-5, [0, 80])).toEqual({ pct: 0, off: true })
    expect(placeOn(95, [0, 80])).toEqual({ pct: 100, off: true })
    expect(placeOn(5, [10, 10]).off).toBe(true)
  })
  it('sorts by the size of the gap, keeps ties in the given order, drops non-finite rows', () => {
    const out = dumbbellLayout(
      [
        { label: 'a', before: 10, after: 12 },
        { label: 'b', before: 50, after: 10 },
        { label: 'c', before: 10, after: 8 },
        { label: 'd', before: Number.NaN, after: 1 },
      ],
      [0, 100],
    )
    expect(out.map((r) => r.label)).toEqual(['b', 'a', 'c'])
    expect(out[0]).toMatchObject({ gap: -40, barLeft: 10, barWidth: 40 })
  })
  it('the ruler has equal steps including both ends', () => {
    expect(rulerValues([0, 80], 5)).toEqual([0, 20, 40, 60, 80])
    expect(rulerValues([0, 1], 1)).toHaveLength(2)
  })
  it('prints a signed difference', () => {
    expect(gapText(12)).toBe('+12')
    expect(gapText(-4)).toBe('-4')
    expect(gapText(0)).toBe('0')
    expect(fmt(2.25)).toBe('2.3')
    expect(fmt(1500)).toBe('1,500')
  })
})

describe('the ledger tape', () => {
  it('every line is the same width, with leaders as text', () => {
    const a = tapeLine('chai', '120')
    const b = tapeLine('notebook', '1,065')
    expect(a).toMatch(/^chai ·+ 120$/)
    expect(a.length).toBe(TAPE_COLS)
    expect(b.length).toBe(TAPE_COLS)
  })
  it('a long label is cut with an ellipsis and keeps at least two leader dots', () => {
    const l = tapeLine('a very long label that cannot fit on one tape line', '1,065')
    expect(l.length).toBeLessThanOrEqual(TAPE_COLS)
    expect(l).toContain('…')
    expect(l).toMatch(/·· 1,065$/)
  })
  it('keeps the newest lines when the tape is long and counts the rest', () => {
    const many = Array.from({ length: TAPE_MAX_LINES + 5 }, (_, i) => i)
    const w = tapeWindow(many)
    expect(w.shown).toHaveLength(TAPE_MAX_LINES)
    expect(w.hidden).toBe(5)
    expect(w.shown[0]).toBe(5)
    expect(tapeWindow([1, 2, 3])).toEqual({ shown: [1, 2, 3], hidden: 0 })
  })
  it('sums only finite amounts', () => {
    expect(tapeSum([{ label: 'a', amount: 10 }, { label: 'b', amount: Number.NaN }, { label: 'c', amount: 5 }])).toBe(15)
  })
  it('the torn edge is deterministic, has one point per tooth edge and closes along the top', () => {
    const e = tornEdge('tape:4:425')
    expect(e).toBe(tornEdge('tape:4:425'))
    expect(e).not.toBe(tornEdge('tape:5:425'))
    expect((e.match(/[ML]/g) ?? []).length).toBe(TEARS + 1)
    expect(tornPath('x')).toMatch(new RegExp(`L${TAPE_WIDTH} 0L0 0Z$`))
  })
})

describe('the jar geometry', () => {
  it('fills to the notch exactly when the level equals the plan', () => {
    const g = jarGeometry(400, 400)
    expect(g.fill).toBeCloseTo(NOTCH_AT, 10)
    expect(g.mode).toBe('under')
    expect(g.left).toBe(0)
    expect(g.over).toBe(0)
  })
  it('fills past the notch when over, and counts how far', () => {
    const g = jarGeometry(520, 400)
    expect(g.mode).toBe('over')
    expect(g.over).toBe(120)
    expect(g.fill).toBeGreaterThan(NOTCH_AT)
    expect(g.fill).toBeLessThanOrEqual(1)
  })
  it('never overfills the well, however far over', () => {
    expect(jarGeometry(10_000, 400).fill).toBe(1)
  })
  it('is empty for zero, negative or non-finite levels', () => {
    for (const lv of [0, -5, Number.NaN, Infinity * -1]) expect(jarGeometry(lv, 400).mode).toBe('empty')
  })
  it('without a plan the level is a share of the well and there is no notch', () => {
    const g = jarGeometry(0.55)
    expect(g).toMatchObject({ mode: 'under', fill: 0.55, notch: null })
    expect(jarGeometry(3).fill).toBe(1)
    expect(jarGeometry(5, 0).notch).toBeNull()
  })
  it('says one plain line, and no scolding words', () => {
    expect(jarLine(jarGeometry(520, 400), 'INR')).toBe('120 INR over')
    expect(jarLine(jarGeometry(520, 400))).toBe('120 over')
    expect(jarLine(jarGeometry(320, 400))).toBe('80 left')
    expect(jarLine(jarGeometry(0, 400))).toBe('nothing in it yet')
    const all = [jarLine(jarGeometry(520, 400)), jarLine(jarGeometry(320, 400)), jarLine(jarGeometry(0, 400))].join(' ')
    expect(all).not.toMatch(/budget|warning|exceed|overspen|too much|danger/i)
  })
})
