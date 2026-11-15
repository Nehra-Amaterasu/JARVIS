// Y02: the Drill, the Park field and the views on fixtures: hint logging, no red on a miss, counts-only end, zero requestAnimationFrame at
// idle, an early end that keeps the filled dots, the port taking each result once, and the legacy id resolving to focus.drill.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Drill } from '../DrillScreen'
import { ParkField } from '../ParkField'
import { FIX_QUESTIONS, fixturePort } from '../fixtures'
import { initialState, reduce, type Act } from '../model'
import { nullFocusPort } from '../ports'
import { buttons, cleanup, click, flush, key, render, type } from './dom'
import { ALIASES } from '../../../shell/ids'
import { registeredView } from '../../../shell/views'

const css = readFileSync(join(__dirname, '..', 'views', 'focus-views.css'), 'utf8')
const noop = () => {}
const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T
const mountDrill = (port = fixturePort(), initial?: ReturnType<typeof initialState>) => {
  render(<Drill port={port} initial={initial} elapsedMin={12} onGo={noop} />)
  return port
}
const play = (acts: Act[]) => acts.reduce(reduce, initialState(FIX_QUESTIONS, 'practice set'))

beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the Drill from the keyboard and the buttons', () => {
  it('loads the set from the port, asks one question, and has no check key until something is typed', async () => {
    mountDrill()
    await flush()
    expect(q('.dr-kick').textContent).toMatch(/Question 1 of 6/)
    expect(q('.dr-stem').textContent).toMatch(/4\.7 kOhm/)
    const check = buttons(document.body, /Check/)[0]
    expect(check.getAttribute('aria-disabled')).toBe('true')
    expect(document.querySelectorAll('.dd-btn')).toHaveLength(6)
  })

  it('Enter checks a typed answer in any usual form; the port is handed the result once', async () => {
    const port = mountDrill()
    await flush()
    type(q<HTMLInputElement>('input'), '1,92')
    key('Enter', q('input'))
    await flush()
    expect(q('.dr-result').textContent).toMatch(/Matches the key/)
    expect(port.attempts).toHaveLength(1)
    expect(port.attempts[0]).toMatchObject({ questionId: 'fx-1', result: 'matched', hintsUsed: 0, shown: false, markedBy: 'check' })
    key('Enter', q('input')) // a second Enter steps; it does not record again
    expect(port.attempts).toHaveLength(1)
    expect(q('.dr-kick').textContent).toMatch(/Question 2 of 6/)
  })

  it('h opens hint 1, hint 2, then the worked answer; each is logged, the telemetry says so, and nothing is lowered', async () => {
    const port = mountDrill()
    await flush()
    key('h'); key('h')
    expect(document.querySelectorAll('.dr-hint')).toHaveLength(2)
    expect(q('.dr-strip').textContent).toContain('hints 2')
    expect(document.body.textContent).toContain('A hint is logged and lowers nothing')
    type(q<HTMLInputElement>('input'), '1.915')
    key('Enter', q('input'))
    await flush()
    expect(port.attempts[0]).toMatchObject({ result: 'matched', hintsUsed: 2, shown: false })
    expect(q('.dr-strip').textContent).toContain('matched 1')
  })

  it('a miss says "Not yet. Worked answer below", shows the key and when it comes back, and uses no red or fault token', async () => {
    const port = mountDrill()
    await flush()
    type(q<HTMLInputElement>('input'), '300')
    key('Enter', q('input'))
    await flush()
    expect(q('.dr-result').textContent).toBe('Not yet. Worked answer below')
    expect(q('.dr-worked').textContent).toMatch(/1\.91 mA/)
    expect(q('.dr-again').textContent).toBe('Seen again on Thursday.')
    expect(port.attempts[0].result).toBe('missed')
    // the miss region carries no fault lamp, no warning glyph and no verdict words
    const region = q('.dr-fb').outerHTML
    expect(region).not.toMatch(/fault|k-lamp|danger|error/i)
    expect(document.body.textContent).not.toMatch(/wrong|incorrect|mistake|failed|streak/i)
  })

  it('the stylesheet names no fault, red, danger or warning token (the lint on tokens)', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/--state-fault|--state-danger|--fault|--danger|--red|--warn|\bred\b|#f00|#e00|crimson/i)
    // and it names no hairline on a labelled control: a border only appears in the forced-colours branch
    const outside = code.split('@media (forced-colors')[0]
    expect(outside).not.toMatch(/border(-\w+)?:\s*1px solid/)
  })

  it('j and k step, s skips to the next with a hollow dot, x opens the Park field and Enter files the thought', async () => {
    const port = mountDrill()
    await flush()
    key('j'); key('j')
    expect(q('.dr-kick').textContent).toMatch(/Question 3 of 6/)
    key('k')
    key('s')
    expect(document.querySelectorAll('.dd-btn[data-dot="skipped"]')).toHaveLength(1)
    expect(q('.dr-kick').textContent).toMatch(/Question 3 of 6/)
    key('x')
    const field = q<HTMLInputElement>('.pk-in')
    expect(document.activeElement).toBe(field)
    type(field, 'Ask about the clock tree')
    act(() => void field.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
    expect(port.parked).toEqual(['Ask about the clock tree'])
    expect(q('.dr-park-list').textContent).toContain('Ask about the clock tree')
    expect(q('.dr-park-list').textContent).toContain('this page only')
    expect(document.querySelector('.pk-in')).toBeNull()
  })

  it('the set ends on counts only; "Go again on the shelf" replays; an early end keeps the filled dots', async () => {
    mountDrill(undefined, play([{ t: 'input', v: '1,92' }, { t: 'check' }, { t: 'step', d: 1 }, { t: 'input', v: '300' }, { t: 'check' }]))
    await flush()
    key('e')
    expect(q('.dr-counts').textContent).toBe('2 attempted, 1 matched, 1 on the shelf')
    expect(document.querySelectorAll('.dd-btn[data-dot="filled"]')).toHaveLength(2)
    expect(q('.dd-note').textContent).toBe('Ended early. The filled dots stay.')
    expect(document.body.textContent).not.toMatch(/%|streak|score|mistakes/i)
    click(buttons(document.body, /Go again on the shelf \(1\)/)[0])
    expect(q('.dr-kick').textContent).toMatch(/Question 1 of 1/)
    expect(q('.dr-strip').textContent).toContain('shelf')
  })

  it('one accent fill at a time: Check, then Next question', async () => {
    mountDrill(undefined, play([]))
    await flush()
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1)
    expect(q('[data-primary]').textContent).toMatch(/Check/)
    type(q<HTMLInputElement>('input'), '1.915')
    key('Enter', q('input'))
    await flush()
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1)
    expect(q('[data-primary]').textContent).toBe('Next question')
  })

  it('pauses with the Pause key and says so on the rail', async () => {
    mountDrill()
    await flush()
    click(buttons(document.body, /Pause/)[0])
    expect(q('.dr-strip').textContent).toContain('held')
    expect(buttons(document.body, /Resume/).length).toBe(1)
  })
})

describe('nothing queued, the null port and the laws of idle', () => {
  it('the null port draws the ASCII frame, WAITING with its reason, and one button to the desk', async () => {
    render(<Drill port={nullFocusPort} elapsedMin={0} onGo={noop} />)
    await flush()
    expect(q('.dr-ascii').textContent).toContain('Nothing queued')
    expect(document.body.textContent).toContain('WAITING')
    expect(document.body.textContent).toContain('no question bank is connected yet')
    expect(buttons(document.body, 'Open the paper desk')).toHaveLength(1)
    expect(q('.dr-strip').textContent).toBe('> nothing queued')
  })

  it('zero requestAnimationFrame calls while idle, and the strip stands still across ten minutes of the clock', async () => {
    vi.useFakeTimers()
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    render(<Drill port={fixturePort()} initial={play([])} onGo={noop} />)
    await flush()
    const strip = q('.dr-strip').textContent
    await act(async () => { vi.advanceTimersByTime(10 * 60_000) })
    expect(raf).not.toHaveBeenCalled()
    expect(q('.dr-strip').textContent).toBe(strip)
    expect(document.body.textContent).toContain('10 min') // the one clock moved the elapsed reading, once a minute
  })
})

describe('the Park field', () => {
  it('opens focused, files on Enter, files nothing for an empty line, and Escape closes it without filing', () => {
    const filed: string[] = []
    let open = true
    const back = document.createElement('button')
    document.body.appendChild(back)
    render(<ParkField open onFile={(t) => filed.push(t)} onClose={() => { open = false }} returnTo={() => back} />)
    const input = q<HTMLInputElement>('.pk-in')
    expect(document.activeElement).toBe(input)
    act(() => void input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(filed).toEqual([])
    type(input, '  remember the unit  ')
    act(() => void input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(filed).toEqual(['remember the unit'])
    expect(open).toBe(false)
    expect(document.activeElement).toBe(back)
    back.remove()
  })
})

describe('the views and the legacy id', () => {
  it('the four views are registered for the Focus section, and "drill" resolves to focus.drill', () => {
    for (const id of ['focus.start', 'focus.session', 'focus.rest', 'focus.drill']) expect(registeredView(id)?.product, id).toBe('ww')
    expect(ALIASES.drill).toBe('focus.drill')
  })
})
