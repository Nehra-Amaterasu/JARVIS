// The pure half of D03: sorting, number text, sparks and meters, grid focus, typeahead, groups, reorder and slots.
import { describe, expect, it } from 'vitest'
import {
  CARD_FIELDS, DENSE_ROW_PX, HIT_PX, NARROW_PX, RACK_ROW_PX, RACK_W, ROW_PX, SEAT_STAGGER_CAP, SLOT_PX, TYPEAHEAD_MS,
  altTarget, ariaSort, cardFields, firstEnabled, formatNumber, groupRuns, growBuffer, gutterGlyph, isEditable, isSortable, lastEnabled,
  meterFill, moveFocus, moveAnnouncement, nextSort, parseNumber, reorder, seatDelayMs, slotAtY, sortGlyph, sortRows, sparkText, stepBy,
  stepEnabled, typeahead, visibleColumns, type Col, type Opt, type Row,
} from '../layout'

const cols: Col[] = [
  { key: 'name', label: 'Name', editable: true },
  { key: 'n', label: 'N', kind: 'number', editable: true },
  { key: 'tr', label: 'Trend', kind: 'spark' },
  { key: 'm', label: 'Cover', kind: 'meter' },
  { key: 's', label: 'Source', kind: 'lamp' },
]
const rows: Row[] = [
  { id: 'a', name: 'beta', n: 3, m: 0.5, s: 'fault' },
  { id: 'b', name: 'Alpha', n: null, m: 0.9, s: 'live' },
  { id: 'c', name: 'gamma', n: 10, m: 0.1, s: 'waiting' },
  { id: 'd', name: 'alpha 2', n: 2, m: 0.5, s: 'simulated' },
]

describe('the figures of spec 20.5.2', () => {
  it('are named constants', () => {
    expect([ROW_PX, DENSE_ROW_PX, HIT_PX, NARROW_PX, RACK_W, RACK_ROW_PX, CARD_FIELDS]).toEqual([32, 28, 44, 900, 320, 44, 3])
    expect(SEAT_STAGGER_CAP).toBe(8)
    expect(TYPEAHEAD_MS).toBeGreaterThan(400)
  })
  it('a 32 px row keeps a 44 px hit area by reaching 6 px into each neighbour', () => {
    expect((HIT_PX - ROW_PX) / 2).toBe(6)
  })
})

describe('sorting', () => {
  it('cycles ascending, descending, none and shows the glyph in text', () => {
    let s = nextSort(null, 'n')
    expect(s).toEqual({ key: 'n', dir: 'asc' })
    expect(sortGlyph(s, 'n')).toBe('▲')
    s = nextSort(s, 'n')
    expect(sortGlyph(s, 'n')).toBe('▼')
    expect(nextSort(s, 'n')).toBeNull()
    expect(sortGlyph(null, 'n')).toBe('·')
    expect(nextSort({ key: 'n', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(ariaSort({ key: 'n', dir: 'desc' }, 'n')).toBe('descending')
    expect(ariaSort({ key: 'n', dir: 'desc' }, 'name')).toBe('none')
  })
  it('sorts text case-insensitively with numeric order, numbers numerically, and puts empties last in both directions', () => {
    expect(sortRows(rows, cols, { key: 'name', dir: 'asc' }).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(sortRows(rows, cols, { key: 'n', dir: 'asc' }).map((r) => r.id)).toEqual(['d', 'a', 'c', 'b'])
    expect(sortRows(rows, cols, { key: 'n', dir: 'desc' }).map((r) => r.id)).toEqual(['c', 'a', 'd', 'b'])
  })
  it('is stable, ranks lamp states by honesty, and leaves spark columns and unknown keys alone', () => {
    expect(sortRows(rows, cols, { key: 'm', dir: 'asc' }).map((r) => r.id)).toEqual(['c', 'a', 'd', 'b'])
    expect(sortRows(rows, cols, { key: 's', dir: 'asc' }).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(sortRows(rows, cols, { key: 'tr', dir: 'asc' }).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(sortRows(rows, cols, { key: 'zz', dir: 'asc' }).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(sortRows(rows, cols, null)).not.toBe(rows)
  })
  it('knows which columns sort and edit', () => {
    expect(isSortable(cols[2])).toBe(false)
    expect(isSortable(cols[0])).toBe(true)
    expect(isEditable(cols[0])).toBe(true)
    expect(isEditable({ key: 'x', label: 'X', kind: 'lamp', editable: true })).toBe(false)
  })
})

describe('number, spark and meter text', () => {
  it('formats and parses numbers', () => {
    expect(formatNumber(14)).toBe('14')
    expect(formatNumber(2.456)).toBe('2.5')
    expect(formatNumber(2.456, 2)).toBe('2.46')
    expect(formatNumber(null)).toBe('')
    expect(formatNumber(NaN)).toBe('')
    expect(parseNumber(' 12,5 ')).toBe(12.5)
    expect(parseNumber('-3')).toBe(-3)
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('1e5')).toBeNull()
  })
  it('draws an ASCII spark of at most 12 characters, flat as a mid bar and empty as nothing', () => {
    expect(sparkText([1, 2, 3, 4, 5, 6, 7, 8])).toBe('▁▂▃▄▅▆▇█')
    expect(sparkText(Array.from({ length: 30 }, (_, i) => i)).length).toBe(12)
    expect(sparkText([4, 4, 4])).toBe('▄▄▄')
    expect(sparkText([])).toBe('')
    expect(sparkText(undefined)).toBe('')
    expect(sparkText([1, NaN, 3]).length).toBe(2)
  })
  it('rounds and clamps the meter', () => {
    expect([meterFill(0), meterFill(0.44), meterFill(0.46), meterFill(1), meterFill(2), meterFill(-1), meterFill('x')]).toEqual([0, 4, 5, 10, 10, 0, 0])
  })
})

describe('columns and cards', () => {
  it('never hides a pinned column or the last one', () => {
    const p: Col[] = [{ key: 'a', label: 'A', pinned: true }, { key: 'b', label: 'B' }]
    expect(visibleColumns(p, new Set(['a', 'b'])).map((c) => c.key)).toEqual(['a'])
    expect(visibleColumns([{ key: 'b', label: 'B' }], new Set(['b'])).map((c) => c.key)).toEqual(['b'])
  })
  it('puts the first text column in the title, the lamp beside it and three plain fields in the card', () => {
    const c = cardFields(cols)
    expect([c.title?.key, c.lamp?.key, c.fields.map((f) => f.key)]).toEqual(['name', 's', ['n', 'tr', 'm']])
  })
})

describe('grid focus', () => {
  it('moves by arrows and clamps at the edges, with the header row at -1', () => {
    expect(moveFocus({ r: 0, c: 1 }, 'ArrowUp', 5, 4)).toEqual({ r: -1, c: 1 })
    expect(moveFocus({ r: -1, c: 1 }, 'ArrowUp', 5, 4)).toEqual({ r: -1, c: 1 })
    expect(moveFocus({ r: 4, c: 1 }, 'ArrowDown', 5, 4)).toEqual({ r: 4, c: 1 })
    expect(moveFocus({ r: 2, c: 4 }, 'ArrowRight', 5, 4)).toEqual({ r: 2, c: 4 })
    expect(moveFocus({ r: 2, c: 2 }, 'Home', 5, 4)).toEqual({ r: 2, c: 0 })
    expect(moveFocus({ r: 2, c: 2 }, 'End', 5, 4)).toEqual({ r: 2, c: 4 })
    expect(moveFocus({ r: 2, c: 2 }, 'Home', 5, 4, true)).toEqual({ r: -1, c: 0 })
    expect(moveFocus({ r: 2, c: 2 }, 'End', 5, 4, true)).toEqual({ r: 4, c: 4 })
    expect(moveFocus({ r: 0, c: 2 }, 'PageDown', 20, 4)).toEqual({ r: 5, c: 2 })
    expect(moveFocus({ r: 1, c: 2 }, 'x', 5, 4)).toEqual({ r: 1, c: 2 })
  })
})

const opts: Opt[] = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Avocado', disabled: true },
  { value: 'c', label: 'Banana', group: 'Fruit' },
  { value: 'd', label: 'Berry', group: 'Fruit' },
  { value: 'e', label: 'Cherry', group: 'Stone' },
]

describe('the select', () => {
  it('steps over disabled options and stops at the ends', () => {
    expect(stepEnabled(opts, 0, 1)).toBe(2)
    expect(stepEnabled(opts, 2, -1)).toBe(0)
    expect(stepEnabled(opts, 4, 1)).toBe(4)
    expect(stepEnabled(opts, 0, -1)).toBe(0)
    expect(firstEnabled(opts)).toBe(0)
    expect(lastEnabled([...opts.slice(0, 4), { value: 'z', label: 'Z', disabled: true }])).toBe(3)
    expect(stepBy(opts, 0, 5)).toBe(4)
    expect(stepBy(opts, 4, -2)).toBe(2)
  })
  it('typeahead finds a prefix, narrows with more letters, cycles on a repeated one and wraps', () => {
    expect(typeahead(opts, 'b', 0)).toBe(2)
    expect(typeahead(opts, 'be', 0)).toBe(3)
    expect(typeahead(opts, 'bb', 2)).toBe(3)
    expect(typeahead(opts, 'a', 0)).toBe(0)
    expect(typeahead(opts, 'av', 0)).toBe(0)
    expect(typeahead(opts, 'q', 1)).toBe(1)
    expect(typeahead(opts, '', 3)).toBe(3)
  })
  it('keeps the buffer only within the window', () => {
    expect(growBuffer('b', 1000, 1000 + TYPEAHEAD_MS, 'e')).toBe('be')
    expect(growBuffer('b', 1000, 1000 + TYPEAHEAD_MS + 1, 'e')).toBe('e')
  })
  it('draws the tree glyphs for grouped rows only', () => {
    expect(opts.map((_, i) => gutterGlyph(opts, i, true))).toEqual(['', '', '├─', '└─', '└─'])
    expect(opts.map((_, i) => gutterGlyph(opts, i, false))).toEqual(['', '', '', '', ''])
  })
  it('groups adjacent options into runs', () => {
    expect(groupRuns(opts, true)).toEqual([
      { heading: null, from: 0, to: 0 }, { heading: null, from: 1, to: 1 }, { heading: 'Fruit', from: 2, to: 3 }, { heading: 'Stone', from: 4, to: 4 },
    ])
    expect(groupRuns(opts, false).length).toBe(5)
  })
})

describe('the slot list', () => {
  it('reorders without mutating and clamps', () => {
    const a = ['a', 'b', 'c', 'd']
    expect(reorder(a, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(reorder(a, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(reorder(a, 1, 99)).toEqual(['a', 'c', 'd', 'b'])
    expect(reorder(a, 9, 0)).toEqual(a)
    expect(a).toEqual(['a', 'b', 'c', 'd'])
  })
  it('finds the slot under the pointer', () => {
    expect([slotAtY(100, 100, 5), slotAtY(100 + SLOT_PX, 100, 5), slotAtY(100 + SLOT_PX * 2 - 1, 100, 5), slotAtY(9999, 100, 5), slotAtY(0, 100, 5)]).toEqual([0, 1, 1, 4, 0])
  })
  it('resolves Alt+arrow targets and refuses to move past an end', () => {
    expect(altTarget(2, 'ArrowUp', 5)).toBe(1)
    expect(altTarget(2, 'ArrowDown', 5)).toBe(3)
    expect(altTarget(0, 'ArrowUp', 5)).toBeNull()
    expect(altTarget(4, 'ArrowDown', 5)).toBeNull()
    expect(altTarget(2, 'x', 5)).toBeNull()
  })
  it('staggers by 40 ms and caps at the eighth row', () => {
    expect([seatDelayMs(0), seatDelayMs(1), seatDelayMs(7), seatDelayMs(30)]).toEqual([0, 40, 280, 280])
  })
  it('speaks positions one-based', () => {
    expect(moveAnnouncement('Physics', 1, 5)).toBe('Physics moved to position 2 of 5')
  })
})
