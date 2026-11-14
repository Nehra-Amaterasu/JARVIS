// NextThree: three rows at most, fewer when given fewer and never padded, a reason and a lamp on each, scores in mono,
// a hollow form with the reason for the other states, and a button that opens a target without running anything.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import { LAMP_STATES, showsNumber } from '../../../lamp'
import { NextThree, scoreText, visibleRows, type NextItem } from '..'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { m?.unmount(); m = null })

const item = (n: number, over: Partial<NextItem> = {}): NextItem => ({ id: `i${n}`, title: `Action ${n}`, reason: `reason ${n}`, state: 'live', scores: { weak: 0.4, due: 1 }, ...over })
const four = [item(1), item(2), item(3), item(4)]

describe('NextThree', () => {
  it('shows three rows from four items', () => {
    m = mount(<NextThree items={four} state="live" />)
    expect(document.querySelectorAll('.dg-n3-row')).toHaveLength(3)
    expect(visibleRows(four).map((i) => i.id)).toEqual(['i1', 'i2', 'i3'])
  })
  it('shows fewer and never pads', () => {
    m = mount(<NextThree items={[item(1), item(2)]} state="live" />)
    expect(document.querySelectorAll('.dg-n3-row')).toHaveLength(2)
    expect(document.querySelectorAll('.dg-n3-hollow')).toHaveLength(0)
  })
  it('every row has its reason line and its own lamp', () => {
    m = mount(<NextThree items={[item(1), item(2, { state: 'simulated' })]} state="live" />)
    const rows = [...document.querySelectorAll('.dg-n3-row')]
    expect(rows.map((r) => r.querySelector('.dg-n3-reason')?.textContent)).toEqual(['reason 1', 'reason 2'])
    expect(rows.map((r) => r.querySelector('[data-state]')?.getAttribute('data-state'))).toEqual(['live', 'simulated'])
  })
  it('prints the scores in order, and speaks them', () => {
    expect(scoreText({ weak: 0.4, due: 1 })).toBe('weak 0.40 / due 1.00')
    m = mount(<NextThree items={[item(1)]} state="live" onOpen={() => undefined} />)
    expect(document.querySelector('.dg-n3-scores')?.textContent).toBe('weak 0.40 / due 1.00')
    expect(document.querySelector('button')?.getAttribute('aria-label')).toContain('Scores: weak 0.40 / due 1.00')
  })
  for (const s of LAMP_STATES.filter((x) => !showsNumber(x))) {
    it(`${s}: the hollow form with the reason and no rows`, () => {
      m = mount(<NextThree items={four} state={s} reason="needs papers on file" />)
      const el = document.querySelector('[data-component="next-three"]') as HTMLElement
      expect(el.dataset.form).toBe('hollow')
      expect(document.querySelectorAll('.dg-n3-row')).toHaveLength(0)
      expect(el.textContent).toContain('needs papers on file')
    })
  }
  it('an empty LIVE list is hollow too', () => {
    m = mount(<NextThree items={[]} state="live" />)
    expect((document.querySelector('[data-component="next-three"]') as HTMLElement).dataset.form).toBe('hollow')
  })
  it('a row opens its target with its id and runs nothing else', () => {
    const onOpen = vi.fn()
    m = mount(<NextThree items={four} state="live" onOpen={onOpen} />)
    act(() => { (document.querySelectorAll('button')[1] as HTMLElement).click() })
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('i2')
  })
  it('the same items give the same markup', () => {
    m = mount(<NextThree items={four} state="live" />)
    const a = document.body.innerHTML
    m.unmount(); document.body.innerHTML = ''
    m = mount(<NextThree items={four} state="live" />)
    expect(document.body.innerHTML).toBe(a)
  })

  it('draws no scores for a row whose own state is not LIVE or SIMULATED', () => {
    m = mount(<NextThree items={[item(1), item(2, { state: 'waiting' }), item(3, { state: 'planned' })]} state="live" />)
    expect(document.querySelectorAll('.dg-n3-scores')).toHaveLength(1)
  })
})
