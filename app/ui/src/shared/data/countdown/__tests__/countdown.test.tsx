// CountdownDots: dots equal days, a filled dot never refills, no animation, hollow forms for the three non-drawing states,
// the same input gives the same markup, and no urgency wording anywhere in the package.
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import { LAMP_STATES, showsNumber } from '../../../lamp'
import { CountdownDots, countdownText, dotModel, MAX_DOTS } from '..'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { m?.unmount(); m = null })
const q = (s: string) => document.querySelector(s) as HTMLElement

describe('dotModel', () => {
  it('draws one dot per day, filled = days lived', () => {
    expect(dotModel(20, 10)).toEqual({ total: 30, filled: 10, hidden: 0 })
    expect(dotModel(5, 0)).toEqual({ total: 5, filled: 0, hidden: 0 })
    expect(dotModel(0, 12)).toEqual({ total: 12, filled: 12, hidden: 0 })
  })
  it('caps at 60 dots and says how many earlier days it leaves out', () => {
    expect(dotModel(90, 0)).toEqual({ total: MAX_DOTS, filled: 0, hidden: 30 })
    expect(dotModel(50, 30)).toEqual({ total: 60, filled: 10, hidden: 20 })
  })
  it('a dot never refills: as days are lived the filled count only grows', () => {
    let prev = -1
    for (let lived = 0; lived <= 40; lived++) {
      const f = dotModel(40 - lived, lived).filled
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
    }
  })
  it('clamps junk to whole non-negative days', () => {
    expect(dotModel(-3, Number.NaN)).toEqual({ total: 0, filled: 0, hidden: 0 })
    expect(dotModel(2.9, 1.2)).toEqual({ total: 3, filled: 1, hidden: 0 })
  })
})

describe('CountdownDots', () => {
  it('LIVE: dot count equals days and the lived dots are marked', () => {
    m = mount(<CountdownDots daysLeft={21} lived={9} to="the first paper" state="live" />)
    expect(document.querySelectorAll('.dg-cd-dot')).toHaveLength(30)
    expect(document.querySelectorAll('.dg-cd-dot[data-lived="true"]')).toHaveLength(9)
    expect(q('[data-component="countdown-dots"]').getAttribute('aria-label')).toBe('21 days to the first paper')
  })
  it('the same props give the same markup', () => {
    m = mount(<CountdownDots daysLeft={33} lived={4} to="Unit 3 test" state="live" />)
    const a = document.body.innerHTML
    m.unmount()
    document.body.innerHTML = ''
    m = mount(<CountdownDots daysLeft={33} lived={4} to="Unit 3 test" state="live" />)
    expect(document.body.innerHTML).toBe(a)
  })
  it('the words are the same on day 60 and day 2 and never say "only"', () => {
    expect(countdownText(60, 'it')).toBe('60 days to it')
    expect(countdownText(2, 'it')).toBe('2 days to it')
    expect(countdownText(1, 'it')).toBe('1 day to it')
    expect(countdownText(0, 'it')).toBe('it is today')
  })
  for (const s of LAMP_STATES.filter((x) => !showsNumber(x))) {
    it(`${s}: a dashed row and the reason, no dots, no count`, () => {
      m = mount(<CountdownDots daysLeft={12} lived={3} to="the first paper" state={s} reason="no date on file" />)
      const el = q('[data-component="countdown-dots"]')
      expect(el.dataset.form).toBe('hollow')
      expect(document.querySelectorAll('.dg-cd-dot')).toHaveLength(0)
      expect(q('.dg-cd-dash')).toBeTruthy()
      expect(el.getAttribute('aria-label')).not.toMatch(/\d+ days/)
    })
  }
  it('SIMULATED draws dots with a stamp', () => {
    m = mount(<CountdownDots daysLeft={4} to="x" state="simulated" />)
    expect(q('.dg-stamp').textContent).toBe('SIMULATED')
    expect(document.querySelectorAll('.dg-cd-dot')).toHaveLength(4)
  })
})

describe('the package source', () => {
  const dir = resolve(__dirname, '..')
  const files = readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f))
  const text = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
  it('has no "only N days" wording, no animation and no timer', () => {
    expect(text).not.toMatch(/only\s+(\$\{|\d|N)/i)
    expect(text).not.toMatch(/@keyframes|animation\s*:|setInterval|setTimeout|requestAnimationFrame/)
    expect(text).not.toMatch(/transition\s*:/)
  })
  it('has a forced-colours branch and no colour literal outside it', () => {
    const css = readFileSync(join(dir, 'countdown.css'), 'utf8')
    expect(css).toMatch(/forced-colors: active/)
    expect(css.replace(/@media \(forced-colors[\s\S]*$/, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })
})
