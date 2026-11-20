// L03 review fixes: a source that has not answered is never read as "none", a broken read is FAULT with a way to try again, a write that
// throws says nothing was saved, the move keys belong to the moving block, and a habit count is drawn only from a read that answered.
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BodyPage } from '../../body/Body'
import { ClosePage } from '../../close/Close'
import { createFixtureStores, type FixtureStores } from '../../ledger/fixtures'
import type { LedgerStores } from '../../ledger/stores'
import { WeekPage, weekLamp } from '../Week'
import { FIXTURE_ATTENDANCE, FIXTURE_MINUTES, FIXTURE_NOW, FIXTURE_SESSIONS, FIXTURE_TODAY, createWeekPort } from '../fixtures'
import { buttons, cleanup, click, flush, keyDown, render } from '../../../../shared/almanac/__tests__/dom'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

const BOOM = async () => { throw new Error('the store threw') }
const type = (el: HTMLInputElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('Week: a broken read, a throwing write, the move keys', () => {
  const mountWeek = async (port = createWeekPort()) => {
    const r = render(<WeekPage today={FIXTURE_TODAY} form="desk" port={port} minutes={FIXTURE_MINUTES} attendance={FIXTURE_ATTENDANCE} simulated />)
    await flush(8)
    return { c: r.container, port }
  }

  it('a read that broke is FAULT with its reason and a Try again key, never an endless "reading the week"', async () => {
    const { c } = await mountWeek({ ...createWeekPort(), day: BOOM })
    expect(c.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('fault')
    expect(c.querySelector('.dy-why')!.textContent).toContain('could not be read')
    expect(buttons(c, 'Try again')).toHaveLength(1)
  })

  it('a write that throws says nothing was saved, and the block stays where it was', async () => {
    const port = { ...createWeekPort(), logs: BOOM }
    const { c } = await mountWeek(port)
    const b = c.querySelector<HTMLElement>('.wk-block[data-id="2026-11-19-ps0"]')!
    b.focus()
    keyDown(b, 'm')
    keyDown(b, 'ArrowRight')
    keyDown(b, 'Enter')
    await flush(8)
    expect(c.querySelector('.wk-line')!.textContent).toContain('The save did not finish. Nothing was saved.')
    expect(c.querySelector('.wk-day[data-date="2026-11-19"]')!.textContent).toContain('fixture topic 4')
  })

  it('Enter on Next week during a move is the key\'s own press, not the placing of the block', async () => {
    const { c, port } = await mountWeek()
    const b = c.querySelector<HTMLElement>('.wk-block[data-id="2026-11-19-ps0"]')!
    b.focus()
    keyDown(b, 'm')
    await flush(2)
    const next = buttons(c, 'Next week')[0] ?? c.querySelector<HTMLElement>('[aria-label="Next week"]')!
    keyDown(next, 'Enter')
    keyDown(next, 'ArrowRight')
    await flush(4)
    expect(port.calls).toHaveLength(0)
    expect(c.querySelector('.wk-line')!.textContent).toContain('Moving')
  })

  it('a block and a margin row are not buttons: they are focusable groups, so nothing announces a press that does nothing', async () => {
    const { c } = await mountWeek()
    expect(c.querySelectorAll('button.wk-block, button.wk-margin')).toHaveLength(0)
    expect(c.querySelector('.wk-block')!.getAttribute('role')).toBe('group')
    expect(c.querySelector('.wk-notch')!.hasAttribute('aria-label')).toBe(false)
    expect(c.querySelector('.wk-day[data-today]')!.getAttribute('aria-current')).toBe('date')
  })

  it('prints the formula of the focused margin row, with its numbers', async () => {
    const { c } = await mountWeek()
    const rows = [...c.querySelectorAll<HTMLElement>('.wk-margin')]
    expect(c.querySelector('.wk-formula')!.textContent).toContain('Focus a row')
    act(() => { rows[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    await flush(2)
    const f = c.querySelector('.wk-formula')!.textContent!
    expect(f).toContain('floor((')
    expect(f).toContain('9 - 0.75 x 12')
  })

  it('a free slot opens the capture line with its start time already typed', async () => {
    const { c } = await mountWeek()
    const free = c.querySelector<HTMLButtonElement>('button.wk-free')!
    expect(free).not.toBeNull()
    click(free)
    await flush(8)
    const input = document.body.querySelector<HTMLInputElement>('.wk-sheet input')!
    expect(input.value).toBe('remind me today 09:50 ')
  })

  it('the header names a day log that is still waiting when other columns are live', () => {
    const waiting = { state: 'waiting' as const, reason: 'the day log is not connected yet', since: null, data: null }
    const l = weekLamp([waiting], true)
    expect(l.state).toBe('live')
    expect(l.reason).toContain('the day log is waiting')
  })
})

describe('Body and Close: nothing is said about a source that has not answered', () => {
  it('Close, unread: WAITING with the reasons, and neither "no class today" nor "none logged yet"', async () => {
    const r = render(<ClosePage today={FIXTURE_TODAY} form="desk" port={createWeekPort()} minutes={null} classes={null} lastSeen={FIXTURE_TODAY} />)
    await flush(8)
    const c = r.container
    expect(c.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('waiting')
    expect(c.textContent).not.toContain('no class today')
    expect(c.textContent).not.toContain('none logged yet')
    expect(c.querySelector('[data-callout="today"]')!.textContent).toContain('reading the timetable')
  })

  it('Close, a source that broke: FAULT over WAITING, and the absence is still not claimed', async () => {
    const r = render(<ClosePage today={FIXTURE_TODAY} form="desk" port={createWeekPort()} minutes={null} minutesUnread={{ state: 'fault', reason: 'your plan could not be read' }} classes={[]} lastSeen={FIXTURE_TODAY} />)
    await flush(8)
    const c = r.container
    expect(c.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('fault')
    expect(c.textContent).not.toContain('none logged yet')
    expect(c.textContent).toContain('no class today')
  })

  it('Close says "no class today" only after the timetable answered with none, and says the note once', async () => {
    const r = render(<ClosePage today={FIXTURE_TODAY} form="desk" port={createWeekPort()} minutes={{}} classes={[]} lastSeen={FIXTURE_TODAY} />)
    await flush(8)
    const c = r.container
    expect(c.textContent).toContain('no class today')
    expect(c.textContent).toContain('none logged yet')
    click(buttons(c, 'Plan tomorrow')[0])
    await flush(8)
    const dr = document.body.querySelector('.cl-drawer')!
    click(dr.querySelector('[data-act="save-plan"]'))
    await flush(6)
    expect(dr.textContent).toContain('Write at least one step first.')
    expect(c.querySelector('.cl-note')!.textContent).toBe('')
  })

  it('Close, a plan store that throws: the drawer says nothing was saved', async () => {
    const r = render(<ClosePage today={FIXTURE_TODAY} form="desk" port={createWeekPort()} plan={{ save: BOOM }} minutes={{}} classes={[]} lastSeen={FIXTURE_TODAY} />)
    await flush(8)
    click(buttons(r.container, 'Plan tomorrow')[0])
    await flush(8)
    const dr = document.body.querySelector('.cl-drawer')!
    type(dr.querySelectorAll<HTMLInputElement>('.cl-row input')[1], 'stretch')
    click(dr.querySelector('[data-act="save-plan"]'))
    await flush(8)
    expect(dr.textContent).toContain('The save did not finish. Nothing was saved.')
  })

  it('Body, the timetable unread: the class reminders say so, and the remind key does nothing', async () => {
    const r = render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={createWeekPort()} stores={createFixtureStores(FIXTURE_TODAY)} sessions={FIXTURE_SESSIONS} simulated classes={null} />)
    await flush(8)
    const plate = r.container.querySelector('[data-callout="class-reminders"]')!
    expect(plate.textContent).toContain('has not been read yet')
    expect(plate.textContent).not.toContain('No class is left')
    const key = plate.querySelector<HTMLElement>('[data-act="remind-class"]')!
    expect(key.hasAttribute('aria-pressed')).toBe(false)
    const before = plate.textContent
    click(key)
    await flush(4)
    expect(plate.textContent).toBe(before)
  })

  it('Body, sessions that could not be read: the Gym plate says FAULT with the reason', async () => {
    const r = render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={createWeekPort()} stores={createFixtureStores(FIXTURE_TODAY)} sessions={null} sessionsFault="the sessions could not be read" classes={[]} />)
    await flush(8)
    expect(r.container.querySelector('[data-callout="gym"]')!.getAttribute('data-lamp')).toBe('fault')
    expect(r.container.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('fault')
  })

  it('Body, a water store that throws on a tap: the line says nothing was saved', async () => {
    const stores: LedgerStores = { ...createFixtureStores(FIXTURE_TODAY), water: { ...createFixtureStores(FIXTURE_TODAY).water, set: BOOM } }
    const r = render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={createWeekPort()} stores={stores} sessions={FIXTURE_SESSIONS} simulated classes={[]} />)
    await flush(8)
    click(r.container.querySelectorAll<HTMLButtonElement>('.by-drop')[4])
    await flush(8)
    expect(r.container.querySelector('[data-callout="water"] .dy-note')!.textContent).toContain('Nothing was saved')
  })

  it('Body: l does not open the Ledger on top of another open drawer', async () => {
    const r = render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={createWeekPort()} stores={createFixtureStores(FIXTURE_TODAY)} sessions={FIXTURE_SESSIONS} simulated classes={[]} initialLog />)
    await flush(8)
    keyDown(window, 'l')
    await flush(8)
    expect(document.body.querySelector('.lg')).toBeNull()
    expect(r.container).not.toBeNull()
  })
})

describe('the Ledger: habits drawn only from a read that answered; the limit field', () => {
  const stores = (events: LedgerStores['habits']['events']): LedgerStores => {
    const base = createFixtureStores(FIXTURE_TODAY)
    return { ...base, habits: { ...base.habits, events } }
  }
  const open = async (s: LedgerStores) => {
    render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={createWeekPort()} stores={s} sessions={FIXTURE_SESSIONS} simulated classes={[]} initialLedger />)
    await flush(12)
    return document.body.querySelector('.lg')!
  }

  it('with the habit list live and the events read waiting: no count, a hollow line, the section WAITING, Log one blocked', async () => {
    const lg = await open(stores(async () => ({ state: 'waiting', reason: 'the habit log is not connected yet', since: null, data: null })))
    const sec = [...lg.querySelectorAll<HTMLElement>('.lg-sec[data-lamp]')][1]
    expect(sec.dataset.lamp).toBe('waiting')
    expect(lg.querySelector('.lg-habit-n')!.textContent).toBe('--')
    expect(lg.querySelector('.lg-spark')!.getAttribute('data-hollow')).toBe('true')
    expect(lg.querySelector('[data-act="log-habit"]')!.getAttribute('aria-disabled')).toBe('true')
  })

  it('Enter keeps a limit, and a letter is named in words instead of being dropped', async () => {
    const s = stores(createFixtureStores(FIXTURE_TODAY).habits.events)
    const lg = await open(s)
    const field = lg.querySelector<HTMLInputElement>('.lg-limit input')!
    type(field, 'abc')
    keyDown(field, 'Enter')
    await flush(4)
    expect(lg.querySelector('.lg-limit')!.textContent).toContain('whole number')
    type(field, '4')
    keyDown(field, 'Enter')
    await flush(10)
    expect((s as FixtureStores).calls).toContain('limit:h1:4')
  })
})
