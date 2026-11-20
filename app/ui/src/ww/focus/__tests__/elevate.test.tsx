// EL-FOCUS: the elevated Focus views. The Length dial is a pure function of the length, the sun of Rest stands as high as the block held,
// the idle Session and Rest say WAITING and why (no invented ledger), one header block and one numeral token serve the four views,
// the stepper of the Drill prints a state word per step, and the stylesheet draws no hairline round a card or a labelled control.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { litDots, sunY, DIAL_DOTS } from '../art'
import { FocusRestPanel } from '../FocusRest'
import { FocusStartPanel } from '../FocusStart'
import { Drill } from '../DrillScreen'
import { FIX_PICK, FIX_QUESTIONS, fixturePort } from '../fixtures'
import type { DrillQuestion } from '../ports'
import type { QResult } from '../model'
import { DrillDots } from '../DrillDots'
import { useNarrow } from '../useNarrow'
import { buttons, cleanup, click, flush, key, render, type } from './dom'

const css = readFileSync(join(__dirname, '..', 'views', 'focus-views.css'), 'utf8')
const noop = () => {}
const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const TRACKS = [{ id: 'a', label: 'Digital logic' }, { id: 'b', label: 'Maths' }]
const start = (len: 25 | 50 | 75 | 90) => (
  <FocusStartPanel tracks={TRACKS} trackId="a" onTrack={noop} len={len} onLen={noop} cue="" onCue={noop} wager={false} onWager={noop} guards={false} onGuards={noop}
    pick={FIX_PICK} onStart={noop} eyesLine="eyes: not live" stamp="simulated" />
)

describe('the Length dial and the sun are pure functions', () => {
  it('lights one dot per 5 minutes of the length, at most 18', () => {
    expect([25, 50, 75, 90].map(litDots)).toEqual([5, 10, 15, 18])
    expect(litDots(0)).toBe(0)
    expect(litDots(500)).toBe(DIAL_DOTS)
  })
  it('puts the sun on the horizon for no block and highest at 90 minutes, never outside that', () => {
    expect(sunY(null)).toBe(190)
    expect(sunY(0)).toBe(190)
    expect(sunY(45)).toBe(120)
    expect(sunY(90)).toBe(50)
    expect(sunY(400)).toBe(50)
    // a reading that is not a number is read as nothing held, never as a missing sun
    expect(sunY(Number.NaN)).toBe(190)
    expect(sunY(Number.POSITIVE_INFINITY)).toBe(190)
  })
})

describe('Start', () => {
  it('draws the length as the hero numeral with a PLANNED lamp and the primary under it; the dial lights what the length says', () => {
    // the test window is 1024 wide, which is the compact band; the big dial is the wide layout's
    vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {} }))
    render(start(75))
    expect(q('[data-testid="length-numeral"]').textContent).toBe('75')
    expect(q('.fs-right').textContent).toContain('PLANNED')
    expect(document.querySelectorAll('.fs-right .fv-dial-dot[data-lit="true"]')).toHaveLength(15)
    // the primary is a sibling after the dial panel, not inside the form column
    expect(q('.fs-go [data-primary]').textContent).toBe('Start session')
    expect(q('.fs-left .fs-go')).toBeNull()
    expect(q('.fv-kick').textContent).toBe('Focus')
    expect(q('.fv-title').textContent).toBe('Start a block')
  })
  it('keeps the Cue label in the shared eyebrow style and no moon', () => {
    render(start(50))
    expect(css).toMatch(/\.fs-cue \.ww-field-label\s*\{[^}]*var\(--type-label\)/)
    expect(css).not.toMatch(/fv-moon/)
    expect(css).not.toMatch(/\.fs-cue\s*\{[^}]*28rem/)
  })
})

describe('Rest says WAITING and why', () => {
  it('Rest with no block: WAITING with its reason, the buttons follow the sentence, and the sun is low', () => {
    render(<FocusRestPanel last={null} onStart={noop} onToday={noop} />)
    expect(q('.fr-left').textContent).toContain('WAITING')
    expect(q('.fr-left').textContent).toContain('No block has ended')
    expect(q('[data-art="hill"]').getAttribute('data-sun')).toBe('190')
    expect(css).not.toMatch(/\.fr-actions\s*\{[^}]*margin-block-start:\s*auto/)
    expect(document.body.textContent).not.toMatch(/Rest 0 of|countdown timer/)
  })
  it('Rest after a block: the held minutes lift the sun', () => {
    render(<FocusRestPanel last={{ at: 1, kind: 'done', line: 'x', heldMin: 90, counted: 90, length: 90, trackLabel: 'Maths', parked: 0 }} onStart={noop} onToday={noop} simulated />)
    expect(q('[data-art="hill"]').getAttribute('data-sun')).toBe('50')
  })
})

describe('one header block and one numeral token', () => {
  it('Drill shares the header and prints a state word per step', async () => {
    render(<Drill port={fixturePort()} elapsedMin={3} onGo={noop} />)
    await flush()
    expect(q('.dr > .fv-head .fv-kick').textContent).toBe('Focus')
    expect(q('.dr > .fv-head .fv-title').textContent).toBe('Drill')
    const words = [...document.querySelectorAll('.dd-word')].map((e) => e.textContent)
    expect(words[0]).toBe('here')
    expect(words.slice(1).every((w) => w === 'open')).toBe(true)
    expect(css).toMatch(/\.dd-n\s*\{[^}]*--type-title/)
    expect(css).toMatch(/\.fv-num\s*\{[^}]*--type-display-compact/)
  })
  it('the stylesheet draws no 1 px border round a card or a labelled control', () => {
    const borders = css.split('\n').filter((l) => /\bborder:\s*1px/.test(l) && !/CanvasText/.test(l))
    expect(borders).toEqual([])
  })
})

const nQs = (n: number): DrillQuestion[] => Array.from({ length: n }, (_, i) => ({ ...FIX_QUESTIONS[i % FIX_QUESTIONS.length], id: `n-${i}` }))
const ans = (state: QResult['state']): QResult => ({ state, hints: 0, shown: false, markedBy: 'check' }) as QResult

describe('the step list of the Drill', () => {
  it('shows every step in the strip when the set ends (current -1) and when the set is longer than six: nothing is windowed out', () => {
    render(<DrillDots qs={nQs(10)} res={{}} current={-1} onJump={noop} variant="strip" />)
    expect(document.querySelectorAll('.dd-btn')).toHaveLength(10)
    cleanup()
    render(<DrillDots qs={nQs(10)} res={{}} current={0} onJump={noop} variant="strip" />)
    expect(document.querySelectorAll('.dd-btn')).toHaveLength(10)
  })
  it('the strip says its count in words: "N of M answered"', () => {
    render(<DrillDots qs={nQs(10)} res={{ 'n-0': ans('matched'), 'n-1': ans('skipped') }} current={2} onJump={noop} variant="strip" />)
    expect(q('.dd-count').textContent).toBe('1 of 10 answered')
    expect(css).not.toMatch(/\.dd\[data-variant='strip'\] \.dd-of\s*\{\s*display:\s*none/)
  })
  it('a rail of 5, 7, 9 and 10 steps joins the line only inside each column: the last step of a column is the end', () => {
    const cases: [number, number[]][] = [[7, [3, 6]], [9, [4, 8]], [10, [4, 9]], [5, [4]]]
    for (const [n, ends] of cases) {
      render(<DrillDots qs={nQs(n)} res={{}} current={0} onJump={noop} />)
      const got = [...document.querySelectorAll('.dd-list li')].map((li, i) => (li.hasAttribute('data-end') ? i : -1)).filter((i) => i >= 0)
      expect(got, `${n} steps`).toEqual(ends)
      cleanup()
    }
  })
  it('answering names the step answered, skipping names it skipped, a click on a step jumps there, and the ended screen lists every step', async () => {
    render(<Drill port={fixturePort()} elapsedMin={3} onGo={noop} />)
    await flush()
    const words = () => [...document.querySelectorAll('.dd-word')].map((e) => e.textContent)
    const input = q<HTMLInputElement>('input')
    type(input, '1,92')
    key('Enter', input)
    await flush()
    expect(words()[0]).toBe('answered')
    key('Enter', input)
    await flush()
    expect(q('.dr-kick').textContent).toMatch(/Question 2 of 6/)
    key('Escape', q('input'))
    key('s')
    await flush()
    expect(words()[1]).toBe('skipped')
    click(document.querySelectorAll('.dd-btn')[4])
    expect(q('.dr-kick').textContent).toMatch(/Question 5 of 6/)
    expect(document.querySelectorAll('.dd-btn')[4].getAttribute('aria-current')).toBe('step')
    key('e')
    await flush()
    expect(document.querySelectorAll('.dd-btn')).toHaveLength(6)
    expect(words()[0]).toBe('answered')
    expect(words()[1]).toBe('skipped')
  })
  it('Esc in the Park field gives the focus back to the Park button', async () => {
    render(<Drill port={fixturePort()} elapsedMin={3} onGo={noop} />)
    await flush()
    key('x')
    await flush()
    const field = q<HTMLInputElement>('.pk-in')
    expect(document.activeElement).toBe(field)
    key('Escape', field)
    await flush()
    expect(document.querySelector('.pk-in')).toBeNull()
    expect(document.activeElement).toBe(buttons(document.body, /Park a thought/)[0])
  })
})

describe('the phone branch (matchMedia says narrow)', () => {
  const stub = (matches: boolean, legacy = false) => {
    const m: Record<string, unknown> = { matches, media: '', onchange: null, dispatchEvent: () => false }
    if (legacy) { m.addListener = vi.fn(); m.removeListener = vi.fn() } else { m.addEventListener = vi.fn(); m.removeEventListener = vi.fn() }
    vi.stubGlobal('matchMedia', () => m)
    return m
  }
  it('draws the strip variant with all six steps, and no rail', async () => {
    stub(true)
    render(<Drill port={fixturePort()} elapsedMin={3} onGo={noop} />)
    await flush()
    expect(document.querySelectorAll('.dd[data-variant="strip"]')).toHaveLength(1)
    expect(document.querySelector('.dd[data-variant="rail"]')).toBeNull()
    expect(document.querySelectorAll('.dd-btn')).toHaveLength(6)
    key('j')
    expect(q('.dr-kick').textContent).toMatch(/Question 2 of 6/)
    expect(document.querySelectorAll('.dd-btn')).toHaveLength(6)
  })
  it('Start draws one dial and one PLANNED lamp in either layout', () => {
    stub(true)
    render(start(50))
    expect(document.querySelectorAll('.fs .k-lamp[data-state="planned"]')).toHaveLength(1)
    expect(document.querySelectorAll('.fv-dial')).toHaveLength(1)
    expect(q('.fs-len-mini').getAttribute('aria-hidden')).toBe('true')
    cleanup()
    stub(false)
    render(start(50))
    expect(document.querySelectorAll('.fs .k-lamp[data-state="planned"]')).toHaveLength(1)
    expect(document.querySelectorAll('.fv-dial')).toHaveLength(1)
    expect(q('.fs-right')).not.toBeNull()
  })
  it('falls back to addListener where addEventListener is missing', () => {
    const m = stub(true, true)
    function Probe() { return <i>{String(useNarrow())}</i> }
    render(<Probe />)
    expect(document.querySelector('i')!.textContent).toBe('true')
    expect(m.addListener).toHaveBeenCalled()
    cleanup()
    expect(m.removeListener).toHaveBeenCalled()
  })
})

describe('the state lines wrap and the type scale is the token scale', () => {
  it('the strips are never cut with an ellipsis', () => {
    const block = /\.fv-strip, \.dr-strip \{[^}]*\}/.exec(css)![0]
    expect(block).not.toMatch(/text-overflow:\s*ellipsis|white-space:\s*nowrap/)
    expect(block).toMatch(/white-space:\s*normal/)
    expect(css).toMatch(/\.dr \{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/)
  })
  it('no raw pixel font size is left outside the token scale', () => {
    const raw = css.split('\n').filter((l) => /\bfont(-size)?:[^;]*\b\d+px/.test(l) && !/var\(--type/.test(l))
    expect(raw).toEqual([])
  })
})
