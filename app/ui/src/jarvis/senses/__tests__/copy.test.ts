// The Senses source as a lint (A.J03 accept list): no forbidden word in any string the section can print, no eye, face or body
// art id, one canvas in the whole section, no static import of the twin or of three.js, and no camera anywhere. The test
// reads the files of the folder (comments removed, since a comment is not on screen) and the shell views that mount it.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FORBIDDEN_ART, copyProblems } from '../model'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(HERE, '..')
const SRC = resolve(DIR, '..', '..')

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
// the lint's own word list lives in model.ts and the fixtures name the eyes of nothing: both are excluded by name
const SKIP = new Set(['model.ts'])
const files = readdirSync(DIR).filter((f) => /\.(tsx?|css)$/.test(f) && !SKIP.has(f))
const read = (f: string) => strip(readFileSync(join(DIR, f), 'utf8'))

describe('the Senses source', () => {
  it('finds the files', () => {
    expect(files.length).toBeGreaterThan(10)
  })
  it('prints no forbidden word (present, absent, occupied, the empty-room claim) in any string', () => {
    const bad: string[] = []
    for (const f of files) {
      if (f.endsWith('.css')) continue
      for (const p of copyProblems(read(f))) bad.push(`${f}: ${p}`)
    }
    expect(bad).toEqual([])
  })
  it('names no art id with an eye, face, body, pose or figure in it', () => {
    const bad: string[] = []
    for (const f of files) {
      for (const m of read(f).matchAll(/art\.[a-z0-9.-]+/g)) if (FORBIDDEN_ART.test(m[0])) bad.push(`${f}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })
  it('draws exactly one canvas: the terrain', () => {
    const hits = files.flatMap((f) => (/<canvas\b/.test(read(f)) ? [f] : []))
    expect(hits).toEqual(['SignalTerrain.tsx'])
  })
  it('imports no WebGL: the twin is loaded by a dynamic import() only, and three.js by nothing here', () => {
    for (const f of files.filter((x) => x.endsWith('.ts') || x.endsWith('.tsx'))) {
      const t = read(f)
      expect(t, f).not.toMatch(/from\s+['"]three/)
      const staticTwin = [...t.matchAll(/^\s*import\s+(?!type\b)[^'"]*from\s+['"][^'"]*twin\/SpatialTwin['"]/gm)]
      expect(staticTwin, `${f} imports the twin statically`).toHaveLength(0)
    }
    expect(read('TwinStage.tsx')).toMatch(/import\('\.\.\/\.\.\/twin\/SpatialTwin'\)/)
  })
  it('has no camera, webcam or video capture', () => {
    for (const f of files) expect(read(f), f).not.toMatch(/getUserMedia|<video\b|webcam|MediaRecorder/i)
  })
  it('uses no colour literal in the stylesheet: tokens and system colours only', () => {
    const css = read('senses.css')
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).toEqual([])
  })
  it('every view registration is product-gated and loads the lazy chunk', () => {
    for (const v of ['presence', 'signal', 'teach']) {
      const t = readFileSync(join(SRC, 'shell', 'views', `senses-${v}.view.ts`), 'utf8')
      expect(t).toMatch(/import\.meta\.env\.VITE_PRODUCT !== 'ww'/)
      expect(t).toMatch(new RegExp(`id: 'senses\\.${v}'`))
      expect(t).not.toMatch(/^\s*import\s[^'"]*from\s*['"][^'"]*jarvis\//m)
    }
  })
})
