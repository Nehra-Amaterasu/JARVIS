// The kit's stylesheet as a test (spec 6.5.2, 7.1, 7.6): no literal colour, only roles that the clay layers define,
// 44 px hit areas, and a forced-colours branch for every family. A rendered forced-colours screenshot needs a
// browser and is a Playwright job; this is the part that can be proven from the file.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const KIT = join(__dirname, '..', '..', 'shared', 'kit')
const css = readFileSync(join(KIT, 'clay.css'), 'utf8')
const semantic = readFileSync(join(__dirname, '..', '..', 'styles', 'design', 'clay', 'semantic.css'), 'utf8')
const forced = css.slice(css.indexOf('@media (forced-colors: active)'))
const normal = css.slice(0, css.indexOf('@media (forced-colors: active)'))
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

describe('clay kit stylesheet', () => {
  it('has a forced-colours branch and keeps it after the normal rules', () => {
    expect(css).toContain('@media (forced-colors: active)')
    expect(forced.length).toBeGreaterThan(500)
  })
  it('declares no literal colour (hex, rgb, hsl, oklch, named) outside the system colours of the forced branch', () => {
    const body = noComments(normal)
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(body).not.toMatch(/\b(rgba?|hsla?|oklch|oklab|color-mix)\(/)
    expect(body).not.toMatch(/:\s*(white|black|red|green|blue|orange|gray|grey)\b/)
  })
  it('reads only colour roles that semantic.css defines (or the component tokens of 7.6, with a role fallback)', () => {
    const roles = new Set([...semantic.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
    const used = [...noComments(normal).matchAll(/var\((--(?:surface|ink|edge|accent|state|selected|focus|scrim)[a-z0-9-]*)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(40)
    const missing = [...new Set(used)].filter((r) => !roles.has(r))
    expect(missing).toEqual([])
  })
  it('takes every pointer target to 44 px through --hit', () => {
    expect(normal).toMatch(/min-height:\s*var\(--hit, 44px\)/)
    const hit = normal.slice(0, normal.indexOf('}', normal.indexOf('min-height: var(--hit, 44px)')))
    for (const c of ['.k-switch', '.k-rocker-half', '.k-key', '.k-tab', '.k-btn', '.k-rail-btn', '.k-palette-row']) expect(hit, c).toContain(c)
  })
  it('gives focus a 2 px ring with a 2 px offset (6.4.5)', () => {
    expect(normal).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\);\s*outline-offset:\s*2px/)
  })
  it('the forced branch covers every family: controls, wells, chamfers, ticks, lamp, fills and planned', () => {
    for (const sel of ['.k-switch', '.k-rocker', '.k-key', '.k-tab', '.k-btn', '.k-dialog', '.k-palette', '.k-console', '.k-readout', '.k-numerals', '.k-lines', '.k-knob', '.k-progress-track', '.k-rail-row']) expect(forced, sel).toContain(sel)
    for (const sel of ['.k-plate', '.k-panel', '.k-toast']) expect(forced, sel).toMatch(new RegExp(`${sel.replace('.', '\\.')}[^{]*\\{[^}]*clip-path: none`))
    expect(forced).toMatch(/\.k-lamp-glyph[^{]*\{[^}]*forced-color-adjust: none/)
    expect(forced).toContain("[data-state='planned']")
    expect(forced).toContain('Highlight')
    expect(forced).toContain('ButtonText')
    expect(forced).toContain('CanvasText')
  })
  it('the chamfer is two layers (outer edge fill plus inset inner), so the diagonal keeps a 3:1 edge', () => {
    // wave 5: the outer layer is the clipped ::before, so the panel itself is unclipped and can cast its shade
    expect(normal).toMatch(/\.k-panel \{[^}]*padding: 1px/)
    expect(normal).toMatch(/\.k-panel::before \{[^}]*background: var\(--edge-ui\)[^}]*clip-path/)
    expect(normal).toMatch(/\.k-panel-in \{[^}]*clip-path/)
  })
  it('the chamfered panel casts the raised shade as a drop-shadow that follows the chamfer, and none in forced colours', () => {
    expect(normal).toMatch(/\.k-panel \{[^}]*filter: var\(--elev-raised-drop, none\)/)
    expect(normal).not.toMatch(/\.k-panel \{[^}]*clip-path/)
    expect(forced).toMatch(/\.k-panel \{[^}]*filter: none/)
  })
  it('the Raised Pill restyle is scoped to a clay theme, so no existing page changes', () => {
    const rule = normal.match(/^[^\n]*\.ww-btn\.primary[^\n]*$/gm) ?? []
    expect(rule.length).toBeGreaterThan(0)
    expect(rule.every((r) => r.startsWith(":root[data-theme^='clay']"))).toBe(true)
  })
  it('stops the hover lift, press and thumb slide under prefers-reduced-motion', () => {
    expect(normal).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.k-switch-thumb \{ transition: none; \}/)
  })
  it('has no infinite animation and no blink (the prompt cursor is a solid block)', () => {
    expect(css).not.toMatch(/animation[^;]*infinite/)
    expect(css).not.toMatch(/@keyframes/)
  })
})
