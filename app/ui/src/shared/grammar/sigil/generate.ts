// The seed-glyph generator (spec 20.4.1): rule-based, no model. FNV-1a 32 of the id seeds mulberry32; a fold n,
// 3 to 5 primitives by weight on 2 to 3 concentric radii, rotated n times and mirrored for the dihedral forms,
// stopped at 60 segments. Same id, same options: same bytes (the golden test). The id itself never reaches the
// markup (a seed can be a person's name, and the repository is public): only its 8-digit hash does.
//
// Why a plan first and an emission second: every random draw happens in the plan, in a fixed order, before the
// size is known. A 16 px day cell and a 48 px empty state of the same id therefore share their primitives and
// differ only in how many outer layers fit the size's segment budget, so the small glyph reads as the big one.

import { fnv1a32, mulberry32, pickWeighted, seedHex } from './hash'
import { HEFT, PRIMITIVES, circleSub, segmentsOf, type Mark, type PrimitiveName, type Pt, type Seg, type Style, type Sub, type Weight } from './primitives'

export type SigilSize = 16 | 24 | 48
export type SigilFold = 2 | 4 | 6 | 8
export interface SigilOptions {
  size?: SigilSize
  fold?: SigilFold
  /** seed: the whole glyph. growth: only the core and the first `stage` share of the layers, centre outward. */
  mode?: 'seed' | 'growth'
  /** growth only, 0 to 1: the share of the layers drawn; the caller binds it to a real count, never a timer. */
  stage?: number
}

export const VIEW = 48
const C = VIEW / 2
/** The drawing stays inside this radius so the 2 px stroke never clips at the view box edge. */
const FIT = 22.4
export const MAX_SEGMENTS = 60
export const MAX_BYTES = 3072
/** Segment budget by display size: a 16 px cell cannot hold 60 strokes and still read. */
export const SIZE_BUDGET: Record<SigilSize, number> = { 16: 20, 24: 36, 48: MAX_SEGMENTS }
/** Primitive scale by size: small glyphs draw their primitives larger so a stroke is not lost in a pixel. */
const SIZE_SCALE: Record<SigilSize, number> = { 16: 1.6, 24: 1.25, 48: 1 }
const STROKE_PX: Record<Weight, string> = { 1: '1', 2: '1.5', 3: '2' }

interface LayerPlan { prim: PrimitiveName; r: number; phi: number; s: number; v: number; flip: boolean }
interface Plan {
  fold: SigilFold
  rot: number
  core: { prim: PrimitiveName; s: number; v: number } | null
  layers: LayerPlan[]
  /** Radial spines on every axis, from the inner radius to the outer one: they tie the layers into one glyph. */
  spine: { from: number; to: number } | null
  ring: 'solid' | 'dash' | null
}

const CORE: PrimitiveName[] = ['diamond', 'cross', 'hex', 'circle', 'xmark']
const CORE_W = [4, 2, 2, 2, 1]
/** The rotational order of each core primitive (circle: any; take the largest fold). */
const CORE_ORDER: Partial<Record<PrimitiveName, number>> = { diamond: 2, cross: 4, hex: 6, circle: 24, xmark: 4 }
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const BY_BAND: { names: PrimitiveName[]; w: number[] }[] = [
  { names: ['diamond', 'cross', 'tri', 'circle', 'xmark', 'stripes', 'hex'], w: [3, 2, 2, 2, 1, 1, 1] },
  { names: ['thorn', 'diamond', 'bracket', 'chain', 'tri', 'stripes', 'xmark', 'spiral', 'ticks', 'arc'], w: [4, 2, 2, 1, 2, 2, 1, 1, 1, 2] },
  { names: ['arc', 'ticks', 'letters', 'bracket', 'thorn', 'stripes', 'xmark', 'diamond', 'circle'], w: [3, 2, 2, 2, 3, 1, 1, 1, 1] },
]
/** The seal family (n = 2, bilateral): thorns first, the "chrome tribal" of C04-08. */
const SEAL_BAND: { names: PrimitiveName[]; w: number[] } = { names: ['thorn', 'spiral', 'diamond', 'xmark', 'chain', 'tri'], w: [6, 2, 2, 1, 1, 1] }

function plan(id: string, foldOpt: SigilFold | undefined, seal: boolean): Plan {
  const rnd = mulberry32(fnv1a32(id))
  // the fold is always drawn, even when it is overridden, so the rest of the stream does not shift
  const drawn = pickWeighted(rnd(), [4, 6, 8] as const, [4, 3, 2])
  const fold: SigilFold = seal ? 2 : (foldOpt ?? drawn)
  const step = (2 * Math.PI) / fold
  const rot = rnd() < 0.5 ? 0 : step / 2
  const coreDraw = rnd()
  const core = coreDraw < 0.12 ? null : { prim: pickWeighted(rnd(), CORE, CORE_W), s: 0.8 + rnd() * 0.4, v: rnd() }
  const bands = rnd() < 0.55 ? 3 : 2
  const radii = bands === 3 ? [6.5 + rnd() * 2, 12.5 + rnd() * 2, 18 + rnd() * 2] : [9 + rnd() * 2.5, 16.5 + rnd() * 2.5]
  const layers: LayerPlan[] = []
  for (let b = 0; b < bands; b++) {
    const band = seal ? SEAL_BAND : BY_BAND[bands === 3 ? b : b + 1]
    const extra = rnd() < 0.4 ? 2 : 1
    for (let j = 0; j < extra; j++) {
      const prim = pickWeighted(rnd(), band.names, band.w)
      const a = rnd()
      const phi = a < 0.5 ? 0 : a < 0.75 ? step / 2 : step * (0.15 + rnd() * 0.25)
      layers.push({ prim, r: radii[b] + (j ? 1.5 : 0), phi, s: 1.05 + rnd() * 0.5, v: rnd(), flip: rnd() < 0.62 })
    }
  }
  // 3 to 5 primitives in all (spec 20.4.1): the core counts as one
  const maxLayers = 5 - (core ? 1 : 0)
  if (layers.length > maxLayers) layers.length = maxLayers
  const spineDraw = rnd()
  const spine = spineDraw < 0.6 ? { from: radii[0] * 0.55, to: radii[radii.length - 1] + 1 } : null
  const ringDraw = rnd()
  const ring = ringDraw < 0.28 ? 'solid' : ringDraw < 0.46 ? 'dash' : null
  return { fold, rot, core, layers, spine, ring }
}

interface Placed { w: Weight; style: Style; subs: Sub[] }

/** Local frame at (theta, r), x flipped for the mirror copy, into view box coordinates. */
function place(marks: Mark[], theta: number, r: number, flip: boolean): Placed[] {
  const sn = Math.sin(theta), cs = Math.cos(theta)
  const tp = ([x, y]: Pt): Pt => {
    const xx = flip ? -x : x
    return [C + (r + y) * sn + xx * cs, C - (r + y) * cs + xx * sn]
  }
  const ts = (s: Seg): Seg => {
    switch (s.k) {
      case 'L': return { k: 'L', p: tp(s.p) }
      case 'Q': return { k: 'Q', c: tp(s.c), p: tp(s.p) }
      case 'C': return { k: 'C', c1: tp(s.c1), c2: tp(s.c2), p: tp(s.p) }
      case 'A': return { k: 'A', r: s.r, large: s.large, sweep: (flip ? 1 - s.sweep : s.sweep) as 0 | 1, p: tp(s.p) }
      default: return s
    }
  }
  return marks.map((m) => ({ w: m.w, style: m.style, subs: m.subs.map((u) => ({ m: tp(u.m), segs: u.segs.map(ts) })) }))
}

function copiesOf(l: LayerPlan, fold: number, mirror: boolean): { theta: number; flip: boolean }[] {
  const step = (2 * Math.PI) / fold
  const sym = PRIMITIVES[l.prim].sym
  const onAxis = l.phi < 1e-6
  const onHalf = Math.abs(l.phi - step / 2) < 1e-6
  const out: { theta: number; flip: boolean }[] = []
  for (let k = 0; k < fold; k++) {
    out.push({ theta: k * step + l.phi, flip: false })
    // a symmetric primitive on a mirror axis is its own mirror image: a second copy would only double the bytes
    if (mirror && !(sym && (onAxis || onHalf))) out.push({ theta: k * step - l.phi, flip: true })
  }
  return out
}

/** Every point (and arc radius) of a placed list scaled about the centre so the drawing fits FIT. */
function fitAll(list: Placed[], fitR: number = FIT): Placed[] {
  let maxR = 0
  const see = (p: Pt) => { maxR = Math.max(maxR, Math.hypot(p[0] - C, p[1] - C)) }
  for (const m of list) for (const u of m.subs) {
    see(u.m)
    for (const s of u.segs) {
      if (s.k === 'L' || s.k === 'A') see(s.p)
      else if (s.k === 'Q') { see(s.c); see(s.p) }
      else if (s.k === 'C') { see(s.c1); see(s.c2); see(s.p) }
    }
  }
  if (maxR <= fitR) return list
  const k = fitR / maxR
  const sp = ([x, y]: Pt): Pt => [C + (x - C) * k, C + (y - C) * k]
  const ss = (s: Seg): Seg => {
    switch (s.k) {
      case 'L': return { k: 'L', p: sp(s.p) }
      case 'Q': return { k: 'Q', c: sp(s.c), p: sp(s.p) }
      case 'C': return { k: 'C', c1: sp(s.c1), c2: sp(s.c2), p: sp(s.p) }
      case 'A': return { ...s, r: s.r * k, p: sp(s.p) }
      default: return s
    }
  }
  return list.map((m) => ({ ...m, subs: m.subs.map((u) => ({ m: sp(u.m), segs: u.segs.map(ss) })) }))
}

const num = (v: number): string => {
  const n = Math.round(v * 10) / 10
  return Object.is(n, -0) ? '0' : String(n)
}
const pt = (p: Pt) => `${num(p[0])} ${num(p[1])}`
function dOf(subs: Sub[]): string {
  let d = ''
  for (const u of subs) {
    d += `M${pt(u.m)}`
    for (const s of u.segs) {
      if (s.k === 'L') d += `L${pt(s.p)}`
      else if (s.k === 'Q') d += `Q${pt(s.c)} ${pt(s.p)}`
      else if (s.k === 'C') d += `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.p)}`
      else if (s.k === 'A') d += `A${num(s.r)} ${num(s.r)} 0 ${s.large} ${s.sweep} ${pt(s.p)}`
      else d += 'Z'
    }
  }
  return d
}

/** One drawn path of the model: the class, the presentation attributes in a fixed order, and the path data. */
export interface SigilPath { cls: string; attrs: [string, string][]; d: string }
export interface SigilModel { size: number; fold: number; seed: string; segments: number; paths: SigilPath[] }

function group(list: Placed[]): SigilPath[] {
  const keyOf = (m: Placed) => (m.style === 'fill' ? 'fill' : m.style === 'dash' ? 'dash' : `w${m.w}`)
  const order = ['w3', 'w2', 'w1', 'dash', 'fill']
  const buckets = new Map<string, Sub[]>()
  for (const m of list) {
    const k = keyOf(m)
    const b = buckets.get(k) ?? []
    b.push(...m.subs)
    buckets.set(k, b)
  }
  const out: SigilPath[] = []
  for (const k of order) {
    const subs = buckets.get(k)
    if (!subs || !subs.length) continue
    const d = dOf(subs)
    if (k === 'fill') out.push({ cls: 'sg-fill', attrs: [['fill', 'currentColor'], ['stroke', 'none']], d })
    else if (k === 'dash') out.push({ cls: 'sg-dash', attrs: [['stroke-width', '1'], ['stroke-dasharray', '1.5 2'], ['vector-effect', 'non-scaling-stroke']], d })
    else {
      const w = Number(k.slice(1)) as Weight
      out.push({ cls: `sg-${k}`, attrs: [['stroke-width', STROKE_PX[w]], ['vector-effect', 'non-scaling-stroke'], ['pathLength', '1']], d })
    }
  }
  return out
}

function emit(p: Plan, size: SigilSize, budget: number, layerCount: number, fitR: number): { placed: Placed[]; segments: number } {
  const scale = SIZE_SCALE[size]
  const placed: Placed[] = []
  let used = 0
  if (p.core) {
    // a core that is not itself n-fold (a diamond is 2-fold, a cross 4-fold) is laid n / gcd(order, n) times,
    // turned by 360/n each, so the union keeps the glyph's symmetry; the symmetry test checks every point
    const marks = PRIMITIVES[p.core.prim].draw(p.core.s * scale, 0, p.core.v)
    const turns = p.fold / gcd(CORE_ORDER[p.core.prim] ?? 1, p.fold)
    const cost = segmentsOf(marks) * turns
    if (used + cost <= budget) {
      for (let k = 0; k < turns; k++) placed.push(...place(marks, p.rot + (k * 2 * Math.PI) / p.fold, 0, false))
      used += cost
    }
  }
  if (p.spine && layerCount > 0) {
    const len = p.spine.to - p.spine.from
    const cost = p.fold
    if (used + cost <= budget) {
      for (let k = 0; k < p.fold; k++) placed.push(...place([{ w: 2, style: 'line', subs: [{ m: [0, 0], segs: [{ k: 'L', p: [0, len] }] }] }], p.rot + (k * 2 * Math.PI) / p.fold, p.spine.from, false))
      used += cost
    }
  }
  // the big size keeps every layer; 24 px keeps the two heaviest that fit and 16 px the heaviest that fits (drawn in
  // their own order), because ink, not position, is what survives a small size; growth keeps inner layers first
  const layers = p.layers.slice(0, layerCount)
  const keepN = size === 48 ? layers.length : size === 24 ? 2 : 1
  const indexed = layers.map((l, i) => ({ l, i, h: HEFT[l.prim] }))
  const ranked = size === 48 ? indexed : indexed.sort((a, b) => b.h - a.h || b.i - a.i)
  const chosen: { l: LayerPlan; i: number; copies: { theta: number; flip: boolean }[]; marks: Mark[] }[] = []
  let budgetLeft = budget - used
  for (const x of ranked) {
    if (chosen.length >= keepN) break
    const marks = PRIMITIVES[x.l.prim].draw(x.l.s * scale, x.l.r, x.l.v)
    const per = segmentsOf(marks)
    const extra = x.l.prim === 'letters' ? 2 : 0
    let copies = copiesOf(x.l, p.fold, x.l.flip)
    if (per * copies.length + extra > budgetLeft) copies = copiesOf(x.l, p.fold, false)
    if (per * copies.length + extra > budgetLeft) continue
    budgetLeft -= per * copies.length + extra
    chosen.push({ l: x.l, i: x.i, copies, marks })
  }
  let ringR = 0
  for (const c of chosen.sort((a, b) => a.i - b.i)) {
    for (const k of c.copies) placed.push(...place(c.marks, p.rot + k.theta, c.l.r, k.flip))
    used += segmentsOf(c.marks) * c.copies.length
    if (c.l.prim === 'letters') {
      // the lettered ring sits on a hairline circle just inside its runes
      placed.push({ w: 1, style: 'line', subs: [circleSub(C, C, c.l.r - 3)] })
      used += 2
    }
    ringR = Math.max(ringR, c.l.r)
  }
  if (used === 0) {
    // nothing fitted (no core, no layer that fits a 16 px cell): an n-fold cross of spokes, never an empty glyph
    for (let k = 0; k < p.fold; k++) placed.push(...place([{ w: 3, style: 'line', subs: [{ m: [0, 0], segs: [{ k: 'L', p: [0, 9] }] }] }], p.rot + (k * 2 * Math.PI) / p.fold, 3, false))
    used += p.fold
  }
  if (p.ring && size !== 16 && used + 2 <= budget) {
    placed.push({ w: 1, style: p.ring === 'dash' ? 'dash' : 'line', subs: [circleSub(C, C, Math.min(FIT, ringR + 5.5))] })
    used += 2
  }
  return { placed: fitAll(placed, fitR), segments: used }
}

const CACHE = new Map<string, SigilModel>()
const CACHE_MAX = 256
function cached(key: string, make: () => SigilModel): SigilModel {
  const hit = CACHE.get(key)
  if (hit) {
    CACHE.delete(key)
    CACHE.set(key, hit)
    return hit
  }
  const m = make()
  CACHE.set(key, m)
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string)
  return m
}
/** For tests: the cache is bounded (256 models) so a long session cannot grow it without limit. */
export const sigilCacheSize = () => CACHE.size

export function sigilModel(id: string, o: SigilOptions = {}): SigilModel {
  const size: SigilSize = o.size ?? 48
  const mode = o.mode ?? 'seed'
  const stage = Math.min(1, Math.max(0, o.stage ?? 1))
  const key = `s|${size}|${o.fold ?? ''}|${mode}|${mode === 'growth' ? stage : ''}|${id}`
  return cached(key, () => {
    const p = plan(id, o.fold, false)
    const n = mode === 'growth' ? Math.ceil(stage * p.layers.length) : p.layers.length
    const { placed, segments } = emit(p, size, SIZE_BUDGET[size], n, FIT)
    return { size, fold: p.fold, seed: seedHex(id), segments, paths: group(placed) }
  })
}

/** A seal: a closed ring plus the bilateral (n = 2) thorn glyph; hollow until earned. 32 px. */
export function sealModel(id: string, earned: boolean): SigilModel {
  return cached(`seal|${earned ? 1 : 0}|${id}`, () => {
    const p = plan(`seal:${id}`, 2, true)
    // the glyph lives inside the ring with a 4 px gap: fitted to 17 before the ring (2 segments) is laid round it
    const inner: Plan = { ...p, ring: null, layers: p.layers.map((l) => ({ ...l, r: l.r * 0.7 })) }
    const glyph = emit(inner, 48, MAX_SEGMENTS - 2, inner.layers.length, 17)
    // hollow (not yet earned): the same glyph as a dashed hairline, so the seal to come is visible but not claimed
    const drawn = earned ? glyph.placed : glyph.placed.map((m) => ({ w: 1 as Weight, style: 'dash' as Style, subs: m.subs }))
    const ring: Placed = { w: 3, style: earned ? 'line' : 'dash', subs: [circleSub(C, C, FIT)] }
    return { size: 32, fold: 2, seed: seedHex(id), segments: glyph.segments + 2, paths: group([ring, ...drawn]) }
  })
}

export function modelToSvg(m: SigilModel): string {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${m.size}" height="${m.size}" fill="none" stroke="currentColor" stroke-linecap="butt" stroke-linejoin="miter" aria-hidden="true" focusable="false" data-seed="${m.seed}" data-fold="${m.fold}">`
  const body = m.paths.map((p) => `<path class="${p.cls}" ${p.attrs.map(([k, v]) => `${k}="${v}"`).join(' ')} d="${p.d}"/>`).join('')
  return `${head}${body}</svg>`
}

/** The contract export: the SVG string of the seed glyph for an id. Pure, cached in memory by id and options. */
export function sigilSvg(id: string, o?: SigilOptions): string {
  return modelToSvg(sigilModel(id, o))
}

/** Segments and bytes of any sigil SVG string, read back from the markup (what the budget test measures). */
export function sigilStats(svg: string): { segments: number; bytes: number } {
  let segments = 0
  for (const m of svg.matchAll(/ d="([^"]*)"/g)) segments += (m[1].match(/[LQCAZ]/g) ?? []).length
  return { segments, bytes: new TextEncoder().encode(svg).length }
}
