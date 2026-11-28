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
      // 28 Nov: the tray body's soft edge transitions its two registered lengths (--s3-fade-t, --s3-fade-b), still named, never all
      for (const part of m[1].split(/,(?![^(]*\))/)) expect(part.trim(), m[0]).toMatch(/^(background-color|background|box-shadow|transform|opacity|color|--s3-fade-[tb])\s/)
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

// 28 Nov, the design reset (docs/design/design-reset-1128.md). The contrast floors of spec 2.7 and the 25 Nov project hues were
// tested here against the copy of the ground values this file used to hold. That copy is gone: shell-v3-tokens.css imports the
// one token file (styles/design/v3/glass.css), and src/__tests__/v3/tokens-v3.test.ts recomputes every floor from it, on both
// grounds and for both accent schemes. What this file holds now is the reset's own rules for the shell: the one source of the
// values, the neutral names the views read, no gradient fill and no tint in the chrome, the accent used only as a signal, the
// tray body that scrolls, and the chrome sizes that give room back.
describe('the design reset in the shell (28 Nov)', () => {
  const raw = readFileSync(join(DIR, 'shell-v3-tokens.css'), 'utf8')
  const rules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))
  const block = (sel: string) => {
    const r = rules.find((x) => x.sel === sel)
    expect(r, sel).toBeTruthy()
    return r!.body
  }

  it('takes every material value from the one token file, and keeps no copy of a ground', () => {
    expect(raw.trimStart()).toMatch(/^\/\*[\s\S]*?\*\/\s*@import '\.\.\/\.\.\/styles\/design\/v3\/glass\.css';/)
    expect(tokens).not.toMatch(/--(ground|tray|trayn|trayl|spine|well)-rgb:/)
    expect(tokens).not.toMatch(/--ink2?:/)
  })
  it('makes the names the views read neutral: no tint on a ground or a tray, a selected row in ink, a selected mark in the accent', () => {
    const where = tokens.slice(tokens.indexOf('--hue: var(--accent)'))
    expect(where).toMatch(/--acc-ground:\s*transparent;/)
    expect(where).toMatch(/--acc-tray:\s*transparent;/)
    expect(where).toMatch(/--acc-tray-1:\s*transparent;/)
    expect(where).toMatch(/--acc-soft:\s*color-mix\(in srgb, var\(--ink\) 8%, transparent\);/)
    // the 25 Nov hue per project is gone from the shell: no channels, no per-project accent block
    expect(tokens).not.toMatch(/--hue-(jarvis|aankhen|yadaash|wellwisher)/)
    expect(tokens).not.toMatch(/\[data-hue=/)
  })
  it('draws no gradient fill and no glow anywhere in the chrome: the only gradient is the mask of the tray body soft edge', () => {
    expect(sheet).not.toMatch(/background-image\s*:/)
    for (const m of sheet.matchAll(/([\w-]+)\s*:\s*[^;{}]*gradient\(/g)) expect(m[1], m[0]).toMatch(/^(-webkit-)?mask-image$/)
    expect(sheet).not.toMatch(/--s3-glow|--acc-|--hue\b|text-shadow/)
  })
  it('uses the accent only as a signal: a dot, a 2 px rule, the open mark, the caret, the ON switch and the flare', () => {
    const readers = rules.filter((r) => /var\(--accent\)/.test(r.body)).map((r) => r.sel.replace(/\s+/g, ' '))
    expect(readers.sort()).toEqual([
      '.s3-flare',
      ".s3-grp[data-open='true'] .s3-pi",
      '.s3-item i',
      ".s3-seg button[aria-current='page']::before",
      ".s3-switch[aria-checked='true'] .s3-track::after",
      '.s3-wellin input',
      ".s3[data-spine='rail'] .s3-item[aria-current='page']::before",
    ].sort())
    // each of them is small: a 6 px dot, a 2 px rule, a 20 px thumb, an inset 2 px edge, a caret, a 24 px mark
    expect(block('.s3-item i')).toMatch(/width: 6px; height: 6px/)
    expect(block(".s3[data-spine='rail'] .s3-item[aria-current='page']::before")).toMatch(/width: 2px/)
    expect(block('.s3-flare')).toMatch(/box-shadow: inset 0 0 0 2px var\(--accent\)/)
  })
  it('every tray body scrolls its own content, with a soft edge only on the side that has more', () => {
    const body = block('.s3-body')
    expect(body).toMatch(/overflow-y: auto;/)
    expect(body).toMatch(/min-height: 0;/)
    expect(body).toContain('mask-image: linear-gradient(to bottom, transparent 0, currentColor var(--s3-fade-t), currentColor calc(100% - var(--s3-fade-b)), transparent 100%)')
    expect(block(".s3-body[data-more-up='1']")).toMatch(/--s3-fade-t: 1\.5rem/)
    expect(block(".s3-body[data-more-down='1']")).toMatch(/--s3-fade-b: 1\.5rem/)
    expect(sheet).toMatch(/@property --s3-fade-t/)
  })
  it('gives room back: a 56 px plate that slims to 44, a 44 px dock that never changes height when it opens', () => {
    expect(block('.s3-top')).toMatch(/min-height: 56px/)
    expect(block(".s3[data-plate='slim'] .s3-top")).toMatch(/min-height: 44px/)
    expect(block('.s3-dock')).toMatch(/min-height: 44px;\s*padding: 0;/)
    for (const r of rules.filter((x) => x.sel.includes("[data-open='true']"))) expect(r.body, r.sel).not.toMatch(/height|padding|margin|width/)
    // the slim plate changes the title by a transform, not a font size, so the compression is drawn by the compositor
    expect(block(".s3[data-plate='slim'] .s3-loc-s")).toMatch(/transform: scale\(0\.8\)/)
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
  // 28 Nov: this test read "the tint of the ground, the trays and the first tray come from tokens"; the reset removed the
  // tints, so it now holds the rule that replaced them: the ground and every tray are one flat colour each, no image over them
  it('the ground and the trays are one flat colour each, from the tokens, with no image laid over them', () => {
    expect(sheet).toMatch(/\.s3-ground\s*\{[^}]*background-color: var\(--s3-ground\)/)
    expect(sheet).toMatch(/\.s3-tray\[data-step='1'\]\s*\{[^}]*background-color: var\(--s3-trayn\)/)
    expect(sheet).not.toMatch(/\.s3-(ground|tray)[^{]*\{[^}]*background-image/)
  })
  it('the ruler under a tray head is not drawn, and the reading face (not mono) names jobs, captions and tabs', () => {
    expect(sheet).toMatch(/\.s3-ruler\s*\{\s*display:\s*none/)
    for (const sel of ['.s3-step {', '.s3-cap {', '.s3-loc-p {', '.s3-pn {']) {
      const i = sheet.indexOf(sel)
      expect(sheet.slice(i, sheet.indexOf('}', i)), sel).not.toMatch(/--s3-mono/)
    }
  })
})
