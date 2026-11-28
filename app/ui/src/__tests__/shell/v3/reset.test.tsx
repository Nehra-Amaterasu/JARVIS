// V1 of the design reset (28 Nov): the chrome that gives room back, in happy-dom. The dock opens on focus, on the "/" key and
// while it holds text, and goes quiet again; "/" is left alone inside a text field; a tray body marks the edges that have more.
// The sizes and the real scroll are proved in a browser by e2e/design-reset.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../../ww/_stubs'
import { Dock } from '../../../shell/v3/Dock'
import { Tray } from '../../../shell/v3/Tray'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)
const key = (k: string, target: EventTarget = window) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

describe('the dock', () => {
  it('is quiet at rest, opens while focus is inside it, and is quiet again when focus leaves', () => {
    m = mount(createElement(Dock, { spec: null, onAsk: () => undefined }))
    const dock = q('.s3-dock')!
    expect(dock.dataset.open).toBe('false')
    act(() => q<HTMLInputElement>('.s3-wellin input')!.focus())
    expect(dock.dataset.open).toBe('true')
    act(() => q<HTMLInputElement>('.s3-wellin input')!.blur())
    expect(dock.dataset.open).toBe('false')
  })
  it('"/" from the page summons it (focus in the input), and "/" typed in another field is left alone', () => {
    m = mount(createElement('div', null, createElement('input', { id: 'other' }), createElement(Dock, { spec: null, onAsk: () => undefined })))
    key('/')
    expect(document.activeElement).toBe(q('.s3-wellin input'))
    act(() => q<HTMLInputElement>('#other')!.focus())
    key('/', q('#other')!)
    expect(document.activeElement).toBe(q('#other'))
  })
  it('stays open while it holds unsent text, and the specimen pose can hold it open', () => {
    m = mount(createElement(Dock, { spec: null, onAsk: () => undefined, open: true }))
    expect(q('.s3-dock')!.dataset.open).toBe('true')
  })
  it('names its key for assistive tech', () => {
    m = mount(createElement(Dock, { spec: null, onAsk: () => undefined }))
    expect(q('.s3-wellin input')!.getAttribute('aria-keyshortcuts')).toBe('/')
  })
})

describe('the tray body', () => {
  it('marks the side that has more: down at the top of a long body, up at its end, neither for a short one', () => {
    vi.useFakeTimers()
    m = mount(createElement(Tray, { step: 1, job: 'JOB', children: createElement('p', null, 'body') }))
    const body = q<HTMLElement>('.s3-body')!
    expect(body.dataset.moreUp).toBe('0')
    expect(body.dataset.moreDown).toBe('0')
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 })
    act(() => {
      body.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(50)
    })
    expect(body.dataset.moreDown).toBe('1')
    expect(body.dataset.moreUp).toBe('0')
    act(() => {
      body.scrollTop = 600
      body.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(50)
    })
    expect(body.dataset.moreUp).toBe('1')
    expect(body.dataset.moreDown).toBe('0')
    vi.useRealTimers()
  })
})
