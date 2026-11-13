// Jury screenshots of the G02 grammars: builds shots.entry.tsx with Vite in memory (as e2e/bench.spec.ts does),
// serves it from a fake origin inside Playwright's Chromium, and saves full-page PNGs at 1366x768 and 390x844 in
// the light and the dark clay theme. No server, no port, nothing written near app/ui/dist.
//
//   cd app/ui && node src/__tests__/grammar/shots.mjs <out dir>
//
// It also prints, per page, the in-page measures a jury reads off: running animations after 1 s (calm) and 6 s
// (motion allowed), live timers are not observable from outside, so the vitest suite checks those.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const OUT = resolve(process.argv[2] ?? resolve(ROOT, 'test-results', 'grammar-shots'))
mkdirSync(OUT, { recursive: true })

const out = await build({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
  esbuild: { jsx: 'automatic' },
  build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'src/__tests__/grammar/shots.entry.tsx'), formats: ['iife'], name: 'GrammarShots', fileName: 'shots' } },
})
let js = ''
let css = ''
for (const o of (Array.isArray(out) ? out : [out]).flatMap((x) => ('output' in x ? x.output : []))) {
  if (o.type === 'chunk') js += o.code
  else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
}
const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grammars</title><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
const URL_ = 'http://grammar-shots.test/'

const browser = await chromium.launch()
const files = []
const report = []
for (const [w, h] of [[1366, 768], [390, 844]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.route(`${URL_}**`, (r) => r.fulfill({ contentType: 'text/html', body: doc }))
    await page.goto(`${URL_}?theme=${theme}`)
    await page.locator('[data-shot]').first().waitFor()
    await page.waitForTimeout(6000)
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const f = resolve(OUT, `g02-grammars-${w}x${h}-${theme}.png`)
    await page.screenshot({ path: f, fullPage: true })
    files.push(f)
    report.push({ viewport: `${w}x${h}`, theme, runningAnimationsAfter6s: running, horizontalOverflowPx: overflowX })
    if (w === 1366) {
      // one viewport-sized crop per theme as well: what the owner sees first
      const top = resolve(OUT, `g02-grammars-${w}x${h}-${theme}-fold.png`)
      await page.screenshot({ path: top })
      files.push(top)
    }
    await ctx.close()
  }
}
// the rows a 1x sheet cannot show (16 px day cells, the portrait plates), at 3 device pixels per CSS pixel, light
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: theme, deviceScaleFactor: 3 })
  const page = await ctx.newPage()
  await page.route(`${URL_}**`, (r) => r.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}&calm=1`)
  await page.locator('[data-shot]').first().waitFor()
  for (const z of ['sigil-16', 'portraits']) {
    const f = resolve(OUT, `g02-zoom-${z}-x3-${theme}.png`)
    await page.locator(`[data-zoom="${z}"]`).screenshot({ path: f })
    files.push(f)
  }
  await ctx.close()
}
// forced colours, light, desktop: the CanvasText form
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, forcedColors: 'active', colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.route(`${URL_}**`, (r) => r.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=dark&calm=1`)
  await page.locator('[data-shot]').first().waitFor()
  await page.waitForTimeout(1000)
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
  const f = resolve(OUT, 'g02-grammars-1366x768-forced.png')
  await page.screenshot({ path: f, fullPage: true })
  files.push(f)
  report.push({ viewport: '1366x768', theme: 'forced-colors, calm', runningAnimationsAfter1s: running })
  await ctx.close()
}
await browser.close()
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ files, report }, null, 2))
console.log(JSON.stringify({ files, report }, null, 2))
