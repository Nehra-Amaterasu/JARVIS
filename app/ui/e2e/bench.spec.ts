// The jury bench (package BENCH): shared/kit, shared/art and shared/lamp mounted in a real Chromium, every exported
// component in each of its states, in the light and the dark clay theme, without touching the app.
//
// The page (e2e/bench/entry.tsx) is built in memory by Vite from the real components and the real token, kit, art and
// lamp stylesheets and served from a fake origin, as planned.spec.ts does; nothing is written near app/ui/dist and no
// server, token or port is involved (port 8790 is only started because the shared config starts the sandbox).
//
// What is asserted, per component (spec rows in e2e/bench/inpage.js):
//   a  forced-colors: active: every control keeps an edge and a focus outline; the five lamp shapes stay distinct
//   b  hit area at least 44 x 44 CSS px, the box plus any ::after extension found by elementFromPoint probes
//   c  Tab reaches every control; aria-disabled controls stay focusable (no disabled attribute)
//   d  reduced motion: no running animation after 1 s; motion allowed: none running after 6 s, no DOM churn, no rAF
//      loop and no live setInterval in the 7th second
//   e  greyscale: the five lamp glyphs differ as pixels
//   f  text 4.5:1 (3:1 large) against its real backdrop, and control edges 3:1, light and dark
//
// A failure is a FINDING. It is never hidden by weakening an assertion; it is listed in KNOWN below with the component,
// the measured value and the rule, so the suite is green while the list shows the debt. A KNOWN entry that stops failing
// fails the suite (delete it: the debt is paid), and a failure that is not in KNOWN fails the suite (a new regression).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'
import { KNOWN, type Known, type Rule } from './bench/known'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'test-results', 'jury-bench')
const URL_ = 'http://jury-bench.test/'
const INPAGE = readFileSync(resolve(ROOT, 'e2e/bench/inpage.js'), 'utf8')
const THEMES = ['light', 'dark'] as const
type Theme = (typeof THEMES)[number]
const OVERLAYS = ['Drawer', 'Sheet', 'Popover', 'RetroDialog', 'RetroDialogDestructive'] as const

let bundle: Promise<{ js: string; css: string }> | null = null
function buildBench() {
  bundle ??= (async () => {
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'e2e/bench/entry.tsx'), formats: ['iife'], name: 'JuryBench', fileName: 'bench' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the bench build produced no script')
    // The legacy ww-* controls pick Paper (light) from html[data-theme='paper']; the clay theme owns that attribute here.
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    return { js, css }
  })()
  return bundle
}

const FONTS = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`

async function openBench(page: Page, theme: Theme, open = '') {
  const { js, css } = await buildBench()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jury bench</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}${open ? `&open=${open}` : ''}`)
  await page.locator('[data-bench]').first().waitFor()
  await page.evaluate(INPAGE)
}

// ------------------------------------------------------------------------------------------------ findings ledger
interface Hit { score: number; text: string; count: number }
type Scan = Record<string, Hit>
interface Finding { theme: Theme; component: string; rule: string; measured: string; count: number }
const findings: Finding[] = []

const knownKey = (k: Known) => `${k.component}|${k.rule}`
/** Compare what a scan found with KNOWN for this theme; both an unlisted failure and a stale entry fail the test. */
function settle(theme: Theme, rules: Rule[], scan: Scan, scope: (component: string) => boolean = () => true) {
  const found = new Map<string, Hit>()
  for (const [k, v] of Object.entries(scan)) {
    const [component, rule] = k.split('|')
    if (!rules.includes(rule as Rule) || !scope(component)) continue
    found.set(k, v)
    findings.push({ theme, component, rule, measured: v.text, count: v.count })
  }
  const listed = KNOWN.filter((k) => rules.includes(k.rule) && (!k.themes || k.themes.includes(theme)) && scope(k.component))
  const listedKeys = new Set(listed.map(knownKey))
  const unlisted = [...found.keys()].filter((k) => !listedKeys.has(k)).map((k) => `${k}: ${found.get(k)!.text}`)
  const stale = listed.filter((k) => !found.has(knownKey(k))).map(knownKey)
  expect(unlisted, `new failures (not in KNOWN), ${theme}`).toEqual([])
  expect(stale, `KNOWN entries that no longer fail, ${theme}: delete them`).toEqual([])
}

const merge = (...s: Scan[]): Scan => {
  const out: Scan = {}
  for (const one of s) for (const [k, v] of Object.entries(one)) out[k] = out[k] ? { score: Math.min(out[k].score, v.score), text: out[k].score <= v.score ? out[k].text : v.text, count: out[k].count + v.count } : { ...v }
  return out
}
const overlayOwner = (o: string) => (o.startsWith('RetroDialog') ? 'kit/RetroDialog' : o === 'Sheet' ? 'kit/Drawer' : `kit/${o}`)

async function scanAllPages(page: Page, theme: Theme, fn: () => Promise<Scan>, includeOverlays = true): Promise<Scan> {
  await openBench(page, theme)
  const parts = [await fn()]
  if (includeOverlays) {
    for (const o of OVERLAYS) {
      await openBench(page, theme, o)
      await page.waitForTimeout(450) // the 200 ms sheet and 120 ms popover entrances settle before the probes
      parts.push(await fn())
    }
  }
  return merge(...parts)
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(resolve(OUT, 'findings.json'), JSON.stringify({ findings, known: KNOWN }, null, 1))
  const rows = findings.map((f) => `| ${f.theme} | ${f.component} | ${f.rule} | ${f.count} | ${f.measured.replace(/\|/g, '/')} |`)
  writeFileSync(resolve(OUT, 'findings.md'), ['| theme | component | rule | hits | worst measured |', '|---|---|---|---|---|', ...rows].join('\n') + '\n')
})

// ------------------------------------------------------------------------------------------------ coverage
test('every exported component of kit, art and lamp is on the bench', async ({ page }) => {
  await openBench(page, 'light')
  const r = await page.evaluate(() => {
    const b = (window as unknown as { __bench: { exports: Record<string, string[]>; rendered: () => string[] } }).__bench
    const drawn = new Set(b.rendered())
    const missing: string[] = []
    for (const [pkg, names] of Object.entries(b.exports)) for (const n of names) if (!drawn.has(`${pkg}:${n}`)) missing.push(`${pkg}:${n}`)
    return { missing, counts: Object.fromEntries(Object.entries(b.exports).map(([k, v]) => [k, v.length])) }
  })
  expect(r.missing, 'exports the bench does not draw').toEqual([])
  expect(r.counts.kit).toBeGreaterThanOrEqual(40)
  expect(r.counts.art).toBeGreaterThanOrEqual(19)
  expect(r.counts.lamp).toBe(4)
})

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    // ---------------------------------------------------------------------------------------- a: forced colours
    test(`(a) forced colours: every control keeps an edge and a focus outline [${theme}]`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' })
      const scan = await scanAllPages(page, theme, () => page.evaluate('window.__bn.scanEdges()') as Promise<Scan>)
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
      settle(theme, ['edge', 'focus'], scan)
    })

    test(`(a) forced colours: the five lamp shapes stay distinct, drawn and as markup [${theme}]`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' })
      await openBench(page, theme)
      const sigs = (await page.evaluate('window.__bn.signatures()')) as Record<string, string[]>
      for (const [set, list] of Object.entries(sigs)) {
        expect(list.length, `${set}: five glyphs found`).toBe(5)
        expect(new Set(list).size, `${set}: five different SVG bodies`).toBe(5)
      }
      // and as pixels, because identical markup is not the only way two shapes can look alike
      const sets = await page.evaluate(() => Object.fromEntries(Object.entries((window as unknown as { __bn: { glyphSets(): Record<string, Element[]> } }).__bn.glyphSets()).map(([k, v]) => [k, v.length])))
      for (const set of Object.keys(sets)) {
        const shots: string[] = []
        for (let i = 0; i < 5; i++) {
          const loc = page.locator(set === 'lamp/LampGlyph' ? '[data-bench="lamp/LampGlyph"] svg.lamp-glyph' : set === 'kit/Lamp' ? '[data-bench="kit/Lamp"] [data-form="glyph only"] svg' : '[data-bench="art/ArtTable"] [data-form="marks and tags"] svg.art-mark').nth(i)
          shots.push('data:image/png;base64,' + (await loc.screenshot()).toString('base64'))
        }
        for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
          const d = (await page.evaluate(([a, b]) => (window as unknown as { __bn: { pixelDiff(a: string, b: string): Promise<number> } }).__bn.pixelDiff(a, b), [shots[i], shots[j]])) as number
          expect(d, `${set}: glyph ${i} vs ${j} differ under forced colours (fraction of pixels)`).toBeGreaterThan(0.02)
        }
      }
    })

    // ---------------------------------------------------------------------------------------- b: hit areas
    test(`(b) every control is at least 44 x 44 CSS px, ::after extensions included [${theme}]`, async ({ page }) => {
      const scan = await scanAllPages(page, theme, () => page.evaluate('window.__bn.scanHits()') as Promise<Scan>)
      settle(theme, ['hit'], scan)
    })

    // ---------------------------------------------------------------------------------------- c: keyboard
    test(`(c) Tab reaches every control and aria-disabled controls stay focusable [${theme}]`, async ({ page }) => {
      const run = async () => {
        const n = (await page.evaluate('window.__bn.tabPrep()')) as number
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await page.mouse.move(0, 0)
        for (let i = 0; i < n + 12; i++) await page.keyboard.press('Tab')
        return (await page.evaluate('window.__bn.tabResult()')) as Scan
      }
      const scan = await scanAllPages(page, theme, run)
      settle(theme, ['tab'], scan)
    })

    // ---------------------------------------------------------------------------------------- d: motion
    test(`(d) reduced motion: no running animation after 1 s [${theme}]`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openBench(page, theme)
      await page.waitForTimeout(1000)
      const running = (await page.evaluate('window.__bn.anims()')) as Scan
      const churn = (await page.evaluate('window.__bn.mutationWindow(1000)')) as Scan
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
      settle(theme, ['motion', 'churn'], merge(running, churn))
    })

    test(`(d) motion allowed: nothing is animating, churning or looping after 6 s [${theme}]`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.addInitScript(() => {
        const w = window as unknown as { __raf: number; __ivl: Set<number> }
        w.__raf = 0
        w.__ivl = new Set()
        const raf = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = (f) => (w.__raf++, raf(f))
        const si = window.setInterval.bind(window)
        window.setInterval = ((...a: Parameters<typeof setInterval>) => {
          const id = si(...a) as unknown as number
          w.__ivl.add(id)
          return id
        }) as typeof setInterval
        const ci = window.clearInterval.bind(window)
        window.clearInterval = ((id?: number) => (w.__ivl.delete(id as number), ci(id))) as typeof clearInterval
      })
      await openBench(page, theme)
      await page.waitForTimeout(6200)
      const running = (await page.evaluate('window.__bn.anims()')) as Scan
      await page.evaluate(() => ((window as unknown as { __raf: number }).__raf = 0))
      const churn = (await page.evaluate('window.__bn.mutationWindow(1000)')) as Scan
      const loops = await page.evaluate(() => ({ raf: (window as unknown as { __raf: number }).__raf, intervals: (window as unknown as { __ivl: Set<number> }).__ivl.size }))
      const idle: Scan = {}
      if (loops.raf > 0) idle['page|idle-loop'] = { score: 0, count: loops.raf, text: `${loops.raf} requestAnimationFrame calls in the 7th second` }
      if (loops.intervals > 0) idle['page|idle-loop'] = { score: 0, count: loops.intervals, text: `${loops.intervals} setInterval timers still live at 7 s` }
      settle(theme, ['motion', 'churn', 'idle-loop'], merge(running, churn, idle))
    })

    // ---------------------------------------------------------------------------------------- e: greyscale
    test(`(e) greyscale: the five lamp glyphs differ as shapes [${theme}]`, async ({ page }) => {
      await openBench(page, theme)
      await page.addStyleTag({ content: 'html{filter:grayscale(1)}' })
      const groups: [string, string][] = [
        ['lamp/LampGlyph', '[data-bench="lamp/LampGlyph"] svg.lamp-glyph'],
        ['kit/Lamp', '[data-bench="kit/Lamp"] [data-form="glyph only"] svg'],
        ['art/StateMark', '[data-bench="art/ArtTable"] [data-form="marks and tags"] svg.art-mark'],
      ]
      const scan: Scan = {}
      for (const [name, sel] of groups) {
        const shots: string[] = []
        for (let i = 0; i < 5; i++) shots.push('data:image/png;base64,' + (await page.locator(sel).nth(i).screenshot()).toString('base64'))
        let worst = 1
        let pair = ''
        for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
          const d = (await page.evaluate(([a, b]) => (window as unknown as { __bn: { pixelDiff(a: string, b: string): Promise<number> } }).__bn.pixelDiff(a, b), [shots[i], shots[j]])) as number
          if (d < worst) { worst = d; pair = `${i} vs ${j}` }
        }
        if (worst < 0.02) scan[`${name}|grey`] = { score: worst, count: 1, text: `glyphs ${pair} differ in ${(worst * 100).toFixed(1)}% of pixels (needs 2%)` }
      }
      settle(theme, ['grey'], scan)
    })

    // ---------------------------------------------------------------------------------------- f: contrast
    test(`(f) text 4.5:1 (3:1 large) and control edges 3:1 [${theme}]`, async ({ page }) => {
      const skipped = { image: 0, hidden: 0 }
      const run = async () => {
        const r = (await page.evaluate('window.__bn.scanContrast()')) as { out: Scan; skipped: typeof skipped }
        skipped.image += r.skipped.image
        skipped.hidden += r.skipped.hidden
        return r.out
      }
      const scan = await scanAllPages(page, theme, run)
      mkdirSync(OUT, { recursive: true })
      writeFileSync(resolve(OUT, `contrast-skips-${theme}.json`), JSON.stringify(skipped))
      settle(theme, ['contrast', 'edge-contrast'], scan)
    })
  })
}

// ------------------------------------------------------------------------------------------------ screenshots
const SHOTS: { name: string; theme: Theme; forced?: boolean; grey?: boolean }[] = [
  { name: 'light', theme: 'light' },
  { name: 'dark', theme: 'dark' },
  { name: 'forced-colors', theme: 'light', forced: true },
  { name: 'greyscale', theme: 'light', grey: true },
]
const VIEWPORTS = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
for (const s of SHOTS) {
  for (const v of VIEWPORTS) {
    test(`screenshot ${s.name} ${v.w}x${v.h}`, async ({ page }) => {
      await page.setViewportSize({ width: v.w, height: v.h })
      if (s.forced) await page.emulateMedia({ forcedColors: 'active' })
      await page.emulateMedia({ reducedMotion: 'reduce', ...(s.forced ? { forcedColors: 'active' as const } : {}) })
      await openBench(page, s.theme)
      if (s.grey) await page.addStyleTag({ content: 'html{filter:grayscale(1)}' })
      await page.waitForTimeout(500)
      mkdirSync(OUT, { recursive: true })
      const path = resolve(OUT, `bench-${s.name}-${v.w}x${v.h}.png`)
      await page.screenshot({ path, fullPage: true })
      // a bench that did not lay out at this width would make every measurement above meaningless
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no horizontal page scroll at ${v.w}`).toBe(true)
    })
  }
}
