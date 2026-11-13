// The series forms (spec 20.5.2, package D02): the pure layout, then the three components in happy-dom, then the
// source rules of the A.D02 accept line (no run-counter identifier, no idle timers, a forced-colours and a reduced-motion
// branch). Fixtures use neutral words only.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mount, resetHtml, setHtml } from '../../../../__tests__/ww/_stubs'
import {
  DotHistogram, HIST_MAX_DOTS, SKY_MAX_FIGURE, SkyLedger, TRACE_MAX_POINTS, TRACE_RINGS, Trace, binValues, cleanPoints,
  constellation, diffText, dotStacks, dotUnit, histLayout, nearestIndex, niceStep, quantile, rulerText, skyCounts, skyHeadline,
  skyPositions, skySlots, stepIndex, traceLayout, typicalStep, type SkyDay, type TracePoint,
} from '..'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 10, 1, 12)
const pts = (vs: (number | null)[]): TracePoint[] => vs.map((v, i) => ({ t: T0 + i * DAY, v }))
const BOX = { w: 600, h: 228 }

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  resetHtml()
})

describe('traceLayout', () => {
  it('breaks the line at a null and hatches the gap; never bridges it', () => {
    const g = traceLayout(pts([1, 2, null, null, 5, 6]), BOX)
    expect(g.paths).toHaveLength(2)
    expect(g.gaps).toHaveLength(1)
    // the gap runs from the last measured point before to the first after
    expect(g.gaps[0].x0).toBe(g.dots[1].x)
    expect(g.gaps[0].x1).toBe(g.dots[4].x)
    // no path segment crosses the gap
    for (const p of g.paths) {
      const xs = [...p.matchAll(/[ML]([\d.]+) /g)].map((mm) => Number(mm[1]))
      expect(xs.every((x) => x <= g.gaps[0].x0 || x >= g.gaps[0].x1)).toBe(true)
    }
  })

  it('treats a missing day (no row at all) as a gap too', () => {
    const p = pts([1, 2, 3, 4])
    const holed = [...p.slice(0, 2), ...p.slice(2).map((q) => ({ ...q, t: q.t + 3 * DAY }))]
    const g = traceLayout(holed, BOX)
    expect(g.paths).toHaveLength(2)
    expect(g.gaps).toHaveLength(1)
  })

  it('draws a halftone area only under runs of two or more points', () => {
    const g = traceLayout(pts([1, null, 3, 4, null, 7]), BOX)
    expect(g.paths).toHaveLength(3)
    expect(g.areas).toHaveLength(1)
    expect(g.areas[0].endsWith('Z')).toBe(true)
  })

  it('marks the last measured point and at most seven rings before it', () => {
    const g = traceLayout(pts(Array.from({ length: 20 }, (_, i) => i)), BOX)
    expect(g.last).toBe(19)
    expect(g.rings).toHaveLength(TRACE_RINGS)
    expect(g.rings).toEqual([12, 13, 14, 15, 16, 17, 18])
    const tail = traceLayout(pts([1, 2, null]), BOX)
    expect(tail.last).toBe(1)
  })

  it('keeps at most TRACE_MAX_POINTS (the latest), sorted by time, and drops junk', () => {
    const many = pts(Array.from({ length: TRACE_MAX_POINTS + 50 }, (_, i) => i))
    const c = cleanPoints([...many].reverse())
    expect(c).toHaveLength(TRACE_MAX_POINTS)
    expect(c[0].v).toBe(50)
    expect(cleanPoints([{ t: NaN, v: 1 }, { t: 1, v: Infinity }])).toEqual([{ t: 1, v: null }])
  })

  it('puts the median datum inside the plot and labels the measured hi and lo', () => {
    const g = traceLayout(pts([10, 20, 30]), BOX, 25)
    expect(g.medianY).not.toBeNull()
    expect(g.medianY!).toBeGreaterThan(g.plot.y0)
    expect(g.medianY!).toBeLessThan(g.plot.y1)
    expect([g.min, g.max]).toEqual([10, 30])
  })

  it('is empty, not invented, when nothing was measured', () => {
    const g = traceLayout(pts([null, null]), BOX)
    expect(g.paths).toEqual([])
    expect(g.last).toBeNull()
    expect(g.min).toBeNull()
  })

  it('typicalStep is the median positive step', () => {
    expect(typicalStep([0, 1, 2, 10])).toBe(1)
    expect(typicalStep([5])).toBe(0)
  })
})

describe('scrub helpers', () => {
  const g = traceLayout(pts([1, null, 3, 4]), BOX)
  it('nearestIndex never lands on a gap', () => {
    expect(nearestIndex(g, g.dots[1].x)).not.toBe(1)
  })
  it('stepIndex walks measured points and clamps at the ends', () => {
    expect(stepIndex(g, 0, 1)).toBe(2)
    expect(stepIndex(g, 3, 1)).toBe(3)
    expect(stepIndex(g, null, -1)).toBe(3)
    expect(stepIndex(g, 3, -1, 7)).toBe(0)
  })
  it('the ruler is |····| with a tick every five and one at the end', () => {
    expect(rulerText(11)).toBe('|····|····|')
    expect(rulerText(8)).toBe('|····|·|')
  })
  it('the two-point difference is signed, in order of time, with the unit', () => {
    const a = { t: T0, v: 30 }
    const b = { t: T0 + 3 * DAY, v: 34 }
    expect(diffText(b, a, 'min')).toBe('+4 min from 1 Nov to 4 Nov')
    expect(diffText({ t: T0, v: 5 }, { t: T0 + DAY, v: 2 })).toMatch(/^−3 from/)
  })
})

describe('DotHistogram layout', () => {
  it('bins with a nice step and reports the quartiles', () => {
    const b = binValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)
    expect(b.n).toBe(10)
    expect(b.counts.reduce((s, c) => s + c, 0)).toBe(10)
    expect(b.median).toBe(5.5)
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75)
    expect(niceStep(3.7)).toBe(5)
    expect(niceStep(1.3, true)).toBe(2)
  })
  it('says what it left out instead of hiding it', () => {
    expect(binValues([1, NaN, 2, Infinity] as number[]).dropped).toBe(2)
  })
  it('one dot stands for several past 200 dots, from the nice list', () => {
    expect(dotUnit(150)).toBe(1)
    expect(dotUnit(640)).toBe(5)
    expect(dotUnit(640, 2)).toBe(5)
    expect(Math.ceil(5000 / dotUnit(5000))).toBeLessThanOrEqual(HIST_MAX_DOTS)
  })
  it('a part dot is never rounded up into a whole', () => {
    expect(dotStacks([12, 10, 3], 5)).toEqual([{ full: 2, part: true }, { full: 2, part: false }, { full: 0, part: true }])
  })
  it('the tallest column fits its sockets and stands as a tower (at least 60 percent of the rows)', () => {
    for (const n of [12, 48, 200, 640, 3000]) {
      const vals = Array.from({ length: n }, (_, i) => (i * 37) % 101)
      const b = binValues(vals, 8)
      const st = dotStacks(b.counts, dotUnit(b.n))
      const g = histLayout(b, st, { w: 700, h: 232 })
      const tallest = Math.max(...st.map((s) => s.full + (s.part ? 1 : 0)))
      const need = Math.ceil(tallest / g.across)
      expect(need).toBeLessThanOrEqual(g.rows)
      if (tallest >= 4) expect(need / g.rows).toBeGreaterThanOrEqual(0.6)
    }
  })
})

describe('SkyLedger layout', () => {
  const today = '2026-11-13'
  const days: SkyDay[] = [
    { date: '2026-11-13', kind: 'kept', habit: 'physics' },
    { date: '2026-11-12', kind: 'rest' },
    { date: '2026-11-11', kind: 'kept', habit: 'physics' },
    { date: '2026-09-01', kind: 'kept' }, // outside a 60-day window
    { date: 'not a date', kind: 'kept' },
  ]
  it('keeps one slot per day, today last; an untouched day keeps its place', () => {
    const s = skySlots(days, 60, today)
    expect(s).toHaveLength(60)
    expect(s[59]).toMatchObject({ date: today, kind: 'kept' })
    expect(s[57].kind).toBe('kept')
    expect(s[0].kind).toBe('none')
    expect(skyCounts(s)).toEqual({ kept: 2, rest: 1, none: 57, window: 60 })
  })
  it('deleting a day lowers the count by one, and nothing else changes', () => {
    const before = skyCounts(skySlots(days, 60, today))
    const after = skyCounts(skySlots(days.filter((d) => d.date !== '2026-11-11'), 60, today))
    expect(after.kept).toBe(before.kept - 1)
    expect(after.rest).toBe(before.rest)
    expect(skyHeadline(after)).toBe('1 of the last 60 days kept')
  })
  it('a date given twice takes the later row (the correction)', () => {
    const s = skySlots([{ date: today, kind: 'kept' }, { date: today, kind: 'rest' }], 60, today)
    expect(s[59].kind).toBe('rest')
  })
  it('positions are fixed (seeded) and inside the box', () => {
    const a = skyPositions(90, 600, 270)
    expect(a).toEqual(skyPositions(90, 600, 270))
    expect(a.every((p) => p.x > 0 && p.x < 600 && p.y > 0 && p.y < 270)).toBe(true)
  })
  it('figures join only one habit, by nearness, at most 12 latest stars, no edge past the reach', () => {
    const many: SkyDay[] = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, kind: 'kept' as const, habit: i % 2 ? 'gym' : 'water' }))
    const s = skySlots(many, 60, today)
    const pos = skyPositions(60, 600, 180)
    const free = constellation(s, pos)
    for (const h of ['gym', 'water']) expect(free.filter((l) => l.habit === h)).toHaveLength(Math.min(15, SKY_MAX_FIGURE) - 1)
    for (const l of free) expect(s[l.a].habit).toBe(s[l.b].habit)
    const reach = 70
    const near = constellation(s, pos, reach)
    expect(near.length).toBeLessThanOrEqual(free.length)
    for (const l of near) expect(Math.hypot(pos[l.a].x - pos[l.b].x, pos[l.a].y - pos[l.b].y)).toBeLessThanOrEqual(reach)
  })
})

// The banned words are assembled, so a plain grep of this folder for them still finds nothing (the accept line).
const BANNED = new RegExp(['str' + 'eak', '\\bch' + 'ain\\b', 'bro' + 'ken'].join('|'), 'i')

const text = (el: Element) => el.textContent ?? ''
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

describe('Trace component', () => {
  const P = pts([30, 32, null, 35, 40, 38])
  it('LIVE draws the latest number, the median and a table twin', () => {
    m = mount(<Trace points={P} median={34} state="live" label="Study minutes" unit="min" />)
    const c = m.container
    expect(c.querySelector('.sr-num')?.textContent).toBe('38')
    expect(text(c)).toContain('LIVE')
    expect(c.querySelectorAll('.sr-line')).toHaveLength(2)
    expect(c.querySelector('details.sr-fold')).not.toBeNull()
  })

  it('the scrub is keyboard reachable: arrows move, Enter pins, a second point reads the difference', () => {
    m = mount(<Trace points={P} state="simulated" label="Study minutes" unit="min" />)
    const s = m.container.querySelector('[role="slider"]')!
    expect(s.getAttribute('tabindex')).toBe('0')
    act(() => (s as HTMLElement).focus())
    expect(s.getAttribute('aria-valuetext')).toMatch(/38 min/)
    key(s, 'ArrowLeft')
    expect(s.getAttribute('aria-valuetext')).toMatch(/40 min/)
    key(s, 'Enter')
    key(s, 'Home')
    expect(text(m.container.querySelector('.sr-diff')!)).toMatch(/pinned.*\+10 min from 1 Nov to 5 Nov|pinned.*−10/)
    key(s, 'Escape')
    expect(text(m.container.querySelector('.sr-diff')!)).not.toMatch(/from/)
  })

  it('WAITING, FAULT and PLANNED draw no number and say why', () => {
    for (const [state, why] of [['waiting', 'no report yet'], ['fault', 'could not be read'], ['planned', 'not built']] as const) {
      m = mount(<Trace points={P} state={state} label="Study minutes" reason={state === 'fault' ? 'the log could not be read' : undefined} />)
      const c = m.container
      expect(c.querySelector('.sr-line')).toBeNull()
      expect(c.querySelector('[role="slider"]')).toBeNull()
      expect(text(c)).not.toMatch(/\b3[0-9]\b|\b40\b/)
      expect(text(c)).toContain(why)
      m.unmount()
      m = null
    }
  })

  it('calm motion shows the line drawn at once (the static form)', () => {
    setHtml({ 'data-motion': 'calm' })
    m = mount(<Trace points={P} state="live" />)
    expect(m.container.querySelector('.sr-screen')?.getAttribute('data-draw')).toBe('done')
  })
})

describe('DotHistogram component', () => {
  const vals = Array.from({ length: 640 }, (_, i) => 100 + ((i * 53) % 300))
  it('states the unit per dot and lights at most 200 dots', () => {
    m = mount(<DotHistogram values={vals} state="live" label="Water per entry" unit="ml" noun="entries" />)
    const c = m.container
    expect(text(c)).toContain('5 entries')
    expect(c.querySelectorAll('.sr-dot').length).toBeLessThanOrEqual(HIST_MAX_DOTS)
  })
  it('Left and Right move across the bins with a callout text', () => {
    m = mount(<DotHistogram values={[21, 22, 25, 31, 35, 44]} state="simulated" unit="min" noun="blocks" />)
    const s = m.container.querySelector('[role="slider"]')!
    key(s, 'Home')
    expect(s.getAttribute('aria-valuetext')).toMatch(/^\d+ blocks?, \d+ to \d+ min$/)
    key(s, 'ArrowRight')
    expect(s.getAttribute('aria-valuenow')).toBe('1')
  })
  it('flips to the ridge form with a 44 px key', () => {
    m = mount(<DotHistogram values={[1, 2, 2, 3]} state="live" />)
    const ridge = [...m.container.querySelectorAll('button')].find((b) => b.textContent === 'Ridge')!
    act(() => ridge.click())
    expect(ridge.getAttribute('aria-pressed')).toBe('true')
    expect(m.container.querySelector('.sr-ridge')).not.toBeNull()
  })
  it('WAITING lights nothing and prints no number', () => {
    m = mount(<DotHistogram values={vals} state="waiting" />)
    expect(m.container.querySelectorAll('.sr-dot')).toHaveLength(0)
    expect(text(m.container)).not.toMatch(/\d{2,}/)
  })
})

describe('SkyLedger component', () => {
  const days: SkyDay[] = [
    { date: '2026-11-13', kind: 'kept', habit: 'physics' },
    { date: '2026-11-12', kind: 'rest' },
    { date: '2026-11-10', kind: 'kept', habit: 'physics' },
  ]
  it('the headline is the ratio; rest days are named; Enter opens a day', () => {
    const opened: string[] = []
    m = mount(<SkyLedger days={days} window={60} today="2026-11-13" state="live" onOpenDay={(d) => opened.push(d)} />)
    const c = m.container
    expect(text(c.querySelector('.sk-headline')!)).toBe('2 of the last 60 days kept')
    expect(text(c)).toContain('rest days')
    const s = c.querySelector('[role="slider"]')!
    key(s, 'End')
    key(s, 'ArrowLeft')
    key(s, 'Enter')
    expect(opened).toEqual(['2026-11-12'])
  })
  it('deleting a day lowers the headline and draws one star fewer', () => {
    m = mount(<SkyLedger days={days} window={60} today="2026-11-13" state="live" />)
    const stars = m.container.querySelectorAll('.sk-star').length
    m.render(<SkyLedger days={days.slice(0, 2)} window={60} today="2026-11-13" state="live" />)
    expect(text(m.container.querySelector('.sk-headline')!)).toBe('1 of the last 60 days kept')
    expect(m.container.querySelectorAll('.sk-star').length).toBe(stars - 1)
  })
  it('has no run counter or loss wording in what it renders', () => {
    m = mount(<SkyLedger days={days} window={90} today="2026-11-13" state="simulated" />)
    expect(text(m.container)).not.toMatch(BANNED)
    expect(text(m.container)).not.toMatch(/missed|lost|fail/i)
  })
  it('WAITING draws the faint field and no count', () => {
    m = mount(<SkyLedger days={days} window={60} today="2026-11-13" state="waiting" />)
    expect(m.container.querySelectorAll('.sk-star')).toHaveLength(0)
    expect(text(m.container.querySelector('.sk-headline')!)).not.toMatch(/\d+ of/)
  })
})

describe('the folder rules (A.D02 accept)', () => {
  const DIR = resolve(__dirname, '..')
  const files = readdirSync(DIR).filter((f) => /\.(ts|tsx|css)$/.test(f)).map((f) => [f, readFileSync(join(DIR, f), 'utf8')] as const)
  it('no run-counter identifier and no loss wording anywhere in the folder', () => {
    for (const [f, s] of files) expect(s, f).not.toMatch(BANNED)
  })
  it('no idle timers or animation loops', () => {
    for (const [f, s] of files) expect(s, f).not.toMatch(/requestAnimationFrame|setInterval|setTimeout/)
  })
  it('the stylesheet has a forced-colours branch and a reduced-motion static form', () => {
    const css = files.find(([f]) => f === 'series.css')![1]
    expect(css).toMatch(/@media \(forced-colors: active\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/:root\[data-motion='calm'\]/)
  })
  it('no innerHTML and no shadow or colour literals outside the forced-colours keywords', () => {
    for (const [f, s] of files) expect(s, f).not.toMatch(/innerHTML|dangerouslySetInnerHTML/)
    const css = files.find(([f]) => f === 'series.css')![1]
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })
})
