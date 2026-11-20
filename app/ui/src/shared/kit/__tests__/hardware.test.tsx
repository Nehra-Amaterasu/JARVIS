// KIT1: the Capsule Switch's behaviour, the part that is not paint: a press, a loading switch that takes none, and the word that
// follows the thumb only when the value CHANGES.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { Switch } from '../Hardware'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const sw = () => m!.container.querySelector('[role=switch]') as HTMLElement
const word = () => m!.container.querySelector('.k-switch-word') as HTMLElement
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
const click = (el: Element) => act(() => void (el as HTMLElement).click())

describe('Switch', () => {
  it('a press and Space toggle; Enter does not (switch convention)', () => {
    const onChange = vi.fn()
    m = mount(<Switch checked={false} onChange={onChange} label="Fan" />)
    click(sw())
    expect(onChange).toHaveBeenLastCalledWith(true)
    key(sw(), ' ')
    expect(onChange).toHaveBeenCalledTimes(2)
    key(sw(), 'Enter')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('loading: aria-busy (not aria-disabled: the loading ring is its look), a press and Space change nothing, and the reason is in a status region', () => {
    const onChange = vi.fn()
    m = mount(<Switch checked={false} onChange={onChange} label="Fan" loading />)
    expect(sw().getAttribute('aria-busy')).toBe('true')
    expect(sw().getAttribute('data-loading')).toBe('true')
    click(sw())
    key(sw(), ' ')
    expect(onChange).not.toHaveBeenCalled()
    expect(m.container.querySelector('[role=status]')!.textContent).toBe('waiting for the board')
  })

  it('not loading: the status region is empty and the switch is not aria-disabled', () => {
    m = mount(<Switch checked onChange={() => {}} label="Fan" />)
    expect(sw().hasAttribute('aria-busy')).toBe(false)
    expect(sw().hasAttribute('aria-disabled')).toBe(false)
    expect(m.container.querySelector('[role=status]')!.textContent).toBe('')
  })

  it('disabled with a reason takes no press and stays focusable', () => {
    const onChange = vi.fn()
    m = mount(<Switch checked={false} onChange={onChange} label="Fan" disabledReason="board offline" />)
    click(sw())
    expect(onChange).not.toHaveBeenCalled()
    expect(sw().getAttribute('aria-disabled')).toBe('true')
    expect(sw().hasAttribute('disabled')).toBe(false)
  })

  it('the word flies in only when the value changes: not on the first render, and already on the render that shows the new word', () => {
    function Host() {
      const [on, setOn] = useState(false)
      return <Switch checked={on} onChange={setOn} label="Fan" />
    }
    m = mount(<Host />)
    expect(word().textContent).toBe('OFF')
    expect(word().hasAttribute('data-flip')).toBe(false)
    click(sw())
    expect(word().textContent).toBe('ON')
    expect(word().getAttribute('data-flip')).toBe('true')
  })
})
