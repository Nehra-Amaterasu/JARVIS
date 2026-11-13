// The terminal grammar (spec 20.4.3, A.G02 accept lines): the tag words ARE the lamp words, the prompt never prints
// a name or a path, BootSequence types once inside 600 ms, skips on any key, shows everything at once in calm, calls
// onDone exactly once and never after unmount, and no component leaves a timer behind when it unmounts.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, resetHtml, setHtml } from '../ww/_stubs'
import { LAMP_SPECS, LAMP_STATES } from '../../shared/lamp'
import { BootSequence, ScanFrame, TAG_WORDS, TermLine, TermWell, promptParts, tagText, typeMs } from '../../shared/grammar'
import { SCAN_CAP_MS, TYPE_CAP_MS } from '../../shared/grammar/term/Term'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
  resetHtml()
})
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('tags', () => {
  it('the tag set equals the LAMP_SPECS words, in the lamp order', () => {
    expect(TAG_WORDS).toEqual(LAMP_STATES.map((s) => LAMP_SPECS[s].label))
    expect(tagText('simulated')).toBe('[SIMULATED]')
  })
  it('a tagged line draws the lamp glyph and the lamp word in brackets, in the state token', () => {
    for (const s of LAMP_STATES) {
      m = mount(<TermLine tag={s}>x</TermLine>)
      const tag = m.container.querySelector('.g-tag')!
      expect(tag.textContent).toBe(`[${LAMP_SPECS[s].label}]`)
      expect(tag.querySelector(`svg[data-glyph="${LAMP_SPECS[s].glyph}"]`)).not.toBeNull()
      expect((tag as HTMLElement).style.getPropertyValue('--g-tag-ink')).toContain(LAMP_SPECS[s].token)
      m.unmount()
      m = null
    }
  })
  it('an error line is ERR with the FAULT tag', () => {
    m = mount(<TermLine kind="err">relay-timeout: no answer</TermLine>)
    expect(m.container.textContent).toBe('[FAULT]ERR relay-timeout: no answer')
  })
})

describe('TermWell and the prompt', () => {
  it('accepts the product and a view id only', () => {
    expect(promptParts('ww day.today $')).toEqual({ product: 'ww', view: 'day.today' })
    expect(promptParts('jarvis core $')).toEqual({ product: 'jarvis', view: 'core' })
    expect(promptParts('jarvis')).toEqual({ product: 'jarvis', view: '' })
    for (const bad of ['Someone $', 'ww C:/Users/x $', 'ww day today $', 'root@host $', 'ww ../x $']) expect(promptParts(bad), bad).toBeNull()
  })
  it('a refused prompt prints a bare $, never the text it was given', () => {
    m = mount(<TermWell prompt="Someone Private $" />)
    const well = m.container.querySelector('section.g-well')!
    expect(well.getAttribute('data-prompt')).toBe('refused')
    expect(well.textContent).not.toContain('Someone')
    expect(well.querySelector('.g-prompt')!.textContent).toBe('$')
  })
  it('is a named region on the charcoal scene with a solid, non-blinking cursor', () => {
    m = mount(<TermWell prompt="ww day.today $" label="Boot" />)
    const well = m.container.querySelector('section.g-well')!
    expect(well.getAttribute('aria-label')).toBe('Boot')
    expect(well.getAttribute('data-scene')).toBe('immersive')
    expect(well.getAttribute('data-grammar')).toBe('terminal')
    expect(well.querySelector('.g-prompt')!.textContent).toBe('ww day.today $')
    expect(well.querySelector('.g-cursor')!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('typed lines', () => {
  it('24 characters a second, capped at 600 ms', () => {
    expect(typeMs(12)).toBe(500)
    expect(typeMs(200)).toBe(TYPE_CAP_MS)
  })
  it('types a plain string by CSS steps (no timer), and refuses to type anything else', () => {
    m = mount(<TermLine typed>reading syllabus index</TermLine>)
    const t = m.container.querySelector('.g-typed') as HTMLElement
    expect(t.style.getPropertyValue('--g-type-steps')).toBe('22')
    expect(vi.getTimerCount()).toBe(0)
    m.unmount()
    m = mount(<TermLine typed><b>x</b></TermLine>)
    expect(m.container.querySelector('.g-line')!.getAttribute('data-typed')).toBe('false')
  })
})

describe('BootSequence', () => {
  const rows = ['heard', 'working: reading syllabus index', 'done']
  it('types every row inside 600 ms, then calls onDone exactly once and leaves no timer', () => {
    const done = vi.fn()
    m = mount(<BootSequence rows={rows} onDone={done} />)
    expect(m.container.querySelector('.g-boot')!.getAttribute('data-done')).toBe('false')
    tick(TYPE_CAP_MS + 80)
    expect(done).toHaveBeenCalledTimes(1)
    expect(m.container.querySelector('.g-boot')!.getAttribute('data-done')).toBe('true')
    expect(m.container.querySelector('[role="status"]')!.textContent).toBe(rows.join('. '))
    expect(vi.getTimerCount()).toBe(0)
    tick(5000)
    expect(done).toHaveBeenCalledTimes(1)
  })
  it('any key skips to the end', () => {
    const done = vi.fn()
    m = mount(<BootSequence rows={rows} onDone={done} />)
    tick(80)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' })) })
    expect(done).toHaveBeenCalledTimes(1)
    expect(m.container.querySelector('.g-boot')!.getAttribute('data-done')).toBe('true')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('calm shows every row at once and starts no timer', () => {
    setHtml({ 'data-motion': 'calm' })
    const done = vi.fn()
    m = mount(<BootSequence rows={rows} onDone={done} />)
    expect(m.container.querySelector('.g-boot')!.getAttribute('data-done')).toBe('true')
    expect(done).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('unmounted mid-run: no timer left, no listener left, and onDone is never called', () => {
    const done = vi.fn()
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    m = mount(<BootSequence rows={rows} onDone={done} />)
    tick(100)
    m.unmount()
    m = null
    expect(vi.getTimerCount()).toBe(0)
    tick(2000)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' })) })
    expect(done).not.toHaveBeenCalled()
    const added = add.mock.calls.filter(([t]) => t === 'keydown' || t === 'pointerdown').length
    const removed = remove.mock.calls.filter(([t]) => t === 'keydown' || t === 'pointerdown').length
    expect(removed).toBe(added)
    add.mockRestore()
    remove.mockRestore()
  })
  it('caps rows at 12 of 120 characters', () => {
    m = mount(<BootSequence rows={Array.from({ length: 30 }, () => 'y'.repeat(500))} onDone={() => {}} />)
    tick(TYPE_CAP_MS + 80)
    const shown = m.container.querySelectorAll('.g-boot-row')
    expect(shown.length).toBe(12)
    expect(shown[0].textContent).toBe(`> ${'y'.repeat(120)}`)
  })
})

describe('ScanFrame', () => {
  it('sweeps at most 3 s, then says "still scanning" with the WAITING lamp and holds still', () => {
    m = mount(<ScanFrame label="Board" state="scanning" />)
    const f = m.container.querySelector('section.g-scan')!
    expect(f.getAttribute('aria-busy')).toBe('true')
    expect(f.querySelector('.g-sweep')).not.toBeNull()
    tick(SCAN_CAP_MS)
    expect(f.getAttribute('data-capped')).toBe('true')
    expect(f.getAttribute('aria-busy')).toBe('false')
    expect(f.querySelector('.g-sweep')).toBeNull()
    expect(f.textContent).toContain('Still scanning')
    expect(f.querySelector('[data-lamp="waiting"]')).not.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('clears its cap timer on unmount', () => {
    m = mount(<ScanFrame label="Board" state="scanning" />)
    expect(vi.getTimerCount()).toBe(1)
    m.unmount()
    m = null
    expect(vi.getTimerCount()).toBe(0)
  })
  it('waiting draws a frozen Bayer field and starts no timer; calm never sweeps', () => {
    m = mount(<ScanFrame label="Phone link" state="waiting" />)
    expect(m.container.querySelector('pre.g-bayer')!.getAttribute('aria-hidden')).toBe('true')
    expect(m.container.textContent).toContain('Waiting for a report')
    expect(vi.getTimerCount()).toBe(0)
    m.unmount()
    setHtml({ 'data-motion': 'calm' })
    m = mount(<ScanFrame label="Board" state="scanning" />)
    expect(m.container.querySelector('.g-sweep')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
