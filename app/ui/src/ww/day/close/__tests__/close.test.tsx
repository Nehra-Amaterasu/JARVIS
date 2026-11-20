// L03 Day / Close: "Pick up here." only on a return, the plan drawer and its honest save, the opt-in capture, and the page on invented rows.
import { afterEach, describe, expect, it } from 'vitest'
import { ClosePage } from '../Close'
import { RETURN_AFTER, daysBetween, isReturn, lastLogged, planRows, planSentence } from '../model'
import { NULL_PLAN } from '../plan'
import { FIXTURE_ATTENDANCE, FIXTURE_MINUTES, FIXTURE_TODAY, createWeekPort } from '../../week/fixtures'
import { view as closeView } from '../../../../shell/views/day-close.view'
import { buttons, cleanup, click, flush, keyDown, render } from '../../../../shared/almanac/__tests__/dom'
import { act } from 'react'

afterEach(() => { cleanup(); document.body.innerHTML = ''; try { localStorage.clear() } catch { /* none */ } })

describe('the return line and the last logged days', () => {
  it('says it only after two or more days away, never on the same day or the next', () => {
    expect(RETURN_AFTER).toBe(2)
    expect(daysBetween('2026-11-12', '2026-11-18')).toBe(6)
    expect(isReturn('2026-11-18', '2026-11-18')).toBe(false)
    expect(isReturn('2026-11-17', '2026-11-18')).toBe(false)
    expect(isReturn('2026-11-16', '2026-11-18')).toBe(true)
    expect(isReturn(null, '2026-11-18')).toBe(false)
    expect(isReturn('garbage', '2026-11-18')).toBe(false)
  })
  it('lists the newest three days that hold a log, and nothing about the days between', () => {
    const l = lastLogged({ '2026-11-18': 45, '2026-11-17': 50, '2026-11-14': 80, '2026-11-10': 20, '2026-11-19': 99, '2026-11-12': 0 }, '2026-11-18')
    expect(l.map((d) => d.date)).toEqual(['2026-11-18', '2026-11-17', '2026-11-14'])
  })
  it('turns up to three lines into rows, keeps only those with a step, and reads minutes loosely', () => {
    const rows = planRows([{ cue: ' after breakfast ', step: ' read the notes ', minutes: '25 min' }, { cue: '', step: '', minutes: '30' }, { cue: 'x', step: 'y', minutes: '9999' }, { cue: 'z', step: 'w', minutes: '5' }])
    expect(rows).toEqual([{ cue: 'after breakfast', step: 'read the notes', minutes: 25 }, { cue: 'x', step: 'y', minutes: null }])
    expect(planSentence(rows[0])).toBe('When after breakfast, I will read the notes for 25 min.')
    expect(planSentence({ cue: '', step: 'stretch', minutes: null })).toBe('When the time comes, I will stretch.')
  })
})

const classes = FIXTURE_ATTENDANCE.today.map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, status: c.status }))
const mount = async (props: Partial<Parameters<typeof ClosePage>[0]> = {}) => {
  const r = render(<ClosePage today={FIXTURE_TODAY} form="desk" port={createWeekPort()} minutes={FIXTURE_MINUTES} classes={classes} tomorrowFirst="Fixture topic" lastSeen={FIXTURE_TODAY} simulated {...props} />)
  await flush(8)
  return r.container
}
const type = (el: HTMLInputElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('Day / Close', () => {
  it('stamps SIMULATED, shows today in one look and tomorrow, and no return line on a normal day', async () => {
    const c = await mount()
    expect(c.querySelector('.dy-sub [data-lamp]')!.getAttribute('data-lamp')).toBe('simulated')
    expect(c.querySelector('[data-callout="today"]')!.textContent).toContain('45')
    expect(c.querySelector('[data-callout="tomorrow"]')!.textContent).toContain('Fixture topic')
    expect(c.querySelector('[data-return]')).toBeNull()
    expect(c.textContent).not.toContain('Pick up here.')
  })
  it('says "Pick up here." once on a return, with the last three logged days and no counter', async () => {
    const c = await mount({ lastSeen: '2026-11-12' })
    const back = c.querySelector('[data-return]')!
    expect(back.textContent).toContain('Pick up here.')
    expect(back.querySelectorAll('.cl-back-days li')).toHaveLength(3)
    expect(back.textContent).not.toMatch(/\d+ days?\b(?! ago)/)
    expect(back.textContent).not.toMatch(/away|gone|since|streak|missed|behind/i)
  })
  it('Plan tomorrow opens the drawer with three lines; saving through the null store says nothing was saved', async () => {
    const c = await mount({ plan: NULL_PLAN })
    click(buttons(c, 'Plan tomorrow')[0])
    await flush(8)
    const dr = document.body.querySelector('.cl-drawer')!
    expect(dr.querySelectorAll('.cl-row')).toHaveLength(3)
    expect(document.body.querySelector('.ww-sheet h2')!.textContent).toBe('Plan Thu 19 Nov')
    const inputs = dr.querySelectorAll<HTMLInputElement>('.cl-row input')
    type(inputs[1], 'read the notes')
    click(dr.querySelector('[data-act="save-plan"]'))
    await flush(8)
    expect(dr.textContent).toContain('Nothing was saved')
    keyDown(document.body.querySelector('.ww-sheet')!, 'Escape')
    await flush(8)
    expect(document.body.querySelector('.ww-sheet[data-state="open"]')).toBeNull()
  })
  it('p opens the plan from anywhere on the page, and an empty plan is refused in words', async () => {
    await mount()
    keyDown(window, 'p')
    await flush(8)
    const dr = document.body.querySelector('.cl-drawer')!
    click(dr.querySelector('[data-act="save-plan"]'))
    await flush(6)
    expect(dr.textContent).toContain('Write at least one step first.')
  })
  it('a saved plan appears as a hollow planned row; the capture is off by default and keeps no count', async () => {
    const c = await mount({ plan: { save: async () => ({ state: 'live', reason: '', since: null, data: { applied: true, message: 'Saved.' } }) } })
    expect(c.textContent).toContain('Daily capture is off')
    expect(c.querySelector('.cl-capture input')).toBeNull()
    click(buttons(c, 'Plan tomorrow')[0])
    await flush(8)
    const dr = document.body.querySelector('.cl-drawer')!
    type(dr.querySelectorAll<HTMLInputElement>('.cl-row input')[1], 'stretch')
    click(dr.querySelector('[data-act="save-plan"]'))
    await flush(10)
    expect(c.querySelector('[data-callout="tomorrow"]')!.textContent).toContain('I will stretch')
    click(buttons(c, 'Capture: off')[0])
    await flush(4)
    expect(c.querySelector('.cl-capture input')).not.toBeNull()
    expect(buttons(c, 'Capture: on')[0].getAttribute('aria-pressed')).toBe('true')
  })
})

describe('registration', () => {
  it('registers day.close for the ww product', () => {
    expect(closeView.id).toBe('day.close')
    expect(closeView.product).toBe('ww')
  })
})
