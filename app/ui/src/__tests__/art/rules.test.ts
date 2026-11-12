// B03c: the rules of spec 7.7 and 14 as text checks over the art folder. The CSS follows the same lint as the
// Well Wisher files (no colour literal, no px for type or spacing, no duration, no animation, no shadow, no
// will-change); the sources use no WebGL, no canvas, no eval, no innerHTML, no rAF loop, and every var(--token)
// the CSS reads is one the clay layers define (or carries a fallback), so a typo cannot ship as an unset property.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ART = resolve(__dirname, '..', '..', 'shared', 'art')
const STYLES = resolve(__dirname, '..', '..', 'styles')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const css = walk(ART).filter((f) => f.endsWith('.css'))
const src = walk(ART).filter((f) => /\.(ts|tsx)$/.test(f))

describe('the art stylesheet', () => {
  it('exists and is found', () => {
    expect(css.length).toBeGreaterThanOrEqual(1)
    expect(src.length).toBeGreaterThanOrEqual(18)
  })
  it.each(css)('%s: no colour literal, no px for type or spacing, no duration, no motion, no shadow', (f) => {
    const t = strip(read(f))
    expect(t).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|color-mix\(/)
    expect(t).not.toMatch(/!important|backdrop-filter|will-change|cursor\s*:\s*none|cubic-bezier\(/)
    expect(t).not.toMatch(/\b(transition|animation|animation-name|@keyframes|box-shadow|text-shadow|filter\s*:\s*drop-shadow)\b/)
    expect(t).not.toMatch(/(^|[^\w-])\d*\.?\d+m?s\b(?!\w)/) // a literal duration
    for (const m of t.matchAll(/(font-size|border-radius|padding[\w-]*|margin[\w-]*|gap|row-gap|column-gap)\s*:\s*([^;]+);/g)) {
      const px = (m[2].match(/(?<![\w.])(\d*\.?\d+)px/g) ?? []).filter((x) => x !== '0px' && x !== '1px')
      expect(px, `${m[1]}: ${m[2]}`).toEqual([])
    }
  })
  it('every var(--token) it reads is defined by the clay layers or has a fallback', () => {
    const defined = new Set<string>()
    for (const f of walk(STYLES).filter((x) => x.endsWith('.css')))
      for (const m of read(f).matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1])
    const missing: string[] = []
    for (const f of css)
      for (const m of strip(read(f)).matchAll(/var\((--[a-z0-9-]+)(,)?/g))
        if (!defined.has(m[1]) && !m[2]) missing.push(m[1])
    expect([...new Set(missing)]).toEqual([])
  })
  it('forced colours: every drawn shape class has a system-colour rule', () => {
    const t = strip(read(css[0]))
    const fc = t.slice(t.indexOf('@media (forced-colors: active)'))
    expect(fc.length).toBeGreaterThan(100)
    for (const cls of ['art-solid', 'art-stroke', 'art-poly', 'art-ridge-line', 'art-label', 'art-dither', 'art-recess']) expect(fc, cls).toContain(`.${cls}`)
    expect(fc).toMatch(/CanvasText/)
    expect(fc).toMatch(/Highlight/)
  })
  it('every focusable mark has a 2 px focus cue and a 44 px target', () => {
    const t = strip(read(css[0]))
    expect(t).toMatch(/\.art-node:focus-visible \.art-focusring[^}]*stroke-width:\s*2/)
    expect(t).toMatch(/\.art-hit\s*\{[^}]*fill:\s*transparent/)
    expect(t).toMatch(/\.art-day\s*\{[^}]*min-height:\s*var\(--hit/)
  })
})

describe('the art sources', () => {
  it.each(src.map((f) => [f.slice(ART.length + 1), f]))('%s: no WebGL, canvas, eval, innerHTML or animation-frame loop', (_n, f) => {
    const t = strip(read(f)).replace(/\/\/.*$/gm, '')
    expect(t).not.toMatch(/webgl|getContext\(|<canvas|new Function|\beval\(|dangerouslySetInnerHTML|\.innerHTML|requestAnimationFrame|localStorage|sessionStorage|fetch\(|XMLHttpRequest/i)
  })
  it('no source imports Well Wisher or JARVIS code (seam S1)', () => {
    for (const f of src) {
      for (const m of read(f).matchAll(/from\s+'([^']+)'/g)) {
        expect(m[1], f).not.toMatch(/\/ww\/|\/ww'|germoney|\/pages\/|galaxy|twin|\/jarvis\//)
      }
    }
  })
  it('the only setInterval is the bounded loop of hooks.ts; no setTimeout outside the sweep delay', () => {
    const uses = (re: RegExp) => src.filter((f) => re.test(strip(read(f)).replace(/\/\/.*$/gm, ''))).map((f) => f.slice(ART.length + 1))
    expect(uses(/setInterval\(/)).toEqual(['hooks.ts'])
    expect(uses(/setTimeout\(/)).toEqual(['ascii.tsx'])
  })
  it('every component root carries data-component (spec 7.7 rule 7)', () => {
    const names = ['node-ring', 'orbit', 'ring-bars', 'ridge', 'callout', 'spec', 'dot-timer', 'date-wheel', 'pillars-chart', 'week-strip', 'ascii-sweep', 'ascii-empty-state', 'stipple-ring', 'dither', 'dot-matrix-meter', 'cell-skeleton', 'blanking-plate']
    const all = src.map(read).join('\n')
    for (const n of names) expect(all, n).toContain(`"${n}"`)
  })
  it('no number is drawn without a state: ring bars, ridge, meter, stipple ring, pillars and timer require one', () => {
    for (const [file, iface] of [['RingBars.tsx', 'RingBarsProps'], ['Ridge.tsx', 'RidgeProps'], ['dots.tsx', 'DotMatrixMeterProps'], ['dots.tsx', 'StippleRingProps'], ['PillarsChart.tsx', 'PillarsChartProps'], ['DotTimer.tsx', 'DotTimerProps']] as const) {
      const t = read(join(ART, file))
      const body = t.slice(t.indexOf(`interface ${iface}`)).split('\n}')[0]
      expect(body, `${file} ${iface}`).toMatch(/\n\s*state: ArtState/)
    }
  })
})
