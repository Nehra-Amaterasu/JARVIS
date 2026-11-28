// The character art of the design reset (28 Nov, shared/kit/v3/Art.tsx and art.css): drawn from a state, never from a made-up
// number; the five figures differ in shape as the five lamps do; the marks are five different drawings; and the stylesheet keeps
// the kit's lint (no colour, duration or easing literal; no px for type and space; infinite motion only for the named states,
// stopped by reduced motion and the calm setting).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { mount } from '../ww/_stubs'
import { DOT_MARKS, DotLevel, DotRing, EmptyPose, StateFigure, litCount, stateRows } from '../../shared/kit/v3'
import { LAMP_STATES } from '../../shared/lamp/types'
import { parse, strip } from './css'

const ART = strip(readFileSync(join(__dirname, '..', '..', 'shared', 'kit', 'v3', 'art.css'), 'utf8'))

describe('the figures are the lamp shapes', () => {
  it('five states, five different 9 x 9 figures, each with lit dots', () => {
    const all = LAMP_STATES.map((s) => stateRows(s).join('\n'))
    expect(new Set(all).size).toBe(5)
    for (const s of LAMP_STATES) {
      const rows = stateRows(s)
      expect(rows).toHaveLength(9)
      expect(rows.every((r) => r.length === 9)).toBe(true)
      expect(rows.join('')).toContain('#')
    }
  })
  it('LIVE is a full disc, WAITING is lit on its left half more than its right, FAULT has its bar cut out of the triangle', () => {
    const lit = (rows: string[], f: (x: number, y: number) => boolean) => rows.reduce((n, r, y) => n + [...r].filter((c, x) => c === '#' && f(x, y)).length, 0)
    expect(lit(stateRows('live'), () => true)).toBeGreaterThan(lit(stateRows('waiting'), () => true))
    expect(lit(stateRows('waiting'), (x) => x < 4)).toBeGreaterThan(lit(stateRows('waiting'), (x) => x > 4))
    const fault = stateRows('fault')
    expect(fault[4][4]).toBe('.')
    expect(fault[7][4]).toBe('.')
    expect(fault[6][3]).toBe('#')
  })
  it('the five project marks are five different drawings', () => {
    expect(new Set(Object.values(DOT_MARKS).map((r) => r.join('\n'))).size).toBe(5)
  })
})

describe('honest by construction', () => {
  it('a level lights dots only under LIVE or SIMULATED, and only from a finite value on a real scale', () => {
    expect(litCount(0.5, 1, 'live', 16)).toBe(8)
    expect(litCount(0.5, 1, 'simulated', 16)).toBe(8)
    for (const s of ['waiting', 'planned', 'fault'] as const) expect(litCount(0.9, 1, s, 16), s).toBeNull()
    expect(litCount(null, 1, 'live', 16)).toBeNull()
    expect(litCount(Number.NaN, 1, 'live', 16)).toBeNull()
    expect(litCount(0.5, 0, 'live', 16)).toBeNull()
    expect(litCount(4, 1, 'live', 16)).toBe(16)
  })
  it('DotLevel under WAITING draws no lit dot and says there is no level', () => {
    const m = mount(createElement(DotLevel, { label: 'Mic', value: 0.7, max: 1, state: 'waiting' }))
    const el = m.container.querySelector('.v3-dotlevel')!
    expect(el.getAttribute('aria-label')).toBe('Mic: WAITING, no level')
    expect(m.container.querySelectorAll('.v3-dot-on')).toHaveLength(0)
    m.unmount()
  })
  it('DotLevel under SIMULATED says so in its name', () => {
    const m = mount(createElement(DotLevel, { label: 'Sample', value: 0.5, max: 1, state: 'simulated', cells: 10 }))
    expect(m.container.querySelector('.v3-dotlevel')!.getAttribute('aria-label')).toBe('Sample: 5 of 10, simulated')
    expect(m.container.querySelectorAll('.v3-dot-on')).toHaveLength(5)
    m.unmount()
  })
  it('DotRing lights nothing without a state that may show a level', () => {
    const m = mount(createElement(DotRing, { state: 'planned', level: 0.8, count: 12 }))
    expect(m.container.querySelectorAll('.v3-dot-on')).toHaveLength(0)
    expect(m.container.querySelectorAll('.v3-dot-off')).toHaveLength(12)
    m.unmount()
  })
  it('an empty pose prints its title, the state word and the reason as text, and is decorative in its figure', () => {
    const m = mount(createElement(EmptyPose, { state: 'waiting', title: 'No follow-ups', reason: 'nothing is dated for today' }))
    const el = m.container.querySelector('.v3-empty')!
    expect(el.getAttribute('data-state')).toBe('waiting')
    expect(el.textContent).toBe('No follow-upsWAITING nothing is dated for today')
    expect(el.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    m.unmount()
  })
  it('a figure given a title is named; without one it is hidden from the reader', () => {
    const named = mount(createElement(StateFigure, { state: 'fault', title: 'Fault' }))
    expect(named.container.querySelector('svg')!.getAttribute('role')).toBe('img')
    named.unmount()
    const bare = mount(createElement(StateFigure, { state: 'fault' }))
    expect(bare.container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    bare.unmount()
  })
})

describe('art.css lint (the kit rules, applied to the new sheet)', () => {
  const rules = parse(ART)
  it('no colour literal: no hex, rgb(a), hsl(a), color-mix', () => {
    expect(ART).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|color-mix\(/)
  })
  it('no px literal for font-size, border-radius, padding, margin or gap, and no literal duration or easing', () => {
    for (const m of ART.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      if (!/^(font-size|border-radius|padding|margin|gap)(-[\w-]+)?$/.test(m[1])) continue
      expect(m[2], m[0]).not.toMatch(/\d+px/)
    }
    expect(ART).not.toMatch(/(^|[^\w-])\d*\.?\d+m?s\b(?!\w)/)
    expect(ART).not.toMatch(/cubic-bezier\(/)
  })
  it('the only infinite animations are the named states (LIVE breathes, WAITING sweeps), and reduced motion and calm stop them', () => {
    const inf = rules.filter((r) => r.at.length === 0 && /infinite/.test(r.decls['animation'] ?? '')).flatMap((r) => r.selectors)
    expect(inf.length).toBeGreaterThan(0)
    for (const s of inf) expect(s, s).toMatch(/\[data-state='(live|waiting)'\]/)
    const off = rules.filter((r) => r.decls['animation'] === 'none').flatMap((r) => r.selectors)
    expect(off.some((s) => s.includes(":root:not([data-motion='full']) .v3-statefig"))).toBe(true)
    expect(off.some((s) => s.includes(":root[data-motion='calm'] .v3-statefig"))).toBe(true)
    expect(rules.some((r) => r.at.some((a) => /prefers-reduced-motion/.test(a)))).toBe(true)
  })
  it('only the fault has a colour of its own; live is the accent through --live; the rest are ink', () => {
    const colours = rules.flatMap((r) => (r.decls['color'] ? [`${r.selectors.join(',')} ${r.decls['color']}`] : []))
    for (const c of colours) expect(c, c).toMatch(/var\(--(ink|ink2|ink3|live|fault)\)|currentColor|inherit|CanvasText/)
  })
})
