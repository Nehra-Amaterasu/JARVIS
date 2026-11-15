// The Review Desk's action row and trace line (RT1, jury of 14 Nov): three actions on the row and the rest behind one "More" key, the
// run's trace as one line that opens, and every key still working with the panel closed.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import { QUESTIONS, TOPICS, TRACE } from '../../papers/fixtures'
import { ReviewDesk } from '../ReviewDesk'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })

const pending = QUESTIONS.filter((x) => x.year === 2024)
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel))
const click = (el: Element) => act(() => (el as HTMLElement).click())
const mountDesk = (events = TRACE) => {
  const onDecide = vi.fn()
  m = mount(<ReviewDesk questions={pending} topics={TOPICS} events={events} state="simulated" paperLabel="Paper 2024" onDecide={onDecide} />)
  return onDecide
}
const names = (sel: string) => qa(sel).map((b) => b.textContent)

describe('the action row', () => {
  it('shows Accept, Edit and Reject and one More key; Merge, Split, Next uncertain and the two switches wait behind it', () => {
    mountDesk()
    expect(names('.rv-actions > button')).toEqual(['Accept', 'Edit', 'Reject', 'More'])
    const more = q('.rv-more')
    expect(more.hasAttribute('hidden')).toBe(true)
    expect(q('.rv-actions button[aria-expanded]').getAttribute('aria-expanded')).toBe('false')
    click(q('.rv-actions button[aria-expanded]'))
    expect(more.hasAttribute('hidden')).toBe(false)
    expect(names('.rv-more > button')).toEqual(['Merge with previous', 'Split', 'Next uncertain'])
    expect(qa('.rv-more [role="switch"]')).toHaveLength(2)
    // the switches left the page column: nothing but the page is under it
    expect(qa('.rv-page [role="switch"]')).toHaveLength(0)
  })

  it('every key still works with the panel closed: M merges, S splits, N jumps, T and R flip their views', () => {
    const onDecide = mountDesk()
    const desk = q('[data-component="review-desk"]')
    key(desk, 'm')
    expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'merge' }))
    key(desk, 's')
    expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'split' }))
    key(desk, 'n')
    expect(q('.rv-box[data-sel="true"]').getAttribute('aria-label')).toContain('Q5')
    const sw = qa('.rv-more [role="switch"]')
    expect(sw.map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    key(desk, 't')
    key(desk, 'r')
    expect(qa('.rv-more [role="switch"]').map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true'])
  })

  it('Escape closes the panel first, and the desk stays; the keys also work from the panel', () => {
    const onDecide = mountDesk()
    click(q('.rv-actions button[aria-expanded]'))
    const desk = q('[data-component="review-desk"]')
    key(desk, 'Escape')
    expect(q('.rv-more').hasAttribute('hidden')).toBe(true)
    expect(q('[data-component="review-desk"]')).not.toBeNull()
    click(q('.rv-actions button[aria-expanded]'))
    click(qa('.rv-more > button')[1]) // Split
    expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'split' }))
  })

  it('editing swaps the row to Save and Cancel and hides the panel', () => {
    mountDesk()
    click(q('.rv-actions button[aria-expanded]'))
    click(qa('.rv-actions > button')[1]) // Edit is the second key
    expect(names('.rv-actions > button')).toEqual(['Save', 'Cancel'])
    expect(q('.rv-more').hasAttribute('hidden')).toBe(true)
  })

  it('keeps the footer disclaimer clear of the step chevrons: the chevrons live in the action row, never in the footer', () => {
    mountDesk()
    expect(qa('.rv-foot .pp-pg')).toHaveLength(0)
    expect(qa('.rv-actions .rv-step .pp-pg')).toHaveLength(2)
  })
})

describe('the trace line', () => {
  it('is one line with the newest real event, its lamp and word, the count and a key; the log opens on it', () => {
    mountDesk()
    expect(qa('.pp-trace')).toHaveLength(0)
    const line = q('.rv-trace-line')
    expect(line.getAttribute('aria-expanded')).toBe('false')
    const last = TRACE[TRACE.length - 1]
    expect(line.textContent).toContain(last.text)
    expect(line.textContent).toContain(`${TRACE.length} events`)
    expect(line.querySelector('.lw-w')?.textContent).toBe({ live: 'LIVE', simulated: 'SIMULATED', waiting: 'WAITING', fault: 'FAULT', planned: 'PLANNED' }[last.state])
    click(line)
    expect(line.getAttribute('aria-expanded')).toBe('true')
    expect(qa('.pp-trace')).toHaveLength(1)
    click(line)
    expect(qa('.pp-trace')).toHaveLength(0)
  })

  it('with no events it says there is no run (nothing invented), and the count is zero', () => {
    mountDesk([])
    expect(q('.rv-trace-line').textContent).toContain('No run yet')
    expect(q('.rv-trace-line').textContent).toContain('0 events')
    expect(q('.rv-trace-line .lw')).toBeNull()
  })
})
