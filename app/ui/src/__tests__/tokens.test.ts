// The contrast oracle of the overhaul design system (spec 6.3.3 and 6.5.3, work package B03).
//
// It reads the REAL clay files (styles/design/clay/*.css and styles/sections/*.css), applies the
// cascade for a described page (theme, scene, section, contrast, forced colours) the way a browser
// would (selector specificity, source order, var() resolved where it is declared, so a role that is
// inherited as a computed value is tested exactly as it renders), and computes every pair of the
// spec's tables with the WCAG 2.2 relative-luminance formula, ratio = (L1 + 0.05) / (L2 + 0.05),
// NOT rounded for pass or fail (4.499 fails). The numbers printed in the spec are expected values
// to two decimals; if a CSS value drifts, the pair fails here before it reaches a screen.
//
// A separate file from ww/tokens.test.ts, which does the same job for the old Well Wisher themes.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCss, stripComments } from './ww/_css'
import { WW_THEME_TO_CLAY, FIRST_RUN_CLAY_THEME, clayThemeFor } from '../ww/design/themes/clay-map'
import { THEMES } from '../ww/frame/theme'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLAY = join(SRC, 'styles/design/clay')
const SECTIONS = join(SRC, 'styles/sections')
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// ------------------------------------------------------------------ files, in the cascade order of index.css
const SECTION_IDS = ['core', 'room', 'senses', 'memory', 'console', 'day', 'study', 'tree', 'career', 'focus', 'proof'] as const
const CLAY_ORDER = ['primitive-scale', 'primitive-color', 'semantic', 'scene', 'elevation', 'focus', 'type', 'products']
const ORDERED_FILES = [
  ...CLAY_ORDER.map((n) => join(CLAY, `${n}.css`)),
  ...SECTION_IDS.map((n) => join(SECTIONS, `${n}.css`)),
  join(CLAY, 'contrast.css'),
  join(CLAY, 'forced.css'),
]
const ALL_RULES = ORDERED_FILES.flatMap((f) => parseCss(read(f)).rules.map((r) => ({ ...r, file: f })))

// ------------------------------------------------------------------ a tiny cascade
interface Page {
  theme: 'clay-light' | 'clay-dark'
  product?: 'jarvis' | 'ww'
  /** how the page asks for more contrast: the in-app switch or the OS setting */
  contrast?: 'attr' | 'os'
  forced?: boolean
  /** the element asked about: a section root, optionally a scene root (same element, as B05 will write it) */
  section?: string
  scene?: 'immersive'
}
type Attrs = Record<string, string>
const htmlAttrs = (p: Page): Attrs => ({
  'data-theme': p.theme,
  ...(p.product ? { 'data-product': p.product } : {}),
  ...(p.contrast === 'attr' ? { 'data-contrast': 'high' } : {}),
})
const elAttrs = (p: Page): Attrs => ({ ...(p.section ? { 'data-section': p.section } : {}), ...(p.scene ? { 'data-scene': p.scene } : {}) })

function matchCompound(comp: string, attrs: Attrs, isHtml: boolean): boolean {
  const m = /^(:root)?((?:\[[^\]]+\])*)$/.exec(comp)
  if (!m) return false // :where(), :focus-visible and the like never carry a token
  if (m[1] && !isHtml) return false
  for (const a of m[2].matchAll(/\[([\w-]+)(?:(\^?=)'([^']*)')?\]/g)) {
    const have = attrs[a[1]]
    if (have === undefined) return false
    if (a[2] === '=' && have !== a[3]) return false
    if (a[2] === '^=' && !have.startsWith(a[3])) return false
  }
  return true
}
const specificity = (sel: string) => (sel.match(/\[[^\]]+\]|:root/g) ?? []).length

function mediaApplies(media: string | null, p: Page): boolean {
  if (media === null) return true
  if (media === '@media (forced-colors: active)') return !!p.forced
  if (media === '@media not (forced-colors: active)') return !p.forced
  if (media === '@media (prefers-contrast: more)') return p.contrast === 'os' && !p.forced // nested inside "not forced"
  throw new Error(`unknown media ${media}`)
}

type Decls = Record<string, string>
function declaredAt(p: Page, level: 0 | 1): Decls {
  const html = htmlAttrs(p)
  const el = elAttrs(p)
  const hits: { spec: number; order: number; decls: Decls }[] = []
  for (const r of ALL_RULES) {
    if (!mediaApplies(r.media, p)) continue
    let best = -1
    for (const s of r.selectors) {
      const comps = s.split(/\s+/).filter(Boolean)
      let ok = false
      if (level === 0) ok = comps.length === 1 && matchCompound(comps[0], html, true)
      else if (comps.length === 1) ok = matchCompound(comps[0], el, false)
      else if (comps.length === 2) ok = matchCompound(comps[0], html, true) && matchCompound(comps[1], el, false)
      if (ok) best = Math.max(best, specificity(s))
    }
    if (best >= 0) hits.push({ spec: best, order: r.order, decls: r.decls })
  }
  hits.sort((a, b) => a.spec - b.spec || a.order - b.order)
  const out: Decls = {}
  for (const h of hits) for (const [k, v] of Object.entries(h.decls)) if (k.startsWith('--')) out[k] = v
  return out
}

/** var() resolved where it is declared, against that element's own declarations then the inherited computed values. */
function resolveAll(declared: Decls, inherited: Decls): Decls {
  const out: Decls = {}
  const busy = new Set<string>()
  const get = (name: string): string | undefined => {
    if (name in declared) {
      if (name in out) return out[name]
      if (busy.has(name)) return undefined
      busy.add(name)
      const r = subst(declared[name], get)
      busy.delete(name)
      if (r !== undefined) out[name] = r
      return r
    }
    return inherited[name]
  }
  for (const n of Object.keys(declared)) get(n)
  return out
}
function subst(value: string, lookup: (n: string) => string | undefined): string | undefined {
  let v = value
  for (let guard = 0; v.includes('var(') && guard < 60; guard++) {
    const start = v.lastIndexOf('var(')
    let depth = 0
    let end = start + 3
    for (; end < v.length; end++) {
      if (v[end] === '(') depth++
      if (v[end] === ')' && --depth === 0) break
    }
    const inner = v.slice(start + 4, end)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const got = lookup(name) ?? (comma < 0 ? undefined : inner.slice(comma + 1).trim())
    if (got === undefined) return undefined
    v = v.slice(0, start) + got + v.slice(end + 1)
  }
  return v
}

/** The computed custom properties on the element the page describes (the root when it names no section or scene). */
function tokens(p: Page): Decls {
  const root = resolveAll(declaredAt(p, 0), {})
  if (!p.section && !p.scene) return root
  return { ...root, ...resolveAll(declaredAt(p, 1), root) }
}

// ------------------------------------------------------------------ WCAG
function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const near = (got: number, want: number) => Math.abs(got - want) <= 0.011 // the spec prints two decimals

// ------------------------------------------------------------------ 0. the files themselves
describe('the clay files', () => {
  it('index.css imports every clay and section file once, with contrast and forced last', () => {
    const idx = read(join(CLAY, 'index.css'))
    const imports = [...idx.matchAll(/@import '([^']+)';/g)].map((m) => m[1])
    const clayFiles = readdirSync(CLAY).filter((f) => f.endsWith('.css') && f !== 'index.css')
    for (const f of clayFiles) expect(imports.filter((i) => i === `./${f}`), f).toHaveLength(1)
    expect(imports.slice(-2)).toEqual(['./contrast.css', './forced.css'])
    expect(imports).toContain('../../sections/index.css')
    expect(imports.indexOf('../../sections/index.css')).toBeLessThan(imports.indexOf('./contrast.css'))
    expect(imports.slice(0, 2)).toEqual(['./primitive-scale.css', './primitive-color.css'])
    // the order this test cascades in is the order the browser will
    const order = imports.filter((i) => i.startsWith('./')).map((i) => i.replace(/^\.\/|\.css$/g, ''))
    expect(order).toEqual([...CLAY_ORDER, 'contrast', 'forced'])
    const sec = [...read(join(SECTIONS, 'index.css')).matchAll(/@import '\.\/([^']+)\.css';/g)].map((m) => m[1])
    expect(sec).toEqual([...SECTION_IDS])
  })
  // B05: the clay layer is imported by exactly one module, the Shell v2 chunk that App.tsx loads lazily and only
  // with the app.shell flag on, so with the flag off no clay rule reaches the page (no pixel changes).
  it('only the flag-on Shell v2 chunk imports the clay layer', () => {
    const offenders: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && p !== CLAY) walk(p)
        } else if (/\.(tsx?|css)$/.test(e.name) && !p.startsWith(CLAY) && !p.startsWith(SECTIONS) && /design\/clay|sections\/index/.test(read(p))) offenders.push(p)
      }
    }
    walk(SRC)
    expect(offenders.map((p) => p.split(sep).join('/').replace(/^.*\/src\//, ''))).toEqual(['shell/ShellV2.tsx'])
    const app = read(join(SRC, 'App.tsx'))
    expect(app).toMatch(/lazy\(\(\) => import\('\.\/shell\/ShellV2'\)\)/)
    expect(app).not.toMatch(/from '\.\/shell\/ShellV2'/)
    expect(read(join(SRC, 'main.tsx'))).not.toMatch(/clay|shell\//)
  })
})

describe('layer-1 primitives', () => {
  const t = tokens({ theme: 'clay-light' })
  it('every colour primitive is a 6-digit hex or an rgb() shadow step', () => {
    const color = parseCss(read(join(CLAY, 'primitive-color.css'))).rules[0].decls
    for (const [k, v] of Object.entries(color)) expect(v, k).toMatch(/^(#[0-9a-f]{6}|rgb\(\d+ \d+ \d+ \/ 0?\.\d+\))$/)
  })
  it('the 33 primitives of spec 6.3.1 hold the spec values', () => {
    const spec: Record<string, string> = {
      '--p-clay-50': '#f2f3f2', '--p-clay-100': '#e8eae9', '--p-clay-200': '#dadcdb', '--p-clay-300': '#c4c7c5', '--p-clay-500': '#6e7270', '--p-clay-600': '#5a5e5c', '--p-clay-700': '#4d4d4d',
      '--p-char-950': '#08090a', '--p-char-900': '#0f1011', '--p-char-850': '#121314', '--p-char-800': '#171717', '--p-char-750': '#1d2124', '--p-char-700': '#222426', '--p-char-600': '#34373a', '--p-char-400': '#7c8082', '--p-char-300': '#9a9ea0', '--p-char-200': '#b4b8ba',
      '--p-bone': '#e8eae9', '--p-orange-500': '#f25623', '--p-orange-450': '#f5693a', '--p-orange-700': '#a8300f',
      '--p-cyan-700': '#006b7a', '--p-cyan-300': '#5ce1ff', '--p-amber-800': '#805400', '--p-amber-300': '#ffb347', '--p-red-700': '#b3261e', '--p-red-400': '#ff6b5e',
      '--p-ochre-800': '#8a4b00', '--p-ochre-300': '#e0a030', '--p-ochre-art': '#ae6f0c', '--p-teal-800': '#2b6468', '--p-teal-300': '#6fc2c6',
      '--p-moss-800': '#46603a', '--p-moss-300': '#9cc38a', '--p-brick-700': '#9a4527', '--p-brick-300': '#e8896a',
    }
    for (const [k, v] of Object.entries(spec)) expect(t[k], k).toBe(v)
  })
  it('--hit is 44px in the clay layer and equals the Well Wisher copy (the pointer target of the jury rubric)', () => {
    const mine = parseCss(read(join(CLAY, 'primitive-scale.css'))).rules[0].decls as Record<string, string>
    expect(mine['--hit']).toBe('44px')
    expect(read(join(SRC, 'ww/design/component.css'))).toMatch(/--hit:\s*44px/)
  })
  it('the scale primitives that also exist in ../primitive.css are equal to it (the copies must not drift)', () => {
    // B01 moved the shared primitives from .ww to :root (seam S4) and left only --stagger under .ww,
    // so the oracle reads both blocks; reading .ww alone found 0 of the 15 shared names.
    const ww = Object.assign({}, ...parseCss(read(join(SRC, 'styles/design/primitive.css'))).rules.filter((r) => r.selectors.includes(':root') || r.selectors.includes('.ww')).map((r) => r.decls)) as Record<string, string>
    const mine = parseCss(read(join(CLAY, 'primitive-scale.css'))).rules[0].decls
    let shared = 0
    for (const [k, v] of Object.entries(mine)) if (k in ww) { shared++; expect(v, k).toBe(ww[k]) }
    expect(shared).toBeGreaterThanOrEqual(15)
    for (const k of ['--p-radius-2', '--p-size-56', '--p-size-72', '--p-line-56', '--p-line-72']) expect(k in ww, `${k} is new in the spec`).toBe(false)
  })
})

// ------------------------------------------------------------------ 1. the contrast tables of 6.3.3
type Row = [token: string, need: number, ground: number, raised: number, sunk: number]
const TEXT = 4.5
const EDGE = 3
const LIGHT: Row[] = [
  ['--ink-1', TEXT, 14.83, 16.12, 13.01], ['--ink-2', TEXT, 6.99, 7.6, 6.14], ['--ink-3', TEXT, 5.45, 5.92, 4.78],
  ['--state-measured', TEXT, 5.13, 5.58, 4.504], ['--state-simulated', TEXT, 5.45, 5.93, 4.78], ['--state-fault', TEXT, 5.41, 5.88, 4.74],
  ['--accent-ink', TEXT, 5.62, 6.1, 4.93], ['--edge-ui', EDGE, 4.04, 4.39, 3.54], ['--focus-ring', EDGE, 14.83, 16.12, 13.01],
]
const DARK: Row[] = [
  ['--ink-1', TEXT, 14.83, 12.89, 15.64], ['--ink-2', TEXT, 8.97, 7.79, 9.46], ['--ink-3', TEXT, 6.64, 5.76, 7.0],
  ['--state-measured', TEXT, 11.67, 10.14, 12.3], ['--state-simulated', TEXT, 10.07, 8.74, 10.61], ['--state-fault', TEXT, 6.42, 5.57, 6.77],
  ['--accent-ink', TEXT, 5.23, 4.55, 5.52], ['--edge-ui', EDGE, 4.5, 3.91, 4.74], ['--focus-ring', EDGE, 14.83, 12.89, 15.64],
]
const IMMERSIVE: Row[] = [
  ['--ink-1', TEXT, 15.76, 14.14, 16.49], ['--ink-2', TEXT, 9.53, 8.55, 9.97], ['--ink-3', TEXT, 7.05, 6.33, 7.38],
  ['--state-measured', TEXT, 12.4, 11.12, 12.97], ['--state-simulated', TEXT, 10.69, 9.6, 11.19], ['--state-fault', TEXT, 6.82, 6.12, 7.13],
  ['--accent-ink', TEXT, 5.56, 4.99, 5.82], ['--edge-ui', EDGE, 4.78, 4.29, 5.0], ['--focus-ring', EDGE, 15.76, 14.14, 16.49],
]
const SURFACES = ['--surface-ground', '--surface-raised', '--surface-sunk'] as const

function checkTable(label: string, page: Page, rows: Row[]) {
  const t = tokens(page)
  describe(label, () => {
    it.each(rows.map((r) => [r[0], r] as const))('%s clears its need on ground, raised and sunk, and matches the spec to 2 decimals', (_n, [name, need, ...want]) => {
      want.forEach((w, i) => {
        const got = ratio(t[name], t[SURFACES[i]])
        expect(got, `${label} ${name} on ${SURFACES[i]}: ${got}`).toBeGreaterThanOrEqual(need)
        expect(near(got, w), `${label} ${name} on ${SURFACES[i]}: computed ${got.toFixed(3)}, spec ${w}`).toBe(true)
      })
    })
  })
}
describe('contrast tables (spec 6.3.3), computed from the CSS', () => {
  checkTable('clay-light', { theme: 'clay-light' }, LIGHT)
  checkTable('clay-dark', { theme: 'clay-dark' }, DARK)
  // the scene remap is the same in either theme: test both
  checkTable('immersive in clay-dark', { theme: 'clay-dark', scene: 'immersive' }, IMMERSIVE)
  checkTable('immersive in clay-light', { theme: 'clay-light', scene: 'immersive' }, IMMERSIVE)

  describe('fills and inverted pairs', () => {
    const light = tokens({ theme: 'clay-light' })
    const dark = tokens({ theme: 'clay-dark' })
    const pairs: [string, string, string, number][] = [
      ['primary button text on the accent fill', light['--accent-on'], light['--accent-fill'], 5.23],
      ['primary button text on the hover fill', light['--accent-on'], light['--accent-fill-hover'], 5.95],
      ['selected segment, light', light['--selected-ink'], light['--selected-fill'], 16.12],
      ['selected segment, dark', dark['--selected-ink'], dark['--selected-fill'], 14.83],
      ['text on a measured fill, dark', dark['--accent-on'], dark['--state-measured'], 11.67],
      ['text on a simulated fill, dark', dark['--accent-on'], dark['--state-simulated'], 10.07],
      ['text on a fault fill, dark', dark['--accent-on'], dark['--state-fault'], 6.42],
      ['text on a measured fill, light', light['--selected-ink'], light['--state-measured'], 5.58],
      ['text on a simulated fill, light', light['--selected-ink'], light['--state-simulated'], 5.93],
      ['text on a fault fill, light', light['--selected-ink'], light['--state-fault'], 5.88],
    ]
    it.each(pairs)('%s', (_n, fg, bg, want) => {
      const got = ratio(fg, bg)
      expect(got).toBeGreaterThanOrEqual(TEXT)
      expect(near(got, want), `computed ${got.toFixed(3)}, spec ${want}`).toBe(true)
    })
  })

  describe('forbidden by design: reported, never relied on', () => {
    const light = tokens({ theme: 'clay-light' })
    const dark = tokens({ theme: 'clay-dark' })
    it('the accent fill on the light ground is 2.83:1 and on raised about 3.08: it fails alone, so the kit always adds an ink edge and a label', () => {
      expect(near(ratio(light['--accent-fill'], light['--surface-ground']), 2.83)).toBe(true)
      expect(ratio(light['--accent-fill'], light['--surface-ground'])).toBeLessThan(EDGE)
      expect(Math.abs(ratio(light['--accent-fill'], light['--surface-raised']) - 3.08)).toBeLessThan(0.02)
    })
    it('--ink-off is exempt from 4.5 and reported at 2.75 (light) and 3.48 (dark)', () => {
      expect(near(ratio(light['--ink-off'], light['--surface-ground']), 2.75)).toBe(true)
      expect(near(ratio(dark['--ink-off'], dark['--surface-ground']), 3.48)).toBe(true)
    })
    it('--edge-hair is decorative at 1.41 (light) and 1.50 (dark), never the only boundary of a control', () => {
      expect(near(ratio(light['--edge-hair'], light['--surface-ground']), 1.41)).toBe(true)
      expect(near(ratio(dark['--edge-hair'], dark['--surface-ground']), 1.5)).toBe(true)
    })
  })

  describe('--state-planned and --state-waiting are re-declared per scene, not inherited from the root (the computed-value gotcha)', () => {
    it.each([['clay-light'], ['clay-dark']] as const)('in %s, inside an immersive scene, both equal that scene\'s --ink-3', (theme) => {
      const t = tokens({ theme, scene: 'immersive' })
      expect(t['--state-planned']).toBe(t['--ink-3'])
      expect(t['--state-waiting']).toBe(t['--ink-3'])
      expect(t['--focus-ring']).toBe(t['--ink-1'])
    })
  })
})

// ------------------------------------------------------------------ 2. scene grounds, 6.3.4
describe('JARVIS and focus scene grounds (spec 6.3.4)', () => {
  // [label, page, ground token or hex, ink-1, ink-3, edge-ui, measured, simulated, fault]
  const rows: [string, Page, number[]][] = [
    ['core', { theme: 'clay-dark', section: 'core', scene: 'immersive' }, [15.76, 7.05, 4.78, 12.4, 10.69, 6.82]],
    ['senses', { theme: 'clay-dark', section: 'senses', scene: 'immersive' }, [16.2, 7.24, 4.91, 12.74, 10.99, 7.01]],
    ['console', { theme: 'clay-dark', section: 'console', scene: 'immersive' }, [16.49, 7.38, 5.0, 12.97, 11.19, 7.13]],
    ['focus session', { theme: 'clay-dark', section: 'focus', scene: 'immersive' }, [15.39, 6.88, 4.67, 12.11, 10.44, 6.66]],
  ]
  it.each(rows)('%s', (_n, page, want) => {
    const t = tokens(page)
    const names = ['--ink-1', '--ink-3', '--edge-ui', '--state-measured', '--state-simulated', '--state-fault']
    names.forEach((n, i) => {
      const got = ratio(t[n], t['--surface-ground'])
      expect(got, `${_n} ${n}`).toBeGreaterThanOrEqual(n === '--edge-ui' ? EDGE : TEXT)
      expect(near(got, want[i]), `${_n} ${n}: computed ${got.toFixed(3)}, spec ${want[i]}`).toBe(true)
    })
  })
  it('the room faceplate is a dark panel under the immersive ink set (13.42, 6.00, 4.07, 10.55, 9.10, 5.80)', () => {
    const page = tokens({ theme: 'clay-light', scene: 'immersive' })
    const root = tokens({ theme: 'clay-light' })
    const plate = root['--surface-faceplate']
    const want = [13.42, 6.0, 4.07, 10.55, 9.1, 5.8]
    ;['--ink-1', '--ink-3', '--edge-ui', '--state-measured', '--state-simulated', '--state-fault'].forEach((n, i) => {
      expect(near(ratio(page[n], plate), want[i]), `${n}: ${ratio(page[n], plate).toFixed(3)}`).toBe(true)
    })
  })
  it('the memory paper is a light scene under the light tokens (14.04, 5.16, 3.82)', () => {
    const t = tokens({ theme: 'clay-light' })
    const paper = t['--surface-paper']
    expect(near(ratio(t['--ink-1'], paper), 14.04)).toBe(true)
    expect(near(ratio(t['--ink-3'], paper), 5.16)).toBe(true)
    expect(near(ratio(t['--edge-ui'], paper), 3.82)).toBe(true)
  })
  it('the immersive grounds differ by well under 1.1:1: a scene is a mood, not information', () => {
    const g = rows.map(([, p]) => tokens(p)['--surface-ground'])
    for (const a of g) for (const b of g) expect(ratio(a, b)).toBeLessThan(1.1)
  })
})

// ------------------------------------------------------------------ 3. section themes, 6.3.5 and 6.3.6
const ALLOWED_SECTION_NAMES = ['--sec-mark', '--sec-art-1', '--sec-art-2', '--sec-art-3', '--sec-scene', '--r-control', '--r-panel', '--tempo', '--spring-main', '--type-kicker']
describe('section themes (layer 3)', () => {
  const css = (id: string) => read(join(SECTIONS, `${id}.css`))
  it('there are eleven files: the ten spec sections plus proof (Well Wisher), one scoped rule each, nothing else', () => {
    expect(readdirSync(SECTIONS).filter((f) => f !== 'index.css').sort()).toEqual(SECTION_IDS.map((i) => `${i}.css`).sort())
  })
  it.each(SECTION_IDS.map((i) => [i]))('%s declares only allow-listed names (6.2.4) and is scoped to [data-section] under a clay theme', (id) => {
    const rules = parseCss(css(id)).rules
    expect(rules.length).toBeGreaterThanOrEqual(1)
    for (const r of rules) {
      for (const s of r.selectors) expect(s, id).toMatch(new RegExp(`^:root\\[data-theme(\\^=|=)'clay-[a-z]*'\\] \\[data-section='${id}'\\]$`))
      for (const k of Object.keys(r.decls)) expect(ALLOWED_SECTION_NAMES, `${id} declares ${k}`).toContain(k)
    }
  })
  it('no section declares --type-kicker: Well Wisher already uses that name as a COLOUR (.ww-kicker), the spec as a font; B05/B11 decide', () => {
    for (const id of SECTION_IDS) expect(css(id)).not.toMatch(/--type-kicker\s*:/)
  })
  it('--sec-scene follows the spec: core, senses and console immersive; every other section light', () => {
    for (const id of SECTION_IDS) {
      const want = ['core', 'senses', 'console'].includes(id) ? 'immersive' : 'light'
      expect(tokens({ theme: 'clay-light', section: id })['--sec-scene'], id).toBe(want)
    }
  })
  it('the section shapes and tempos follow 6.3.6', () => {
    const want: Record<string, [string, string, string]> = {
      core: ['2px', '2px', '0.67'], senses: ['2px', '2px', '0.67'], room: ['10px', '2px', '0.5'], memory: ['2px', '2px', '0.67'], console: ['0', '0', '0.5'],
      day: ['10px', '14px', '1'], study: ['10px', '14px', '1'], tree: ['10px', '14px', '1'], career: ['10px', '14px', '1'], proof: ['10px', '14px', '1'], focus: ['10px', '14px', '1'],
    }
    for (const [id, [c, p, tempo]] of Object.entries(want)) {
      const t = tokens({ theme: 'clay-light', section: id })
      expect([t['--r-control'], t['--r-panel'], t['--tempo']], id).toEqual([c, p, tempo])
    }
  })
  it('the product layer sets the silhouette and tempo and nothing else', () => {
    const j = tokens({ theme: 'clay-dark', product: 'jarvis' })
    const w = tokens({ theme: 'clay-light', product: 'ww' })
    expect([j['--r-control'], j['--r-panel'], j['--tempo']]).toEqual(['2px', '2px', '0.67'])
    expect([w['--r-control'], w['--r-panel'], w['--tempo']]).toEqual(['10px', '14px', '1'])
    const decls = parseCss(read(join(CLAY, 'products.css'))).rules.flatMap((r) => Object.keys(r.decls))
    for (const k of decls) expect(['--r-control', '--r-panel', '--tempo']).toContain(k)
  })

  // marks: text-safe (4.5) on ground, raised and sunk of the theme they sit in
  const MARK_WANT: Record<string, { light?: number[]; dark?: number[] }> = {
    day: { light: [5.63, 6.12, 4.94], dark: [7.89, 6.85] },
    study: { light: [5.56, 6.04, 4.88], dark: [8.71, 7.57] },
    tree: { light: [5.8, 6.3, 5.09], dark: [9.04, 7.85] },
    focus: { light: [14.83, 16.12, 13.01], dark: [14.83, 12.89] },
    proof: { light: [6.99, 7.6, 6.14], dark: [8.97, 7.79] },
  }
  describe.each(SECTION_IDS.filter((i) => !['core', 'senses', 'console'].includes(i)).map((i) => [i]))('mark of %s in the chrome themes', (id) => {
    it.each([['clay-light'], ['clay-dark']] as const)('%s: --sec-mark clears 4.5 on ground, raised and sunk', (theme) => {
      const t = tokens({ theme, section: id })
      SURFACES.forEach((s) => expect(ratio(t['--sec-mark'], t[s]), `${id} ${theme} on ${s}`).toBeGreaterThanOrEqual(TEXT))
      const want = MARK_WANT[id]?.[theme === 'clay-light' ? 'light' : 'dark']
      if (want) want.forEach((w, i) => expect(near(ratio(t['--sec-mark'], t[SURFACES[i]]), w), `${id} ${theme} on ${SURFACES[i]}: ${ratio(t['--sec-mark'], t[SURFACES[i]]).toFixed(3)} vs ${w}`).toBe(true))
    })
  })
  it('the immersive sections mark with ink-1 on their own charcoal', () => {
    for (const id of ['core', 'senses', 'console'] as const) {
      const t = tokens({ theme: 'clay-dark', section: id, scene: 'immersive' })
      expect(t['--sec-mark'], id).toBe(t['--ink-1'])
      expect(ratio(t['--sec-mark'], t['--surface-ground']), id).toBeGreaterThanOrEqual(TEXT)
    }
  })
  it('the day mark on the immersive scene is 8.38:1 (the spec prints it for a dark scene)', () => {
    const dark = tokens({ theme: 'clay-dark', section: 'day' })['--sec-mark']
    expect(near(ratio(dark, tokens({ theme: 'clay-dark', section: 'core', scene: 'immersive' })['--surface-ground']), 8.38)).toBe(true)
  })

  describe('art: 3:1 for every shape that carries information, and the decorative ones named', () => {
    const light = tokens({ theme: 'clay-light' })['--surface-ground']
    const meaningful: [string, Page, string, number, number][] = [
      // [what, page, art token, ground, spec ratio]
      ['day sun', { theme: 'clay-light', section: 'day' }, '--sec-art-1', 0, 3.42],
      ['study contour', { theme: 'clay-light', section: 'study' }, '--sec-art-1', 0, 5.56],
      ['tree trunk', { theme: 'clay-light', section: 'tree' }, '--sec-art-1', 0, 5.8],
      ['career towers', { theme: 'clay-light', section: 'career' }, '--sec-art-1', 0, 5.34],
      ['senses orbit', { theme: 'clay-dark', section: 'senses', scene: 'immersive' }, '--sec-art-1', 0, 16.2],
      ['core voice dots', { theme: 'clay-dark', section: 'core', scene: 'immersive' }, '--sec-art-1', 0, 15.76],
      ['focus elapsed dot', { theme: 'clay-dark', section: 'focus', scene: 'immersive' }, '--sec-art-1', 0, 15.39],
      ['focus remaining dot', { theme: 'clay-dark', section: 'focus', scene: 'immersive' }, '--sec-art-2', 0, 3.66],
    ]
    it.each(meaningful.map((m) => [m[0], m] as const))('%s', (_n, [, page, name, , spec]) => {
      const t = tokens(page)
      const ground = page.scene ? t['--surface-ground'] : light
      const got = ratio(t[name], ground)
      expect(got).toBeGreaterThanOrEqual(EDGE)
      expect(near(got, spec), `computed ${got.toFixed(3)}, spec ${spec}`).toBe(true)
    })
    it('the core ghost ring is decorative at 1.76:1 and carries no data', () => {
      const t = tokens({ theme: 'clay-dark', section: 'core', scene: 'immersive' })
      expect(near(ratio(t['--sec-art-3'], t['--surface-ground']), 1.76)).toBe(true)
    })
    it('a section art colour that is a hue is used by at most three sections plus career (day, study, tree; career brick is art only)', () => {
      const hue = (v: string) => /--p-(ochre|teal|moss|brick|cyan)/.test(v)
      const withHueMark = SECTION_IDS.filter((id) => hue(parseCss(read(join(SECTIONS, `${id}.css`))).rules[0].decls['--sec-mark']))
      expect(withHueMark.sort()).toEqual(['day', 'study', 'tree'])
    })
  })
})

// ------------------------------------------------------------------ 4. more contrast, 6.5.1
describe('prefers-contrast: more and data-contrast="high"', () => {
  const rows: [string, Page][] = [
    ['clay-light', { theme: 'clay-light' }],
    ['clay-dark', { theme: 'clay-dark' }],
    ['immersive in clay-light', { theme: 'clay-light', scene: 'immersive' }],
    ['immersive in clay-dark', { theme: 'clay-dark', scene: 'immersive' }],
  ]
  it.each(rows)('%s: ink-3 and edge-ui take the ink-2 value, edge-hair takes edge-ui, and every pair still passes', (_n, page) => {
    for (const mode of ['attr', 'os'] as const) {
      const base = tokens(page)
      const t = tokens({ ...page, contrast: mode })
      expect(t['--ink-3'], `${_n} ${mode}`).toBe(base['--ink-2'])
      expect(t['--edge-ui']).toBe(base['--ink-2'])
      expect(t['--edge-hair']).toBe(t['--edge-ui'])
      for (const s of SURFACES) {
        expect(ratio(t['--ink-3'], t[s]), `${_n} ${mode} ink-3 on ${s}`).toBeGreaterThanOrEqual(TEXT)
        expect(ratio(t['--edge-ui'], t[s]), `${_n} ${mode} edge-ui on ${s}`).toBeGreaterThanOrEqual(EDGE)
      }
    }
  })
  it('the headline numbers: 6.99 on the light ground and 8.97 on the dark ground', () => {
    const l = tokens({ theme: 'clay-light', contrast: 'os' })
    const d = tokens({ theme: 'clay-dark', contrast: 'os' })
    expect(near(ratio(l['--ink-3'], l['--surface-ground']), 6.99)).toBe(true)
    expect(near(ratio(d['--ink-3'], d['--surface-ground']), 8.97)).toBe(true)
  })
  it('the in-app switch and the OS setting resolve to exactly the same tokens, with and without a section', () => {
    for (const [, page] of rows) for (const sec of [undefined, 'day']) {
      const p = { ...page, ...(sec ? { section: sec } : {}) }
      expect(tokens({ ...p, contrast: 'attr' })).toEqual(tokens({ ...p, contrast: 'os' }))
    }
  })
  it('recessed and pressed drop to edge-only, decorative layers are hidden, accent-ink on light stays #a8300f', () => {
    const t = tokens({ theme: 'clay-light', contrast: 'attr' })
    expect(t['--elev-recessed']).toBe('none')
    expect(t['--elev-pressed']).toBe('none')
    expect(t['--decor-opacity']).toBe('0')
    expect(t['--accent-ink']).toBe('#a8300f')
    expect(near(ratio(t['--accent-ink'], t['--surface-ground']), 5.62)).toBe(true)
    expect(tokens({ theme: 'clay-light' })['--decor-opacity']).toBeUndefined()
  })
  it('a section mark becomes ink-1', () => {
    for (const mode of ['attr', 'os'] as const) {
      const t = tokens({ theme: 'clay-dark', section: 'day', contrast: mode })
      expect(t['--sec-mark']).toBe(t['--ink-1'])
    }
  })
})

// ------------------------------------------------------------------ 5. forced colours, 6.5.1
describe('forced-colors: active', () => {
  const COLOUR_ROLES: Record<string, string> = {
    '--surface-ground': 'Canvas', '--surface-raised': 'Canvas', '--surface-sunk': 'Canvas', '--surface-paper': 'Canvas', '--surface-faceplate': 'Canvas',
    '--ink-1': 'CanvasText', '--ink-2': 'CanvasText', '--ink-3': 'CanvasText', '--ink-off': 'GrayText',
    '--edge-ui': 'CanvasText', '--edge-hair': 'ButtonBorder',
    '--accent-fill': 'ButtonFace', '--accent-on': 'ButtonText', '--accent-fill-hover': 'ButtonFace', '--accent-ink': 'CanvasText',
    '--state-measured': 'CanvasText', '--state-simulated': 'CanvasText', '--state-fault': 'CanvasText', '--state-planned': 'CanvasText', '--state-waiting': 'CanvasText',
    '--selected-fill': 'Highlight', '--selected-ink': 'HighlightText', '--focus-ring': 'Highlight',
    // craft round two (14 Nov): the accent as a state fill and the 2 percent lighter hover face
    '--accent-state': 'Highlight', '--surface-raised-hi': 'Canvas',
  }
  const pages: [string, Page][] = [
    ['clay-light', { theme: 'clay-light' }],
    ['clay-dark', { theme: 'clay-dark' }],
    ['immersive core in clay-dark', { theme: 'clay-dark', section: 'core', scene: 'immersive' }],
    ['immersive senses in clay-light', { theme: 'clay-light', section: 'senses', scene: 'immersive' }],
    ['immersive focus in clay-light', { theme: 'clay-light', section: 'focus', scene: 'immersive' }],
    ['dark day section', { theme: 'clay-dark', section: 'day' }],
  ]
  it.each(pages)('%s: every colour role is a system colour (the scene stops being charcoal, the section grounds lose)', (_n, page) => {
    const t = tokens({ ...page, forced: true })
    for (const [k, v] of Object.entries(COLOUR_ROLES)) expect(t[k], `${_n} ${k}`).toBe(v)
    expect(t['--scrim']).toBe('color-mix(in srgb, Canvas 80%, transparent)')
    for (const e of ['--elev-raised', '--elev-recessed', '--elev-pressed', '--elev-float']) expect(t[e], e).toBe('none')
  })
  it('every colour role the clay layer defines is covered by the forced map (a new role cannot be forgotten)', () => {
    const roles = new Set<string>()
    for (const f of ['semantic.css', 'scene.css']) for (const r of parseCss(read(join(CLAY, f))).rules) for (const k of Object.keys(r.decls)) if (/^--(surface|ink|edge|accent|state|selected|focus|scrim)-?/.test(k)) roles.add(k)
    const covered = new Set([...Object.keys(COLOUR_ROLES), '--scrim'])
    for (const r of roles) expect(covered.has(r), `${r} has no forced-colours mapping`).toBe(true)
  })
  it('the section mark and the art pair become CanvasText and Canvas', () => {
    const t = tokens({ theme: 'clay-dark', section: 'day', forced: true })
    expect([t['--sec-mark'], t['--art-ink'], t['--art-ground']]).toEqual(['CanvasText', 'CanvasText', 'Canvas'])
    const n = tokens({ theme: 'clay-light', section: 'day' })
    expect([n['--art-ink'], n['--art-ground']]).toEqual([n['--ink-1'], n['--surface-ground']])
  })
  it('contrast rules do not apply in forced colours, and forced.css names no colour literal', () => {
    const t = tokens({ theme: 'clay-light', contrast: 'attr', forced: true })
    expect(t['--ink-3']).toBe('CanvasText')
    expect(stripComments(read(join(CLAY, 'forced.css')))).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|gradient\(/)
  })
})

// ------------------------------------------------------------------ 6. lint over the new files
describe('lint over the clay and section files (the css-lint rules, applied to the new folders)', () => {
  const files = [...readdirSync(CLAY).filter((f) => f.endsWith('.css')).map((f) => join(CLAY, f)), ...readdirSync(SECTIONS).filter((f) => f.endsWith('.css')).map((f) => join(SECTIONS, f))]
  const body = (f: string) => stripComments(read(f))
  it('there are 23 files: 11 clay files, 11 section themes (the ten of the spec plus proof) and the section index', () => {
    expect(files).toHaveLength(11 + SECTION_IDS.length + 1)
  })
  it.each(files.map((f) => [f.replace(SRC, '').replace(/\\/g, '/'), f]))('%s: no colour literal outside primitive-color.css', (_n, f) => {
    if (f.endsWith('primitive-color.css')) return
    expect(body(f)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/)
    if (!f.endsWith('forced.css')) expect(body(f)).not.toMatch(/color-mix\(/)
  })
  it.each(files.map((f) => [f.replace(SRC, '').replace(/\\/g, '/'), f]))('%s: no !important, backdrop-filter, will-change, transition on shadow, animation, gradient or cursor: none', (_n, f) => {
    const t = body(f)
    expect(t).not.toMatch(/!important|backdrop-filter|will-change|cursor\s*:\s*none|gradient\(|@keyframes|\banimation\b/)
    expect(t).not.toMatch(/transition[^;{}]*box-shadow|transition(-property)?\s*:\s*all\b/)
    expect(t).not.toMatch(/outline\s*:\s*(none|0)\b/)
    expect(t).not.toMatch(/(^|[^\w-])\d*\.?\d+m?s\b(?!\w)/) // no literal duration: motion has its own tokens
  })
  it('every var() names a custom property declared in these files, or one of the three Well Wisher springs', () => {
    const declared = new Set(ALL_RULES.flatMap((r) => Object.keys(r.decls).filter((k) => k.startsWith('--'))))
    const external = new Set(['--spring-calm', '--spring-settle', '--spring-heavy'])
    for (const f of files) for (const m of body(f).matchAll(/var\((--[\w-]+)/g)) expect(declared.has(m[1]) || external.has(m[1]), `${f}: ${m[1]}`).toBe(true)
  })
  it('layer 2 never reads a section name, and a section file reads layer 1 or layer 2 only', () => {
    for (const f of ['semantic', 'scene', 'elevation', 'focus', 'type', 'products'].map((n) => join(CLAY, `${n}.css`))) {
      const t = body(f)
      if (!f.endsWith('products.css')) expect(t, f).not.toMatch(/var\(--sec-/)
    }
    for (const id of SECTION_IDS) expect(read(join(SECTIONS, `${id}.css`))).not.toMatch(/var\(--(sec|art)-/)
  })
  it('the elevation recipes have at most two shadow layers, and none transitions', () => {
    const rules = parseCss(read(join(CLAY, 'elevation.css'))).rules
    for (const r of rules) for (const [k, v] of Object.entries(r.decls)) {
      if (!k.startsWith('--elev-') || v === 'none') continue
      let depth = 0
      let layers = 1
      for (const ch of v) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (ch === ',' && depth === 0) layers++
      }
      expect(layers, `${k}: ${v}`).toBeLessThanOrEqual(2)
    }
  })
  it('the focus ring is a 2 px outline in --focus-ring at offset 2, with zero specificity, an inset form for bars, and never a box-shadow', () => {
    const t = body(join(CLAY, 'focus.css'))
    expect(t).toMatch(/:where\(:root\[data-theme='clay-light'\], :root\[data-theme='clay-dark'\]\) :focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);[^}]*outline-offset:\s*2px;/)
    expect(t).toMatch(/\[data-focus-inset\] :focus-visible\s*\{\s*outline-offset:\s*-2px;/)
    expect(t).not.toMatch(/box-shadow/)
    expect(t).toMatch(/scroll-padding:/)
    expect(tokens({ theme: 'clay-light' })['--focus-bleed']).toBe('4px')
  })
})

// ------------------------------------------------------------------ 7. type roles, 6.4.2
describe('type roles (spec 6.4.2)', () => {
  const t = tokens({ theme: 'clay-light' })
  const want: Record<string, [string, string, string, string]> = {
    // role: weight, size, line, family start
    '--type-display': ['400', '72px', '72px', "'Doto Variable'"],
    '--type-display-compact': ['400', '56px', '56px', "'Doto Variable'"],
    '--type-heading': ['600', '24px', '32px', "'Inter Variable'"],
    '--type-title': ['600', '18px', '24px', "'Inter Variable'"],
    '--type-read': ['400', '16px', '26px', "'Inter Variable'"],
    '--type-body': ['400', '14px', '20px', "'Inter Variable'"],
    '--type-small': ['400', '13px', '18px', "'Inter Variable'"],
    '--type-label': ['500', '12px', '16px', "'Geist Mono Variable'"],
    '--type-meta': ['400', '12px', '16px', "'Geist Mono Variable'"],
    '--type-log': ['400', '13px', '18px', "'Geist Mono Variable'"],
  }
  it.each(Object.entries(want))('%s resolves to weight, size / line and the right family', (name, [w, s, l, fam]) => {
    expect(t[name].startsWith(`${w} ${s} / ${l} ${fam}`), `${name}: ${t[name]}`).toBe(true)
  })
  it('nothing is under 12 px, headings are never mono, and the body line is 70ch at most', () => {
    for (const [name, v] of Object.entries(t)) if (name.startsWith('--type-') && /\d+px \//.test(v)) expect(parseInt(/(\d+)px \//.exec(v)![1], 10), name).toBeGreaterThanOrEqual(12)
    expect(t['--type-heading']).not.toMatch(/Mono/)
    expect(t['--type-title']).not.toMatch(/Mono/)
    expect(t['--type-read-measure']).toBe('70ch')
  })
  it('the corner roles: clay 14 px, sharp 2 px', () => {
    expect([t['--r-clay'], t['--r-sharp']]).toEqual(['14px', '2px'])
  })
})

// ------------------------------------------------------------------ 8. the Well Wisher mapping
describe('ww/design/themes/clay-map.ts', () => {
  it('maps paper to clay-light, ash to clay-dark and keeps indigo, for every Well Wisher theme id', () => {
    expect(Object.keys(WW_THEME_TO_CLAY).sort()).toEqual([...THEMES].sort())
    expect(WW_THEME_TO_CLAY).toEqual({ paper: 'clay-light', ash: 'clay-dark', indigo: 'indigo' })
    expect(clayThemeFor('paper')).toBe('clay-light')
  })
  it('first run is clay-dark for JARVIS and clay-light for Well Wisher (spec 6.1, F6)', () => {
    expect(FIRST_RUN_CLAY_THEME).toEqual({ jarvis: 'clay-dark', ww: 'clay-light' })
  })
  it('both clay themes it can produce have a theme block in semantic.css; indigo deliberately has none yet', () => {
    const css = read(join(CLAY, 'semantic.css'))
    for (const id of Object.values(WW_THEME_TO_CLAY)) if (id !== 'indigo') expect(css).toContain(`:root[data-theme='${id}']`)
    expect(css).not.toContain("data-theme='indigo'")
  })
})
