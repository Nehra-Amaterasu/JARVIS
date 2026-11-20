// KIT1: Chip, the poses that are behaviour (not only paint): a plain label, a toggle, a cycle, and disabled with a reason.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { Chip } from '../Chip'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const click = (el: Element) => act(() => void (el as HTMLElement).click())

describe('Chip', () => {
  it('without a handler it is a plain label, not a control', () => {
    m = mount(<Chip>Quiet</Chip>)
    expect(m.container.querySelector('button')).toBeNull()
    expect(m.container.textContent).toBe('Quiet')
  })

  it('a toggle: aria-pressed follows selected and a press calls onClick', () => {
    const onClick = vi.fn()
    m = mount(<Chip selected onClick={onClick}>Quiet</Chip>)
    const b = m.container.querySelector('button')!
    expect(b.getAttribute('aria-pressed')).toBe('true')
    click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('a cycle chip asks for the next state, with a glyph and a word', () => {
    const onCycle = vi.fn()
    m = mount(<Chip cycle="todo" onCycle={onCycle}>Topic</Chip>)
    const b = m.container.querySelector('button')!
    expect(b.textContent).toContain('to do')
    click(b)
    expect(onCycle).toHaveBeenCalledWith('learned')
  })

  it('disabled with a reason: aria-disabled, the reason is printed and described, a press calls nothing', () => {
    const onClick = vi.fn()
    const onCycle = vi.fn()
    m = mount(
      <Chip onClick={onClick} cycle="todo" onCycle={onCycle} disabledReason="not built yet">
        Topic
      </Chip>,
    )
    const b = m.container.querySelector('button')!
    expect(b.getAttribute('aria-disabled')).toBe('true')
    const reason = m.container.querySelector('.ww-reason')!
    expect(reason.textContent).toBe('not built yet')
    expect(b.getAttribute('aria-describedby')).toBe(reason.id)
    click(b)
    expect(onClick).not.toHaveBeenCalled()
    expect(onCycle).not.toHaveBeenCalled()
  })

  it('disabled with a reason and NO handler is still a blocked control, never a chip that looks enabled', () => {
    m = mount(<Chip disabledReason="not wired yet">Topic</Chip>)
    const b = m.container.querySelector('button')!
    expect(b).not.toBeNull()
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.getAttribute('aria-describedby')).toBe(m.container.querySelector('.ww-reason')!.id)
  })

  it('becoming blocked keeps the same button (and its focus): only the reason is added beside it', () => {
    const onClick = vi.fn()
    m = mount(<Chip onClick={onClick}>Topic</Chip>)
    const before = m.container.querySelector('button')!
    before.focus()
    m.render(
      <Chip onClick={onClick} disabledReason="waiting">
        Topic
      </Chip>,
    )
    const after = m.container.querySelector('button')!
    expect(after).toBe(before)
    expect(document.activeElement).toBe(after)
    expect(m.container.querySelector('.ww-reason')!.textContent).toBe('waiting')
  })
})
