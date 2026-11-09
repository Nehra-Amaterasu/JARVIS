// Chunk 1b, group 1: Button, IconButton, Segmented, Chip, Field (plan 5.5).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { mount } from './_stubs'
import { Button, Chip, Field, IconButton, Segmented } from '../../ww/kit'
import { cssFiles, parseCss, read, WW_DIR } from './_css'
import { join } from 'node:path'

// createElement with loose props: the components' own prop types are checked where the kit is used
const h = createElement as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReactElement
let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
})
const click = (el: Element) => act(() => (el as HTMLElement).click())
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

describe('Button', () => {
  it('renders its label as a button with a default type of button', () => {
    m = mount(h(Button, null, 'Save'))
    const b = m.container.querySelector('button')!
    expect(b.textContent).toBe('Save')
    expect(b.type).toBe('button')
    expect(b.dataset.size).toBe('md')
  })
  it('passes the click through', () => {
    const on = vi.fn()
    m = mount(h(Button, { onClick: on }, 'Go'))
    click(m.container.querySelector('button')!)
    expect(on).toHaveBeenCalledTimes(1)
  })
  it('takes the three sizes and the three tones as plain attributes and classes', () => {
    m = mount(h('div', null, h(Button, { size: 'sm', tone: 'primary' }, 'a'), h(Button, { size: 'lg', tone: 'danger' }, 'b')))
    const [a, b] = [...m.container.querySelectorAll('button')]
    expect(a.dataset.size).toBe('sm')
    expect(a.classList.contains('primary')).toBe(true)
    expect(b.dataset.size).toBe('lg')
    expect(b.classList.contains('danger')).toBe(true)
  })
  it('grouped marks the box as 44 px for real', () => {
    m = mount(h(Button, { grouped: true }, 'x'))
    expect(m.container.querySelector('button')!.dataset.grouped).toBe('true')
  })
  it('disabled-with-reason stays focusable, is aria-disabled, never uses the disabled attribute, and prints the reason', () => {
    const on = vi.fn()
    m = mount(h(Button, { onClick: on, disabledReason: 'No GATE bank yet' }, 'Sharpen'))
    const b = m.container.querySelector('button')!
    expect(b.disabled).toBe(false)
    expect(b.getAttribute('aria-disabled')).toBe('true')
    act(() => b.focus())
    expect(document.activeElement).toBe(b)
    const reason = m.container.querySelector('.ww-reason')!
    expect(reason.textContent).toBe('No GATE bank yet')
    expect(b.getAttribute('aria-describedby')).toBe(reason.id)
    click(b)
    expect(on).not.toHaveBeenCalled()
  })
  it('a refused press flashes the reason for one state duration, keeps focus and does not shake', () => {
    vi.useFakeTimers()
    m = mount(h(Button, { disabledReason: 'Locked' }, 'Open'))
    const b = m.container.querySelector('button')!
    act(() => b.focus())
    click(b)
    const reason = m.container.querySelector('.ww-reason') as HTMLElement
    expect(reason.dataset.flash).toBe('on')
    expect(document.activeElement).toBe(b)
    act(() => void vi.advanceTimersByTime(161))
    expect(reason.dataset.flash).toBeUndefined()
  })
  it('loading blocks the click and is announced as busy', () => {
    const on = vi.fn()
    m = mount(h(Button, { onClick: on, loading: true }, 'Save'))
    const b = m.container.querySelector('button')!
    click(b)
    expect(on).not.toHaveBeenCalled()
    expect(b.getAttribute('aria-busy')).toBe('true')
    expect(b.textContent).toContain('Working')
  })
})

describe('IconButton', () => {
  it('names itself: aria-label and title both carry the label', () => {
    m = mount(h(IconButton, { label: 'Close' }, '×'))
    const b = m.container.querySelector('button')!
    expect(b.getAttribute('aria-label')).toBe('Close')
    expect(b.title).toBe('Close')
  })
  it('a missing label is a type error (checked by tsc -b), and the prop is required', () => {
    // @ts-expect-error label is required by type
    const bad = <IconButton>x</IconButton>
    expect(bad.type).toBe(IconButton)
  })
})

describe('Segmented', () => {
  const OPTS = [
    { id: 'a', label: 'Papers' },
    { id: 'b', label: 'Plan' },
    { id: 'c', label: 'dMAT', disabledReason: 'Not built yet' },
  ]
  it('is a named radio group with one roving tab stop on the selected option', () => {
    m = mount(h(Segmented, { options: OPTS, value: 'b', onChange: () => {}, label: 'View' }))
    const g = m.container.querySelector('[role=radiogroup]')!
    expect(g.getAttribute('aria-label')).toBe('View')
    const radios = [...g.querySelectorAll('[role=radio]')] as HTMLElement[]
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1])
  })
  it('click and arrow keys select; the arrow wraps', () => {
    const on = vi.fn()
    m = mount(h(Segmented, { options: OPTS, value: 'a', onChange: on, label: 'View' }))
    const radios = [...m.container.querySelectorAll('[role=radio]')] as HTMLElement[]
    click(radios[1])
    expect(on).toHaveBeenLastCalledWith('b')
    key(radios[0], 'ArrowLeft') // wraps to the last option, which is disabled: it is focused, not selected
    expect(document.activeElement).toBe(radios[2])
    expect(on).toHaveBeenCalledTimes(1)
    key(radios[0], 'ArrowRight')
    expect(on).toHaveBeenLastCalledWith('b')
  })
  it('a disabled option stays focusable, selects nothing and says why', () => {
    const on = vi.fn()
    m = mount(h(Segmented, { options: OPTS, value: 'a', onChange: on, label: 'View' }))
    const dis = m.container.querySelectorAll('[role=radio]')[2] as HTMLElement
    expect(dis.getAttribute('aria-disabled')).toBe('true')
    expect((dis as HTMLButtonElement).disabled).toBe(false)
    click(dis)
    expect(on).not.toHaveBeenCalled()
    expect(m.container.querySelector('[role=status]')!.textContent).toBe('dMAT: Not built yet')
  })
  it('the variant is an attribute the CSS sizes from', () => {
    m = mount(h(Segmented, { options: OPTS, value: 'a', onChange: () => {}, label: 'V', variant: 'compact' }))
    expect((m.container.querySelector('[role=radiogroup]') as HTMLElement).dataset.variant).toBe('compact')
  })
})

describe('Chip', () => {
  it('without a handler it is a label, not a button', () => {
    m = mount(h(Chip, { tone: 'live', count: 3 }, 'Measured'))
    expect(m.container.querySelector('button')).toBeNull()
    expect(m.container.textContent).toContain('Measured')
    expect(m.container.querySelector('.ww-chip-count')!.textContent).toBe('3')
    expect(m.container.querySelector('.ww-chip-dot')).not.toBeNull()
  })
  it('with onClick it is a toggle button with aria-pressed', () => {
    const on = vi.fn()
    m = mount(h(Chip, { onClick: on, selected: true }, 'Today'))
    const b = m.container.querySelector('button')!
    expect(b.getAttribute('aria-pressed')).toBe('true')
    click(b)
    expect(on).toHaveBeenCalledTimes(1)
  })
  it('cycle goes to do, learned, solid, to do, with a glyph and a word for each state', () => {
    const on = vi.fn()
    const seen: string[] = []
    for (const s of ['todo', 'learned', 'solid'] as const) {
      m = mount(h(Chip, { cycle: s, onCycle: on }, 'Limits'))
      const b = m.container.querySelector('button')!
      seen.push(b.querySelector('.ww-chip-mark')!.textContent + '|' + b.querySelector('.ww-sr-only')!.textContent)
      click(b)
      m.unmount()
      m = null
    }
    expect(on.mock.calls.map((c) => c[0])).toEqual(['learned', 'solid', 'todo'])
    expect(seen).toEqual(['○|, to do', '◐|, learned', '●|, solid'])
  })
  it('a cycle tap starts the one-shot pop and the end of the animation clears it', () => {
    m = mount(h(Chip, { cycle: 'todo', onCycle: () => {} }, 'Limits'))
    const b = m.container.querySelector('button')!
    click(b)
    expect(b.getAttribute('data-cycle')).toBe('pop')
    act(() => void b.dispatchEvent(new Event('animationend', { bubbles: true })))
    expect(b.hasAttribute('data-cycle')).toBe(false)
  })
})

describe('Field', () => {
  it('ties the label to the control', () => {
    m = mount(h(Field, { label: 'Marks' }))
    const input = m.container.querySelector('input')!
    const label = m.container.querySelector('label')!
    expect(label.htmlFor).toBe(input.id)
    expect(label.textContent).toBe('Marks')
  })
  it('hint and error are described-by; an error sets aria-invalid and reads as words', () => {
    m = mount(h(Field, { label: 'Marks', hint: 'Out of 20' }))
    const input = m.container.querySelector('input')!
    expect(m.container.querySelector('#' + CSS.escape(input.getAttribute('aria-describedby')!))!.textContent).toBe('Out of 20')
    m.render(h(Field, { label: 'Marks', hint: 'Out of 20', error: 'More than 20' }))
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(m.container.querySelector('.ww-field-note')!.textContent).toBe('Error: More than 20')
  })
  it('renders each kind with the same class, and a unit beside the control', () => {
    m = mount(h('div', null, h(Field, { label: 'a', kind: 'number', unit: 'min' }), h(Field, { label: 'b', kind: 'area' }), h(Field, { label: 'c', kind: 'select' }, h('option', null, 'x'))))
    expect(m.container.querySelector('input[type=number]')!.classList.contains('ww-input')).toBe(true)
    expect(m.container.querySelector('textarea')!.classList.contains('ww-input')).toBe(true)
    expect(m.container.querySelector('select')!.classList.contains('ww-input')).toBe(true)
    expect(m.container.querySelector('.ww-field-unit')!.textContent).toBe('min')
  })
})

describe('the control sizes in CSS (plan 5.4)', () => {
  const rules = parseCss(read(join(WW_DIR, 'kit/controls.css'))).rules
  const decl = (sel: string, prop: string) => rules.find((r) => r.selectors.includes(sel))?.decls[prop]
  it('sm 36, md the field height, lg 48', () => {
    expect(decl(".ww-btn[data-size='sm']", '--ctl-h')).toBe('36px')
    expect(decl('.ww-btn', '--ctl-h')).toBe('var(--field-h)')
    expect(decl(".ww-btn[data-size='lg']", '--ctl-h')).toBe('48px')
  })
  it('a grouped control is 44 px for real, via the hit token', () => {
    expect(decl(".ww-btn[data-grouped='true']", 'min-height')).toBe('var(--hit)')
    expect(decl("button.ww-chip[data-grouped='true']", 'min-height')).toBe('var(--hit)')
  })
  it('an isolated short control grows a 44 px hit area vertically only', () => {
    expect(decl('.ww-btn::after', 'inset-inline')).toBe('0')
    expect(decl('.ww-btn::after', 'inset-block')).toContain('var(--hit)')
  })
  it('no kit CSS file reads a --p-* primitive (css-lint also checks this)', () => {
    for (const f of cssFiles(join(WW_DIR, 'kit'))) expect(read(f)).not.toMatch(/var\(--p-/)
  })
})
