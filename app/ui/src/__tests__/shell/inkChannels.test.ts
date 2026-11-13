// A.N02 (a): shell.css writes `--ink-rgb` for the folded Well Wisher frame as channel triplets, because
// rgba(var(--ink-rgb), a) cannot read channels out of a var(). That is the one copied colour value in the bridge,
// so this test keeps it tied to the single source: each clay theme's ink-1 primitive (semantic.css) and its hex
// (primitive-color.css). If G01 or a later package retunes ink-1, this fails instead of the frame drifting.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLAY = join(__dirname, '..', '..', 'styles', 'design', 'clay')
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const semantic = read(join(CLAY, 'semantic.css'))
const primitive = read(join(CLAY, 'primitive-color.css'))
const shell = read(join(__dirname, '..', '..', 'shell', 'shell.css'))

/** The body of the first rule whose selector is exactly `sel`. */
function block(css: string, sel: string): string {
  const i = css.indexOf(`${sel} {`)
  if (i < 0) throw new Error(`no rule ${sel}`)
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i))
}

function inkChannels(theme: 'clay-light' | 'clay-dark'): string {
  const prim = /--ink-1:\s*var\((--p-[a-z0-9-]+)\)/.exec(block(semantic, `:root[data-theme='${theme}']`))?.[1]
  const hex = new RegExp(`${prim}:\\s*#([0-9a-f]{6})`, 'i').exec(primitive)?.[1]
  if (!prim || !hex) throw new Error(`ink-1 of ${theme} not found`)
  return [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16)).join(', ')
}

describe('the folded frame\'s --ink-rgb', () => {
  for (const theme of ['clay-light', 'clay-dark'] as const) {
    it(`equals the ink-1 primitive of ${theme}`, () => {
      const m = new RegExp(`:root\\[data-theme='${theme}'\\] \\.s2 \\.ww-portal \\{ --ink-rgb: ([0-9, ]+); \\}`).exec(shell)
      expect(m, `the ${theme} --ink-rgb rule in shell.css`).not.toBeNull()
      expect(m![1]).toBe(inkChannels(theme))
    })
  }
})
