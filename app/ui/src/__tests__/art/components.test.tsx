// B03c: the rendered components. What is checked is what the spec makes binding: a data table beside every
// picture, the hooks of rule 7 (data-component, data-state), required state, the shape (not colour) of each
// status, roving focus and Enter, the static form in Calm, no idle timer left behind, and the planned plate that
// is aria-disabled and opens the overlay. Fictional text only.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, resetHtml, setHtml } from '../ww/_stubs'
import {
  AsciiEmptyState, AsciiSweep, BlankingPlate, Callout, CellSkeleton, DateWheel, Dither, DotMatrixMeter, DotTimer, NodeRing, Orbit, PillarsChart,
  Ridge, RingBars, Spec, StippleRing, WeekStrip, ART_STATES, StateMark,
} from '../../shared/art'
import { SWEEP_DELAY_MS, SWEEP_FRAME_MS, SWEEP_MAX_MS } from '../../shared/art/ascii'
import { setPlannedOpener } from '../../shared/planned/open'
import type { PlannedEntry } from '../../shared/planned/types'

let m: ReturnType<typeof mount> | null = null
const q = <T extends Element = Element>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)
const qa = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<Element>(sel)]
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
  resetHtml()
  vi.useRealTimers()
})

describe('every art component exposes its hooks and a table equivalent', () => {
  it('node ring: data-component, a table row per node, 24 at most', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, status: (['done', 'open', 'planned'] as const)[i % 3] }))
    m = mount(<NodeRing nodes={nodes} caption="Sample ring" />)
    expect(q('[data-component="node-ring"]')).toBeTruthy()
    expect(qa('[data-node]')).toHaveLength(24)
    expect(qa('table tbody tr')).toHaveLength(24)
  })
  it('status is a shape: done is a solid disc, open a ring, planned a dashed ring', () => {
    m = mount(<NodeRing nodes={[{ id: 'a', label: 'A', status: 'done' }, { id: 'b', label: 'B', status: 'open' }, { id: 'c', label: 'C', status: 'planned' }]} caption="c" />)
    const shape = (id: string) => q(`[data-node="${id}"] circle:not(.art-hit):not(.art-focusring)`)!
    expect(shape('a').getAttribute('class')).toBe('art-solid')
    expect(shape('b').getAttribute('class')).toBe('art-stroke')
    expect(shape('b').hasAttribute('stroke-dasharray')).toBe(false)
    expect(shape('c').getAttribute('stroke-dasharray')).toBeTruthy()
  })
  it('node ring centre never shows a number without a reading state', () => {
    m = mount(<NodeRing nodes={[]} centre={{ value: '12', state: 'waiting' }} caption="c" />)
    expect(q('.art-num')!.textContent).toBe('--')
    m.render(<NodeRing nodes={[]} centre={{ value: '12', state: 'live' }} caption="c" />)
    expect(q('.art-num')!.textContent).toBe('12')
    expect(q('[data-component="node-ring"]')!.getAttribute('data-state')).toBe('live')
  })
  it('orbit: hero and compact sizes, one marker per milestone, an ordered list equivalent', () => {
    const ms = [{ id: 'a', label: 'Start', orbit: 0, at: 0.1, status: 'reached' as const }, { id: 'b', label: 'End', orbit: 2, at: 0.6, status: 'planned' as const }]
    m = mount(<Orbit milestones={ms} now={{ orbit: 1, at: 0.3 }} caption="Orbit" />)
    expect(q('svg')!.getAttribute('width')).toBe('280')
    expect(qa('[data-node]')).toHaveLength(2)
    expect(qa('ol li')).toHaveLength(2)
    expect(q('.art-now')).toBeTruthy()
    m.render(<Orbit milestones={ms} size="compact" caption="Orbit" />)
    expect(q('svg')!.getAttribute('width')).toBe('160')
  })
  it('ring bars: required state; WAITING draws stubs and "--" and the table says no reading', () => {
    const bars = [{ id: 'a', label: 'A', value: 4 }, { id: 'b', label: 'B', value: 8 }]
    m = mount(<RingBars bars={bars} max={10} state="waiting" caption="Bars" />)
    expect(qa('[data-bar]')).toHaveLength(2)
    expect(qa('[data-bar][data-empty]')).toHaveLength(2)
    expect(q('.art-num')!.textContent).toBe('--')
    expect(qa('tbody td').map((d) => d.textContent)).toEqual(['no reading', 'no reading'])
    m.render(<RingBars bars={bars} max={10} state="live" caption="Bars" />)
    expect(qa('[data-bar][data-empty]')).toHaveLength(0)
    expect(qa('tbody td').map((d) => d.textContent)).toEqual(['4', '8'])
  })
  it('ring bars: the table is visible only on request and is a real table', () => {
    m = mount(<RingBars bars={[{ id: 'a', label: 'A', value: 1 }]} max={1} state="live" caption="Bars" />)
    expect(q('table')!.className).toContain('art-sr')
    m.render(<RingBars bars={[{ id: 'a', label: 'A', value: 1 }]} max={1} state="live" caption="Bars" showTable />)
    expect(q('table')!.className).not.toContain('art-sr')
  })
  it('ridge: simulated is stamped in the frame, waiting is an empty frame, at most 24 rows', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ label: `r${i}`, values: [1, 3, 2, 5, 1] }))
    m = mount(<Ridge rows={rows} state="simulated" source="a fictional series" />)
    expect(qa('[data-row]')).toHaveLength(24)
    expect(q('.art-stamp')!.textContent).toBe('SIMULATED')
    expect(q('figcaption')!.textContent).toContain('Source: a fictional series')
    m.render(<Ridge rows={rows} state="waiting" source="a fictional series" />)
    expect(qa('[data-row]')).toHaveLength(0)
    expect(q('.art-stamp')).toBeNull()
    expect(q('svg')!.textContent).toContain('no report')
  })
  it('ridge: the arrow keys change the active row and the readout follows', () => {
    const rows = [{ label: 'mon', values: [1, 2] }, { label: 'tue', values: [3, 6] }]
    m = mount(<Ridge rows={rows} state="live" source="s" />)
    expect(q('.art-readout')!.textContent).toContain('mon')
    key(q('svg')!, 'ArrowDown')
    expect(q('.art-readout')!.textContent).toContain('tue')
    key(q('svg')!, 'ArrowDown')
    expect(q('.art-readout')!.textContent).toContain('tue')
    key(q('svg')!, 'ArrowUp')
    expect(q('.art-readout')!.textContent).toContain('mon')
  })
  it('callout: at most 6 plates, each a tab stop; focusing one lights its point', () => {
    const pts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, x: 30 + i * 60, y: 40 + i * 20, label: `Point ${i}`, value: `${i} V`, status: i === 1 ? ('planned' as const) : i === 2 ? ('fault' as const) : ('normal' as const) }))
    m = mount(<Callout points={pts} caption="Wall box" />)
    expect(qa('.art-callout')).toHaveLength(6)
    const plates = qa('.art-plate-g')
    expect(plates.every((p) => p.getAttribute('tabindex') === '0')).toBe(true)
    expect(q('[data-callout="p1"] .art-plate-rect')!.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(q('[data-callout="p2"] path.art-stroke')).toBeTruthy() // the fault triangle
    act(() => void (plates[0] as HTMLElement).dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    expect(qa('[data-hot]').length).toBeLessThanOrEqual(1)
  })
  it('dimension sheet: a not-fitted part is dashed, says so, and has no number', () => {
    m = mount(<Spec rows={[{ id: 'a', label: 'Box', mm: 54 }, { id: 'b', label: 'Lid', mm: null }]} caption="Parts" />)
    expect(qa('tbody tr')).toHaveLength(2)
    expect(q('[data-fitted="false"] .art-dash')).toBeTruthy()
    expect(q('[data-fitted="false"] td.art-mono')!.textContent).toBe('not fitted')
    expect(q('[data-fitted="true"] td.art-mono')!.textContent).toBe('54 mm')
  })
  it('dot timer: columns follow the plan, the minute text is aria-live off, and it is not role=timer', () => {
    m = mount(<DotTimer plannedMin={75} elapsedMin={32} state="live" />)
    expect(q('svg')!.getAttribute('data-columns')).toBe('3')
    expect(qa('[data-dot="filled"]')).toHaveLength(32)
    expect(qa('[data-dot="next"]')).toHaveLength(1)
    expect(qa('[data-dot]')).toHaveLength(75)
    expect(q('[data-timer-text]')!.textContent).toBe('32 of 75 minutes')
    expect(q('[data-timer-text]')!.getAttribute('aria-live')).toBe('off')
    expect(q('[role="timer"]')).toBeNull()
  })
  it('dot timer: paused gives a half disc, resting five rings, a long plan is capped and says so', () => {
    m = mount(<DotTimer plannedMin={60} elapsedMin={10} paused state="live" />)
    expect(qa('[data-dot="half"]')).toHaveLength(1)
    expect(q('[data-timer-text]')!.textContent).toContain('paused')
    m.render(<DotTimer plannedMin={0} elapsedMin={0} resting state="waiting" />)
    expect(qa('svg.art-svg circle')).toHaveLength(5)
    m.render(<DotTimer plannedMin={400} elapsedMin={0} state="live" />)
    expect(qa('[data-dot]')).toHaveLength(150)
    expect(document.body.textContent).toContain('Showing the first 150 minutes of 400')
  })
  it('date wheel: past is filled, upcoming a ring, planned dashed; a notch for today; invalid dates are skipped', () => {
    const items = [
      { id: 'a', label: 'Paper one', date: '2027-01-10' },
      { id: 'b', label: 'Paper two', date: '2027-06-20' },
      { id: 'c', label: 'Paper three', date: '2027-09-05', planned: true },
      { id: 'x', label: 'Broken', date: '2027-02-31' },
    ]
    const opened: string[] = []
    m = mount(<DateWheel items={items} today="2027-03-01" caption="Dates" onOpen={(id) => opened.push(id)} />)
    expect(qa('[data-node]')).toHaveLength(3)
    expect(q('[data-node="a"]')!.getAttribute('data-status')).toBe('past')
    expect(q('[data-node="b"]')!.getAttribute('data-status')).toBe('upcoming')
    expect(q('[data-node="c"]')!.getAttribute('data-status')).toBe('planned')
    expect(q('.art-now')).toBeTruthy()
    expect(qa('ol li')).toHaveLength(3)
    key(q('[data-node="a"]')!, 'Enter')
    expect(opened).toEqual(['a'])
    m.render(<DateWheel items={items} caption="Dates" />)
    expect(q('.art-now')).toBeNull()
  })
  it('pillars chart: 5 to 8 axes only, a sample tag, sliders only in edit mode', () => {
    const axes = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, label: id.toUpperCase(), value: 0.2 + i * 0.1 }))
    m = mount(<PillarsChart axes={axes} state="simulated" sample caption="Pillars" />)
    expect(qa('[data-node], g.art-node')).toHaveLength(5)
    expect(q('figcaption')!.textContent).toContain('SAMPLE DATA')
    expect(q('figcaption')!.textContent).toContain('SIMULATED')
    expect(qa('input[type="range"]')).toHaveLength(0)
    const got: [string, number][] = []
    m.render(<PillarsChart axes={axes} state="live" editable onChange={(id, v) => got.push([id, v])} caption="Pillars" />)
    expect(qa('input[type="range"]')).toHaveLength(5)
    m.render(<PillarsChart axes={axes.slice(0, 3)} state="live" caption="Pillars" />)
    expect(document.body.textContent).toContain('needs 5 to 8 axes')
    expect(q('svg.art-svg')).toBeNull()
  })
  it('week strip: seven pills, today notched, a rest day is a glyph and a word, roving focus', () => {
    const days = Array.from({ length: 9 }, (_, i) => ({ iso: `2027-03-${String(8 + i).padStart(2, '0')}`, label: 'Mo', minutes: i * 40, rest: i === 3 }))
    const opened: string[] = []
    m = mount(<WeekStrip days={days} today="2027-03-09" onOpen={(i) => opened.push(i)} />)
    const pills = qa('.art-day')
    expect(pills).toHaveLength(7)
    expect(pills.filter((p) => p.hasAttribute('data-today'))).toHaveLength(1)
    expect(q('.art-notch')).toBeTruthy()
    expect(q('[data-rest]')!.textContent).toContain('rest')
    expect(q('[data-rest]')!.getAttribute('aria-label')).toContain('rest day')
    expect(pills.map((p) => p.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1', '-1'])
    key(pills[0], 'ArrowRight')
    expect(qa('.art-day').map((p) => p.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1', '-1', '-1', '-1'])
    key(qa('.art-day')[1], 'ArrowLeft')
    key(qa('.art-day')[0], 'ArrowLeft') // a strip does not wrap
    expect(qa('.art-day')[0].getAttribute('tabindex')).toBe('0')
    act(() => void (pills[2] as HTMLElement).click())
    expect(opened).toEqual(['2027-03-10'])
  })
  it('week strip dots are a pure function of minutes and a rest day has none', () => {
    m = mount(<WeekStrip days={[{ iso: '2027-03-08', label: 'Mo', minutes: 70 }, { iso: '2027-03-09', label: 'Tu', minutes: 0 }, { iso: '2027-03-10', label: 'We', minutes: 500, rest: true }]} />)
    const on = (iso: string) => qa(`[data-day="${iso}"] [data-on]`).length
    expect(on('2027-03-08')).toBe(3)
    expect(on('2027-03-09')).toBe(0)
    expect(on('2027-03-10')).toBe(0)
  })
  it('stipple ring: discs for the share, rings for the rest, "--" without a reading', () => {
    m = mount(<StippleRing frac={0.5} value="50 %" state="live" count={60} caption="Share" />)
    expect(qa('circle.art-solid')).toHaveLength(30)
    expect(qa('circle.art-stroke')).toHaveLength(30)
    m.render(<StippleRing frac={0.5} value="50 %" state="waiting" caption="Share" />)
    expect(qa('circle.art-solid')).toHaveLength(0)
    expect(q('.art-num')!.textContent).toBe('--')
  })
  it('dot-matrix meter: 60 dots, WAITING all rings and "--", simulated stamps the diamond', () => {
    m = mount(<DotMatrixMeter level={50} min={0} max={100} unit=" %" state="live" caption="Level" />)
    expect(qa('svg.art-svg circle')).toHaveLength(60)
    expect(qa('svg.art-svg circle[data-on]')).toHaveLength(30)
    expect(q('svg.art-svg')!.getAttribute('aria-valuenow')).toBe('50')
    m.render(<DotMatrixMeter level={50} min={0} max={100} state="waiting" caption="Level" />)
    expect(qa('svg.art-svg circle[data-on]')).toHaveLength(0)
    expect(q('[data-meter-text]')!.textContent).toContain('--')
    expect(q('svg.art-svg')!.hasAttribute('aria-valuenow')).toBe(false)
    m.render(<DotMatrixMeter level={50} min={0} max={100} state="simulated" caption="Level" />)
    expect(q('[data-meter-text] [data-mark="simulated"]')).toBeTruthy()
  })
  it('the five states have five distinct shapes, so greyscale still tells them apart', () => {
    const sig = (s: (typeof ART_STATES)[number]) => {
      document.body.innerHTML = ''
      const x = mount(<StateMark state={s} />)
      const out = q('svg')!.innerHTML
      x.unmount()
      return out
    }
    expect(new Set(ART_STATES.map(sig)).size).toBe(5)
  })
  it('dither plate is decorative: aria-hidden, one path', () => {
    m = mount(<Dither kind="bridge" />)
    const svg = q('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('data-component')).toBe('dither')
    expect(qa('path')).toHaveLength(1)
    expect(svg.querySelector('path')!.getAttribute('d')!.length).toBeLessThan(20_000)
  })
  it('cell skeleton: busy while loading, the content replaces it in the same box', () => {
    m = mount(<CellSkeleton depth={2} seed={3}>real content</CellSkeleton>)
    expect(q('[aria-busy="true"]')).toBeTruthy()
    expect(qa('.art-cell').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('real content')
    m.render(<CellSkeleton depth={2} seed={3} ready>real content</CellSkeleton>)
    expect(q('[aria-busy]')).toBeNull()
    expect(document.body.textContent).toContain('real content')
  })
  it('ascii empty state: art aria-hidden, a message and one action that calls back', () => {
    const calls: number[] = []
    m = mount(<AsciiEmptyState variant="console" message="Nothing has run yet." action={{ label: 'Run one', onAction: () => calls.push(1) }} />)
    expect(q('pre')!.getAttribute('aria-hidden')).toBe('true')
    expect(q('[data-variant="console"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Nothing has run yet.')
    act(() => void q<HTMLButtonElement>('button')!.click())
    expect(calls).toEqual([1])
  })
})

describe('the ASCII sweep: delay, bound, calm and cleanup', () => {
  const frames = () => q('pre')?.textContent ?? null
  it('draws nothing before 160 ms, then a frame; the verb is always there as text', () => {
    vi.useFakeTimers()
    m = mount(<AsciiSweep verb="reading memory" />)
    expect(frames()).toBeNull()
    expect(q('[aria-busy="true"]')).toBeTruthy()
    expect(q('.art-verb')!.textContent).toBe('reading memory')
    act(() => void vi.advanceTimersByTime(SWEEP_DELAY_MS))
    expect(frames()).not.toBeNull()
  })
  it('moves for at most 5 s, then settles on the static frame and leaves no timer behind', () => {
    vi.useFakeTimers()
    m = mount(<AsciiSweep verb="reading memory" />)
    act(() => void vi.advanceTimersByTime(SWEEP_DELAY_MS))
    expect(q('[data-form]')!.getAttribute('data-form')).toBe('moving')
    const a = frames()
    act(() => void vi.advanceTimersByTime(SWEEP_FRAME_MS * 3))
    expect(frames()).not.toEqual(a)
    act(() => void vi.advanceTimersByTime(SWEEP_MAX_MS))
    expect(q('[data-form]')!.getAttribute('data-form')).toBe('static')
    const settled = frames()
    act(() => void vi.advanceTimersByTime(2000))
    expect(frames()).toEqual(settled)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('Calm shows the static form from the first frame and runs no interval', () => {
    vi.useFakeTimers()
    setHtml({ 'data-motion': 'calm' })
    m = mount(<AsciiSweep verb="reading memory" />)
    act(() => void vi.advanceTimersByTime(SWEEP_DELAY_MS))
    expect(q('[data-form]')!.getAttribute('data-form')).toBe('static')
    const f = frames()
    act(() => void vi.advanceTimersByTime(1000))
    expect(frames()).toEqual(f)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('a hidden tab stops the loop and unmounting clears every timer', () => {
    vi.useFakeTimers()
    m = mount(<AsciiSweep verb="reading memory" />)
    act(() => void vi.advanceTimersByTime(SWEEP_DELAY_MS + SWEEP_FRAME_MS))
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    const f = frames()
    act(() => void vi.advanceTimersByTime(1000))
    expect(frames()).toEqual(f)
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    m.unmount()
    m = null
    expect(vi.getTimerCount()).toBe(0)
  })
  it('active=false renders nothing and no pending timer', () => {
    vi.useFakeTimers()
    m = mount(<AsciiSweep verb="reading memory" active={false} />)
    expect(q('[data-component="ascii-sweep"]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the blanking plate (38)', () => {
  const entry: PlannedEntry = {
    id: 'ww.synthetic', product: 'ww', home: 'study.library', label: 'Synthetic thing', pattern: 'coming', blocker: 'build',
    line: 'A synthetic planned thing used only by this test.', works_today: 'A plain list works today.', needs: 'Nothing real.', since: '2026-11-12', reviewBy: '2027-02-10', owner: 'ww-chat',
  }
  afterEach(() => setPlannedOpener(null))
  it('is one aria-disabled control, never disabled, with PLANNED, the line, the works-today line and the cue', () => {
    m = mount(<BlankingPlate entry={entry} />)
    const p = q('[data-component="blanking-plate"]')!
    expect(p.getAttribute('role')).toBe('button')
    expect(p.getAttribute('aria-disabled')).toBe('true')
    expect(p.hasAttribute('disabled')).toBe(false)
    expect(p.getAttribute('tabindex')).toBe('0')
    expect(p.textContent).toContain('PLANNED')
    expect(p.textContent).toContain('A synthetic planned thing used only by this test.')
    expect(p.textContent).toContain('Today: A plain list works today.')
    expect(p.textContent).toContain('What is coming')
    expect(qa('button, a', p)).toHaveLength(0)
  })
  it('Enter and Space open the overlay; so does a click; nothing else happens', () => {
    const opened: string[] = []
    setPlannedOpener((id) => opened.push(id))
    m = mount(<BlankingPlate entry={entry} />)
    const p = q('[data-component="blanking-plate"]')!
    key(p, 'Enter')
    key(p, ' ')
    act(() => void (p as HTMLElement).click())
    key(p, 'a')
    expect(opened).toEqual(['ww.synthetic', 'ww.synthetic', 'ww.synthetic'])
  })
  it('a built-not-verified entry says so with a different glyph, not PLANNED', () => {
    m = mount(<BlankingPlate entry={{ ...entry, state: 'unverified' }} />)
    const p = q('[data-component="blanking-plate"]')!
    expect(p.getAttribute('data-state')).toBe('unverified')
    expect(p.textContent).toContain('BUILT, NOT VERIFIED')
    expect(p.textContent).not.toContain('PLANNED')
  })
})
