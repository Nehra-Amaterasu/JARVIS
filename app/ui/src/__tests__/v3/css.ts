// A small reader for the v3 token file and the v3 kit stylesheet, shared by the two v3 test files. It understands only what
// those two files use: comma selectors, @media and @supports wrappers, custom properties and var(). It is not a browser, and
// it does not pretend to be: the cascade between blocks is applied in the order the test names them (dark, light, off).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..')
export const TOKENS_PATH = join(SRC, 'styles', 'design', 'v3', 'glass.css')
export const KIT_PATH = join(SRC, 'shared', 'kit', 'glass.css')
export const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\r\n/g, '\n')
export const tokensCss = () => strip(readFileSync(TOKENS_PATH, 'utf8'))
export const kitCss = () => strip(readFileSync(KIT_PATH, 'utf8'))

export interface Rule {
  at: string[]
  selectors: string[]
  decls: Record<string, string>
}

function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  let depth = 0
  let cur = ''
  const flush = () => {
    const i = cur.indexOf(':')
    if (i > 0) out[cur.slice(0, i).trim()] = cur.slice(i + 1).trim()
    cur = ''
  }
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ';' && depth === 0) flush()
    else cur += ch
  }
  if (cur.trim()) flush()
  return out
}

/** Every rule outside @keyframes, with the @media and @supports preludes it sits in. */
export function parse(src: string, at: string[] = []): Rule[] {
  const text = src.replace(/@import[^;]*;/g, '')
  const out: Rule[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const head = text.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < text.length && depth) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const body = text.slice(open + 1, j - 1)
    if (head.startsWith('@')) {
      if (/^@(media|supports)/.test(head)) out.push(...parse(body, [...at, head]))
    } else {
      let d = 0
      let cur = ''
      const sels: string[] = []
      for (const ch of head) {
        if (ch === '(' || ch === '[') d++
        if (ch === ')' || ch === ']') d--
        if (ch === ',' && d === 0) {
          sels.push(cur.trim())
          cur = ''
        } else cur += ch
      }
      if (cur.trim()) sels.push(cur.trim())
      out.push({ at, selectors: sels, decls: decls(body) })
    }
    i = j
  }
  return out
}

export type TokenMap = Record<string, string>

/** Replace var(--x) and var(--x, fallback) until nothing is left to replace. */
export function resolve(value: string, map: TokenMap): string {
  let v = value
  for (let n = 0; n < 12 && /var\(/.test(v); n++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_m, name: string, fb?: string) => (map[name] !== undefined ? map[name] : fb ?? ''))
  }
  return v
}

/** The token values of a ground, with glass on or off, from the base blocks in file order (no media wrapper). */
export function tokens(ground: 'dark' | 'light', glass: 'on' | 'off'): TokenMap {
  const rules = parse(tokensCss()).filter((r) => r.at.length === 0)
  const has = (r: Rule, s: string) => r.selectors.includes(s)
  const pick = (pred: (r: Rule) => boolean) => rules.filter(pred)
  const layers = [
    ...pick((r) => has(r, "[data-look='v3']") && !!r.decls['--ground-rgb']),
    ...(ground === 'light' ? pick((r) => has(r, "[data-look='v3'][data-ground='light']")) : []),
    ...(glass === 'off' ? pick((r) => has(r, "[data-look='v3'][data-glass='off']")) : []),
    ...(glass === 'off' && ground === 'light' ? pick((r) => has(r, "[data-look='v3'][data-ground='light'][data-glass='off']")) : []),
  ]
  const raw: TokenMap = {}
  for (const r of layers) Object.assign(raw, r.decls)
  const out: TokenMap = {}
  for (const k of Object.keys(raw)) out[k] = resolve(raw[k], raw)
  return out
}

// ---------------------------------------------------------------------------------------------- colour

export type RGB = [number, number, number]
export function colour(v: string): { rgb: RGB; a: number } {
  const s = v.trim()
  // 28 Nov: the reset sets the glare, sheen and specular tokens to transparent (no gradient light on a surface)
  if (s === 'transparent') return { rgb: [0, 0, 0], a: 0 }
  const hex = /^#([0-9a-f]{6})$/i.exec(s)
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as RGB, a: 1 }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s)
  if (!m) throw new Error(`not a colour: ${v}`)
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) }
}
export const triple = (v: string): RGB => v.split(',').map((n) => Number(n.trim())) as RGB
/** `fg` at alpha `a` over an opaque `bg`. */
export const over = (fg: RGB, a: number, bg: RGB): RGB => fg.map((c, i) => c * a + bg[i] * (1 - a)) as RGB
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export const lum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
export const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
