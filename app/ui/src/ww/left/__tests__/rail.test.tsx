// L04 left rail: the one-instrument rail draws the same data as the classic cards, from fixtures without the store.
import { afterEach, describe, expect, it } from 'vitest'
import { FIX_NOW, fixtureRail } from '../../day/today/fixtures'
import { LeftRail, railBudget } from '../Rail'
import { useLeft } from '../store'
import { cleanup, click, render } from '../../day/today/__tests__/dom'
import { RailFormProvider } from '../railForm'

afterEach(cleanup)

describe('the left rail', () => {
  it('shows the sitting as a numeral and a notch scale, each class with three 44 px keys, and SIMULATED lamps on fixtures', () => {
    const before = useLeft.getState().classes
    const { container } = render(<LeftRail go={() => {}} fixture={fixtureRail('day')} today={FIX_NOW} omit={['now', 'counters']} />)
    expect(container.querySelector('.lr-big .lr-num')?.textContent).toBe('12')
    expect(container.querySelectorAll('.lr-scale-dot')).toHaveLength(3)
    expect(container.querySelectorAll('.lr-trio')).toHaveLength(3)
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(2)
    expect(container.querySelector('[data-part="now"]')).toBeNull()
    expect(container.querySelector('[data-part="counters"]')).toBeNull()
    expect(container.querySelector('.lr[data-simulated]')).not.toBeNull()
    expect(container.querySelector('.lamp-glyph[data-glyph]')).not.toBeNull()
    // showing fixtures never writes the real store
    expect(useLeft.getState().classes).toBe(before)
  })

  it('draws every part when nothing is left out, and budgets rows so nothing scrolls', () => {
    const { container } = render(<LeftRail go={() => {}} fixture={fixtureRail('day')} today={FIX_NOW} />)
    expect(container.querySelector('[data-part="now"]')).not.toBeNull()
    expect(container.querySelectorAll('.lr-ctr').length).toBeLessThanOrEqual(3)
    expect(railBudget(664, ['now', 'counters']).classRows).toBe(4)
    expect(railBudget(664, []).classRows).toBe(1)
    expect(railBudget(900, []).tiles).toBe(6)
  })
})

describe('the lamp words and the folded row (RT1)', () => {
  it('every label of the rail carries its lamp and the state word, never a bare glyph', () => {
    const { container } = render(<LeftRail go={() => {}} fixture={fixtureRail('day')} today={FIX_NOW} omit={['now', 'counters']} />)
    const labels = [...container.querySelectorAll('.lr-label')]
    expect(labels.length).toBeGreaterThanOrEqual(2)
    for (const l of labels) expect(l.querySelector('.lw-w')?.textContent).toBe('SIMULATED')
    // the numeral of the next sitting sits under a label that says SIMULATED
    expect(container.querySelector('[data-part="sitting"] .lr-label .lw-w')?.textContent).toBe('SIMULATED')
  })

  it('a waiting read draws no numeral and the label says WAITING', () => {
    const { container } = render(<LeftRail go={() => {}} fixture={fixtureRail('waiting')} today={FIX_NOW} omit={['now', 'counters']} />)
    expect(container.querySelector('.lr-big')?.getAttribute('data-hollow')).toBe('true')
    expect(container.querySelector('[data-part="sitting"] .lr-label .lw-w')?.textContent).toBe('WAITING')
  })

  it('in the row form it is one short key (date, next sitting and classes marked, each with lamp and word) and the rail opens under it', () => {
    const { container } = render(<RailFormProvider value="row"><LeftRail go={() => {}} fixture={fixtureRail('day')} today={FIX_NOW} omit={['now', 'counters']} /></RailFormProvider>)
    const key = container.querySelector('.lr-rowkey') as HTMLButtonElement
    expect(key.getAttribute('aria-expanded')).toBe('false')
    expect(key.textContent).toContain('12 days')
    expect(key.textContent).toContain('2 of 3')
    expect([...key.querySelectorAll('.lw-w')].map((w) => w.textContent)).toEqual(['SIMULATED', 'SIMULATED'])
    expect(container.querySelector('.lr-trio')).toBeNull()
    click(key)
    expect(key.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('.lr-trio')).toHaveLength(3)
    click(key)
    expect(container.querySelector('.lr-trio')).toBeNull()
  })
})
