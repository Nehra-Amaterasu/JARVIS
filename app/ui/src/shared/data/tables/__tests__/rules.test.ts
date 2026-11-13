// The rules of D03 as a test over its own files: no native select, no animation loop, no zebra, no streak word, a forced-colours
// branch and a reduced-motion branch, no colour literal, no unescaped innerHTML, and imports only from the lamp, kit and motion
// packages (the contract table of wave 6). The gallery entry exists and covers the three exports.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import entries from '../../../../gallery/entries/d03-tables'

const DIR = resolve(__dirname, '..')
const files = readdirSync(DIR).filter((f) => /\.(tsx?|css)$/.test(f))
const read = (f: string) => readFileSync(join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = files.filter((f) => /\.tsx?$/.test(f))
const css = read('tables.css')

describe('the D03 source', () => {
  it('has no native select element and no select role shortcut', () => {
    for (const f of code) expect(read(f), f).not.toMatch(/<select[\s>]|createElement\(\s*['"]select['"]/)
  })
  it('runs no loop: no requestAnimationFrame, no setInterval, no scroll or resize listener', () => {
    for (const f of code) {
      expect(read(f), f).not.toMatch(/requestAnimationFrame|setInterval|addEventListener\(\s*['"](scroll|resize)['"]/)
    }
  })
  it('uses setTimeout only as a bound on a collapsing slot', () => {
    const uses = code.filter((f) => /setTimeout/.test(read(f)))
    expect(uses).toEqual(['SlotList.tsx'])
    expect(read('SlotList.tsx')).toMatch(/GHOST_FALLBACK_MS/)
  })
  it('never writes unescaped HTML or evaluates text', () => {
    for (const f of code) expect(read(f), f).not.toMatch(/innerHTML|dangerouslySetInnerHTML|\beval\(|new Function\(/)
  })
  it('has no streak, broken or loss wording and no red-for-failure token', () => {
    for (const f of files) expect(read(f).toLowerCase(), f).not.toMatch(/streak|\bbroken\b|\bfailed\b|you lost|\bpenalt/)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\bred\b/i)
  })
  it('imports only from the lamp, kit and motion packages and never from another wave-6 package', () => {
    const bad: string[] = []
    for (const f of code) {
      for (const m of read(f).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]
        if (!spec.startsWith('.')) continue
        const target = resolve(dirname(join(DIR, f)), spec).split('\\').join('/')
        if (target.startsWith(DIR.split('\\').join('/'))) continue
        if (/\/shared\/(lamp|kit|motion)(\/|$)/.test(target)) continue
        if (/\/gallery\/entries\/d03-tables$/.test(target)) continue
        bad.push(`${f}: ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('the D03 stylesheet', () => {
  it('has no zebra striping', () => {
    expect(css).not.toMatch(/nth-child\(\s*(even|odd|2n)/)
  })
  it('never transitions or animates a box-shadow and gives no shadow to a repeated row beyond the flush lip', () => {
    expect(css).not.toMatch(/transition[^;{}]*box-shadow/)
    expect(css).not.toMatch(/@keyframes[^{]*\{[^]*?box-shadow/)
    expect(css).not.toMatch(/\.d3-table td[^{]*\{[^}]*box-shadow\s*:\s*var\(--elev-(raised|float)/)
  })
  it('has a forced-colours branch that sets edges and the selection', () => {
    const fc = css.slice(css.indexOf('@media (forced-colors: active)'))
    expect(fc).toMatch(/CanvasText/)
    expect(fc).toMatch(/Highlight/)
    expect(fc).toMatch(/\.d3r-rack/)
    expect(fc).toMatch(/aria-selected/)
  })
  it('has a reduced-motion branch for the OS flag and for data-motion=calm', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/data-motion='calm'/)
  })
  it('keeps every motion bounded: no infinite animation', () => {
    expect(css).not.toMatch(/infinite/)
  })
  it('states the 32 px row, the 44 px hit area and the 320 px rack in the sheet', () => {
    expect(css).toMatch(/--d3-row, 32px/)
    expect(css).toMatch(/--hit, 44px/)
    expect(css).toMatch(/--d3-rack-w, 320px/)
    expect(css).toMatch(/--d3-slot-px: 52px/)
  })
  it('takes a 2 px focus ring in the ring token', () => {
    expect(css).toMatch(/outline: 2px solid var\(--focus-ring\)/)
    expect(css).not.toMatch(/outline\s*:\s*none/)
  })
})

describe('the gallery entry', () => {
  it('covers LedgerTable, SlotList and DetentRack in the data group, each with a hollow or static form', () => {
    expect(entries.map((e) => e.id)).toEqual(['data/LedgerTable', 'data/SlotList', 'data/DetentRack'])
    expect(entries.every((e) => e.group === 'data' && e.states.length >= 4)).toBe(true)
    const labels = entries[0].states.map((s) => s.label).join(' | ')
    for (const w of ['WAITING', 'FAULT', 'PLANNED', 'cards', 'drawer', 'chooser', 'dense', 'loading', 'empty']) expect(labels).toContain(w)
  })
})
