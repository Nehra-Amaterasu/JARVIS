// The pure helpers of the intake desk: dates in words, the groups, the page, the batch rule, the older fold, the provenance
// sentence, the ladder, and the fixture reader. No React.
import { describe, expect, it } from 'vitest'
import { NOW, ROWS, fixtureReadIcs, fixtureReadLine, manyRows } from '../fixtures'
import {
  OLDER_DAYS, PER_PAGE, batchEligible, canAccept, dayNumber, dueWords, groupOf, isOlder, ladderOf, localDay, pageOf, provenanceLine, readingWords, sizeWords,
} from '../model'
import type { IntakeRow } from '../types'

const byId = (id: string): IntakeRow => ROWS.find((r) => r.id === id)!

describe('dates in words', () => {
  it('a date with a time, a date without one, and no date', () => {
    expect(dueWords('2026-11-18', '17:00', NOW)).toBe('Wed 18 Nov, 17:00')
    expect(dueWords('2026-12-04', null, NOW)).toBe('Fri 4 Dec')
    expect(dueWords(null, null, NOW)).toBe('no date')
  })
  it('a date in another year says the year, so a reading is never mistaken', () => {
    expect(dueWords('2027-03-12', null, NOW)).toBe('Fri 12 Mar 2027')
    expect(readingWords('2026-12-03', NOW)).toBe('3 Dec')
    expect(readingWords('2027-03-12', NOW)).toBe('12 Mar 2027')
  })
  it('day arithmetic never shifts across a month or a year end', () => {
    expect(dayNumber('2026-12-01') - dayNumber('2026-11-30')).toBe(1)
    expect(dayNumber('2027-01-01') - dayNumber('2026-12-31')).toBe(1)
    expect(localDay(NOW)).toBe('2026-11-15')
  })
})

describe('the groups and the page', () => {
  it('This week is today to six days on, Later is beyond, No date has none, Earlier is before today', () => {
    expect(groupOf(byId('r1'), NOW)).toBe('week')
    expect(groupOf(byId('r5'), NOW)).toBe('later')
    expect(groupOf(byId('r4'), NOW)).toBe('none')
    expect(groupOf(byId('r10'), NOW)).toBe('earlier')
    expect(groupOf({ ...byId('r1'), date: '2026-11-21' }, NOW)).toBe('week')
    expect(groupOf({ ...byId('r1'), date: '2026-11-22' }, NOW)).toBe('later')
  })
  it('forty new rows: the first screen has at most six rows under at most three headers, and the pages add up', () => {
    const rows = manyRows(40)
    const first = pageOf(rows, 0, NOW)
    expect(first.pages).toBe(Math.ceil(40 / PER_PAGE))
    expect(first.groups.flatMap((g) => g.rows)).toHaveLength(PER_PAGE)
    expect(first.groups.length).toBeLessThanOrEqual(3)
    const all = Array.from({ length: first.pages }, (_, p) => pageOf(rows, p, NOW).groups.flatMap((g) => g.rows).length).reduce((a, b) => a + b, 0)
    expect(all).toBe(40)
  })
  it('rows are in due order, the dated before the undated', () => {
    const ids = pageOf(ROWS.filter((r) => r.state === 'new' && r.id !== 'r10'), 0, NOW).groups.flatMap((g) => g.rows.map((r) => r.id))
    expect(ids.slice(0, 3)).toEqual(['r9', 'r1', 'r2'])
  })
  it('a page past the end is held at the last page', () => {
    expect(pageOf(ROWS, 99, NOW).page).toBe(pageOf(ROWS, 99, NOW).pages - 1)
  })
})

describe('the rules that keep a press his', () => {
  it('only a new, dated, clear row with a confirmed subject is in the batch', () => {
    const eligible = ROWS.filter(batchEligible).map((r) => r.id)
    expect(eligible).toEqual(['r2', 'r5', 'r8', 'r9'])
    expect(batchEligible(byId('r4'))).toBe(false) // ambiguous
    expect(batchEligible(byId('r1'))).toBe(false) // only a suggestion, not confirmed
    expect(batchEligible(byId('r6'))).toBe(false) // a file is taken, not accepted
    expect(batchEligible(byId('r11'))).toBe(false) // already decided
  })
  it('an ambiguous date cannot be accepted until one reading is chosen; a file is never accepted', () => {
    expect(canAccept(byId('r4'), {})).toBe(false)
    expect(canAccept(byId('r4'), { date: '2026-12-03' })).toBe(true)
    expect(canAccept(byId('r1'), {})).toBe(true)
    expect(canAccept(byId('r6'), {})).toBe(false)
  })
  it('a new row left alone for 14 days is older; a decided row never is', () => {
    expect(OLDER_DAYS).toBe(14)
    expect(isOlder(byId('r10'), NOW)).toBe(true)
    expect(isOlder(byId('r1'), NOW)).toBe(false)
    expect(isOlder({ ...byId('r10'), state: 'accepted' }, NOW)).toBe(false)
  })
})

describe('provenance and the ladder', () => {
  it('every source says where it came from, with the line or file when the store kept it', () => {
    expect(provenanceLine(byId('r1'), NOW)).toContain('a pasted line')
    expect(provenanceLine(byId('r1'), NOW)).toContain('Maths Assignment 3 - due 18 Nov 5pm')
    expect(provenanceLine(byId('r3'), NOW)).toContain('a calendar file')
    expect(provenanceLine(byId('r6'), NOW)).toContain('notes-unit4.pdf')
    expect(provenanceLine(byId('r6'), NOW)).toContain('your watched folder')
  })
  it('a file he saved himself skips LINKED and ASKED; a taken file is read; the next rung is named', () => {
    const own = ladderOf(byId('r6'))
    expect(own.map((r) => r.state)).toEqual(['skipped', 'skipped', 'done', 'next', 'later'])
    expect(ladderOf({ ...byId('r6'), state: 'taken' }).map((r) => r.state)).toEqual(['skipped', 'skipped', 'done', 'done', 'done'])
  })
  it('a Classroom file starts on its own rungs (the connector can reach LINKED alone)', () => {
    const c = ladderOf({ ...byId('r6'), source: 'classroom', ladder: 'linked' })
    expect(c.map((r) => r.state)).toEqual(['done', 'next', 'later', 'later', 'later'])
  })
  it('file sizes in words', () => {
    expect(sizeWords(482_000)).toBe('471 KB')
    expect(sizeWords(3_200_000)).toBe('3.1 MB')
  })
})

describe('the fixture reader (a gallery stand-in, not the engine parser)', () => {
  it('reads a title, a date and an optional time, and lists what it cannot read', () => {
    const r = fixtureReadLine('Maths Assignment 4 - due 25 Nov 5pm', 'x', NOW)!
    expect([r.title, r.date, r.time]).toEqual(['Maths Assignment 4', '2026-11-25', '17:00'])
    expect(fixtureReadLine('Signals Lab 3 - due 2 Dec', 'x', NOW)!.time).toBeNull()
    expect(fixtureReadLine('Circuits viva on Thursday', 'x', NOW)).toBeNull()
    expect(fixtureReadLine('Quiz - due 31 Zzz', 'x', NOW)).toBeNull()
  })
  it('reads events, skips one with no start and marks a repeating one', () => {
    const res = fixtureReadIcs('BEGIN:VEVENT\nSUMMARY:A\nDTSTART:20261124T100000\nRRULE:FREQ=WEEKLY\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:B\nEND:VEVENT', 'i-', NOW)
    expect(res.items).toHaveLength(1)
    expect(res.items[0]).toMatchObject({ title: 'A', date: '2026-11-24', time: '10:00', repeats: true })
    expect(res.skipped).toBe(1)
  })
})
