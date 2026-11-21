// The v3 shell's stylesheets against the repo-wide style rules (the ww css-lint reads only ww/, so this reads shell/v3/): no
// colour, duration or easing literal outside the token file, no pixel literal for type, radius, padding, margin or gap, no
// `transition: all`, and the spec 2.7 contrast floors recomputed from the token file's own numbers.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, '..', '..', '..', 'shell', 'v3')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = strip(readFileSync(join(DIR, 'shell-v3-tokens.css'), 'utf8'))
const sheet = strip(readFileSync(join(DIR, 'shell-v3.css'), 'utf8'))

describe('shell-v3.css', () => {
  it('holds no colour literal: every colour is a token of shell-v3-tokens.css', () => {
    expect(sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|color-mix\(|oklch\(/)
  })
  it('holds no duration or easing literal', () => {
    expect(sheet).not.toMatch(/(^|[^\w-])\d*\.?\d+m?s\b(?!\w)/)
    expect(sheet).not.toMatch(/cubic-bezier\(/)
  })
  it('names the properties of every transition and never says all', () => {
    expect(sheet).not.toMatch(/transition(-property)?\s*:\s*all\b/)
    for (const m of sheet.matchAll(/transition\s*:\s*([^;}]+)[;}]/g)) {
      if (/^\s*none\s*$/.test(m[1])) continue
      for (const part of m[1].split(/,(?![^(]*\))/)) expect(part.trim(), m[0]).toMatch(/^(background-color|background|box-shadow|transform|opacity|color)\s/)
    }
  })
  it('writes no pixel literal for font-size, border-radius, padding, margin or gap (rem), 0 and 1 px excepted', () => {
    for (const m of sheet.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
      if (!/^(font-size|border-radius|padding|margin|gap|row-gap|column-gap)(-[\w-]+)?$/.test(m[1])) continue
      const px = (m[2].match(/(?<![\w.])(\d*\.?\d+)px/g) ?? []).filter((x) => x !== '0px' && x !== '1px')
      expect(px, `${m[1]}: ${m[2]}`).toEqual([])
    }
  })
  it('sets no font below 11 px (0.6875rem) and no !important', () => {
    for (const m of sheet.matchAll(/font(?:-size)?\s*:\s*[^;{}]*?(\d*\.?\d+)rem/g)) expect(Number(m[1]), m[0]).toBeGreaterThanOrEqual(0.6875)
    expect(sheet).not.toMatch(/!important/)
  })
  it('puts a backdrop-filter nowhere in the stylesheet: only the ground blurs, and ShellV3 sets it inline', () => {
    expect(sheet).not.toMatch(/backdrop-filter/)
  })
  it('keeps a reduced-motion block and a forced-colours block', () => {
    expect(sheet).toContain('@media (prefers-reduced-motion: reduce)')
    expect(sheet).toContain('@media (forced-colors: active)')
  })
  it('every pointer target of the chrome is 44 px: keys, spine items, view keys, mode keys and tabs state it', () => {
    for (const sel of ['.s3-key {', '.s3-item {', '.s3-seg button {', '.s3-mode button {', '.s3-popitem {', '.s3-lamprow {']) {
      const i = sheet.indexOf(sel)
      expect(i, sel).toBeGreaterThan(-1)
      expect(sheet.slice(i, sheet.indexOf('}', i)), sel).toMatch(/min-height:\s*44px/)
    }
    expect(sheet).toMatch(/\.s3-tab \{[^}]*min-height: 52px/)
  })
})

describe('contrast floors of spec 2.7, recomputed from the token file', () => {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const over = (tint: number[], a: number, back: number) => tint.map((c) => c * a + back * (1 - a))
  const prop = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))![1].trim()
  const dark = tokens.slice(tokens.indexOf(":root:where([data-look='v3']) {"), tokens.indexOf(":root:where([data-look='v3'][data-theme='clay-light'])"))
  const light = tokens.slice(tokens.indexOf(":root:where([data-look='v3'][data-theme='clay-light'])"), tokens.indexOf(":root:where([data-look='v3'][data-host]"))
  const host = tokens.slice(tokens.indexOf(":root:where([data-look='v3'][data-host]"), tokens.indexOf("[data-glass='off']"))
  const rgb = (block: string, name: string) => prop(block, name).split(',').map((n) => Number(n))

  it('dark ground in the desktop host (no brightness term), worst backdrop white: ink2 on ground and spine is at least 4.5 to 1', () => {
    const ga = Number(prop(host, '--ga'))
    const sa = Number(prop(host, '--sa'))
    const ground = over(rgb(dark, '--ground-rgb'), ga, 255)
    const spine = over(rgb(dark, '--spine-rgb'), sa, 255)
    const ink2 = lum(hex(prop(dark, '--ink2')))
    expect(ratio(ink2, lum(ground))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(ink2, lum(spine))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(lum(hex(prop(dark, '--ink'))), lum(spine))).toBeGreaterThanOrEqual(4.5)
  })
  it('dark ground in a plain browser (brightness .5 lowers a white backdrop to 128): ink2 is at least 4.5 to 1', () => {
    const ground = over(rgb(dark, '--ground-rgb'), Number(prop(dark, '--ga')), 128)
    const spine = over(rgb(dark, '--spine-rgb'), Number(prop(dark, '--sa')), 128)
    const ink2 = lum(hex(prop(dark, '--ink2')))
    expect(ratio(ink2, lum(ground))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(ink2, lum(spine))).toBeGreaterThanOrEqual(4.5)
  })
  it('light ground, worst backdrop black: ink2 on the ground and ink on the first tray are at least 4.5 to 1', () => {
    const ground = over(rgb(light, '--ground-rgb'), Number(prop(light, '--ga')), 0)
    expect(ratio(lum(hex(prop(light, '--ink2'))), lum(ground))).toBeGreaterThanOrEqual(4.5)
    const tray = over(rgb(light, '--trayn-rgb'), Number(prop(light, '--tna')), 0)
    expect(ratio(lum(hex(prop(light, '--ink'))), lum(tray))).toBeGreaterThanOrEqual(4.5)
  })
  it('the text wells never drop below .93 and the locked label, ink3 on a well and the accent label hold 4.5 to 1', () => {
    expect(Number(prop(dark, '--wa'))).toBeGreaterThanOrEqual(0.93)
    expect(Number(prop(light, '--wa'))).toBeGreaterThanOrEqual(0.93)
    const well = rgb(dark, '--well-rgb')
    expect(ratio(lum(hex(prop(dark, '--locked'))), lum(well))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(lum(hex(prop(dark, '--ink3'))), lum(well))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(lum(hex(prop(dark, '--on-accent'))), lum(hex(prop(dark, '--accent-lo'))))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(lum(hex(prop(tokens, '--s3-kcap-ink'))), lum(hex(prop(tokens, '--s3-kcap-bg'))))).toBeGreaterThanOrEqual(4.5)
  })
  it('glass off sets every alpha to 1 and the filter to none', () => {
    const off = tokens.slice(tokens.indexOf("[data-glass='off']"), tokens.indexOf('@supports'))
    for (const a of ['--ga', '--sa', '--ta', '--tna', '--tla', '--wa']) expect(prop(off, a), a).toBe('1')
    expect(prop(off, '--glass-filter')).toBe('none')
  })
})
