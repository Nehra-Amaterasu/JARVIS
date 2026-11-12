// Wave 5, G01: the clay material recipe and the kit debt. What this file proves without a browser:
//   1  one PLANNED drawing: every planned glyph the kit, the lamp, the planned plate, the chip and the folder tab render
//      is the same ring from shared/lamp/PlannedGlyph, and no other source file draws a dashed ring;
//   2  the material tokens: both ridge lips are a real 3:1 edge on every surface they sit on, in light and dark, and
//      high contrast and forced colours turn the material into edges (tooth 0, lit lips transparent);
//   3  LitPanel: 8 quantised angles, a fixed angle stays put, and the pointer writes an attribute only on a new sector;
//   4  the *.planned.ts glob: collected in path order, lint-clean, merged into a registry without touching its source.
// The rendered side (hit areas, edges in pixels, forced colours, reflow, idle motion) is e2e/bench.spec.ts.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '../ww/_stubs'
import { FolderTabs, LIT_ANGLES, LampGlyph as KitGlyph, LitPanel, PLANNED_RING, PlannedGlyph, snapAngle } from '../../shared/kit'
import { LampGlyph as ContractGlyph } from '../../shared/lamp'
import { PlannedPlate } from '../../shared/planned/PlannedPlate'
import { PlannedChip } from '../../shared/planned/PlannedChip'
import { GLOBBED_PLANNED, collectPlanned, createRegistry, globbedFor, lintEntry, withGlobbed } from '../../shared/planned/registry'
import { isKnownHome } from '../../shared/planned/homes'
import type { PlannedEntry } from '../../shared/planned/types'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

const entry = (over: Partial<PlannedEntry> = {}): PlannedEntry => ({
  id: 'ww.thing', product: 'ww', home: 'study.library', label: 'A thing', pattern: 'coming', blocker: 'build',
  line: 'The thing is not built yet. The other thing works.', needs: 'Somebody to build it.', since: '2026-11-13', reviewBy: '2027-02-11', owner: 'ui-chat', ...over,
})

const ringOf = (svg: SVGSVGElement | null) => {
  const c = svg?.querySelector('circle')
  return c ? { r: c.getAttribute('r'), dash: c.getAttribute('stroke-dasharray'), w: c.getAttribute('stroke-width'), box: svg!.getAttribute('viewBox') } : null
}
const ONE = { r: String(PLANNED_RING.r), dash: PLANNED_RING.dash, w: String(PLANNED_RING.strokeWidth), box: '0 0 16 16' }

describe('one PLANNED drawing (PlannedGlyph)', () => {
  it('the kit lamp, the contract lamp, the plate, the chip and the folder tab all draw the same ring', () => {
    const found: Record<string, ReturnType<typeof ringOf>> = {}
    m = mount(<KitGlyph state="planned" />)
    found.kit = ringOf(m.container.querySelector('svg'))
    expect(m.container.querySelector('svg')!.getAttribute('data-shape')).toBe('dashed-ring')
    m.unmount()
    m = mount(<ContractGlyph state="planned" />)
    found.lamp = ringOf(m.container.querySelector('svg.lamp-glyph'))
    m.unmount()
    m = mount(<PlannedPlate entry={entry()} onOpen={() => {}} />)
    found.plate = ringOf(m.container.querySelector('svg'))
    m.unmount()
    m = mount(<PlannedChip registry={createRegistry([entry()])} home="study.library" onOpen={() => {}} />)
    found.chip = ringOf(m.container.querySelector('svg'))
    m.unmount()
    m = mount(<FolderTabs label="Views" value="a" onChange={() => {}} tabs={[{ id: 'a', label: 'One' }, { id: 'b', label: 'Later', planned: true }]} />)
    found.tab = ringOf(m.container.querySelector('svg.planned-glyph'))
    for (const [k, v] of Object.entries(found)) expect(v, k).toEqual(ONE)
  })
  it('built-not-verified on a plate is the WAITING half disc, not a second planned shape', () => {
    m = mount(<PlannedPlate entry={entry({ state: 'unverified' })} onOpen={() => {}} />)
    const svg = m.container.querySelector('svg')!
    expect(svg.getAttribute('data-glyph')).toBe('half-disc')
    expect(m.container.querySelector('[data-glyph="dashed-ring"]')).toBeNull()
  })
  it('PlannedGlyph takes a size and is decorative', () => {
    m = mount(<PlannedGlyph size={24} />)
    const svg = m.container.querySelector('svg')!
    expect([svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('aria-hidden')]).toEqual(['24', '24', 'true'])
  })
  it('no other file in kit, lamp or planned draws a dashed ring of its own', () => {
    const root = join(__dirname, '..', '..', 'shared')
    const offenders: string[] = []
    for (const dir of ['kit', 'lamp', 'planned']) {
      for (const f of readdirSync(join(root, dir))) {
        if (!f.endsWith('.tsx') || f === 'PlannedGlyph.tsx') continue
        const src = readFileSync(join(root, dir, f), 'utf8')
        if (/<circle[^>]*strokeDasharray/.test(src)) offenders.push(`${dir}/${f}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// ------------------------------------------------------------------------------------------------ material tokens
const CLAY = join(__dirname, '..', '..', 'styles', 'design', 'clay')
const read = (f: string) => readFileSync(join(CLAY, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const decls = (css: string, selector: string): Record<string, string> => {
  const at = css.indexOf(selector)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]))
}
const prim = decls(read('primitive-color.css'), ':root')
const hex = (v: string) => {
  const m = /^var\((--p-[\w-]+)\)$/.exec(v)
  const h = m ? prim[m[1]] : v
  expect(h, v).toMatch(/^#[0-9a-f]{6}$/)
  return h
}
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('the material recipe (elevation.css, contrast.css, forced.css)', () => {
  const elev = read('elevation.css')
  const sem = read('semantic.css')
  const themes = [
    ['light', decls(elev, ":root[data-theme='clay-light']"), decls(sem, ":root[data-theme='clay-light']")],
    ['dark', decls(elev, ":root[data-theme='clay-dark']"), decls(sem, ":root[data-theme='clay-dark']")],
  ] as const
  it.each(themes)('%s: both ridge lips are a real edge of at least 3:1 on the ground, the raised face and the well', (_t, e, s) => {
    for (const lip of ['--ridge-hi', '--ridge-lo']) {
      for (const surface of ['--surface-ground', '--surface-raised', '--surface-sunk']) {
        const r = ratio(hex(e[lip]), hex(s[surface]))
        expect(r, `${_t} ${lip} on ${surface}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
  it.each(themes)('%s: the lit lip, the tooth and the three raised steps are declared, each with at most two layers', (_t, e) => {
    for (const k of ['--lit-hi', '--lit-lo', '--tooth-opacity', '--elev-flush', '--elev-raised', '--elev-float', '--elev-recessed', '--elev-pressed']) expect(e[k], k).toBeTruthy()
    expect(Number(e['--tooth-opacity'])).toBeCloseTo(0.025, 5)
    for (const k of ['--elev-flush', '--elev-raised', '--elev-float']) expect(e[k], `${k} carries the lit lip`).toContain('var(--lit-hi)')
    // the light is aimed from the top left: every outer shade falls right and down
    for (const k of ['--elev-raised', '--elev-float']) {
      const outer = e[k].split(/,(?![^(]*\))/).map((x) => x.trim()).filter((x) => !x.startsWith('inset'))
      for (const o of outer) {
        const [x, y] = o.split(/\s+/).map(parseFloat)
        expect(x, `${k} x offset`).toBeGreaterThan(0)
        expect(y, `${k} y offset`).toBeGreaterThan(0)
      }
    }
  })
  it('the bevel reads the right way round: light theme darkens the bottom lip, dark theme lightens the top lip', () => {
    const [l, d] = [themes[0][1], themes[1][1]]
    const [ls, ds] = [themes[0][2], themes[1][2]]
    expect(ratio(hex(l['--ridge-lo']), hex(ls['--surface-ground']))).toBeGreaterThan(ratio(hex(l['--ridge-hi']), hex(ls['--surface-ground'])))
    expect(ratio(hex(d['--ridge-hi']), hex(ds['--surface-ground']))).toBeGreaterThan(ratio(hex(d['--ridge-lo']), hex(ds['--surface-ground'])))
  })
  it('high contrast (both ways in) and forced colours turn the material into edges', () => {
    const hc = read('contrast.css')
    const blocks = hc.split('--decor-opacity: 0;').slice(1)
    expect(blocks).toHaveLength(4)
    for (const b of blocks) {
      const head = b.slice(0, b.indexOf('}'))
      expect(head).toMatch(/--tooth-opacity: 0;/)
      expect(head).toMatch(/--lit-hi: transparent;/)
      expect(head).toMatch(/--ridge-hi: var\(--p-(clay-700|char-200)\);/)
    }
    const f = read('forced.css')
    for (const k of ['--tooth-opacity: 0', '--lit-hi: transparent', '--lit-lo: transparent', '--ridge-hi: CanvasText', '--ridge-lo: CanvasText', '--elev-flush: none']) expect(f).toContain(k)
  })
  it('disabled text under clay is ink-3, at least 4.5:1 on every light and dark surface (ink-off measured 2.41:1)', () => {
    for (const [, , s] of themes) for (const surface of ['--surface-ground', '--surface-raised', '--surface-sunk']) expect(ratio(hex(s['--ink-3']), hex(s[surface]))).toBeGreaterThanOrEqual(4.5)
    const kit = readFileSync(join(__dirname, '..', '..', 'shared', 'kit', 'clay.css'), 'utf8')
    expect(kit).toMatch(/:root\[data-theme\^='clay'\] :is\(\[data-state='disabled'\], \[aria-disabled='true'\]\) \{ color: var\(--ink-3\);/)
  })
  it('the kit never transitions a shadow and the tooth is a mask over a colour role, not a picture', () => {
    const kit = readFileSync(join(__dirname, '..', '..', 'shared', 'kit', 'clay.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(kit).not.toMatch(/transition[^;{}]*box-shadow/)
    expect(kit).toMatch(/\.k-tooth::before, \.k-panel-in::before \{[^}]*background: var\(--ink-1\);[^}]*mask: var\(--tooth-tile\)/)
    expect(kit).toMatch(/opacity: calc\(var\(--tooth-opacity, 0\) \* var\(--decor-opacity, 1\)\)/)
  })
})

// ------------------------------------------------------------------------------------------------ LitPanel
describe('LitPanel', () => {
  it('snaps a pointer direction to one of 8 angles, 0 from the top, clockwise', () => {
    expect(LIT_ANGLES).toEqual([0, 45, 90, 135, 180, 225, 270, 315])
    expect(snapAngle(0, -10)).toBe(0)
    expect(snapAngle(10, -10)).toBe(45)
    expect(snapAngle(10, 0)).toBe(90)
    expect(snapAngle(10, 10)).toBe(135)
    expect(snapAngle(0, 10)).toBe(180)
    expect(snapAngle(-10, 10)).toBe(225)
    expect(snapAngle(-10, 0)).toBe(270)
    expect(snapAngle(-10, -10)).toBe(315)
    expect(snapAngle(-1, -30)).toBe(0) // 358 degrees rounds to 0, not 360
    expect(snapAngle(0, 0)).toBe(315)
  })
  it('a fixed angle is drawn as given and does not follow the pointer; the default rests at 315', () => {
    m = mount(<LitPanel angle={90}>Body</LitPanel>)
    const lit = m.container.querySelector<HTMLElement>('.k-lit')!
    expect(lit.dataset.angle).toBe('90')
    expect(lit.dataset.follow).toBeUndefined()
    expect(lit.querySelector('.k-panel .k-panel-in')!.textContent).toBe('Body')
    m.unmount()
    m = mount(<LitPanel error="could not load">Body</LitPanel>)
    const l2 = m.container.querySelector<HTMLElement>('.k-lit')!
    expect([l2.dataset.angle, l2.dataset.follow]).toEqual(['315', 'true'])
    expect(m.container.querySelector('.k-panel')!.getAttribute('data-state')).toBe('error')
  })
  it('a mouse over a following panel writes the snapped angle; touch and pen leave it at rest', () => {
    m = mount(<LitPanel>Body</LitPanel>)
    const lit = m.container.querySelector<HTMLElement>('.k-lit')!
    lit.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    const move = (x: number, y: number, pointerType: string) => {
      const ev = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y })
      Object.defineProperty(ev, 'pointerType', { value: pointerType })
      act(() => void lit.dispatchEvent(ev))
    }
    move(100, 50, 'touch')
    expect(lit.dataset.angle).toBe('315')
    move(100, 50, 'mouse')
    expect(lit.dataset.angle).toBe('90')
    move(50, 100, 'mouse')
    expect(lit.dataset.angle).toBe('180')
  })
})

// ------------------------------------------------------------------------------------------------ the *.planned.ts glob
describe('the *.planned.ts glob (registry.ts)', () => {
  it('collects in path order and ignores a module with nothing usable', () => {
    const a = entry({ id: 'ww.a', label: 'A' })
    const b = entry({ id: 'ww.b', label: 'B' })
    expect(collectPlanned({ './z.planned.ts': { planned: [b] }, './a.planned.ts': { default: [a] }, './x.planned.ts': {} }).map((e) => e.id)).toEqual(['ww.a', 'ww.b'])
  })
  it('finds the wave 5 homes: day.month and focus.drill, each a lint-clean Well Wisher entry with a known home', () => {
    const ids = GLOBBED_PLANNED.map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['ww.day-month', 'ww.focus-drill']))
    for (const e of GLOBBED_PLANNED) {
      expect(lintEntry(e), e.id).toEqual([])
      expect(isKnownHome(e.home), e.home).toBe(true)
    }
    expect(globbedFor('ww').map((e) => e.home)).toEqual(expect.arrayContaining(['day.month', 'focus.drill']))
    expect(globbedFor('jarvis').every((e) => e.product === 'jarvis')).toBe(true)
  })
  it('withGlobbed adds the product\'s globbed rows to a registry, live, and the base row wins on a shared id', () => {
    const live = [entry()]
    const base = createRegistry(live)
    const extra = [entry({ id: 'ww.more', home: 'day.month', label: 'More' }), entry({ id: 'ww.thing', label: 'Shadowed' }), entry({ id: 'jarvis.no', product: 'jarvis', label: 'No' })]
    const reg = withGlobbed(base, 'ww', extra)
    expect(reg.entries.map((e) => e.id)).toEqual(['ww.thing', 'ww.more'])
    expect(reg.byId('ww.thing')!.label).toBe('A thing')
    expect(reg.forHome('day.month').map((e) => e.id)).toEqual(['ww.more'])
    live.push(entry({ id: 'ww.late', label: 'Late' }))
    expect(reg.byId('ww.late')).toBeDefined()
    expect(reg.byId('jarvis.no')).toBeUndefined()
  })
  it('a *.planned.ts file imports types only from shared/planned (a value import would be a cycle with the eager glob)', () => {
    const src = join(__dirname, '..', '..')
    const files: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        if (f === 'node_modules') continue
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (f.endsWith('.planned.ts')) files.push(p)
      }
    }
    walk(src)
    expect(files.length).toBeGreaterThanOrEqual(1)
    for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n').filter((l) => /^import /.test(l))) expect(line, f).toMatch(/^import type /)
  })
})
