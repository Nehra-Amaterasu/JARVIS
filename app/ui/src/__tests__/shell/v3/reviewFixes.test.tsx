// What the review of package S1 changed: lost input in the dock, focus after a popover choice, a tray's own name, one ruler
// pattern per tray, the glare only on a rise, a modal sheet, and a reported fault reaching both the pill and the spine tile.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../../ww/_stubs'
import ShellV2 from '../../../shell/ShellV2'
import { LOOK_KEY, resetLookForTests } from '../../../shell/look'
import { resetShellForTests } from '../../../shell/store'
import { resetPortsForTests } from '../../../shell/ports'
import { useStore } from '../../../lib/store'
import { Dock } from '../../../shell/v3/Dock'
import { Ruler, Tray } from '../../../shell/v3/Tray'
import { Zones } from '../../../shell/v3/Zones'
import type { DockSpec } from '../../../shell/v3/contract'

const el = createElement
let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)
const qa = (sel: string) => [...m!.container.querySelectorAll<HTMLElement>(sel)]
const click = (e: Element | null) => act(() => void (e as HTMLElement).click())
const type = (input: HTMLInputElement, v: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const modes = [{ id: 'capture', label: 'Capture', prefix: '>', example: 'x', action: 'Add' }]

describe('the dock keeps what was typed', () => {
  it('Ask hands the text to the shell and leaves it in the input', () => {
    const onAsk = vi.fn()
    m = mount(el(Dock, { spec: { modes }, onAsk }))
    click(q('.s3-mode [data-mode="ask"]'))
    type(q<HTMLInputElement>('.s3-wellin input')!, 'open room rules')
    click(q('.s3-send'))
    expect(onAsk).toHaveBeenCalledWith('open room rules')
    expect(q<HTMLInputElement>('.s3-wellin input')!.value).toBe('open room rules')
  })

  it('a view that says it did not take the line keeps the text; a promise of false does too; success clears', async () => {
    let result: boolean | void | Promise<boolean | void> = false
    const spec: DockSpec = { modes, onSubmit: () => result }
    m = mount(el(Dock, { spec, onAsk: () => undefined }))
    const input = q<HTMLInputElement>('.s3-wellin input')!
    type(input, 'spent 120 chai')
    click(q('.s3-send'))
    expect(input.value).toBe('spent 120 chai')
    result = Promise.resolve(false)
    click(q('.s3-send'))
    await act(async () => void (await Promise.resolve()))
    expect(input.value).toBe('spent 120 chai')
    result = Promise.resolve(true)
    click(q('.s3-send'))
    await act(async () => void (await Promise.resolve()))
    expect(input.value).toBe('')
  })

  it('a throwing view keeps the text', () => {
    const spec: DockSpec = {
      modes,
      onSubmit: () => {
        throw new Error('offline')
      },
    }
    m = mount(el(Dock, { spec, onAsk: () => undefined }))
    type(q<HTMLInputElement>('.s3-wellin input')!, 'keep me')
    click(q('.s3-send'))
    expect(q<HTMLInputElement>('.s3-wellin input')!.value).toBe('keep me')
  })
})

describe('trays', () => {
  it('a tray with a label is named by it, not by its step head', () => {
    m = mount(el(Tray, { step: 2, job: 'DETAIL', label: 'Detail of the fix', children: 'x' }))
    const s = q('section')!
    expect(s.getAttribute('aria-label')).toBe('Detail of the fix')
    expect(s.hasAttribute('aria-labelledby')).toBe(false)
    m.render(el(Tray, { step: 2, job: 'DETAIL', children: 'x' }))
    expect(q('section')!.hasAttribute('aria-labelledby')).toBe(true)
  })

  it('two rulers on one screen use two pattern ids', () => {
    m = mount(el('div', null, el(Ruler), el(Ruler)))
    const ids = qa('pattern').map((p) => p.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const r of qa('.s3-ruler-marks rect')) expect(ids.some((id) => r.getAttribute('fill') === `url(#${id})`)).toBe(true)
  })

  it('the glare does not play on arrival and plays when the number rises', () => {
    const t = (flare: number) => el(Tray, { step: 1, job: 'WAKE', flare, children: 'x' })
    m = mount(t(2))
    expect(q('.s3-flare')).toBeNull()
    m.render(t(2))
    expect(q('.s3-flare')).toBeNull()
    m.render(t(3))
    expect(q('.s3-flare')!.getAttribute('data-flare')).toBe('3')
  })
})

describe('an open phone sheet is modal', () => {
  it('Tab and Shift+Tab wrap inside the sheet', () => {
    const zones = el(Zones, {
      first: { job: 'WAKE', children: el('button', { id: 'outside' }, 'a') },
      second: { job: 'CONVERSATION', peek: { name: 'Conversation', lamp: 'waiting' }, children: el('button', { id: 'inner' }, 'b') },
      third: { job: 'VOICE PATH', children: 'c' },
    } as never)
    m = mount(el('div', null, zones, el('button', { id: 'behind' }, 'behind')))
    click(q('.s3-pill[data-peek="2"]'))
    const done = q<HTMLButtonElement>('.s3-tray[data-step="2"] .s3-done')!
    expect(document.activeElement).toBe(done)
    const tab = (shiftKey: boolean) => act(() => void done.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })))
    tab(false)
    expect(document.activeElement).toBe(q('#inner'))
    tab(true)
    expect(document.activeElement).toBe(done)
  })
})

const PAGES = Object.fromEntries(['core', 'limbs', 'aankhen', 'yaadash', 'connect', 'system'].map((t) => [t, () => el('div', null, t)]))
describe('in the shell', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(LOOK_KEY, 'v3')
    history.replaceState(null, '', '/')
    resetLookForTests()
    resetShellForTests()
    resetPortsForTests()
    useStore.setState({ readings: {} })
  })
  afterEach(() => {
    localStorage.clear()
    resetLookForTests()
  })
  async function render() {
    m = mount(el(ShellV2, { pages: PAGES, wwRoot: () => el('div'), verbs: [], serverUp: true }))
    for (let i = 0; i < 100 && !q('.s3'); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 20))))
  }

  it('a view chosen in a popover leaves focus on the popover trigger, not on body', async () => {
    await render()
    click(q('.s3-chipbtn'))
    click(q('.s3-vlist .s3-popitem:not([aria-current])'))
    expect(document.activeElement).toBe(q('.s3-chipbtn'))
  })

  it('the popover panel is a dialog and focus moves into it on open', async () => {
    await render()
    const pill = q<HTMLButtonElement>('.s3-pillbtn')!
    expect(pill.getAttribute('aria-haspopup')).toBe('dialog')
    click(pill)
    expect(q('.s3-pop')!.getAttribute('role')).toBe('dialog')
    expect(q('.s3-pop')!.contains(document.activeElement)).toBe(true)
  })

  it('the dock keeps a half-typed line when the person switches section', async () => {
    await render()
    type(q<HTMLInputElement>('.s3-wellin input')!, 'half a thought')
    click(q('.s3-item:not([aria-current])'))
    expect(q<HTMLInputElement>('.s3-wellin input')!.value).toBe('half a thought')
  })

  it('a reported fault reaches the pill and the spine tile, and the tile line is the state word alone', async () => {
    useStore.setState({ readings: { steward: { state: 'fault', since: 1, reason: 'Ollama is not answering' } } })
    await render()
    expect(q('.s3-pillbtn')!.getAttribute('aria-label')).toContain('1 FAULT')
    const small = q('.s3-grp[data-p="jarvis"] .s3-hn small')!
    expect(small.textContent).toBe('FAULT')
    expect(small.getAttribute('title')).toContain('steward')
  })
})
