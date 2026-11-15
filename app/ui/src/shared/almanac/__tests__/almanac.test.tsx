// L01 Almanac: the shape table is the fixture (nine kinds, no shape shared), what a cell may show (a count only for a LIVE or
// SIMULATED source), the month arithmetic, the year columns, and the keyboard (one tab stop, arrow roving, PageDown, t, w, m, y, n).
import { act, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Almanac, DayMark, KINDS, SHAPES, SHAPE_NAMES, StippleStrip, cellView, dotsFor, levelOf, monthGrid, monthReading, mergeDays, nextFocus, pageLamp, shapeOf, yearColumns } from '..'
import type { DayData, Kind } from '..'
import { cleanup, click, keyDown, render } from './dom'

afterEach(cleanup)

const day = (date: string, over: Partial<DayData> = {}): DayData => ({ date, marks: [], minutes: null, state: 'live', ...over })

// the table of 20.6.1, written out here a second time on purpose: a change to SHAPES must be a change to this table too
const TABLE: Record<Kind, [string, string]> = {
  study: ['disc', 'ring'],
  class: ['square', 'square-outline'],
  body: ['triangle', 'triangle-outline'],
  water: ['drop', 'drop-outline'],
  spend: ['bar', 'bar-outline'],
  rest: ['dash', 'dash'],
  intent: ['diamond', 'diamond-dashed'],
  google: ['notch', 'notch-outline'],
  classroom: ['hexagon', 'hexagon-outline'],
}

describe('the shape table', () => {
  it('has the eight kinds of 20.6.1 and the classroom kind, in order', () => {
    expect([...KINDS]).toEqual(['study', 'class', 'body', 'water', 'spend', 'rest', 'intent', 'google', 'classroom'])
  })
  it('matches the fixture row by row and draws only named shapes', () => {
    for (const k of KINDS) {
      expect([SHAPES[k].done, SHAPES[k].planned], k).toEqual(TABLE[k])
      expect(SHAPE_NAMES).toContain(SHAPES[k].done)
      expect(SHAPE_NAMES).toContain(SHAPES[k].planned)
      expect(SHAPES[k].word.length).toBeGreaterThan(2)
      expect(SHAPES[k].source.length).toBeGreaterThan(2)
    }
  })
  it('never lets two kinds share a shape, and only the rest day has one shape for both forms', () => {
    const seen = new Set<string>()
    for (const k of KINDS) for (const s of new Set([SHAPES[k].done, SHAPES[k].planned])) {
      expect(seen.has(s), `${s} is used twice`).toBe(false)
      seen.add(s)
    }
    for (const k of KINDS) expect(SHAPES[k].done === SHAPES[k].planned, k).toBe(k === 'rest')
  })
  it('draws every kind filled and hollow with its shape name and an accessible name', () => {
    for (const k of KINDS) for (const done of [true, false]) {
      const { container } = render(<DayMark kind={k} done={done} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('data-shape')).toBe(shapeOf(k, done))
      expect(svg.getAttribute('data-shape')).toBe(TABLE[k][done ? 0 : 1])
      expect(svg.getAttribute('role')).toBe('img')
      expect(svg.getAttribute('aria-label')).toContain(SHAPES[k].word)
      expect(svg.querySelector('path, circle, rect'), `${k} draws nothing`).not.toBeNull()
    }
  })
  it('a decorative mark is hidden from assistive technology', () => {
    const { container } = render(<DayMark kind="study" done decorative />)
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('svg')!.hasAttribute('role')).toBe(false)
  })
})

describe('the stipple strip', () => {
  it('is one dot per 15 minutes, at most 12, then a plus', () => {
    expect(dotsFor(0)).toEqual({ dots: 0, more: false })
    expect(dotsFor(5)).toEqual({ dots: 1, more: false })
    expect(dotsFor(45)).toEqual({ dots: 3, more: false })
    expect(dotsFor(180)).toEqual({ dots: 12, more: false })
    expect(dotsFor(195)).toEqual({ dots: 12, more: true })
    const { container } = render(<StippleStrip minutes={300} />)
    expect(container.querySelectorAll('i').length).toBe(12)
    expect(container.querySelector('b')?.textContent).toBe('+')
  })
})

describe('what a cell may show', () => {
  const marks = (state: DayData['state']) => [{ kind: 'study' as const, done: true, count: 2, state }, { kind: 'class' as const, done: false, count: 1, state }]

  it('draws counts and the strip for a LIVE source', () => {
    const v = cellView('2026-11-10', day('2026-11-10', { marks: marks('live'), minutes: 70 }), undefined)
    expect(v.marks.map((m) => m.count)).toEqual([2, 1])
    expect(v.dots).toBe(4)
    expect(v.text).toBe('2 study blocks, 1 class planned')
  })
  it('draws counts for a SIMULATED source too (the bench), never for the others', () => {
    expect(cellView('2026-11-10', day('2026-11-10', { marks: marks('simulated'), minutes: 30, state: 'simulated' }), undefined).marks[0].count).toBe(2)
    for (const state of ['waiting', 'planned', 'fault'] as const) {
      const v = cellView('2026-11-10', day('2026-11-10', { marks: marks(state), minutes: 90, state }), undefined)
      expect(v.dots, state).toBeNull()
      expect(v.marks.every((m) => m.count === null), state).toBe(true)
      expect(/\d/.test(v.text), `${state}: "${v.text}"`).toBe(false)
    }
  })
  it('draws nothing at all for a WAITING or FAULT mark, and a hollow mark with no count for a PLANNED one', () => {
    expect(cellView('2026-11-10', day('2026-11-10', { marks: marks('waiting'), state: 'waiting' }), undefined).marks).toEqual([])
    expect(cellView('2026-11-10', day('2026-11-10', { marks: marks('fault'), state: 'fault' }), undefined).marks).toEqual([])
    const p = cellView('2026-11-10', day('2026-11-10', { marks: [{ kind: 'google', done: false, count: 1, state: 'planned' }], state: 'planned' }), undefined)
    expect(p.marks).toEqual([{ kind: 'google', done: false, count: null, state: 'planned' }])
    expect(p.text).toBe('Google event, planned')
  })
  it('says so when no record was read, and when a read day is empty', () => {
    expect(cellView('2026-11-10', undefined, undefined).text).toBe('no record read')
    expect(cellView('2026-11-10', day('2026-11-10'), undefined).text).toBe('nothing logged')
    expect(cellView('2026-11-10', day('2026-11-10', { state: 'waiting' }), undefined).text).toBe('no figure, waiting')
  })
  it('turns an exam date into a planned Classroom mark with its label', () => {
    const v = cellView('2026-11-25', undefined, { date: '2026-11-25', label: 'Fixture paper A' })
    expect(v.marks).toEqual([{ kind: 'classroom', done: false, count: null, state: 'planned' }])
    expect(v.text).toContain('exam: Fixture paper A')
  })
  it('leaves out the kinds that are switched off, and marks a rest day', () => {
    const d = day('2026-11-10', { marks: marks('live'), rest: true })
    const v = cellView('2026-11-10', d, undefined, new Set<Kind>(['class', 'rest']))
    expect(v.marks.map((m) => m.kind)).toEqual(['class'])
    expect(v.rest).toBe(true)
    expect(cellView('2026-11-10', d, undefined, new Set<Kind>(['class'])).rest).toBe(false)
  })
  it('weighs a done mark before a planned one when a cell has room for one', () => {
    const v = cellView('2026-11-10', day('2026-11-10', { marks: [{ kind: 'class', done: false, count: 1, state: 'live' }, { kind: 'body', done: true, count: 1, state: 'live' }] }), undefined)
    expect(v.marks[0].kind).toBe('body')
  })
})

describe('the month arithmetic', () => {
  it('lays out six Mondays-first rows from the Monday on or before the 1st', () => {
    const g = monthGrid('2026-11')
    expect(g.length).toBe(42)
    expect(g[0].date).toBe('2026-10-26')
    expect(g[6].date).toBe('2026-11-01')
    expect(g.filter((c) => c.inMonth).length).toBe(30)
    expect(g[41].date).toBe('2026-12-06')
  })
  it('counts the marks of a month by kind, LIVE or SIMULATED only, and adds no ratio', () => {
    const days = [
      day('2026-11-02', { marks: [{ kind: 'study', done: true, count: 3, state: 'live' }, { kind: 'study', done: false, count: 1, state: 'live' }] }),
      day('2026-11-03', { marks: [{ kind: 'google', done: false, count: 4, state: 'planned' }] }),
      day('2026-12-01', { marks: [{ kind: 'study', done: true, count: 9, state: 'live' }] }),
    ]
    const r = monthReading(days, '2026-11')
    expect(r.perKind).toEqual([{ kind: 'study', done: 3, planned: 1 }])
    expect(r.done).toBe(3)
    expect(r.planned).toBe(1)
    expect(Object.keys(r).sort()).toEqual(['counted', 'done', 'perKind', 'planned'])
    expect(monthReading([], '2026-11').counted).toBe(false)
    expect(monthReading(days, '2026', new Set<Kind>(['study'])).done).toBe(12)
  })
  it('stamps the page SIMULATED when any day holds a fixture, and WAITING when nothing was read', () => {
    expect(pageLamp([])).toBe('waiting')
    expect(pageLamp([day('2026-11-02', { state: 'live' }), day('2026-11-03', { state: 'simulated' })])).toBe('simulated')
    expect(pageLamp([day('2026-11-02')])).toBe('live')
    expect(pageLamp([], ['planned'])).toBe('planned')
  })
  it('merges sources: marks add up by kind, state and doneness; the first source keeps the minutes', () => {
    const a = [day('2026-11-02', { marks: [{ kind: 'study', done: true, count: 1, state: 'live' }], minutes: 40 })]
    const b = [day('2026-11-02', { marks: [{ kind: 'study', done: true, count: 2, state: 'live' }, { kind: 'google', done: false, count: 1, state: 'simulated' }], minutes: 99 })]
    const m = mergeDays(a, null, b)
    expect(m.length).toBe(1)
    expect(m[0].minutes).toBe(40)
    expect(m[0].marks.find((x) => x.kind === 'study')!.count).toBe(3)
    expect(m[0].marks.length).toBe(2)
  })
  it('builds a year of week columns from the Monday on or before 1 January, and four densities', () => {
    const cols = yearColumns(2026)
    expect(cols.length).toBe(53)
    expect(cols[0][0].date).toBe('2025-12-29')
    expect(cols[0][3].date).toBe('2026-01-01')
    expect(cols[0][3].inYear).toBe(true)
    expect(cols[0][0].inYear).toBe(false)
    expect(cols[52][6].date).toBe('2027-01-03')
    expect([0, 10, 45, 90, 400].map((minutes) => levelOf(day('2026-11-02', { minutes })))).toEqual([0, 1, 2, 3, 4])
    expect(levelOf(day('2026-11-02', { minutes: 400, state: 'waiting' }))).toBe(0)
  })
  it('moves by arrow, Home and End across a Monday-first week', () => {
    expect(nextFocus('2026-11-18', 'ArrowRight')).toBe('2026-11-19')
    expect(nextFocus('2026-11-18', 'ArrowDown')).toBe('2026-11-25')
    expect(nextFocus('2026-11-18', 'Home')).toBe('2026-11-16')
    expect(nextFocus('2026-11-18', 'End')).toBe('2026-11-22')
    expect(nextFocus('2026-11-18', 'x')).toBeNull()
  })
})

describe('the Almanac in a page', () => {
  const live: DayData[] = [
    day('2026-11-10', { marks: [{ kind: 'study', done: true, count: 2, state: 'live' }], minutes: 70 }),
    day('2026-11-11', { marks: [{ kind: 'study', done: true, count: 3, state: 'waiting' }], minutes: 120, state: 'waiting' }),
  ]
  const cell = (c: HTMLElement, d: string) => c.querySelector<HTMLButtonElement>(`button[data-date="${d}"]`)!

  it('draws the strip and the counts for the LIVE day and nothing numeric for the WAITING one', () => {
    const { container } = render(<Almanac mode="month" days={live} month="2026-11" today="2026-11-15" onPick={() => {}} />)
    expect(cell(container, '2026-11-10').querySelectorAll('.alm-strip i').length).toBe(4)
    expect(cell(container, '2026-11-10').getAttribute('aria-label')).toContain('2 study blocks')
    expect(cell(container, '2026-11-11').querySelectorAll('.alm-strip').length).toBe(0)
    expect(cell(container, '2026-11-11').getAttribute('aria-label')).toContain('no figure, waiting')
    expect(cell(container, '2026-11-11').querySelectorAll('.alm-mark').length).toBe(0)
  })
  it('shows the still skeleton on every cell when nothing has been read', () => {
    const { container } = render(<Almanac mode="month" days={[]} state="waiting" month="2026-11" today="2026-11-15" onPick={() => {}} />)
    expect(container.querySelectorAll('.alm-skel').length).toBe(42)
    expect(container.querySelectorAll('.alm-mark').length).toBe(0)
    expect(container.querySelector('button[data-date="2026-11-10"]')!.getAttribute('aria-label')).toContain('no record read')
  })
  it('has exactly one tab stop, on today, and roving moves it', () => {
    const { container } = render(<Almanac mode="month" days={[]} month="2026-11" today="2026-11-15" onPick={() => {}} />)
    const stops = () => [...container.querySelectorAll<HTMLButtonElement>('button.alm-cell')].filter((b) => b.tabIndex === 0).map((b) => b.dataset.date)
    expect(stops()).toEqual(['2026-11-15'])
    act(() => cell(container, '2026-11-15').focus())
    keyDown(cell(container, '2026-11-15'), 'ArrowRight')
    expect(stops()).toEqual(['2026-11-16'])
    expect(document.activeElement).toBe(cell(container, '2026-11-16'))
    keyDown(document.activeElement!, 'ArrowDown')
    expect(stops()).toEqual(['2026-11-23'])
    keyDown(document.activeElement!, 'End')
    expect(stops()).toEqual(['2026-11-29'])
    keyDown(document.activeElement!, 'Home')
    expect(stops()).toEqual(['2026-11-23'])
    expect(container.querySelectorAll('button').length).toBe(42)
  })
  it('asks for the next month at the edge, and PageDown, t, w, m, y and n reach the page', () => {
    const calls: string[] = []
    const { container } = render(
      <Almanac mode="month" days={[]} month="2026-11" today="2026-11-30" onPick={() => {}}
        onMonth={(d) => calls.push(`month${d}`)} onMode={(m) => calls.push(`mode:${m}`)} onToday={() => calls.push('today')} onAdd={(d) => calls.push(`add:${d}`)} />,
    )
    act(() => cell(container, '2026-11-30').focus())
    keyDown(document.activeElement!, 'ArrowRight')
    expect(calls).toEqual(['month1'])
    // the page did not change the month prop, so the tab stop stays on the old grid: use the root for the shortcuts
    for (const k of ['PageDown', 'PageUp', 't', 'w', 'm', 'y']) keyDown(container.querySelector('.alm')!, k)
    expect(calls.slice(1)).toEqual(['month1', 'month-1', 'today', 'mode:week', 'mode:month', 'mode:year'])
  })
  it('adds an intent on the focused day with n', () => {
    const onAdd = vi.fn()
    const { container } = render(<Almanac mode="month" days={[]} month="2026-11" today="2026-11-12" onPick={() => {}} onAdd={onAdd} />)
    keyDown(container.querySelector('.alm')!, 'n')
    expect(onAdd).toHaveBeenCalledWith('2026-11-12')
  })
  it('does not take a shortcut while typing in a field', () => {
    const onMode = vi.fn()
    const { container } = render(<div><input aria-label="x" /><Almanac mode="month" days={[]} month="2026-11" today="2026-11-15" onPick={() => {}} onMode={onMode} /></div>)
    keyDown(container.querySelector('input')!, 'y')
    expect(onMode).not.toHaveBeenCalled()
  })
  it('opens the day on a click and marks the open day', () => {
    const picked: string[] = []
    function Page() {
      const [sel, setSel] = useState<string | null>(null)
      return <Almanac mode="month" days={[]} month="2026-11" today="2026-11-15" selected={sel} onPick={(d) => { picked.push(d); setSel(d) }} />
    }
    const { container } = render(<Page />)
    click(cell(container, '2026-11-12'))
    expect(picked).toEqual(['2026-11-12'])
    expect(cell(container, '2026-11-12').getAttribute('data-selected')).toBe('true')
  })
  it('wears the today ring and the pressed tile outside the month', () => {
    const { container } = render(<Almanac mode="month" days={[]} month="2026-11" today="2026-11-15" onPick={() => {}} />)
    expect(cell(container, '2026-11-15').getAttribute('aria-current')).toBe('date')
    expect(cell(container, '2026-11-15').querySelectorAll('.alm-ring circle').length).toBe(12)
    expect(cell(container, '2026-10-30').getAttribute('data-inmonth')).toBe('false')
  })
  it('shows a rest day with the word Rest', () => {
    const { container } = render(<Almanac mode="month" days={[day('2026-11-15', { rest: true })]} month="2026-11" today="2026-11-18" onPick={() => {}} />)
    expect(cell(container, '2026-11-15').querySelector('.alm-rest')?.textContent).toBe('Rest')
    expect(cell(container, '2026-11-15').getAttribute('aria-label')).toContain('rest day')
  })
  it('keeps the phone cell to its strongest mark with a dot for the rest', () => {
    const d = day('2026-11-10', { marks: [{ kind: 'class', done: false, count: 1, state: 'live' }, { kind: 'study', done: true, count: 1, state: 'live' }], minutes: 30 })
    const { container } = render(<Almanac mode="month" days={[d]} month="2026-11" today="2026-11-15" form="phone" onPick={() => {}} />)
    const c = cell(container, '2026-11-10')
    expect(c.querySelectorAll('.alm-mark').length).toBe(1)
    expect(c.querySelector('.alm-mark')!.getAttribute('data-kind')).toBe('study')
    expect(c.querySelectorAll('.alm-more').length).toBe(1)
    expect(c.querySelectorAll('.alm-strip').length).toBe(0)
  })
  it('draws the year form as one focusable grid whose Enter jumps to the month', () => {
    const onJump = vi.fn()
    const { container } = render(<Almanac mode="year" days={[day('2026-11-10', { minutes: 100, marks: [] })]} month="2026-11" today="2026-11-18" onPick={() => {}} onJump={onJump} />)
    const grid = container.querySelector<HTMLElement>('.alm-ygrid')!
    expect(grid.tabIndex).toBe(0)
    expect(container.querySelectorAll('.alm-yc').length).toBe(7 * 53)
    expect(container.querySelector('.alm-yc[data-date="2026-11-10"]')!.getAttribute('data-level')).toBe('3')
    keyDown(grid, 'Enter')
    expect(onJump).toHaveBeenCalledWith('2026-11')
    expect(container.querySelectorAll('.alm-ykey').length).toBe(12)
  })
  it('says the week and day forms are not built, with no borrowed content', () => {
    const { container } = render(<Almanac mode="week" days={[]} month="2026-11" today="2026-11-18" onPick={() => {}} />)
    expect(container.querySelector('.alm-notbuilt')?.textContent).toContain('not built yet')
    expect(container.querySelectorAll('button').length).toBe(0)
  })
})

describe('the copy', () => {
  it('holds none of the banned words of 20.6.7 in the strings of the kinds', () => {
    const banned = /streak|failed|missed|clean|relapse|disorder|treat|diagnos/i
    expect(banned.test(JSON.stringify(SHAPES))).toBe(false)
  })
})
