// Legend: it lists exactly the entries a specimen is drawn from (three fixtures), `?` swaps it in at once, Esc swaps back,
// the text list is always in the document, and the stylesheet has the static branch and no transition.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import { Legend, LEGEND_GLYPHS, legendEntries, legendLine, type SpecimenEntry } from '..'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { m?.unmount(); m = null })

// the three fixtures: each is the array its specimen is drawn from
const week: SpecimenEntry[] = [
  { id: 'disc', name: 'tip disc', meaning: 'practised in the last 7 days', glyph: 'disc' },
  { id: 'ring', name: 'ring', meaning: 'not practised in the last 7 days', glyph: 'ring' },
  { id: 'dashed', name: 'dashed ring', meaning: 'never practised', glyph: 'dashed-ring' },
]
const month: SpecimenEntry[] = [
  { id: 'dots', name: 'dot field', meaning: 'one dot per answered question', glyph: 'dots' },
  { id: 'line', name: 'median line', meaning: 'your own median', glyph: 'line' },
]
const rack: SpecimenEntry[] = [
  { id: 'bar', name: 'bar', meaning: 'minutes studied', glyph: 'bar' },
  { id: 'hatch', name: 'hatch', meaning: 'over the plan', glyph: 'hatch' },
  { id: 'diamond', name: 'diamond', meaning: 'simulated figure', glyph: 'diamond' },
  { id: 'bar', name: 'bar', meaning: 'minutes studied', glyph: 'bar' }, // a repeated mark on the specimen is listed once
]

const items = () => [...document.querySelectorAll<HTMLElement>('.dg-lg-item')].map((e) => e.dataset.entry)
const face = () => document.querySelector('.dg-lg-face') as HTMLElement
const back = () => document.querySelector('.dg-lg-back') as HTMLElement

describe('Legend entries equal the specimen entries', () => {
  for (const [name, fixture] of [['week', week], ['month', month], ['rack', rack]] as const) {
    it(`${name}: the same ids in the same order`, () => {
      m = mount(<Legend entries={fixture} label={name}><p>specimen</p></Legend>)
      expect(items()).toEqual(legendEntries(fixture).map((e) => e.id))
      expect(items()).toEqual([...new Set(fixture.map((e) => e.id))])
    })
  }
  it('a mark added to the specimen appears, a mark removed leaves', () => {
    m = mount(<Legend entries={week.slice(0, 2)} label="w"><p>x</p></Legend>)
    expect(items()).toEqual(['disc', 'ring'])
    m.unmount()
    m = mount(<Legend entries={week} label="w"><p>x</p></Legend>)
    expect(items()).toEqual(['disc', 'ring', 'dashed'])
  })
  it('every glyph kind is drawn', () => {
    const all = LEGEND_GLYPHS.map((g) => ({ id: g, name: g, meaning: g, glyph: g }))
    m = mount(<Legend entries={all} label="g"><p>x</p></Legend>)
    expect([...document.querySelectorAll('.dg-lg-glyph')].map((e) => e.getAttribute('data-glyph'))).toEqual([...LEGEND_GLYPHS])
  })
  it('the text twin is "name: meaning"', () => {
    expect(legendLine(week[0])).toBe('tip disc: practised in the last 7 days')
    m = mount(<Legend entries={week} label="w"><p>x</p></Legend>)
    expect(document.querySelector('.dg-lg-item')?.getAttribute('aria-label')).toBe('tip disc: practised in the last 7 days')
  })
})

describe('the flip', () => {
  it('starts on the specimen; the key swaps to the list and back at once', () => {
    m = mount(<Legend entries={week} label="w"><p>specimen</p></Legend>)
    const key = document.querySelector('.dg-lg-key') as HTMLButtonElement
    expect(face().hidden).toBe(false)
    expect(back().hidden).toBe(true)
    act(() => key.click())
    expect(face().hidden).toBe(true)
    expect(back().hidden).toBe(false)
    expect(key.getAttribute('aria-pressed')).toBe('true')
    act(() => key.click())
    expect(face().hidden).toBe(false)
  })
  it('? toggles, Esc closes, and ? typed in a field is left alone', () => {
    m = mount(<Legend entries={week} label="w"><input aria-label="note" /><p>specimen</p></Legend>)
    const root = document.querySelector('[data-component="legend"]') as HTMLElement
    const press = (el: Element, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
    press(root, '?')
    expect(root.dataset.flipped).toBe('true')
    press(root, 'Escape')
    expect(root.dataset.flipped).toBe('false')
    press(document.querySelector('input')!, '?')
    expect(root.dataset.flipped).toBe('false')
  })
  it('both faces stay in the document, so the list is always a text twin', () => {
    m = mount(<Legend entries={week} label="w"><p>specimen</p></Legend>)
    expect(document.querySelectorAll('.dg-lg-item')).toHaveLength(3)
  })
  it('is controllable', () => {
    m = mount(<Legend entries={week} label="w" flipped><p>specimen</p></Legend>)
    expect(back().hidden).toBe(false)
  })
})

describe('the stylesheet', () => {
  const css = readFileSync(resolve(__dirname, '../legend.css'), 'utf8')
  it('has the static branch for reduced motion and forced colours, and no transition or animation', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\), \(forced-colors: active/)
    expect(css).not.toMatch(/@keyframes|animation\s*:|transition\s*:|rotateY|perspective/)
  })
})
