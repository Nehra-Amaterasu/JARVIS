// The Capture Line in a DOM (A.D04): typing, the chips, Enter, the question that waits, the Undo toast, the jarvis
// grammar, Ctrl+Space, the keyboard, and the rules the stylesheet must keep (a still block, no loop, 44 px).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../__tests__/ww/_stubs'
import { CaptureLine, UNKNOWN_VERB, type Parsed } from '..'

const NOW = () => new Date(2026, 10, 13, 10, 30)
let m: ReturnType<typeof mount> | null = null
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }) })
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers(); document.body.replaceChildren() })

const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('.cl-input')!
const type = (el: HTMLInputElement, v: string) => act(() => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
const click = (el: Element) => act(() => { (el as HTMLElement).click() })
const chip = (c: HTMLElement, field: string) => c.querySelector<HTMLButtonElement>(`.cl-chip[data-field="${field}"] .cl-chip-btn`)!
const status = (c: HTMLElement) => c.querySelector('.cl')!.getAttribute('data-status')
const enterKey = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.cl-enter')!

function line(props: Partial<Parameters<typeof CaptureLine>[0]> = {}) {
  const onCommit = vi.fn<(p: Parsed) => void>()
  m = mount(<CaptureLine grammar="ww" onCommit={onCommit} now={NOW} {...props} />)
  return { c: m.container as HTMLElement, onCommit }
}

describe('idle', () => {
  it('is one labelled section with one text field, a 44 px Enter key that is not ready, and the examples as its hint', () => {
    const { c } = line()
    expect(c.querySelector('section.cl[aria-label="Capture line"]')).not.toBeNull()
    expect(c.querySelectorAll('input.cl-input').length).toBe(1)
    expect(enterKey(c).getAttribute('aria-disabled')).toBe('true')
    expect(enterKey(c).hasAttribute('disabled')).toBe(false) // it stays focusable
    expect(status(c)).toBe('idle')
    expect(c.querySelector('.cl-say')!.textContent).toContain('spent 120 chai')
    expect(c.querySelector('.cl-chips')).toBeNull()
  })
  it('draws a solid block cursor that is hollow until the field has focus, and never animates', () => {
    const { c } = line()
    const block = c.querySelector('.cl-block')!
    expect(block.getAttribute('data-focus')).toBe('false')
    act(() => input(c).focus())
    expect(c.querySelector('.cl-block')!.getAttribute('data-focus')).toBe('true')
    expect(input(c).getAttribute('aria-describedby')).toBe(c.querySelector('.cl-say')!.id)
  })
  it('the cursor column follows the caret', () => {
    const { c } = line()
    const el = input(c)
    type(el, 'spent 12')
    el.setSelectionRange(3, 3)
    act(() => { el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })) })
    expect((c.querySelector('.cl') as HTMLElement).style.getPropertyValue('--cl-col')).toBe('3')
  })
})

describe('typing', () => {
  it('reads as you type: chips appear beneath, Enter becomes ready, nothing is committed yet', () => {
    const { c, onCommit } = line()
    type(input(c), 'spent 120 chai')
    expect(status(c)).toBe('ready')
    expect([...c.querySelectorAll('.cl-chip')].map((x) => x.getAttribute('data-field'))).toEqual(['verb', 'amount', 'label', 'date'])
    expect(enterKey(c).getAttribute('aria-disabled')).toBe('false')
    expect(onCommit).not.toHaveBeenCalled()
  })
  it('a verb being typed is parsing, not a question', () => {
    const { c } = line()
    type(input(c), 'sp')
    expect(status(c)).toBe('parsing')
    expect(c.querySelector('.cl-say')!.textContent).toContain('spent')
  })
  it('an ambiguous line shows its question with the WAITING lamp, and Enter waits', () => {
    const { c, onCommit } = line()
    type(input(c), '120')
    expect(status(c)).toBe('ambiguous')
    expect(c.querySelector('.cl-say')!.textContent).toBe('? what is 120')
    expect(c.querySelector('.cl-plate .lamp-glyph')).not.toBeNull()
    key(input(c), 'Enter')
    click(enterKey(c))
    expect(onCommit).not.toHaveBeenCalled()
    expect(input(c).value).toBe('120') // the line is kept
    expect(c.querySelector('[role="status"].k-vh')!.textContent).toContain('Question: what is 120')
  })
  it('what it did understand stays as chips and what is missing is a hollow chip', () => {
    const { c } = line()
    type(input(c), 'spent 120')
    expect(c.querySelector('.cl-chip[data-field="amount"]')!.getAttribute('data-state')).toBe('typed')
    expect(c.querySelector('.cl-chip[data-field="label"]')!.getAttribute('data-state')).toBe('missing')
    expect(chip(c, 'label').getAttribute('aria-label')).toBe('Fill in label')
  })
  it('markup typed into a label stays text', () => {
    const { c } = line()
    type(input(c), 'spent 5 <img src=x onerror=alert(1)>')
    expect(c.querySelector('img')).toBeNull()
    expect(c.querySelector('.cl-chip[data-field="label"] .cl-val')!.textContent).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('Enter commits', () => {
  it('calls onCommit once with the parsed entry, clears the line and shows a toast with Undo', () => {
    const onUndo = vi.fn()
    const { c, onCommit } = line({ onUndo })
    type(input(c), 'spent 120 chai')
    key(input(c), 'Enter')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0]).toMatchObject({ grammar: 'ww', verb: 'spent', amount: 120, label: 'chai', date: '2026-11-13' })
    expect(input(c).value).toBe('')
    expect(c.querySelector('.k-toast')!.textContent).toContain('logged: spent 120 chai')
    expect(c.querySelector('.k-toast-undo')).not.toBeNull()
  })
  it('the Enter key button commits too', () => {
    const { c, onCommit } = line()
    type(input(c), 'water 250')
    click(enterKey(c))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('the Undo toast stays 6 seconds and then leaves', () => {
    const { c } = line({ onUndo: () => {} })
    type(input(c), 'water 250')
    key(input(c), 'Enter')
    act(() => { vi.advanceTimersByTime(5900) })
    expect(c.querySelector('.k-toast')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(200) })
    expect(c.querySelector('.k-toast')).toBeNull()
  })
  it('Undo calls onUndo with what was committed and puts the line back for editing', () => {
    const onUndo = vi.fn()
    const { c } = line({ onUndo })
    type(input(c), 'gym legs 45')
    key(input(c), 'Enter')
    click(c.querySelector('.k-toast-undo')!)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onUndo.mock.calls[0][0]).toMatchObject({ verb: 'gym', label: 'legs', minutes: 45 })
    expect(input(c).value).toBe('gym legs 45')
    expect(c.querySelector('.k-toast')).toBeNull()
  })
  it('without onUndo the toast carries no Undo, because the line cannot take back what the host stored', () => {
    const { c } = line()
    type(input(c), 'water 250')
    key(input(c), 'Enter')
    expect(c.querySelector('.k-toast')).not.toBeNull()
    expect(c.querySelector('.k-toast-undo')).toBeNull()
  })
  it('a second commit restarts the toast', () => {
    const { c } = line({ onUndo: () => {} })
    type(input(c), 'water 250')
    key(input(c), 'Enter')
    act(() => { vi.advanceTimersByTime(4000) })
    type(input(c), 'water 300')
    key(input(c), 'Enter')
    act(() => { vi.advanceTimersByTime(4000) })
    expect(c.querySelector('.k-toast')!.textContent).toContain('water 300')
  })
  it('leaves no timer behind when it unmounts', () => {
    const { c } = line({ onUndo: () => {} })
    type(input(c), 'water 250')
    key(input(c), 'Enter')
    m!.unmount()
    m = null
    expect(vi.getTimerCount()).toBe(0)
    void c
  })
})

describe('the chips are editable', () => {
  it('pressing a chip opens an input with its text; Enter rewrites the line, re-reads it and returns to the line', () => {
    const { c } = line()
    type(input(c), 'spent 120 chai')
    click(chip(c, 'amount'))
    const edit = c.querySelector<HTMLInputElement>('.cl-chip-input')!
    expect(edit.value).toBe('120')
    expect(document.activeElement).toBe(edit)
    type(edit, '150')
    key(edit, 'Enter')
    expect(input(c).value).toBe('spent 150 chai')
    expect(c.querySelector('.cl-chip[data-field="amount"] .cl-val')!.textContent).toBe('150')
    expect(c.querySelector('.cl-chip-input')).toBeNull()
    expect(document.activeElement).toBe(input(c))
  })
  it('Escape cancels an edit and leaves the line as it was', () => {
    const { c } = line()
    type(input(c), 'spent 120 chai')
    click(chip(c, 'amount'))
    const edit = c.querySelector<HTMLInputElement>('.cl-chip-input')!
    type(edit, '999')
    key(edit, 'Escape')
    expect(input(c).value).toBe('spent 120 chai')
    expect(c.querySelector('.cl-chip-input')).toBeNull()
  })
  it('a hollow chip is filled in the same way and the line becomes ready', () => {
    const { c, onCommit } = line()
    type(input(c), 'spent 120')
    click(chip(c, 'label'))
    const edit = c.querySelector<HTMLInputElement>('.cl-chip-input')!
    type(edit, 'tea')
    key(edit, 'Enter')
    expect(input(c).value).toBe('spent 120 tea')
    expect(status(c)).toBe('ready')
    key(input(c), 'Enter')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('a date chip takes a date word and shows the resolved day', () => {
    const { c } = line()
    type(input(c), 'spent 120 chai')
    click(chip(c, 'date'))
    const edit = c.querySelector<HTMLInputElement>('.cl-chip-input')!
    type(edit, 'yesterday')
    key(edit, 'Enter')
    expect(c.querySelector('.cl-chip[data-field="date"] .cl-val')!.textContent).toBe('Thu 12 Nov')
  })
  it('the verb plate is not a control', () => {
    const { c } = line()
    type(input(c), 'spent 120 chai')
    expect(c.querySelector('.cl-chip[data-field="verb"] button')).toBeNull()
  })
  it('every chip is a labelled button with its value in the name', () => {
    const { c } = line()
    type(input(c), 'remind me next tue 7 pm physics')
    expect(chip(c, 'date').getAttribute('aria-label')).toBe('Edit date: Tue 17 Nov')
    expect(chip(c, 'time').getAttribute('aria-label')).toBe('Edit time: 19:00')
  })
})

describe('the keyboard', () => {
  it('Escape clears a line that has text', () => {
    const { c } = line()
    type(input(c), 'spent 120 chai')
    key(input(c), 'Escape')
    expect(input(c).value).toBe('')
  })
  it('the up and down arrows walk the lines that were committed', () => {
    const { c } = line()
    for (const t of ['water 250', 'gym legs 45']) { type(input(c), t); key(input(c), 'Enter') }
    type(input(c), 'spe')
    key(input(c), 'ArrowUp')
    expect(input(c).value).toBe('gym legs 45')
    key(input(c), 'ArrowUp')
    expect(input(c).value).toBe('water 250')
    key(input(c), 'ArrowDown')
    key(input(c), 'ArrowDown')
    expect(input(c).value).toBe('spe') // back to what was being typed
  })
  it('Ctrl+Space focuses the line from anywhere; plain Space does not, and a hidden line is skipped', () => {
    const { c } = line()
    const other = document.createElement('button')
    document.body.appendChild(other)
    other.focus()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })) })
    expect(document.activeElement).toBe(other)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true, cancelable: true })) })
    expect(document.activeElement).toBe(input(c))
    other.focus()
    ;(c.querySelector('.cl') as HTMLElement).hidden = true
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true, cancelable: true })) })
    expect(document.activeElement).toBe(other)
  })
  it('the jarvis grammar does not take Ctrl+Space unless asked', () => {
    const { c } = line({ grammar: 'jarvis' })
    const other = document.createElement('button')
    document.body.appendChild(other)
    other.focus()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true, cancelable: true })) })
    expect(document.activeElement).toBe(other)
    void c
  })
  it('two lines share one window listener, and it goes with the last one', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const a = mount(<CaptureLine grammar="ww" onCommit={() => {}} />)
    const b = mount(<CaptureLine grammar="ww" onCommit={() => {}} />)
    expect(add.mock.calls.filter((x) => x[0] === 'keydown').length).toBe(1)
    a.unmount()
    expect(remove.mock.calls.filter((x) => x[0] === 'keydown').length).toBe(0)
    b.unmount()
    expect(remove.mock.calls.filter((x) => x[0] === 'keydown').length).toBe(1)
    add.mockRestore(); remove.mockRestore()
  })
  it('exactly the Enter key, the field and the chips are the tab stops: no tabindex above 0', () => {
    const { c } = line()
    type(input(c), 'spent 120 chai')
    expect([...c.querySelectorAll('[tabindex]')].filter((x) => Number(x.getAttribute('tabindex')) > 0)).toEqual([])
  })
})

describe('the jarvis grammar', () => {
  it('a word that is not a verb answers "unknown verb; try help" and waits', () => {
    const { c, onCommit } = line({ grammar: 'jarvis', verbs: ['status', 'jobs'] })
    type(input(c), 'format c:')
    expect(status(c)).toBe('unknown')
    expect(c.querySelector('.cl-say')!.textContent).toBe(UNKNOWN_VERB)
    key(input(c), 'Enter')
    expect(onCommit).not.toHaveBeenCalled()
  })
  it('remember> writes a fact: the verb and the text become chips and Enter commits', () => {
    const { c, onCommit } = line({ grammar: 'jarvis' })
    type(input(c), 'remember> I keep my notes in the blue folder')
    expect(status(c)).toBe('ready')
    expect(c.querySelector('.cl-chip[data-field="verb"] .cl-val')!.textContent).toBe('remember')
    key(input(c), 'Enter')
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ grammar: 'jarvis', verb: 'remember', args: 'I keep my notes in the blue folder' }))
    expect(c.querySelector('.k-toast')!.textContent).toContain('sent:')
  })
  it('the section\'s own verbs are accepted and the idle hint lists them', () => {
    const { c, onCommit } = line({ grammar: 'jarvis', verbs: ['status', 'test hearing'] })
    expect(c.querySelector('.cl-say')!.textContent).toContain('test hearing')
    type(input(c), 'test hearing')
    key(input(c), 'Enter')
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'test hearing' }))
  })
  it('the field is named Command and the key says Send it', () => {
    const { c } = line({ grammar: 'jarvis' })
    expect(input(c).getAttribute('aria-label')).toBe('Command')
    expect(enterKey(c).getAttribute('aria-label')).toBe('Send it')
  })
})

describe('initialText shows a state without typing', () => {
  it('starts ambiguous when it is given an ambiguous line', () => {
    const { c } = line({ initialText: '120' })
    expect(status(c)).toBe('ambiguous')
  })
})

describe('the stylesheet keeps the rules', () => {
  const css = readFileSync(resolve(__dirname, '..', 'capture.css'), 'utf8')
  it('has no loop, no blink and no scanline, and no literal colour outside forced-colour words', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/infinite|blink|scanline|flicker/i)
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
  it('keeps 44 px on the field, the key and the chips, a 2 px focus ring and a forced-colours branch', () => {
    expect((css.match(/min-block-size: var\(--hit, 44px\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(css).toMatch(/outline: 2px solid var\(--focus-ring/)
    expect(css).toMatch(/@media \(forced-colors: active\)/)
    expect(css).toMatch(/prefers-reduced-motion: reduce/)
    expect(css).toMatch(/data-motion='calm'/)
  })
  it('hides the native caret, because it blinks', () => expect(css).toMatch(/caret-color: transparent/))
})
