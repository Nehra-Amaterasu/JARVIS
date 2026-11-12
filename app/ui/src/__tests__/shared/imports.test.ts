// Seam cuts S1, S2 and S4 as a test (docs/design/jarvis-product-overhaul.md 15.1, A.B01): the import graph
// of src/ must keep the two products apart so each can be built alone (VITE_PRODUCT=jarvis|ww).
//   - JARVIS code (pages, galaxy, twin) and shared/ import nothing from ww/ or germoney/
//   - Well Wisher code (ww, germoney) and shared/ import nothing from the JARVIS pages, galaxy or twin
//   - the only files outside those trees that name a Well Wisher module are the places that mount it
//     (App.tsx, pageLoaders.ts); each is listed with the reason, so a new one fails loudly
// The ESLint-style rule in .oxlintrc.json catches the same thing in the editor; this test is the CI copy
// and also resolves relative paths, which a pattern cannot.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const SRC = resolve(__dirname, '..', '..')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const posix = (p: string) => p.split(sep).join('/')
const rel = (p: string) => posix(relative(SRC, p))

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w$.])import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

/** Every relative import in a file, resolved to a path under src/ (no extension, no index). */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (!spec || !spec.startsWith('.')) continue
    out.push(rel(resolve(dirname(file), spec)))
  }
  return out
}

const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/__tests__/.test(posix(f)) && !/\.test\./.test(f))
const under = (p: string, dirs: string[]) => dirs.some((d) => p === d || p.startsWith(d + '/'))

const JARVIS_TREES = ['pages', 'galaxy', 'twin']
const WW_TREES = ['ww', 'germoney']

describe('the product seams in the import graph', () => {
  it('finds the source files and the imports in them', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(importsOf(join(SRC, 'App.tsx'))).toContain('pageLoaders')
  })

  it('S1: JARVIS code and shared code import no Well Wisher module', () => {
    const bad: string[] = []
    for (const f of files.filter((f) => under(rel(f), [...JARVIS_TREES, 'shared'])))
      for (const i of importsOf(f)) if (under(i, WW_TREES)) bad.push(`${rel(f)} -> ${i}`)
    expect(bad).toEqual([])
  })

  it('S1: Well Wisher code and shared code import no JARVIS page, galaxy or twin module', () => {
    const bad: string[] = []
    for (const f of files.filter((f) => under(rel(f), [...WW_TREES, 'shared'])))
      for (const i of importsOf(f)) if (under(i, JARVIS_TREES) || under(i, ['jarvis'])) bad.push(`${rel(f)} -> ${i}`)
    expect(bad).toEqual([])
  })

  it('S2: only the mounting files outside the two products name a Well Wisher module', () => {
    // App.tsx lazily starts the game bridge, pageLoaders.ts lazily loads the Well Wisher root; both are
    // gated by VITE_PRODUCT so the jarvis build removes them (scripts/bundle-budget.mjs proves it).
    const allowed = new Set(['App.tsx', 'pageLoaders.ts'])
    const seen = new Set<string>()
    for (const f of files.filter((f) => !under(rel(f), [...WW_TREES, ...JARVIS_TREES, 'shared'])))
      if (importsOf(f).some((i) => under(i, WW_TREES))) seen.add(rel(f))
    expect([...seen].sort()).toEqual([...allowed].sort())
  })

  it('S2: App.tsx no longer mounts the Well Wisher overlays (they live in the ww root)', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8')
    expect(app).not.toMatch(/FxLayer|GameFx|<Dialogs/)
    const root = readFileSync(join(SRC, 'germoney', 'MissionRoot.tsx'), 'utf8')
    expect(root).toMatch(/<FxLayer \/>/)
    expect(root).toMatch(/<GameFx \/>/)
    expect(root).toMatch(/<Dialogs \/>/)
  })

  it('S1: Core renders no Well Wisher card', () => {
    const core = readFileSync(join(SRC, 'pages', 'Core.tsx'), 'utf8')
    expect(core).not.toMatch(/MissionCard/)
  })

  it('S4: the shared primitives are declared on :root, not only under .ww', () => {
    const css = readFileSync(join(SRC, 'styles', 'design', 'primitive.css'), 'utf8')
    expect(css).toMatch(/:root\s*[,{]/)
  })
})
