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

// 25 Nov: one hue per project, as tokens, with the contrast of the text that sits on a tinted ground recomputed here.
describe('project hues', () => {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const over = (tint: number[], a: number, back: number[]) => tint.map((c, i) => c * a + back[i] * (1 - a))
  const prop = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))![1].trim()
  const channels = (v: string) => v.split(',').map((n) => Number(n))
  const IDS = ['jarvis', 'aankhen', 'yadaash', 'wellwisher'] as const
  // the first four --hue-*-rgb are the dark ground's, the next four the light ground's (file order)
  const all = [...tokens.matchAll(/--hue-(jarvis|aankhen|yadaash|wellwisher)-rgb:\s*([^;]+);/g)].map((m) => [m[1], channels(m[2])] as const)
  const darkHue = Object.fromEntries(all.slice(0, 4)) as Record<(typeof IDS)[number], number[]>
  const lightHue = Object.fromEntries(all.slice(4, 8)) as Record<(typeof IDS)[number], number[]>
  const dark = tokens.slice(tokens.indexOf(":root:where([data-look='v3']) {"), tokens.indexOf(":root:where([data-look='v3'][data-theme='clay-light'])"))
  const light = tokens.slice(tokens.indexOf(":root:where([data-look='v3'][data-theme='clay-light']) {"), tokens.indexOf(":root:where([data-look='v3'][data-host]"))
  const host = tokens.slice(tokens.indexOf(":root:where([data-look='v3'][data-host]"), tokens.indexOf("[data-glass='off']"))
  const rgb = (block: string, name: string) => channels(prop(block, name))
  const hues = tokens.slice(tokens.indexOf('--hue-jarvis-rgb'))
  const WHITE = [255, 255, 255]
  const BLACK = [0, 0, 0]

  it('gives every project a hue on both grounds, and the tint steps are the stated ones', () => {
    expect(all).toHaveLength(8)
    expect(Object.keys(darkHue).sort()).toEqual([...IDS].sort())
    expect(prop(hues, '--acc-ground')).toBe('rgba(var(--hue-rgb), 0.04)')
    expect(prop(hues, '--acc-tray')).toBe('rgba(var(--hue-rgb), 0.05)')
    expect(prop(hues, '--acc-tray-1')).toBe('rgba(var(--hue-rgb), 0.08)')
    expect(prop(hues, '--acc-soft')).toBe('rgba(var(--hue-rgb), 0.12)')
  })

  it('DARK ground, worst backdrop white in the desktop host: text holds 4.5 to 1 on the ground, the spine and the first tray with the hue laid over', () => {
    const ink2 = hex(prop(dark, '--ink2'))
    const ink = hex(prop(dark, '--ink'))
    const ga = Number(prop(host, '--ga'))
    const sa = Number(prop(host, '--sa'))
    for (const id of ['jarvis', 'aankhen', 'yadaash'] as const) {
      const h = darkHue[id]
      const ground = over(h, 0.04, over(rgb(dark, '--ground-rgb'), ga, WHITE))
      const spine = over(h, 0.05, over(rgb(dark, '--spine-rgb'), sa, WHITE))
      const first = over(h, 0.08, over(rgb(dark, '--trayn-rgb'), Number(prop(dark, '--tna')), WHITE))
      expect(ratio(ink2, ground), `${id} ground`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(ink2, spine), `${id} spine`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(ink, first), `${id} first tray`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('DARK ground in a plain browser (backdrop 128): the open project mark holds 3 to 1 on the spine', () => {
    const spine = over(rgb(dark, '--spine-rgb'), Number(prop(dark, '--sa')), [128, 128, 128])
    for (const id of ['jarvis', 'aankhen', 'yadaash'] as const) expect(ratio(darkHue[id], spine), id).toBeGreaterThanOrEqual(3)
  })
  it('LIGHT ground, worst backdrop black: ink and ink2 hold 4.5 to 1 on the tinted ground, tray and first tray; the mark holds 3 to 1 on the first tray', () => {
    const h = lightHue.wellwisher
    const ground = over(h, 0.04, over(rgb(light, '--ground-rgb'), Number(prop(light, '--ga')), BLACK))
    const tray = over(h, 0.05, over(rgb(light, '--tray-rgb'), Number(prop(light, '--ta')), BLACK))
    const first = over(h, 0.08, over(rgb(light, '--trayn-rgb'), Number(prop(light, '--tna')), BLACK))
    expect(ratio(hex(prop(light, '--ink2')), ground)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(hex(prop(light, '--ink')), tray)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(hex(prop(light, '--ink')), first)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(h, rgb(light, '--trayn-rgb'))).toBeGreaterThanOrEqual(3)
  })

  it('the label on every accent fill, and on every key cap, holds 4.5 to 1', () => {
    for (const id of ['aankhen', 'yadaash', 'wellwisher']) {
      const i = hues.indexOf(`:root[data-look='v3'][data-hue='${id}']`)
      expect(i, id).toBeGreaterThan(-1)
      const block = hues.slice(i, hues.indexOf('\n}', i))
      expect(ratio(hex(prop(block, '--on-accent')), hex(prop(block, '--accent'))), `${id} label`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(hex(prop(block, '--on-accent')), hex(prop(block, '--accent-b'))), `${id} label on the pressed end`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(hex(prop(block, '--cap-ink')), hex(prop(block, '--cap-fill'))), `${id} cap`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(hex(prop(block, '--s3-kcap-ink')), hex(prop(block, '--s3-kcap-bg'))), `${id} s3 cap`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a hue is not a state colour: each of the four sits at least 20 degrees from the live green-teal and the simulated violet', () => {
    const hsl = (c: number[]) => {
      const [r, g, b] = c.map((x) => x / 255)
      const mx = Math.max(r, g, b)
      const d = mx - Math.min(r, g, b)
      if (!d) return 0
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      return (h * 60 + 360) % 360
    }
    const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
    for (const [set, ground] of [[darkHue, dark], [lightHue, light]] as const) {
      const live = hsl(hex(prop(ground, '--live')))
      const sim = hsl(hex(prop(ground, '--sim')))
      for (const id of IDS) {
        expect(gap(hsl(set[id]), live), `${id} vs live`).toBeGreaterThanOrEqual(20)
        expect(gap(hsl(set[id]), sim), `${id} vs simulated`).toBeGreaterThanOrEqual(20)
      }
    }
  })
})

describe('the slim spine (25 Nov)', () => {
  it('is 184 px wide and 64 px folded, and the column animates by the sheet token', () => {
    expect(sheet).toMatch(/--s3-spine-w:\s*184px/)
    expect(sheet).toMatch(/\.s3\[data-spine='rail'\]\s*\{\s*--s3-spine-w:\s*64px/)
    expect(sheet).toMatch(/transition-property:\s*grid-template-columns/)
  })
  it('every spine row is one line of 44 px', () => {
    for (const sel of ['.s3-head {', '.s3-item {']) {
      const i = sheet.indexOf(sel)
      expect(sheet.slice(i, sheet.indexOf('}', i)), sel).toMatch(/min-height:\s*44px/)
    }
  })
  it('the tint of the ground, the trays and the first tray come from tokens', () => {
    expect(sheet).toMatch(/\.s3-ground\s*\{[^}]*var\(--acc-ground\)/)
    expect(sheet).toMatch(/\.s3-tray\[data-step='1'\]\s*\{[^}]*var\(--acc-tray-1\)/)
  })
  it('the ruler under a tray head is not drawn, and the reading face (not mono) names jobs, captions and tabs', () => {
    expect(sheet).toMatch(/\.s3-ruler\s*\{\s*display:\s*none/)
    for (const sel of ['.s3-step {', '.s3-cap {', '.s3-loc-p {', '.s3-pn {']) {
      const i = sheet.indexOf(sel)
      expect(sheet.slice(i, sheet.indexOf('}', i)), sel).not.toMatch(/--s3-mono/)
    }
  })
})
