// R7 (25 Nov): the Applications view under v3, without a browser (the browser half is e2e/career-way.spec.ts). The rules it holds: the list
// is soonest closing date first with ONE stage chip a row; an unconfirmed date is one small tag, not a WAITING line; choosing a row fills
// the second tray; the stepper moves the stage forward and back; the view has one main key; no name of the old metaphors is on screen.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buttons, cleanup, click, render } from '../../../../shared/almanac/__tests__/dom'
import { resetLookForTests } from '../../../../shell/look'
import { dateTag, daysFace, sentence } from '../ApplicationsV3'
import { RunwayView } from '../Runway'
import { FIXTURE_APPS, FIXTURE_CELLS, FIXTURE_TODAY } from '../fixtures'
import { buildDeadlines } from '../../model'

const noop = () => undefined

beforeEach(() => { localStorage.setItem('app.look', 'v3'); resetLookForTests() })
afterEach(() => { cleanup(); localStorage.removeItem('app.look'); resetLookForTests() })

const mount = (set: string[] = [], cells = FIXTURE_CELLS) => {
  const due = buildDeadlines({ applications: FIXTURE_APPS, pipeline: {}, due_soon: [], tasks: [], goals: [] }, [], FIXTURE_TODAY)
  return render(<RunwayView width={1302} simulated data={{ apps: FIXTURE_APPS, due, today: FIXTURE_TODAY, cells }} actions={{ setStatus: (id, s) => set.push(`${id}:${s}`), confirm: noop, unconfirm: noop, add: noop, next: noop, nextFor: noop, confirmDue: noop }} campaigns={null} />).container
}

describe('the helpers', () => {
  it('sentence makes a fragment a sentence', () => {
    expect(sentence('decide whether to apply')).toBe('Decide whether to apply.')
    expect(sentence('Write the cover note.')).toBe('Write the cover note.')
    expect(sentence('  ')).toBe('')
  })
  it('daysFace gives a number for a dated open row and a word otherwise', () => {
    const a = FIXTURE_APPS[0]
    expect(daysFace({ ...a, days_left: 9 })).toEqual({ big: '9', unit: 'days left' })
    expect(daysFace({ ...a, days_left: 1 })).toEqual({ big: '1', unit: 'day left' })
    expect(daysFace({ ...a, days_left: 0 }).big).toBe('today')
    expect(daysFace({ ...a, days_left: null }).big).toBe('no date')
    expect(daysFace({ ...a, days_left: -2 }).big).toBe('closed')
  })
  it('dateTag: quiet when confirmed, one tag when not, none for a ruled-out row or no date', () => {
    const north = FIXTURE_APPS.find((a) => a.id === 'northgate-intern')!
    expect(dateTag(north, FIXTURE_CELLS)).toBe('')
    expect(dateTag(north, {})).toBe('date not confirmed')
    expect(dateTag({ ...north, closes: null }, {})).toBe('')
    expect(dateTag({ ...north, status: 'not_eligible' }, {})).toBe('')
  })
})

describe('Applications under v3', () => {
  it('lists the applications soonest closing date first, ruled out last, one stage chip a row', () => {
    const c = mount()
    const names = [...c.querySelectorAll('.t2-app .t2-app-name')].map((n) => n.textContent)
    expect(names).toEqual(['Northgate Labs', 'Quayside Systems', 'Lumen Research Group', 'Ashford Design Works', 'Vale Instruments', 'Orchard Semiconductor', 'Quay Analytics', 'Fen Optics'])
    for (const li of c.querySelectorAll('.t2-apps > li')) expect(li.querySelectorAll('.t2-chip')).toHaveLength(1)
    expect(c.querySelectorAll('.t2-stages, .t2-stagehead')).toHaveLength(0)
  })
  it('says the date caveat once a row and never prints a WAITING line in a row', () => {
    const c = mount()
    for (const li of c.querySelectorAll('.t2-apps > li')) {
      expect(li.querySelectorAll('.t2-app-tag').length).toBeLessThanOrEqual(1)
      expect((li.textContent ?? '').toUpperCase()).not.toContain('WAITING')
    }
    // the fixture confirms two dates (Northgate, Lumen): those rows carry no tag
    expect(c.querySelector('[data-row="northgate-intern"] .t2-app-tag')).toBeNull()
    expect(c.querySelector('[data-row="quayside-grad"] .t2-app-tag')?.textContent).toBe('date not confirmed')
  })
  it('chooses the soonest on open, and choosing a row fills the second tray with that application', () => {
    const c = mount()
    expect(c.querySelector('.t2-this .t2-v3-name')?.textContent).toBe('Northgate Labs')
    click(c.querySelector('[data-row="lumen-research"] .t2-app'))
    expect(c.querySelector('.t2-this .t2-v3-name')?.textContent).toBe('Lumen Research Group')
    expect(c.querySelectorAll('.t2-app[aria-pressed="true"]')).toHaveLength(1)
    expect(c.querySelector('.t2-this')?.getAttribute('data-app')).toBe('lumen-research')
  })
  it('the stepper moves the stage forward and back, and an end has no key to press', () => {
    const set: string[] = []
    const c = mount(set)
    // Northgate is Preparing
    click(buttons(c, 'On to Applied')[0])
    click(buttons(c, 'Back to Idea')[0])
    click(buttons(c, 'Northgate Labs: Interview')[0])
    expect(set).toEqual(['northgate-intern:applied', 'northgate-intern:idea', 'northgate-intern:interview'])
    click(c.querySelector('[data-row="orchard-offer"] .t2-app'))
    const on = buttons(c, 'On')[0]
    expect(on.getAttribute('aria-disabled') === 'true' || on.disabled).toBe(true)
  })
  it('has one main key, Add application, and the next step is a key of the chosen application', () => {
    const c = mount()
    const primary = c.querySelectorAll('[data-primary="true"]')
    expect(primary).toHaveLength(1)
    expect(primary[0].textContent).toContain('Add application')
    expect(buttons(c, 'Do this step')).toHaveLength(1)
    expect(buttons(c, 'Do next step')).toHaveLength(0)
  })
  it('keeps the closing date and its confirm action inside the application', () => {
    const c = mount({} as unknown as string[], {})
    expect(c.querySelector('.t2-this')?.textContent).toContain('I checked this date today')
  })
  it('names nothing Runway, flight board or bracketed in the visible text', () => {
    const c = mount()
    const t = (c.textContent ?? '').toLowerCase()
    expect(t).not.toContain('runway')
    expect(t).not.toContain('flight board')
    expect(t).toContain('closing dates in the next 120 days')
  })
})
