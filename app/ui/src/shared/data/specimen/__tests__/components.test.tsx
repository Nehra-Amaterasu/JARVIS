// The four components rendered: required lamp state, no number outside LIVE and SIMULATED, hollow forms, the rack's
// honesty rule, keyboard operation, and a table or text twin for every drawing.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import { CalloutPlate, RackRow, SigilMark, SpecimenLayout, StrataCore, Rack } from '../index'
import { UNITS, arms } from '../gallery'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })
const NOW = 1_700_000_000_000

describe('SpecimenLayout', () => {
  it('lays out the desktop stage with its callouts, datum and footer', () => {
    m = mount(<SpecimenLayout width={1302} specimen={<b>hero</b>} callouts={[<i key="1">a</i>, <i key="2">b</i>]} footer={<span>foot</span>} />)
    const root = m.container.querySelector('[data-component="specimen-layout"]') as HTMLElement
    expect(root.dataset.state).toBe('desktop')
    expect(root.style.height).toBe('720px')
    expect(m.container.querySelectorAll('.sp-callout')).toHaveLength(2)
    expect(m.container.querySelectorAll('.sp-leader')).toHaveLength(2)
    const spec = m.container.querySelector('[data-object="specimen"]') as HTMLElement
    expect([spec.style.left, spec.style.top, spec.style.width, spec.style.height]).toEqual(['24px', '8px', '760px', '560px'])
    expect(m.container.querySelector('.sp-footer')?.textContent).toBe('foot')
  })
  it('keeps at most five callouts', () => {
    m = mount(<SpecimenLayout width={1302} specimen="x" callouts={Array.from({ length: 8 }, (_, i) => <i key={i}>{i}</i>)} />)
    expect(m.container.querySelectorAll('.sp-callout')).toHaveLength(5)
  })
  it('reflows under 900 px: specimen first, a carousel with a dot per card, a sticky rule', () => {
    m = mount(<SpecimenLayout width={390} specimen={<b>hero</b>} callouts={[<i key="1">a</i>, <i key="2">b</i>, <i key="3">c</i>]} />)
    const root = m.container.querySelector('[data-component="specimen-layout"]') as HTMLElement
    expect(root.dataset.state).toBe('reflow')
    expect(root.firstElementChild?.classList.contains('sp-rule')).toBe(true)
    expect(m.container.querySelectorAll('.sp-card')).toHaveLength(3)
    const dots = m.container.querySelectorAll('.sp-dot')
    expect(dots).toHaveLength(3)
    expect(dots[0].getAttribute('aria-current')).toBe('true')
    expect(m.container.querySelector('.sp-leader')).toBeNull()
  })
  it('a dot press moves the carousel index', () => {
    m = mount(<SpecimenLayout width={390} specimen="x" callouts={[<i key="1">a</i>, <i key="2">b</i>]} />)
    const track = m.container.querySelector('.sp-track') as HTMLElement
    track.scrollTo = vi.fn() as unknown as typeof track.scrollTo
    const dots = m.container.querySelectorAll<HTMLButtonElement>('.sp-dot')
    act(() => dots[1].click())
    expect(m.container.querySelectorAll('.sp-dot')[1].getAttribute('aria-current')).toBe('true')
  })
})

describe('CalloutPlate', () => {
  it('draws the number only for live and simulated', () => {
    m = mount(<div><CalloutPlate label="A" value={42} state="live" /><CalloutPlate label="B" value={43} state="simulated" /><CalloutPlate label="C" value={44} state="waiting" reason="no report" /><CalloutPlate label="D" value={45} state="fault" reason="store down" /><CalloutPlate label="E" value={46} state="planned" /></div>)
    const t = m.container.textContent ?? ''
    expect(t).toContain('42')
    expect(t).toContain('43')
    for (const n of ['44', '45', '46']) expect(t).not.toContain(n)
    expect(m.container.querySelectorAll('[data-hollow="true"]')).toHaveLength(3)
  })
})

describe('StrataCore', () => {
  it('draws numbers and a table for a simulated state, with a SIMULATED stamp', () => {
    m = mount(<StrataCore units={UNITS} state="simulated" />)
    expect(m.container.textContent).toContain('82 %')
    expect(m.container.textContent).toContain('SIMULATED')
    expect(m.container.querySelectorAll('table tbody tr')).toHaveLength(UNITS.length)
    expect(m.container.querySelectorAll('[data-flat="true"]')).toHaveLength(2)
  })
  for (const state of ['waiting', 'planned', 'fault'] as const) {
    it(`${state}: every layer flat, no number anywhere, and it says why`, () => {
      m = mount(<StrataCore units={UNITS} state={state} reason="because" />)
      expect(m.container.querySelectorAll('[data-flat="true"]')).toHaveLength(UNITS.length)
      expect(m.container.textContent).not.toMatch(/\d+ %/)
      expect(m.container.textContent).toContain('because')
      expect(m.container.querySelector('.sp-contour')).toBeNull()
    })
  }
  it('rows are 44 px buttons, one tab stop, arrows move, Enter opens', () => {
    const open = vi.fn()
    m = mount(<StrataCore units={UNITS} state="live" onSelect={open} />)
    const rows = Array.from(m.container.querySelectorAll<HTMLButtonElement>('.sp-strata-row'))
    expect(rows).toHaveLength(6)
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1)
    act(() => rows[0].focus())
    act(() => { rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(rows[1])
    act(() => rows[1].click())
    expect(open).toHaveBeenCalledWith('u5')
  })
  it('survives no units', () => {
    m = mount(<StrataCore units={[]} state="live" />)
    expect(m.container.querySelectorAll('.sp-strata-row')).toHaveLength(0)
  })
})

describe('SigilMark', () => {
  it('draws arms for simulated data with a text twin and no number', () => {
    m = mount(<SigilMark arms={arms(8)} state="simulated" />)
    expect(m.container.querySelector('svg')).not.toBeNull()
    expect(m.container.querySelectorAll('table tbody tr')).toHaveLength(8)
    expect(m.container.textContent).not.toMatch(/\d/)
  })
  it('renders the same markup twice', () => {
    m = mount(<SigilMark arms={arms(10)} state="live" />)
    const a = m.container.innerHTML
    m.unmount()
    m = mount(<SigilMark arms={arms(10)} state="live" />)
    expect(m.container.innerHTML).toBe(a)
  })
  it('draws the hollow form when no evidence may speak', () => {
    m = mount(<SigilMark arms={arms(8)} state="waiting" reason="no evidence report" />)
    const fig = m.container.querySelector('figure') as HTMLElement
    expect(fig.dataset.hollow).toBe('true')
    expect(m.container.querySelector('.sg-w2')).toBeNull()
    expect(m.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('no evidence report')
  })
})

describe('RackRow', () => {
  const draw = (props: Partial<Parameters<typeof RackRow>[0]>) => {
    m = mount(<Rack title="t"><RackRow device="Relay 1" state="confirmed" now={NOW} {...props} /></Rack>)
    return m.container.querySelector('[data-component="rack-row"]') as HTMLElement
  }
  it('never shows confirmed from the state prop alone', () => {
    const row = draw({})
    expect(row.dataset.state).toBe('unconfirmed')
    expect(row.dataset.requested).toBe('confirmed')
    expect(row.textContent).toContain('sent, not acknowledged')
    expect(row.querySelector('[data-glyph="disc"]')).toBeNull()
  })
  it('shows confirmed with a report, and the pulse only inside a minute', () => {
    let row = draw({ reportedAt: NOW - 10_000 })
    expect(row.dataset.state).toBe('confirmed')
    expect(row.querySelector('[data-glyph="disc"]')).not.toBeNull()
    expect(row.querySelector('.sp-rack-pulse')?.textContent).toBe('▁▂▁')
    m?.unmount()
    row = draw({ reportedAt: NOW - 5 * 60_000 })
    expect(row.dataset.state).toBe('confirmed')
    expect(row.querySelector('.sp-rack-pulse')?.textContent).toBe('')
  })
  it('fault carries a triangle and its reason; planned is dashed and has no lamp disc', () => {
    expect(draw({ state: 'fault', reason: 'no answer in 3 s' }).textContent).toContain('no answer in 3 s')
    m?.unmount()
    const p = draw({ state: 'planned' })
    expect(p.dataset.state).toBe('planned')
    expect(p.textContent).toContain('planned')
  })
  it('the rocker calls onToggle and does not change the lamp', () => {
    const t = vi.fn()
    const row = draw({ state: 'unconfirmed', onToggle: t, on: false })
    const radios = row.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    act(() => radios[0].click())
    expect(t).toHaveBeenCalledTimes(1)
    expect(row.dataset.state).toBe('unconfirmed')
  })
  it('names itself with the commanded state and what the board said', () => {
    const row = draw({ reportedAt: NOW - 20_000, serial: 'RLY-0001', on: true })
    const name = row.getAttribute('aria-label') ?? ''
    expect(name).toContain('commanded on')
    expect(name).toContain('RLY-0001')
    expect(name).toContain('confirmed')
  })
})
