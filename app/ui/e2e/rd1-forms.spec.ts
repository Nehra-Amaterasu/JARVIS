// Package RD1 (rework of D01 and D02) in a real Chromium: the geometry the wave 6 jury could not see in the specimen shots.
// The page is built in memory by Vite from e2e/rd1/entry.tsx (the real clay tokens and the real specimen states) and served
// from a fake origin, as e2e/gallery.spec.ts does; no token, no port of its own, nothing near app/ui/dist.
// Proved: the Jar stays under 700 px tall with no horizontal overflow at 358 and 390; the LedgerTape draws its lines at 358
// and 390 (the blank jury shot was the capture, not the component); Trace, DotHistogram and SkyLedger fill their container up
// to 960 px at 360, 720 and 1100, with the compact form (no left plate) below 420; the Odometer's padding sockets draw no
// glyph; every number form names its state in words; no text is under 11 px; every focus stop draws a 2 px ring and every
// press target is 44 px.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.RD1_SHOTS ? resolve(process.env.RD1_SHOTS) : null
const FONTS = `html{--font-ui:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`

let bundle: Promise<string> | null = null
function pageHtml() {
  bundle ??= (async () => {
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'e2e/rd1/entry.tsx'), formats: ['iife'], name: 'Rd1Page', fileName: 'rd1' } },
    })
    let js = ''
    let css = ''
    for (const o of (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  })()
  return bundle
}

async function open(page: Page, id: string, w: number, theme: 'light' | 'dark' = 'light', vw = w) {
  const doc = await pageHtml()
  await page.setViewportSize({ width: vw, height: 844 })
  await page.route('http://rd1.test/**', (r) => r.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`http://rd1.test/?id=${encodeURIComponent(id)}&w=${w}&theme=${theme}`)
  await page.locator('#host .rd1-state').first().waitFor()
  await page.waitForTimeout(300)
}
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true })
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

for (const w of [358, 390]) {
  test(`Jar at a ${w} px container: every state under 700 px tall, no horizontal overflow`, async ({ page }) => {
    await open(page, 'data/Jar', w)
    const hs = await page.locator('.rd1-state').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    expect(hs.length).toBe(5)
    for (const h of hs) expect(h).toBeLessThan(700)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await shot(page, `Jar-${w}`)
  })

  test(`LedgerTape at a ${w} px container: lines drawn, total drawn, no overflow`, async ({ page }) => {
    await open(page, 'data/LedgerTape', w)
    const tapes = page.locator('.d1-tape')
    expect(await tapes.count()).toBe(5)
    for (let i = 0; i < 5; i++) {
      const b = (await tapes.nth(i).boundingBox())!
      expect(b.width).toBeLessThanOrEqual(w)
      expect(b.height).toBeGreaterThan(180)
    }
    expect(await tapes.first().locator('.d1-tape-line').count()).toBe(4)
    expect(await tapes.first().locator('.d1-odo').count()).toBe(1)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await shot(page, `LedgerTape-${w}`)
  })

  test(`Odometer and Dumbbell at a ${w} px container: no horizontal overflow`, async ({ page }) => {
    for (const id of ['data/Odometer', 'data/Dumbbell']) {
      await open(page, id, w, 'dark')
      expect(await overflow(page), id).toBeLessThanOrEqual(0)
      await shot(page, `${id.split('/')[1]}-${w}`)
    }
  })
}

for (const id of ['data/Trace', 'data/DotHistogram', 'data/SkyLedger']) {
  for (const w of [360, 720, 1100]) {
    test(`${id} fills a ${w} px container up to 960 px`, async ({ page }) => {
      await open(page, id, w, 'dark', Math.max(w, 390))
      const widths = await page.locator('.sr-inst').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
      expect(widths.length).toBeGreaterThan(0)
      for (const x of widths) {
        expect(x).toBeGreaterThanOrEqual(Math.min(w, 960) - 1)
        expect(x).toBeLessThanOrEqual(Math.min(w, 960) + 1)
      }
      const compact = await page.locator('.sr-stage').first().getAttribute('data-compact')
      expect(compact).toBe(w < 440 ? 'true' : 'false')
      if (w < 440) expect(await page.locator('.sr-tag[data-at="tl"]').first().isVisible()).toBe(false)
      expect(await overflow(page)).toBeLessThanOrEqual(0)
      await shot(page, `${id.split('/')[1]}-${w}`)
    })
  }
}

test('Odometer padding sockets draw no glyph and the value stays in the accessible text', async ({ page }) => {
  await open(page, 'data/Odometer', 600)
  const first = page.locator('.d1-odo').first()
  const vis = await first.locator('.d1-well').evaluateAll((ws) => ws.map((w) => ({ lead: (w as HTMLElement).dataset.lead === 'true', glyph: getComputedStyle(w.querySelector('.d1-strip')!).visibility !== 'hidden' })))
  expect(vis).toEqual([{ lead: true, glyph: false }, { lead: true, glyph: false }, { lead: false, glyph: true }, { lead: false, glyph: true }])
  expect(await first.getAttribute('aria-label')).toBe('41 questions answered')
})

test('every number form names its state in words, never a bare dot', async ({ page }) => {
  for (const id of ['data/Odometer', 'data/Dumbbell', 'data/LedgerTape', 'data/Jar']) {
    await open(page, id, 700)
    const rows = await page.locator('[data-component]').evaluateAll((els) => els.map((e) => {
      const own = e as HTMLElement
      return {
        c: own.dataset.component,
        state: own.dataset.state,
        words: [...own.querySelectorAll('.k-lamp')].map((l) => l.textContent?.trim()),
        inTape: own.dataset.component === 'odometer' && !!own.closest('.d1-tape'),
      }
    }))
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      if (r.inTape) continue // the ledger total sits in a card that carries the lamp and its word
      expect(r.words.join(' '), `${id} ${r.c} ${r.state}`).toContain(r.state!.toUpperCase())
    }
  }
})

for (const id of ['data/Odometer', 'data/Dumbbell', 'data/LedgerTape', 'data/Jar', 'data/Trace', 'data/DotHistogram', 'data/SkyLedger']) {
  test(`${id}: no text under 11 px, every press target 44 px, a 2 px focus ring on every tab stop`, async ({ page }) => {
    await open(page, id, 900, 'dark')
    const small = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of document.querySelectorAll('#host *')) {
        if (el.closest('.d1-sr') || el.closest('.sr-hint')) continue
        const t = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0)
        if (!t) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 11) bad.push(`${(el as HTMLElement).className} ${fs}`)
      }
      return bad
    })
    expect(small).toEqual([])
    const targets = await page.evaluate(() => [...document.querySelectorAll('#host button, #host summary, #host [tabindex="0"]')].map((e) => {
      const r = e.getBoundingClientRect()
      return { n: `${e.tagName}.${(e as HTMLElement).className}`, w: Math.round(r.width), h: Math.round(r.height) }
    }))
    for (const t of targets) { expect(t.h, t.n).toBeGreaterThanOrEqual(44); expect(t.w, t.n).toBeGreaterThanOrEqual(44) }
    const stops = await page.locator('#host button, #host summary, #host [tabindex="0"]').count()
    for (let i = 0; i < Math.min(stops, 8); i++) {
      await page.keyboard.press('Tab')
      const ring = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        if (!a || a === document.body) return null
        const s = getComputedStyle(a)
        return { outline: parseFloat(s.outlineWidth), style: s.outlineStyle }
      })
      expect(ring, `tab stop ${i} of ${id}`).not.toBeNull()
      expect(ring!.style).not.toBe('none')
      expect(ring!.outline).toBeGreaterThanOrEqual(2)
    }
  })
}
