// Plan 8.2: the CSS lint. Every .css file under ww/ is scanned as text. Token files (primitive.css,
// themes/*.css, motion/springs.generated.css) may hold literals; everything else must use tokens.
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { WW_DIR, cssFiles, parseCss, read, stripComments } from './_css'

const files = cssFiles(WW_DIR)
const isToken = (f: string) => /design[\\/]primitive\.css$|themes[\\/][^\\/]+\.css$|springs\.generated\.css$/.test(f)
const colourOk = (f: string) => /design[\\/]primitive\.css$|themes[\\/][^\\/]+\.css$/.test(f)
const body = (f: string) => stripComments(read(f))
const short = (f: string) => f.slice(WW_DIR.length + 1).replace(/\\/g, '/')
const decls = (f: string) => parseCss(read(f)).rules.flatMap((r) => Object.entries(r.decls).map(([k, v]) => ({ sel: r.selectors.join(', '), k, v })))

describe('ww CSS files', () => {
  it('the scan finds the design files', () => {
    expect(files.map(short)).toEqual(expect.arrayContaining(['design/primitive.css', 'design/motion.css', 'design/base.css', 'design/component.css', 'design/themes/ash.css']))
  })
  it.each(files.map((f) => [short(f), f]))('%s: no colour literal outside the token files', (_n, f) => {
    if (colourOk(f)) return
    expect(body(f)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|color-mix\(/)
  })
  it.each(files.map((f) => [short(f), f]))('%s: no px literal for font-size, radius, padding, margin or gap outside the token files', (_n, f) => {
    if (isToken(f)) return
    for (const d of decls(f)) {
      if (/^(font-size|border-radius|padding|margin|gap)(-[\w-]+)?$/.test(d.k) && !d.k.startsWith('--')) {
        const px = (d.v.match(/(?<![\w.])(\d*\.?\d+)px/g) ?? []).filter((x) => x !== '0px' && x !== '1px')
        expect(px, `${d.sel} { ${d.k}: ${d.v} }`).toEqual([])
      }
    }
  })
  it.each(files.map((f) => [short(f), f]))('%s: no !important, backdrop-filter, cubic-bezier, transition: all, will-change or cursor: none', (_n, f) => {
    const t = body(f)
    expect(t).not.toMatch(/!important/)
    expect(t).not.toMatch(/backdrop-filter/)
    expect(t).not.toMatch(/transition(-property)?\s*:\s*all\b/)
    expect(t).not.toMatch(/will-change/)
    expect(t).not.toMatch(/cursor\s*:\s*none/)
    if (!isToken(f)) expect(t).not.toMatch(/cubic-bezier\(/)
  })
  it.each(files.map((f) => [short(f), f]))('%s: no literal duration outside the token files', (_n, f) => {
    if (isToken(f)) return
    expect(body(f)).not.toMatch(/(^|[^\w-])\d*\.?\d+m?s\b(?!\w)/)
  })
  it.each(files.map((f) => [short(f), f]))('%s: no --p-* primitive is read outside the token files', (_n, f) => {
    if (isToken(f)) return
    expect(body(f)).not.toMatch(/var\(--p-/)
  })
})

describe('colour roles', () => {
  const nonToken = files.filter((f) => !isToken(f))
  it('--ink-off and --accent-hi are never a text colour', () => {
    for (const f of files) for (const d of decls(f)) if (d.k === 'color') expect(d.v, `${short(f)} ${d.sel}`).not.toMatch(/--ink-off|--accent-hi/)
  })
  it('--ink-off and --accent-hi are not aliased into another token that could reach color:', () => {
    for (const f of nonToken) for (const d of decls(f)) if (d.k.startsWith('--') && /ink-off|accent-hi/.test(d.v)) expect(d.k, short(f)).toMatch(/^--(focus-ring|ink-off|accent-hi)$/)
  })
  it('no box-shadow: inset on a state class (the 3 px stripe that bled into rounded corners)', () => {
    for (const f of files) for (const d of decls(f)) if (d.k === 'box-shadow' && /^inset|\binset\b/.test(d.v)) expect(d.sel).not.toMatch(/\.(on|active|selected|done|current)\b|\[aria-(selected|pressed|current)/)
  })
  it('a dashed border is --line-ui, so the only cue that a card is not live clears 3:1', () => {
    for (const f of nonToken) for (const d of decls(f)) if (/dashed/.test(d.v)) expect(d.v).toMatch(/var\(--line-ui\)/)
  })
  it('--accent is used only for the primary button, the active tab, the focus ring and their component tokens', () => {
    for (const f of nonToken) {
      for (const d of decls(f)) {
        if (!/var\(--accent\)/.test(d.v)) continue
        const ok = /^--(btn-primary-bg|tab-underline)$/.test(d.k) || /btn\.primary|\.ww-tab|aria-selected|focus/.test(d.sel)
        expect(ok, `${short(f)} ${d.sel} { ${d.k}: ${d.v} }`).toBe(true)
      }
    }
  })
  it('accent-coloured text is never rendered on --accent-wash', () => {
    for (const f of files) {
      for (const r of parseCss(read(f)).rules) {
        const text = /var\(--accent\)/.test(r.decls['color'] ?? '')
        const wash = Object.entries(r.decls).some(([k, v]) => /^background/.test(k) && /accent-wash/.test(v))
        expect(text && wash, `${short(f)} ${r.selectors[0]}`).toBe(false)
      }
    }
  })
  it('no fixed height or max-height on an element whose class starts with ww-page (the 300 px Log box)', () => {
    for (const f of files) for (const d of decls(f)) if (/\.ww-page/.test(d.sel) && /^(height|max-height)$/.test(d.k)) expect(d.v, `${d.sel}`).not.toMatch(/\d+(px|vh|rem|em)/)
  })
})

describe('the sources under ww/', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
    })
  const sources = walk(WW_DIR)
  it('there are sources to scan', () => expect(sources.length).toBeGreaterThan(5))
  it('no scroll listener, no cursor hiding, no animation library', () => {
    for (const f of sources) {
      const t = read(f)
      expect(t, short(f)).not.toMatch(/addEventListener\(\s*['"]scroll['"]/)
      expect(t, short(f)).not.toMatch(/cursor\s*=\s*['"]none['"]/)
      expect(t, short(f)).not.toMatch(/from\s+['"](gsap|framer-motion|motion|lenis|locomotive-scroll)(\/[^'"]*)?['"]/)
    }
  })
})

describe('the legacy ratchet: counts in germoney/** CSS may fall and may never rise', () => {
  // Baseline measured 9 Nov 2026 with THIS counting method (the plan's 72 / 939 / 17 / 16 / 11
  // came from a different one: ours counts rgb( too, every px literal, and distinct value strings).
  const BASE = { colours: 78, px: 940, fontSizes: 21, radii: 23, important: 12 }
  const text = cssFiles(join(WW_DIR, '../germoney')).map((f) => body(f)).join('\n')
  const now = {
    colours: (text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length + (text.match(/rgba?\(/g) ?? []).length,
    px: (text.match(/\b\d+(\.\d+)?px/g) ?? []).length,
    fontSizes: new Set([...text.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim())).size,
    radii: new Set([...text.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim())).size,
    important: (text.match(/!important/g) ?? []).length,
  }
  it.each(Object.keys(BASE) as (keyof typeof BASE)[])('%s does not rise', (k) => expect(now[k]).toBeLessThanOrEqual(BASE[k]))
})
