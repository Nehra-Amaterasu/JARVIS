// VIS1: the CSS rules that keep an overlay readable under whatever it is mounted under. e2e/surfaces.spec.ts measures the result in a
// real Chromium; this is the cheap guard on the source, so a later edit cannot quietly take a rule out.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8')
const clay = src('shared/kit/clay.css')
const shell = src('shell/shell.css')
const rule = (css: string, selector: string) => {
  const at = css.indexOf(selector)
  expect(at, `rule ${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(at, css.indexOf('}', at) + 1)
}

describe('every overlay brings its own surface, ink and place (VIS1)', () => {
  it.each([
    [":root[data-theme^='clay'] .ww-sheet {"],
    [":root[data-theme^='clay'] .ww-popover {"],
    ['.k-dialog {'],
    ['.k-palette {'],
  ])('%s sets an opaque surface token and an ink token', (sel) => {
    const r = rule(clay, sel)
    expect(r).toMatch(/background: var\(--surface-raised\)/)
    expect(r).toMatch(/color: var\(--ink-1\)/)
  })
  it('the drawer, sheet and popover are placed by the kit, not by a sheet that may not be loaded', () => {
    expect(rule(clay, ":root[data-theme^='clay'] .ww-sheet {")).toMatch(/position: fixed/)
    expect(rule(clay, ":root[data-theme^='clay'] .ww-popover {")).toMatch(/position: fixed/)
    expect(rule(clay, ":root[data-theme^='clay'] .ww-scrim {")).toMatch(/position: fixed; inset: 0/)
  })
  it('the scrim is below the panel: z 40 against 50, with a colour of its own', () => {
    expect(rule(clay, ":root[data-theme^='clay'] .ww-scrim {")).toMatch(/z-index: var\(--z-scrim, 40\); background: var\(--scrim\)/)
    expect(rule(clay, ":root[data-theme^='clay'] .ww-sheet {")).toMatch(/z-index: var\(--z-sheet, 50\)/)
    expect(rule(clay, ":root[data-theme^='clay'] .ww-popover {")).toMatch(/z-index: var\(--z-sheet, 50\)/)
  })
  it('a native select list is drawn from an option that has its own opaque surface and ink', () => {
    expect(clay).toMatch(/:is\(select, datalist\) :is\(option, optgroup\) \{ background-color: var\(--surface-raised\); color: var\(--ink-1\); \}/)
  })
  it('the shell maps the Ash roles to the clay roles on every .ww and .ww-portal, mounted under .s2 or not', () => {
    const head = shell.slice(shell.indexOf('.s2 .ww,'), shell.indexOf('--ink-1: inherit'))
    expect(head).toContain(":root[data-theme^='clay-'] .ww-portal")
    expect(head).toContain(":root[data-theme^='clay-'] .ww,")
  })
  it('an unselected segmented option answers the pointer and the press is written after the hover', () => {
    const hover = clay.indexOf(".ww-seg-opt:is(:hover, [data-demo='hover']):not(")
    const press = clay.indexOf(".ww-seg-opt:is(:active, [data-demo='pressed']):not(")
    expect(hover).toBeGreaterThan(0)
    expect(press).toBeGreaterThan(hover)
  })
})
