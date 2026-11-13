// The sigil grammar (spec 20.4.1, A.G02 accept lines): the same id gives the same bytes (golden file), n-fold
// symmetry holds point for point, every glyph stays within 60 segments and 3 KB, the id never reaches the markup,
// and the cache is bounded. Regenerate the golden file only on purpose: GRAMMAR_GOLDEN_WRITE=1 npx vitest run grammar
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { mount } from '../ww/_stubs'
import {
  GlyphRule, MAX_BYTES, MAX_SEGMENTS, PRIMITIVES, PRIMITIVE_NAMES, SIZE_BUDGET, Seal, Sigil, SigilFrame, fnv1a32, microPlan, mulberry32,
  sigilModel, sigilStats, sigilSvg, type SigilFold, type SigilSize,
} from '../../shared/grammar'
import { sigilCacheSize } from '../../shared/grammar/sigil/generate'
import { segmentsOf } from '../../shared/grammar/sigil/primitives'

const GOLDEN = join(__dirname, 'golden', 'sigils.json')
const SIZES: SigilSize[] = [16, 24, 48]
const ids = (n: number, p = 'id') => Array.from({ length: n }, (_, i) => `${p}.${i}`)
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

/** Every point of every path (M, L, Q, C control and end points, A end points), from the markup itself. */
function points(svg: string): [number, number][] {
  const out: [number, number][] = []
  for (const dm of svg.matchAll(/ d="([^"]*)"/g)) {
    // a full circle (M then two large arcs) is centred and symmetric by construction; its two end points are not
    const d = dm[1].replace(/M[^MA]*A[^A]* 0 1 1 [^A]*A[^A]* 0 1 1 [^MLQCAZ]*/g, '')
    for (const cm of d.matchAll(/([MLQCAZ])([^MLQCAZ]*)/g)) {
      const n = cm[2].trim() ? cm[2].trim().split(/\s+/).map(Number) : []
      if (cm[1] === 'A') out.push([n[5], n[6]])
      else for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]])
    }
  }
  return out
}

describe('hash and PRNG', () => {
  it('FNV-1a 32 matches the published vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42), b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('the 14 primitives', () => {
  it('are exactly the 14 of spec 20.4.1', () => {
    expect(PRIMITIVE_NAMES.sort()).toEqual(['arc', 'bracket', 'chain', 'circle', 'cross', 'diamond', 'hex', 'letters', 'spiral', 'stripes', 'thorn', 'ticks', 'tri', 'xmark'])
  })
  it('each draws something, within 12 segments, at every variant', () => {
    for (const n of PRIMITIVE_NAMES) for (const v of [0, 0.3, 0.6, 0.99]) {
      const segs = segmentsOf(PRIMITIVES[n].draw(1, 12, v))
      expect(segs, n).toBeGreaterThan(0)
      expect(segs, n).toBeLessThanOrEqual(12)
    }
  })
})

describe('sigilSvg: determinism and golden bytes', () => {
  it('gives the same bytes for the same id and options, call after call', () => {
    for (const id of ids(30)) for (const size of SIZES) expect(sigilSvg(id, { size })).toBe(sigilSvg(id, { size }))
  })
  it('gives different glyphs for different ids (no two of 200 equal at 48 px)', () => {
    const seen = new Set(ids(200, 'distinct').map((id) => sigilSvg(id)))
    expect(seen.size).toBe(200)
  })
  it('matches the golden file (40 ids x 3 sizes, plus full bytes of three)', () => {
    const now = {
      hashes: Object.fromEntries(ids(40, 'golden').flatMap((id) => SIZES.map((s) => [`${id}@${s}`, sha(sigilSvg(id, { size: s }))]))),
      full: Object.fromEntries(['day.today', 'tree.node.optics', 'core'].map((id) => [id, sigilSvg(id)])),
      seals: Object.fromEntries(['unit.waves', 'block.focus'].flatMap((id) => [[`${id}:earned`, sha(renderSeal(id, true))], [`${id}:hollow`, sha(renderSeal(id, false))]])),
    }
    if (process.env.GRAMMAR_GOLDEN_WRITE || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n')
    const gold = JSON.parse(readFileSync(GOLDEN, 'utf8'))
    expect(now).toEqual(gold)
  })
})
function renderSeal(id: string, earned: boolean) {
  return renderToStaticMarkup(<Seal id={id} earned={earned} />)
}

describe('symmetry', () => {
  it('every point has a partner rotated by 360/n degrees (fold 4, 6, 8; 60 seeds each)', () => {
    for (const fold of [4, 6, 8] as SigilFold[]) {
      for (const id of ids(60, `sym${fold}`)) {
        const svg = sigilSvg(id, { fold, size: 48 })
        expect(svg).toContain(`data-fold="${fold}"`)
        const pts = points(svg)
        const a = (2 * Math.PI) / fold
        const cs = Math.cos(a), sn = Math.sin(a)
        for (const [x, y] of pts) {
          const rx = 24 + (x - 24) * cs - (y - 24) * sn
          const ry = 24 + (x - 24) * sn + (y - 24) * cs
          const best = Math.min(...pts.map(([u, v]) => Math.hypot(u - rx, v - ry)))
          expect(best, `${id} fold ${fold}`).toBeLessThan(0.25)
        }
      }
    }
  })
  it('the seal is bilateral: every point has a mirror partner across the vertical axis', () => {
    for (const id of ids(30, 'seal')) {
      const pts = points(sigilSvgOfSeal(id))
      for (const [x, y] of pts) {
        const best = Math.min(...pts.map(([u, v]) => Math.hypot(u - (48 - x), v - y)))
        const bestRot = Math.min(...pts.map(([u, v]) => Math.hypot(u - (48 - x), v - (48 - y))))
        // n = 2: the dihedral copy mirrors across the axis, the rotation copy turns 180 degrees; one partner exists
        expect(Math.min(best, bestRot), id).toBeLessThan(0.25)
      }
    }
  })
})
function sigilSvgOfSeal(id: string) {
  return renderToStaticMarkup(<Seal id={id} earned />)
}

describe('budgets', () => {
  it('stays within the size budget, 60 segments and 3 KB for 300 ids at every size and fold', () => {
    let worstSeg = 0, worstBytes = 0
    for (const id of ids(300, 'budget')) for (const size of SIZES) for (const fold of [undefined, 4, 6, 8] as (SigilFold | undefined)[]) {
      const svg = sigilSvg(id, { size, fold })
      const st = sigilStats(svg)
      expect(st.segments).toBeLessThanOrEqual(SIZE_BUDGET[size])
      expect(st.segments).toBeLessThanOrEqual(MAX_SEGMENTS)
      expect(st.bytes).toBeLessThanOrEqual(MAX_BYTES)
      expect(st.segments).toBe(sigilModel(id, { size, fold }).segments)
      expect(st.segments).toBeGreaterThan(0)
      worstSeg = Math.max(worstSeg, st.segments)
      worstBytes = Math.max(worstBytes, st.bytes)
    }
    // measured on 13 Nov: worst 60 segments and about 1.9 KB; the bound is the spec's, the log is for the record
    console.info(`sigil budget: worst ${worstSeg} segments, ${worstBytes} bytes over 3600 glyphs`)
  })
  it('a seal stays within 60 segments and 3 KB too', () => {
    for (const id of ids(100, 'sealb')) for (const e of [true, false]) {
      const st = sigilStats(renderToStaticMarkup(<Seal id={id} earned={e} />))
      expect(st.segments).toBeLessThanOrEqual(MAX_SEGMENTS)
      expect(st.bytes).toBeLessThanOrEqual(MAX_BYTES)
    }
  })
  it('keeps the drawing inside the 48 view box with room for a 2 px stroke', () => {
    for (const id of ids(100, 'fit')) for (const size of SIZES) for (const [x, y] of points(sigilSvg(id, { size }))) {
      expect(Math.hypot(x - 24, y - 24)).toBeLessThanOrEqual(22.6)
    }
  })
  it('the in-memory cache is bounded (256 models) however many ids pass through', () => {
    for (const id of ids(600, 'flood')) sigilSvg(id, { size: 16 })
    expect(sigilCacheSize()).toBeLessThanOrEqual(256)
  })
})

describe('privacy and options', () => {
  it('never writes the id into the markup, only an 8-digit hash', () => {
    const name = 'Someone Private'
    const svg = sigilSvg(name)
    expect(svg).not.toContain('Someone')
    expect(svg).toMatch(/data-seed="[0-9a-f]{8}"/)
    m = mount(<Sigil seed={name} label="Person" />)
    expect(m.container.innerHTML).not.toContain('Someone')
  })
  it('honours fold, and ignores a fold that is not 2, 4, 6 or 8', () => {
    expect(sigilSvg('x', { fold: 6 })).toContain('data-fold="6"')
    m = mount(<Sigil seed="x" fold={5} />)
    expect(m.container.querySelector('svg')!.getAttribute('data-fold')).toBe(sigilModel('x').fold.toString())
  })
  it('growth draws more as the stage rises and never less (centre outward)', () => {
    for (const id of ids(40, 'grow')) {
      const segs = [0, 0.25, 0.5, 0.75, 1].map((stage) => sigilModel(id, { mode: 'growth', stage }).segments)
      for (let i = 1; i < segs.length; i++) expect(segs[i]).toBeGreaterThanOrEqual(segs[i - 1])
      expect(segs[4]).toBeGreaterThan(segs[0])
      expect(sigilModel(id, { mode: 'growth', stage: 1 }).segments).toBe(sigilModel(id).segments)
    }
  })
  it('a smaller size keeps the same fold as the big one (same id, same family)', () => {
    for (const id of ids(50, 'fam')) expect(sigilModel(id, { size: 16 }).fold).toBe(sigilModel(id, { size: 48 }).fold)
  })
})

describe('the 16 px micro glyph', () => {
  it('is n-fold symmetric point for point, like the big glyph (fold 4, 6, 8; 60 seeds each)', () => {
    for (const fold of [4, 6, 8] as SigilFold[]) for (const id of ids(60, `msym${fold}`)) {
      const pts = points(sigilSvg(id, { fold, size: 16 }))
      const a = (2 * Math.PI) / fold
      const cs = Math.cos(a), sn = Math.sin(a)
      for (const [x, y] of pts) {
        const rx = 24 + (x - 24) * cs - (y - 24) * sn
        const ry = 24 + (x - 24) * sn + (y - 24) * cs
        expect(Math.min(...pts.map(([u, v]) => Math.hypot(u - rx, v - ry))), `${id} fold ${fold}`).toBeLessThan(0.25)
      }
    }
  })
  it('is never a bare plus or asterisk: a frame, a centre or a terminal, at least two of them, on 500 ids', () => {
    for (const id of ids(500, 'micro')) {
      const mp = microPlan(id)
      const feats = (mp.frame !== 'none' ? 1 : 0) + (mp.core !== 'none' ? 1 : 0) + (mp.arm !== 'spoke' ? 1 : 0)
      expect(feats, id).toBeGreaterThanOrEqual(2)
      // a frameless star only with a terminal that is a filled shape (a blade, a tip or a dot), never T, fork or plain
      if (mp.frame === 'none') expect(['blade', 'tip', 'dot'], id).toContain(mp.arm)
      // and the markup is more than open straight strokes: a second weight, a fill, a curve, an arc or a closed shape
      const svg = sigilSvg(id, { size: 16 })
      const paths = svg.match(/<path /g)!.length
      expect(paths > 1 || /[QAZ]/.test(svg.match(/ d="([^"]*)"/)![1]), id).toBe(true)
    }
  })
  it('separates seeds: 300 ids give at least 60 distinct part plans (fold, layout, frame, terminal, centre)', () => {
    const sig = new Set(ids(300, 'mdist').map((id) => {
      const mp = microPlan(id)
      return `${sigilModel(id).fold}|${mp.layout}|${mp.frame}|${mp.arm}|${mp.core}`
    }))
    console.info(`micro glyph: ${sig.size} distinct part plans over 300 ids`)
    expect(sig.size).toBeGreaterThanOrEqual(60)
  })
  it('never draws a 4-fold ring of bent blades (a hooked cross)', () => {
    for (const id of ids(300, 'hook')) expect(microPlan(id, 4).arm).not.toBe('blade')
  })
  it('keeps the family: the terminal comes from the big glyph and the fold is the same', () => {
    for (const id of ids(50, 'mfam')) {
      expect(sigilModel(id, { size: 16 }).fold).toBe(sigilModel(id).fold)
      expect(sigilSvg(id, { size: 16 })).toContain(`data-seed="${sigilModel(id).seed}"`)
    }
  })
  it('grows centre first and never draws less as the stage rises', () => {
    for (const id of ids(40, 'mgrow')) {
      const segs = [0, 0.25, 0.5, 0.75, 1].map((stage) => sigilModel(id, { size: 16, mode: 'growth', stage }).segments)
      for (let i = 1; i < segs.length; i++) expect(segs[i]).toBeGreaterThanOrEqual(segs[i - 1])
      expect(segs[0]).toBeGreaterThan(0)
      expect(segs[4]).toBe(sigilModel(id, { size: 16 }).segments)
    }
  })
})

describe('Sigil component', () => {
  it('renders the same SVG as sigilSvg, attribute for attribute', () => {
    for (const id of ['day.today', 'core', 'tree.node.optics']) for (const size of SIZES) {
      const html = renderToStaticMarkup(<Sigil seed={id} size={size} />)
      const svg = html.slice(html.indexOf('<svg'), html.lastIndexOf('</svg>') + 6).replace(/><\/path>/g, '/>')
      expect(svg).toBe(sigilSvg(id, { size }))
    }
  })
  it('is decoration (aria-hidden) unless it is named, then an img with that name', () => {
    m = mount(<Sigil seed="a" />)
    const span = m.container.querySelector('.g-sigil')!
    expect(span.getAttribute('aria-hidden')).toBe('true')
    expect(span.getAttribute('role')).toBeNull()
    expect(span.getAttribute('data-grammar')).toBe('sigil')
    m.unmount()
    m = mount(<Sigil seed="a" label="Optics node" />)
    expect(m.container.querySelector('.g-sigil')!.getAttribute('role')).toBe('img')
    expect(m.container.querySelector('.g-sigil')!.getAttribute('aria-label')).toBe('Optics node')
  })
  it('marks the drawn form for CSS and keeps strokes non-scaling with the three weights', () => {
    m = mount(<Sigil seed="day.today" drawn />)
    expect(m.container.querySelector('.g-sigil')!.getAttribute('data-drawn')).toBe('true')
    for (const p of m.container.querySelectorAll('path[class^="sg-w"]')) {
      expect(p.getAttribute('vector-effect')).toBe('non-scaling-stroke')
      expect(['1', '1.5', '2']).toContain(p.getAttribute('stroke-width'))
      expect(p.getAttribute('pathLength')).toBe('1')
    }
  })
})

describe('Seal', () => {
  it('earned is a solid ring with a solid glyph; hollow is all dashed hairline, and says so', () => {
    m = mount(<Seal id="unit.waves" earned label="Unit finished" />)
    const e = m.container.querySelector('.g-seal')!
    expect(e.getAttribute('aria-label')).toBe('Unit finished: earned')
    expect(e.querySelector('.sg-w3')).not.toBeNull()
    m.unmount()
    m = mount(<Seal id="unit.waves" earned={false} label="Unit finished" />)
    const h = m.container.querySelector('.g-seal')!
    expect(h.getAttribute('aria-label')).toBe('Unit finished: not yet earned')
    expect(h.querySelectorAll('svg > path').length).toBe(1)
    expect(h.querySelector('svg > path')!.getAttribute('class')).toBe('sg-dash')
  })
  it('a simulated seal carries the SIMULATED lamp word, from the lamp table', () => {
    m = mount(<Seal id="p" earned simulated />)
    expect(m.container.textContent).toContain('SIMULATED')
    expect(m.container.querySelector('.g-seal')!.getAttribute('aria-label')).toContain('SIMULATED')
  })
})

describe('SigilFrame and GlyphRule', () => {
  it('a frame has four corner brackets and one ruler per named side; planned is dashed', () => {
    m = mount(<SigilFrame sides={['l', 'b', 'b']} planned><p>x</p></SigilFrame>)
    expect(m.container.querySelectorAll('.g-corner').length).toBe(4)
    expect([...m.container.querySelectorAll('.g-ruler')].map((r) => r.getAttribute('data-side'))).toEqual(['l', 'b'])
    expect(m.container.querySelector('.g-frame')!.getAttribute('data-planned')).toBe('true')
    expect(m.container.querySelector('p')!.textContent).toBe('x')
  })
  it('the divider is a separator with a diamond chain of 3 to 7, clamped, and one filled centre cell', () => {
    m = mount(<GlyphRule length={12} density={1} />)
    const sep = m.container.querySelector('[role="separator"]')!
    expect(sep).not.toBeNull()
    expect(sep.querySelector('.sg-fill')!.getAttribute('d')!.match(/M/g)!.length).toBe(1)
    const lines = sep.querySelector('.sg-w2')!.getAttribute('d')!
    // 6 outline diamonds (7 minus the filled one), 2 X marks of 2 strokes, 2 stripe blocks of 3 bars
    expect(lines.match(/Z/g)!.length).toBe(6)
    m.unmount()
    m = mount(<GlyphRule length={1} density={0} />)
    expect(m.container.querySelector('.sg-w2')!.getAttribute('d')!.match(/Z/g)!.length).toBe(2)
  })
})
