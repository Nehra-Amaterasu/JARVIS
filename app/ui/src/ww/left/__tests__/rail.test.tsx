// L04 left rail: the one-instrument rail draws the same data as the classic cards, from fixtures without the store.
import { afterEach, describe, expect, it } from 'vitest'
import { FIX_NOW, fixtureRail } from '../../day/today/fixtures'
import { LeftRail, railBudget } from '../Rail'
import { useLeft } from '../store'
import { cleanup, render } from '../../day/today/__tests__/dom'

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
    expect(railBudget(664, ['now', 'counters']).classRows).toBe(5)
    expect(railBudget(664, []).classRows).toBe(1)
    expect(railBudget(900, []).tiles).toBe(6)
  })
})
