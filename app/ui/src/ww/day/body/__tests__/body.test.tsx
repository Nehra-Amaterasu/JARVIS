// L03 Day / Body and the Ledger drawer: the strip arithmetic, the drops, the stores' WAITING answers, the Ledger on the fixture stores, and the
// ribbon and the spend bands.
import { afterEach, describe, expect, it } from 'vitest'
import { DAY_PORT } from '../../ports'
import { BodyPage } from '../Body'
import { DEFAULT_GOAL, clampGoal, dateOf, lastWeekCount, nextClass, recentSessions, remindAt, sessionStrip, tapDrop, waterFrac } from '../model'
import { FIXTURE_ATTENDANCE, FIXTURE_NOW, FIXTURE_SESSIONS, FIXTURE_TODAY, createWeekPort } from '../../week/fixtures'
import { createFixtureStores } from '../../ledger/fixtures'
import { NULL_STORES } from '../../ledger/stores'
import { BANDS, bandOf, monthTotal, parseAmount, ribbon, rolling7, shares, spendColumns, tertiles } from '../../ledger/model'
import { view as bodyView } from '../../../../shell/views/day-body.view'
import { buttons, cleanup, click, flush, keyDown, render } from '../../../../shared/almanac/__tests__/dom'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('the strip and the drops', () => {
  it('counts the sessions of the last seven days, and a day with none is just an empty cell', () => {
    const strip = sessionStrip(FIXTURE_SESSIONS, FIXTURE_TODAY)
    expect(strip).toHaveLength(7)
    expect(strip[6].iso).toBe(FIXTURE_TODAY)
    expect(strip.map((d) => d.count)).toEqual([1, 1, 0, 1, 0, 1, 0])
    expect(lastWeekCount(strip)).toBe(4)
    expect(recentSessions(FIXTURE_SESSIONS)[0]).toMatchObject({ id: 's1', muscles: 'legs, core', sets: 7 })
    expect(dateOf('not a date')).toBeNull()
  })
  it('a tap fills up to the drop, and a tap on the last filled drop takes one off', () => {
    expect(tapDrop(0, 2)).toBe(3)
    expect(tapDrop(3, 5)).toBe(6)
    expect(tapDrop(3, 2)).toBe(2)
    expect(tapDrop(1, 0)).toBe(0)
    expect(clampGoal(0)).toBe(1)
    expect(clampGoal(99)).toBe(8)
    expect(clampGoal(NaN)).toBe(DEFAULT_GOAL)
    expect(waterFrac(5, 4)).toBe(1)
    expect(waterFrac(2, 8)).toBe(0.25)
  })
  it('finds the next class today and the time a reminder would show', () => {
    const cs = FIXTURE_ATTENDANCE.today.map((c) => ({ start: c.start, status: c.status }))
    expect(nextClass(cs, 10 * 60 + 20)?.start).toBe('11:00')
    expect(nextClass(cs, 17 * 60)).toBeNull()
    expect(remindAt('11:00', 10)).toBe('10:50')
  })
})

const mount = async (props: Partial<Parameters<typeof BodyPage>[0]> = {}) => {
  const stores = createFixtureStores(FIXTURE_TODAY)
  const r = render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={createWeekPort()} stores={stores} sessions={FIXTURE_SESSIONS} simulated
    classes={FIXTURE_ATTENDANCE.today.map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, status: c.status }))} {...props} />)
  await flush(8)
  return { c: r.container, stores }
}

describe('Day / Body on the fixture stores', () => {
  it('stamps SIMULATED and draws the gym log, the strip and the gauge with its count', async () => {
    const { c } = await mount()
    expect(c.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('simulated')
    expect(c.querySelectorAll('.by-day')).toHaveLength(7)
    expect(c.querySelectorAll('.by-log li')).toHaveLength(4)
    expect(c.querySelector('.by-gauge-n')!.textContent).toBe('3/8')
    expect(c.querySelectorAll('.by-drop[data-on="true"]')).toHaveLength(3)
  })
  it('a tap on a drop goes to the store, and a tap on the last filled one takes one off', async () => {
    const { c, stores } = await mount()
    const drops = c.querySelectorAll<HTMLButtonElement>('.by-drop')
    click(drops[4])
    await flush(8)
    expect(stores.calls).toContain('water:5')
    expect(c.querySelectorAll('.by-drop[data-on="true"]')).toHaveLength(5)
    click(c.querySelectorAll<HTMLButtonElement>('.by-drop')[4])
    await flush(8)
    expect(c.querySelectorAll('.by-drop[data-on="true"]')).toHaveLength(4)
  })
  it('says the reminders are the student\'s own and not medical advice, and offers no instruction', async () => {
    const { c } = await mount()
    const rem = c.querySelector('[data-callout="reminders"]')!
    expect(rem.textContent).toContain('Reminders you set. Not medical advice.')
    expect(rem.querySelectorAll('.td-rems li')).toHaveLength(2)
    expect(c.textContent).not.toMatch(/\b(take|dose|mg|calorie|kcal|weight)\b/i)
  })
  it('the class reminders are PLANNED, off, and name the next class', async () => {
    const { c } = await mount()
    const plate = c.querySelector('[data-callout="class-reminders"]')!
    expect(plate.getAttribute('data-lamp')).toBe('planned')
    expect(plate.textContent).toContain('Next class: 11:00')
    expect(plate.textContent).toContain('10:50')
    expect(plate.querySelector('[data-act="remind-class"]')!.hasAttribute('aria-pressed')).toBe(false) // the remind key is not a toggle: nothing here can switch on
  })
  it('l opens the Ledger and Esc closes it, and the key opens it too', async () => {
    const { c } = await mount()
    keyDown(window, 'l')
    await flush(8)
    expect(document.body.querySelector('.lg')).not.toBeNull()
    expect(document.body.querySelector('.ww-sheet[data-state="open"] h2')!.textContent).toBe('Ledger')
    keyDown(document.body.querySelector('.ww-sheet')!, 'Escape')
    await flush(8)
    expect(document.body.querySelector('.ww-sheet[data-state="open"]')).toBeNull()
    click(buttons(c, 'Ledger')[0])
    await flush(8)
    expect(document.body.querySelector('.ww-sheet[data-state="open"]')).not.toBeNull()
  })
})

describe('Day / Body on the null stores', () => {
  it('draws hollow forms with the reason, and a tap saves nothing', async () => {
    const { c } = await mount({ port: DAY_PORT, stores: NULL_STORES, sessions: [], simulated: false, classes: [] })
    const water = c.querySelector('[data-callout="water"]')!
    expect(water.getAttribute('data-lamp')).toBe('waiting')
    expect(c.querySelector('.by-gauge-n')!.textContent).toBe('– –')
    expect(c.querySelectorAll('.by-drop[data-waiting]')).toHaveLength(8)
    click(c.querySelector('.by-drop')!)
    await flush(6)
    expect(c.querySelector('[data-callout="water"] .dy-note')!.textContent).toContain('Nothing was saved')
    expect(c.querySelector('[data-callout="reminders"]')!.getAttribute('data-lamp')).toBe('waiting')
  })
})

describe('the Ledger drawer', () => {
  it('on the fixture stores: a month total with the word logged, an entry that goes in, a habit that can be logged and taken back', async () => {
    const { stores } = await mount({ initialLedger: true })
    await flush(10)
    const lg = document.body.querySelector('.lg')!
    expect(lg.textContent).toContain('A log you keep for yourself.')
    expect(lg.textContent).toContain('logged in November 2026')
    expect(lg.textContent).toContain('750')
    const amount = lg.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const { act } = await import('react')
    act(() => { set.call(amount, '45'); amount.dispatchEvent(new Event('input', { bubbles: true })) })
    click(lg.querySelector('[data-act="add-spend"]'))
    await flush(10)
    expect(stores.calls).toContain('spend:45')
    expect(lg.textContent).toContain('795')
    const before = lg.querySelectorAll('.lg-habit-n')[0].textContent
    click(lg.querySelector('[data-act="log-habit"]'))
    await flush(10)
    expect(lg.querySelectorAll('.lg-habit-n')[0].textContent).toBe(String(Number(before) + 1))
    click(lg.querySelector('[data-act="undo-habit"]'))
    await flush(10)
    expect(lg.querySelectorAll('.lg-habit-n')[0].textContent).toBe(before)
    expect(lg.textContent).toContain('cells = what you logged; fewer is fine')
  })
  it('on the null stores: WAITING for each section, hollow forms, the Add key disabled with its reason, and nothing invented in Help', async () => {
    await mount({ port: DAY_PORT, stores: NULL_STORES, sessions: [], simulated: false, classes: [], initialLedger: true })
    await flush(10)
    const lg = document.body.querySelector('.lg')!
    const secs = [...lg.querySelectorAll<HTMLElement>('.lg-sec[data-lamp]')]
    expect(secs.map((s) => s.dataset.lamp)).toEqual(['waiting', 'waiting'])
    expect(lg.querySelector('.lg-total-n')!.textContent).toBe('--')
    expect(lg.querySelector('[data-act="add-spend"]')!.getAttribute('aria-disabled')).toBe('true')
    expect(lg.querySelector('.lg-help')!.textContent).toContain('Nothing is listed')
  })
  it('spend bands are tertiles of the month, a short list is all middle', () => {
    expect(tertiles([10, 20, 30, 40, 50, 60])).toEqual([30, 50])
    expect(bandOf(10, [30, 50])).toBe(0)
    expect(bandOf(30, [30, 50])).toBe(1)
    expect(bandOf(60, [30, 50])).toBe(2)
    expect(bandOf(5, tertiles([5, 6]))).toBe(1)
    expect(BANDS).toHaveLength(3)
    const rows = [{ id: 'a', date: '2026-11-02', amount: 10, category: 'x', note: '' }, { id: 'b', date: '2026-11-02', amount: 15.5, category: 'y', note: '' }]
    expect(monthTotal(rows)).toBe(25.5)
    expect(spendColumns(rows, '2026-11')).toHaveLength(30)
    expect(shares(rows)[0].category).toBe('y')
    expect(parseAmount('1,250')).toBe(1250)
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('0')).toBeNull()
  })
  it('the ribbon subdivides as more is logged, an empty day is neutral, and a count can fall', () => {
    const ev = (n: number, at: string) => Array.from({ length: n }, (_, i) => ({ id: `${at}${i}`, habit: 'h', at, chip: null }))
    const events = [...ev(1, '2026-11-17'), ...ev(3, '2026-11-16'), ...ev(9, '2026-11-15')]
    const cells = ribbon(events, 'h', '2026-11-18', 28)
    expect(cells).toHaveLength(28)
    expect(cells[27]).toMatchObject({ date: '2026-11-18', grid: 0, count: 0 })
    expect(cells[26]).toMatchObject({ grid: 1, tiles: 1 })
    expect(cells[25]).toMatchObject({ grid: 2, tiles: 3 })
    expect(cells[24]).toMatchObject({ grid: 4, tiles: 9 })
    expect(rolling7(events, 'h', '2026-11-18').map((d) => d.n)).toEqual([0, 0, 0, 9, 3, 1, 0])
    expect(rolling7(events.slice(0, 1), 'h', '2026-11-18').map((d) => d.n)).toEqual([0, 0, 0, 0, 0, 1, 0])
  })
})

describe('registration', () => {
  it('registers day.body for the ww product', () => {
    expect(bodyView.id).toBe('day.body')
    expect(bodyView.product).toBe('ww')
  })
})
