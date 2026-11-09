/// <reference types="node" />
/**
 * A small CSS reader for the Well Wisher token tests: it parses the design files, applies the
 * cascade for a described page (theme, workspace, motion mode) and resolves var() the way a
 * browser would, so the contrast and motion tests recompute from the real files instead of from
 * numbers copied out of the plan. It understands only what the token files use: class and
 * attribute compounds, descendant combinators, :not([attr]), @media (prefers-reduced-motion).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WW_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../ww')
export const DESIGN_DIR = join(WW_DIR, 'design')

export const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/** Every .css file under a directory, recursively. */
export function cssFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...cssFiles(p))
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

/** base.css's @import list, in order, as absolute paths. */
export function designFilesInOrder(): string[] {
  const base = read(join(DESIGN_DIR, 'base.css'))
  return [...base.matchAll(/@import\s+'([^']+)'/g)].map((m) => resolve(DESIGN_DIR, m[1]))
}

export const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

export interface Rule {
  selectors: string[]
  decls: Record<string, string>
  media: string | null
  order: number
}
export interface Keyframes {
  name: string
  body: string
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

function parseDecls(body: string): Record<string, string> {
  const d: Record<string, string> = {}
  for (const part of splitTop(body, ';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    d[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return d
}

let counter = 0
export function parseCss(text: string, media: string | null = null, keyframes: Keyframes[] = []): { rules: Rule[]; keyframes: Keyframes[] } {
  const src = stripComments(text)
  const rules: Rule[] = []
  let i = 0
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++
    if (i >= src.length) break
    // @import and other statements
    if (src[i] === '@') {
      const semi = src.indexOf(';', i)
      const brace = src.indexOf('{', i)
      if (brace < 0 || (semi >= 0 && semi < brace)) {
        i = semi + 1
        continue
      }
    }
    const open = src.indexOf('{', i)
    if (open < 0) break
    const head = src.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    const body = src.slice(open + 1, j - 1)
    i = j
    if (head.startsWith('@keyframes')) keyframes.push({ name: head.replace('@keyframes', '').trim(), body })
    else if (head.startsWith('@media') || head.startsWith('@supports')) {
      const inner = parseCss(body, head, keyframes)
      rules.push(...inner.rules)
    } else if (head.startsWith('@')) continue
    else rules.push({ selectors: splitTop(head, ',').map((s) => s.trim()), decls: parseDecls(body), media, order: counter++ })
  }
  return { rules, keyframes }
}

// ---------------------------------------------------------------- cascade

export interface Page {
  /** attributes on <html> (data-ww is always added) */
  html?: Record<string, string>
  /** the centre's data-ws, if the element asked about is inside a workspace */
  ws?: string
  /** the OS asks for reduced motion */
  osReduce?: boolean
}
type El = { tag: string; classes: string[]; attrs: Record<string, string> }

function chainFor(page: Page, withCentre: boolean): El[] {
  const chain: El[] = [
    { tag: 'html', classes: [], attrs: { 'data-ww': '', ...(page.html ?? {}) } },
    { tag: 'div', classes: ['ww'], attrs: {} },
  ]
  if (withCentre) chain.push({ tag: 'div', classes: ['ww-centre'], attrs: page.ws ? { 'data-ws': page.ws } : {} })
  return chain
}

function matchCompound(comp: string, el: El): boolean {
  let rest = comp
  const tag = /^[a-z][a-z0-9]*/.exec(rest)
  if (tag) {
    if (tag[0] !== el.tag) return false
    rest = rest.slice(tag[0].length)
  }
  while (rest.length) {
    let m = /^\.([\w-]+)/.exec(rest)
    if (m) {
      if (!el.classes.includes(m[1])) return false
      rest = rest.slice(m[0].length)
      continue
    }
    m = /^:not\(\[([\w-]+)(?:=['"]([^'"]*)['"])?\]\)/.exec(rest)
    if (m) {
      const has = m[1] in el.attrs && (m[2] === undefined || el.attrs[m[1]] === m[2])
      if (has) return false
      rest = rest.slice(m[0].length)
      continue
    }
    m = /^\[([\w-]+)(?:=['"]([^'"]*)['"])?\]/.exec(rest)
    if (m) {
      if (!(m[1] in el.attrs)) return false
      if (m[2] !== undefined && el.attrs[m[1]] !== m[2]) return false
      rest = rest.slice(m[0].length)
      continue
    }
    return false // pseudo-classes and pseudo-elements: not part of a token cascade
  }
  return true
}

function matches(selector: string, chain: El[], idx: number): boolean {
  const comps = selector.split(/\s+/).filter(Boolean)
  const last = comps.length - 1
  if (!matchCompound(comps[last], chain[idx])) return false
  let e = idx - 1
  for (let k = last - 1; k >= 0; k--) {
    while (e >= 0 && !matchCompound(comps[k], chain[e])) e--
    if (e < 0) return false
    e--
  }
  return true
}

function specificity(sel: string): [number, number] {
  const b = (sel.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length
  const c = (sel.match(/(^|\s)[a-z][a-z0-9]*/g) ?? []).length
  return [b, c]
}

function mediaApplies(media: string | null, page: Page): boolean {
  if (media === null) return true
  if (media.includes('prefers-reduced-motion: reduce')) return !!page.osReduce
  return false
}

type Computed = Record<string, string>

function declaredAt(rules: Rule[], chain: El[], idx: number, page: Page): Computed {
  const hits: { spec: [number, number]; order: number; decls: Record<string, string> }[] = []
  for (const r of rules) {
    if (!mediaApplies(r.media, page)) continue
    let best: [number, number] | null = null
    for (const s of r.selectors) {
      if (matches(s, chain, idx)) {
        const sp = specificity(s)
        if (!best || sp[0] > best[0] || (sp[0] === best[0] && sp[1] > best[1])) best = sp
      }
    }
    if (best) hits.push({ spec: best, order: r.order, decls: r.decls })
  }
  hits.sort((a, b) => a.spec[0] - b.spec[0] || a.spec[1] - b.spec[1] || a.order - b.order)
  const out: Computed = {}
  for (const h of hits) for (const [k, v] of Object.entries(h.decls)) if (k.startsWith('--')) out[k] = v
  return out
}

function substitute(value: string, lookup: (name: string) => string | undefined): string | undefined {
  let guard = 0
  let v = value
  while (v.includes('var(') && guard++ < 60) {
    const start = v.lastIndexOf('var(')
    let depth = 0
    let end = start + 3
    for (; end < v.length; end++) {
      if (v[end] === '(') depth++
      if (v[end] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    const inner = v.slice(start + 4, end)
    const [name, ...fb] = splitTop(inner, ',')
    const got = lookup(name.trim())
    const repl = got ?? (fb.length ? fb.join(',').trim() : undefined)
    if (repl === undefined) return undefined
    v = v.slice(0, start) + repl + v.slice(end + 1)
  }
  return v
}

/** Computed custom properties of `.ww` (target 'root') or `.ww-centre` (target 'centre') for a page. */
export function computeTokens(cssText: string, page: Page, target: 'root' | 'centre'): Computed {
  const { rules } = parseCss(cssText)
  const chain = chainFor(page, target === 'centre')
  let inherited: Computed = {}
  for (let idx = 0; idx < chain.length; idx++) {
    const declared = declaredAt(rules, chain, idx, page)
    const resolved: Computed = {}
    const busy = new Set<string>()
    const get = (name: string): string | undefined => {
      if (name in declared) {
        if (name in resolved) return resolved[name]
        if (busy.has(name)) return undefined
        busy.add(name)
        const r = substitute(declared[name], get)
        busy.delete(name)
        if (r !== undefined) resolved[name] = r
        return r
      }
      return inherited[name]
    }
    const next: Computed = { ...inherited }
    for (const name of Object.keys(declared)) {
      const r = get(name)
      if (r === undefined) delete next[name]
      else next[name] = r
    }
    inherited = next
  }
  return inherited
}

// ---------------------------------------------------------------- colour

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 }
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 }
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const p = m[1].split(',').map((x) => Number(x.trim()))
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }
  }
  m = /^color-mix\(in srgb,(.+)\)$/.exec(s)
  if (m) {
    const parts = splitTop(m[1], ',').map((x) => x.trim())
    const one = (t: string) => {
      const pm = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(t)!
      return { c: parseColor(pm[1]), p: pm[2] === undefined ? undefined : Number(pm[2]) / 100 }
    }
    const A = one(parts[0])
    const B = one(parts[1])
    const pa = A.p ?? (B.p !== undefined ? 1 - B.p : 0.5)
    const pb = B.p ?? 1 - pa
    const a = A.c.a * pa + B.c.a * pb
    const ch = (k: 'r' | 'g' | 'b') => (a === 0 ? 0 : (A.c[k] * A.c.a * pa + B.c[k] * B.c.a * pb) / a)
    return { r: ch('r'), g: ch('g'), b: ch('b'), a }
  }
  throw new Error(`cannot parse colour: ${input}`)
}

/** Composite a (possibly translucent) colour over an opaque background. */
export function over(fg: RGBA, bg: RGBA): RGBA {
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 }
}

const lin = (v: number) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
export const luminance = (c: RGBA) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)

/** WCAG contrast ratio of fg (blended over bg first if translucent) on an opaque bg. */
export function contrast(fg: RGBA, bg: RGBA): number {
  const f = over(fg, bg)
  const a = luminance(f)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
