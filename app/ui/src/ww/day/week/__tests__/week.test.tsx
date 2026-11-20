// L03 Day / Week: the margin arithmetic, the rack, the move, and the page on the fixture port (SIMULATED) and the null port (WAITING).
import { afterEach, describe, expect, it } from 'vitest'
import { DAY_PORT } from '../../ports'
import { WeekPage } from '../Week'
import { FIXTURE_ATTENDANCE, FIXTURE_MINUTES, FIXTURE_STALE, FIXTURE_TODAY, createWeekPort } from '../fixtures'
import { LIVE_DAYS, byMargin, daysSince, fmtMinutes, ledgerReading, marginLine, marginOf, moveTarget, needOf, plannedMinutes, rackItems, weekDates, weekLabel, weekStart, type RackClass, type WeekBlock } from '../model'
import { view as weekView } from '../../../../shell/views/day-week.view'
import { buttons, cleanup, click, flush, keyDown, render } from '../../../../shared/almanac/__tests__/dom'

afterEach(cleanup)

describe('margin arithmetic (20.5.3)', () => {
  it('is floor((attended - r x held) / r), exact on the line and one below it', () => {
    expect(marginOf(11, 12, 0.75)).toBe(2)
    expect(marginOf(9, 12, 0.75)).toBe(0)
    expect(marginOf(9, 10, 0.75)).toBe(2)
    expect(marginOf(7, 11, 0.75)).toBe(-2)
    expect(marginOf(0, 0, 0.75)).toBe(0)
    expect(marginOf(5, 5, 0)).toBe(0)
  })
  it('leaving out m classes keeps the share at or above r exactly for m <= margin (table of 60 rows)', () => {
    for (const r of [0.6, 0.75, 0.8]) for (let held = 5; held <= 24; held++) for (let att = 0; att <= held; att += 3) {
      const m = marginOf(att, held, r)
      if (m >= 0) {
        expect(att / (held + m)).toBeGreaterThanOrEqual(r - 1e-9)
        expect(att / (held + m + 1)).toBeLessThan(r + 1e-9)
      }
    }
  })
  it('needs n classes in a row to reach the line, and none at or above it', () => {
    expect(needOf(7, 11, 0.75)).toBe(5)
    expect((7 + 5) / (11 + 5)).toBeGreaterThanOrEqual(0.75)
    expect((7 + 4) / (11 + 4)).toBeLessThan(0.75)
    expect(needOf(9, 12, 0.75)).toBe(0)
    expect(needOf(0, 0, 0.75)).toBe(0)
  })
  it('words a row as margin, never as a warning; below the line it says what reaches it', () => {
    const row = (held: number, attended: number) => ({ subject: 'x', name: 'x', held, attended, last: null })
    expect(marginLine(row(12, 11), 0.75).text).toBe('margin +2')
    expect(marginLine(row(12, 9), 0.75).text).toBe('margin 0')
    expect(marginLine(row(11, 7), 0.75)).toMatchObject({ tone: 'below', text: 'needs 5 classes to reach 75%' })
    expect(marginLine(row(3, 2), 0.75).tone).toBe('few')
    expect(marginLine(row(0, 0), 0.75).tone).toBe('none')
    expect(marginLine(row(11, 7), 0.75).formula).toContain('floor((7 - 0.75 x 11) / 0.75)')
    for (const t of ['bunk', 'skip', 'fail', 'danger', 'warning']) expect(JSON.stringify(marginLine(row(11, 7), 0.75)).toLowerCase()).not.toContain(t)
  })
  it('orders the least margin first and a subject with too few classes last', () => {
    const rows = FIXTURE_ATTENDANCE.subjects.map((s) => ({ subject: s.subject, name: s.name, held: s.held, attended: s.attended, last: s.last }))
    expect(byMargin(rows, 0.75).map((r) => r.subject)).toEqual(['FC', 'FB', 'FA', 'FD', 'FE'])
  })
  it('is LIVE only when a class was entered today, else WAITING with how long ago; SIMULATED for the bench', () => {
    const rows = (last: string | null) => [{ subject: 'a', name: 'a', held: 6, attended: 5, last }]
    expect(LIVE_DAYS).toBe(0)
    expect(ledgerReading(rows(FIXTURE_TODAY), FIXTURE_TODAY)).toMatchObject({ state: 'live' })
    expect(ledgerReading(rows('2026-11-09'), FIXTURE_TODAY)).toEqual({ state: 'waiting', reason: 'last entered 9 days ago' })
    expect(ledgerReading(rows(null), FIXTURE_TODAY).state).toBe('waiting')
    expect(ledgerReading(rows(FIXTURE_TODAY), FIXTURE_TODAY, true).state).toBe('simulated')
    expect(daysSince('2026-11-17', FIXTURE_TODAY)).toBe(1)
  })
})

describe('the week, the rack and the move', () => {
  it('starts weeks on Monday and labels them across a month end', () => {
    expect(weekStart('2026-11-18')).toBe('2026-11-16')
    expect(weekStart('2026-11-22')).toBe('2026-11-16')
    expect(weekDates('2026-11-16')).toHaveLength(7)
    expect(weekLabel('2026-11-16')).toBe('16 to 22 Nov')
    expect(weekLabel('2026-11-30')).toBe('30 Nov to 6 Dec')
  })
  it('puts a free-slot plate wherever two classes leave 20 minutes or more', () => {
    const c = (id: string, start: string, end: string): RackClass => ({ id, start, end, name: id, status: null })
    const items = rackItems([c('b', '11:00', '11:50'), c('a', '09:00', '09:50'), c('c', '12:00', '12:50'), c('d', '13:10', '14:00')])
    expect(items.map((i) => i.type)).toEqual(['class', 'free', 'class', 'class', 'free', 'class'])
    expect(items[1]).toMatchObject({ type: 'free', minutes: 70 })
    expect(fmtMinutes(70)).toBe('1 h 10 m')
    expect(fmtMinutes(45)).toBe('45 m')
  })
  it('moves a target one day at a time and holds it inside the week', () => {
    const d = weekDates('2026-11-16')
    expect(moveTarget(d, d[2], 1)).toBe(d[3])
    expect(moveTarget(d, d[0], -1)).toBe(d[0])
    expect(moveTarget(d, d[6], 1)).toBe(d[6])
  })
  it('prints planned minutes only from planned blocks that carry minutes', () => {
    const b = (status: WeekBlock['status'], minutes?: number): WeekBlock => ({ id: 'i', date: 'd', time: null, kind: 'study', text: 't', status, state: 'live', movable: false, minutes })
    expect(plannedMinutes([b('planned', 30), b('planned', 20), b('done', 50)])).toBe(50)
    expect(plannedMinutes([b('planned'), b('done', 50)])).toBeNull()
  })
})

const mount = async (props: Partial<Parameters<typeof WeekPage>[0]> = {}) => {
  const port = createWeekPort()
  const r = render(<WeekPage today={FIXTURE_TODAY} form="desk" port={port} minutes={FIXTURE_MINUTES} attendance={FIXTURE_ATTENDANCE} simulated {...props} />)
  await flush(8)
  return { c: r.container, port }
}
const block = (c: HTMLElement, id: string) => c.querySelector<HTMLButtonElement>(`.wk-block[data-id="${id}"]`)!

describe('Day / Week on the fixture port', () => {
  it('stamps the page SIMULATED and draws seven day columns with today marked', async () => {
    const { c } = await mount()
    expect(c.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('simulated')
    expect(c.querySelectorAll('.wk-day')).toHaveLength(7)
    expect(c.querySelector('.wk-day[data-today]')!.getAttribute('data-date')).toBe(FIXTURE_TODAY)
    expect(c.querySelector('.dy-title')!.textContent).toContain('16 to 22 Nov')
  })
  it('draws a planned block hollow and a done one solid, each with its word', async () => {
    const { c } = await mount()
    const planned = c.querySelector<HTMLElement>('.wk-block[data-status="planned"]')!
    const done = c.querySelector<HTMLElement>('.wk-block[data-status="done"]')!
    expect(planned.querySelector('.wk-block-meta')!.textContent).toContain('planned')
    expect(done.querySelector('.wk-block-meta')!.textContent).toContain('done')
    expect(planned.getAttribute('aria-label')).toContain('planned')
    expect(done.getAttribute('aria-label')).toContain('done')
  })
  it('moves a planned block with m, Right, Enter through the port, and Esc leaves it where it was', async () => {
    const { c, port } = await mount()
    const b = block(c, '2026-11-19-ps0')
    expect(b.dataset.movable).toBe('true')
    b.focus()
    keyDown(b, 'm')
    await flush(2)
    expect(c.querySelector('.wk-line')!.textContent).toContain('Moving')
    expect(c.querySelector('.wk-line')!.textContent).toContain('Thu 19 Nov')
    keyDown(b, 'ArrowRight')
    await flush(2)
    expect(c.querySelector('.wk-line')!.textContent).toContain('Fri 20 Nov')
    expect(c.querySelector('.wk-day[data-date="2026-11-20"]')!.getAttribute('data-landing')).toBe('true')
    keyDown(b, 'Escape')
    await flush(2)
    expect(port.calls).toHaveLength(0)
    expect(c.querySelector('.wk-line')!.textContent).toContain('Move cancelled')
    keyDown(b, 'm')
    keyDown(b, 'ArrowRight')
    keyDown(b, 'Enter')
    await flush(8)
    expect(port.calls).toEqual([{ op: 'move', date: '2026-11-19', id: '2026-11-19-ps0', to: '2026-11-20' }])
    expect(c.querySelector('.wk-day[data-date="2026-11-20"]')!.textContent).toContain('fixture topic 4')
  })
  it('says a done block cannot move, and a WAITING port saves nothing', async () => {
    const { c } = await mount()
    const done = c.querySelector<HTMLButtonElement>('.wk-block[data-status="done"]')!
    keyDown(done, 'm')
    await flush(2)
    expect(c.querySelector('.wk-line')!.textContent).toContain('Only a planned block can move')
    cleanup()
    const w = await mount({ port: { ...createWeekPort(), logs: DAY_PORT.logs } })
    const b = block(w.c, '2026-11-19-ps0')
    keyDown(b, 'm')
    keyDown(b, 'ArrowRight')
    keyDown(b, 'Enter')
    await flush(8)
    expect(w.c.querySelector('.wk-line')!.textContent).toContain('Nothing was saved')
    expect(w.c.querySelector('.wk-day[data-date="2026-11-19"]')!.textContent).toContain('fixture topic 4')
  })
  it('prints the formula of the focused margin row and draws the line the student set', async () => {
    const { c } = await mount()
    const rows = [...c.querySelectorAll<HTMLButtonElement>('.wk-margin')]
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('needs 5 classes to reach 75%')
    expect(rows[0].querySelectorAll('.wk-dot-on')).toHaveLength(13)
    expect(rows[0].querySelector('.wk-tick-half')).not.toBeNull()
    expect(rows[1].querySelector('.wk-tick')).not.toBeNull()
    rows[1].focus()
    rows[1].dispatchEvent(new FocusEvent('focus'))
    await flush(2)
    rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(c.querySelector('.wk-margins')).not.toBeNull()
  })
  it('opens every subject behind one key', async () => {
    const { c } = await mount()
    click(buttons(c, 'All 5')[0])
    await flush(6)
    expect(document.body.querySelector('.wk-margins-all')!.querySelectorAll('.wk-margin')).toHaveLength(5)
  })
  it('stale attendance is WAITING with how long ago and draws no figure', async () => {
    const { c } = await mount({ attendance: FIXTURE_STALE, simulated: false })
    const plate = c.querySelector('[data-callout="margins"]')!
    expect(plate.getAttribute('data-lamp')).toBe('waiting')
    expect(plate.textContent).toContain('last entered 9 days ago')
    expect(plate.querySelectorAll('.wk-dot-on')).toHaveLength(0)
    expect(plate.textContent).not.toMatch(/margin [+0-9]/)
  })
})

describe('Day / Week on the null port', () => {
  it('says WAITING with the reason and draws no block and no figure', async () => {
    const { c } = await mount({ port: DAY_PORT, minutes: {}, attendance: null, simulated: false })
    expect(c.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('waiting')
    expect(c.querySelector('.dy-why')!.textContent).toContain('not connected')
    expect(c.querySelectorAll('.wk-block')).toHaveLength(0)
    expect(c.querySelector('[data-callout="margins"]')!.getAttribute('data-lamp')).toBe('waiting')
  })
  it('draws what the stores know as LIVE', async () => {
    const { c } = await mount({ port: DAY_PORT, simulated: false })
    expect(c.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('live')
    expect(c.querySelector('.wk-day[data-today] .wk-block[data-kind="study"]')!.textContent).toContain('45 min')
  })
})

describe('registration', () => {
  it('registers day.week for the ww product behind a lazy load', () => {
    expect(weekView.id).toBe('day.week')
    expect(weekView.product).toBe('ww')
    expect(typeof weekView.load).toBe('function')
  })
})
