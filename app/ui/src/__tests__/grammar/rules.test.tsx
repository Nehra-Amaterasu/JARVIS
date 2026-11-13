// The rules every grammar component keeps (A.G02 accept lines and the engineering checklist of the quality bar):
// grammar.css has no literal colour, only one-shot animations, a reduced-motion and a calm form and a forced-colours
// branch; every component carries data-grammar; the grammar-use lint; every number on the gallery entry sits beside
// a lamp; and the contract exports all exist.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { mount } from '../ww/_stubs'
import * as G from '../../shared/grammar'
import { entry } from '../../shared/grammar/gallery'

const CSS = readFileSync(join(__dirname, '..', '..', 'shared', 'grammar', 'grammar.css'), 'utf8')
const SRC = join(__dirname, '..', '..')

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

describe('the contract exports (wave 5 table)', () => {
  it('every name of the G02 row exists with the right kind', () => {
    for (const fn of ['sigilSvg', 'Sigil', 'SigilFrame', 'GlyphRule', 'Seal', 'AsciiPlate', 'AsciiHeat', 'AsciiBar', 'AsciiPortrait', 'sparkline', 'TermWell', 'TermLine', 'BootSequence', 'ScanFrame']) {
      expect(typeof (G as Record<string, unknown>)[fn], fn).toBe('function')
    }
    expect(G.sigilSvg('x')).toMatch(/^<svg /)
    expect(typeof G.sparkline([1, 2])).toBe('string')
  })
  it('a typed line wraps on a phone instead of clipping its tail', () => {
    const mobile = CSS.slice(CSS.indexOf('@media (max-width: 899px)'))
    expect(mobile).toMatch(/\.g-line\[data-typed='true'\] > \.g-typed \{[^}]*white-space: pre-wrap;[^}]*inline-size: auto !important;[^}]*animation: none;/)
  })
  it('grammar.css declares the contract tokens', () => {
    for (const t of ['--term-ground', '--term-ink', '--sigil-w-1', '--sigil-w-2', '--sigil-w-3', '--bracket-arm', '--ascii-cell-w', '--ascii-cell-h']) {
      expect(CSS, t).toMatch(new RegExp(`${t}:`))
    }
  })
})

describe('grammar.css', () => {
  const noComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  it('holds no literal colour (hex lives in primitive-color.css only) and reads G01 tokens with fallbacks', () => {
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(noComments).not.toMatch(/\brgba?\(|\bhsla?\(/)
    // every var() of a role has a fallback, so the file renders before the clay layer is imported
    for (const v of noComments.matchAll(/var\((--(?:ink|edge|surface|state|accent|p)-[a-z0-9-]+)\)/g)) throw new Error(`no fallback: ${v[1]}`)
  })
  it('runs only one-shot animations: no infinite, at most 2 iterations, at most 5 s', () => {
    expect(noComments).not.toMatch(/infinite/)
    for (const a of noComments.matchAll(/animation:\s*([^;]+);/g)) {
      // removing an animation is not running one
      if (a[1].trim() === 'none !important' || a[1].trim() === 'none') continue
      const ms = [...a[1].matchAll(/(\d+)ms/g)].map((x) => Number(x[1]))
      expect(Math.max(...ms), a[1]).toBeLessThanOrEqual(5000)
      expect(a[1], a[1]).toMatch(/\s[12]\s/)
      expect(a[1], a[1]).toMatch(/backwards/)
    }
  })
  it('has a reduced-motion form, a calm form, a more-contrast form and a forced-colours branch', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(CSS).toMatch(/:root\[data-motion='calm'\]/)
    expect(CSS).toMatch(/@media \(prefers-contrast: more\)/)
    const forced = CSS.slice(CSS.indexOf('@media (forced-colors: active)'))
    expect(forced.length).toBeGreaterThan(100)
    for (const sel of ['.g-sigil', '.g-seal', '.g-rule', '.g-well', '.g-heat-cell', '.g-scan']) expect(forced, sel).toContain(sel)
    expect(forced).toMatch(/stroke: CanvasText/)
  })
})

describe('data-grammar and the grammar-use lint', () => {
  it('every grammar component carries data-grammar', () => {
    const lamp = <span />
    const cases = [
      [<G.Sigil seed="a" />, 'sigil'], [<G.SigilFrame />, 'sigil'], [<G.GlyphRule />, 'sigil'], [<G.Seal id="a" earned />, 'sigil'],
      [<G.AsciiPlate text="." />, 'ascii'], [<G.AsciiHeat cells={[1]} reading={lamp} />, 'ascii'], [<G.AsciiBar value={1} max={2} reading={lamp} />, 'ascii'],
      [<G.AsciiPortrait initials="A" />, 'ascii'], [<G.TermWell prompt="ww" />, 'terminal'], [<G.BootSequence rows={[]} onDone={() => {}} />, 'terminal'],
      [<G.ScanFrame label="x" state="waiting" />, 'terminal'],
    ] as const
    for (const [el, g] of cases) {
      m = mount(el)
      expect(m.container.firstElementChild!.getAttribute('data-grammar')!.split(' ')).toContain(g)
      m.unmount()
      m = null
    }
  })
  it('reports each data-view with the grammars it uses; two or more pass (reported in wave 5)', () => {
    m = mount(
      <div>
        <section data-view="a"><G.Sigil seed="a" /><G.TermWell prompt="ww a" /></section>
        <section data-view="b"><G.Sigil seed="b" /></section>
      </div>,
    )
    expect(G.grammarReport(m.container)).toEqual([
      { view: 'a', grammars: ['sigil', 'terminal'], ok: true },
      { view: 'b', grammars: ['sigil'], ok: false },
    ])
  })
})

describe('the gallery entry', () => {
  it('renders all five states, and every number shown sits beside a lamp', () => {
    expect(entry.states.map((s) => s.label)).toEqual(['Sigils', 'Seals', 'Frames and dividers', 'ASCII', 'Terminal'])
    m = mount(<div data-view="gallery.g02">{entry.states.map((s) => <section key={s.label}>{s.node}</section>)}</div>)
    for (const form of m.container.querySelectorAll('.g-bar, .g-heat, .gs-spark')) {
      expect(form.querySelector('[data-lamp]'), form.className).not.toBeNull()
    }
    // a terminal line is a reading too: a digit may stand only under the SIMULATED tag (a fixture under [LIVE] or
    // [FAULT] would show invented data as measured; the first sheet had "[LIVE] voice level 0.42")
    for (const line of m.container.querySelectorAll('.g-well .g-line, .g-boot-row')) {
      if (/[0-9]/.test(line.textContent ?? '')) expect(line.getAttribute('data-tag'), line.textContent ?? '').toBe('simulated')
    }
    // the sheet uses all three grammars
    expect(G.grammarReport(m.container)[0].grammars).toEqual(['sigil', 'ascii', 'terminal'])
    // no person's name as a seed: the sheet's seeds are ids with a dot or a single word
    expect(m.container.innerHTML).not.toMatch(/data-seed="[^"]*[A-Z ]/)
  })
})

describe('the atmosphere byte budget across the app (D-V2-4)', () => {
  it('every *.atmo.txt under src is within 8 KB, 6 a section and 90 KB in all', () => {
    const files: { name: string; section: string; bytes: number }[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n === 'node_modules') continue
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (n.endsWith('.atmo.txt')) files.push({ name: relative(SRC, p), section: relative(SRC, p).split(/[\\/]/)[0], bytes: statSync(p).size })
      }
    }
    walk(SRC)
    console.info(`atmosphere budget: ${files.length} files, ${files.reduce((n, f) => n + f.bytes, 0)} bytes`)
    expect(G.atmosphereBudget(files)).toEqual([])
  })
})
