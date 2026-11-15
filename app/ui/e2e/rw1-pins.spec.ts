// RW1: the relay pin map in a real Chromium. The page is the pin map alone (e2e/rw1-harness.tsx) built in memory,
// as e2e/l02-trim.spec.ts does; nothing is written near app/ui/dist. Proved: the keyboard path (Tab to the fold, Enter opens,
// Tab to a test key, Escape cools it), every control 44 px, the collapsed fold at most 56 px high and the open map at most
// 360 px at 1366, one column at 390 with no sideways scroll, the second press before anything is saved. Screenshots go to
// RW1_SHOTS (a folder outside the repository) when it is set.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.RW1_SHOTS ? resolve(process.env.RW1_SHOTS) : ''
const URL_ = 'http://rw1.test/'
const FONTS = `body{margin:0}html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }
type W = { __saved: unknown[]; __tests: string[] }

let bundle: Promise<{ js: string; css: string }> | null = null
function buildHarness() {
  bundle ??= (async () => {
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'e2e/rw1-harness.tsx'), formats: ['iife'], name: 'Rw1Harness', fileName: 'rw1' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    return { js, css }
  })()
  return bundle
}

async function open(page: Page, theme: 'light' | 'dark', query: string) {
  const { js, css } = await buildHarness()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pins</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}&${query}`)
  await page.locator('.ww-fold').waitFor()
}
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, name) })
}
const mapBox = (page: Page) => page.locator('.ww-fold').evaluate((el) => { const r = el.getBoundingClientRect(); return { h: r.height, w: r.width } })

for (const [size, vp] of [['1366x768', DESKTOP], ['390x844', PHONE]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${size} ${theme}`, () => {
      test.use({ viewport: vp })

      test('collapsed it is one row of at most 56 px; open it is at most 360 px at 1366 and never scrolls', async ({ page }) => {
        await open(page, theme, '')
        expect((await mapBox(page)).h).toBeLessThanOrEqual(56)
        await shot(page, `pins-${size}-${theme}-closed.png`)
        await page.locator('.ww-fold-btn').click()
        const b = await mapBox(page)
        if (size === '1366x768') expect(b.h).toBeLessThanOrEqual(360)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        if (size === '1366x768') expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
        await shot(page, `pins-${size}-${theme}-open.png`)
      })

      test('every control is at least 44 px and nothing is under 11 px', async ({ page }) => {
        await open(page, theme, 'open=1&adapter=1')
        const small = await page.locator('.ww-fold').evaluate((root) => {
          const bad: string[] = []
          for (const c of root.querySelectorAll('button, input')) {
            const r = c.getBoundingClientRect()
            if (r.height < 43.5) bad.push(`${c.className || c.tagName} ${r.height}`)
          }
          for (const t of root.querySelectorAll('*')) {
            if ([...t.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()) && parseFloat(getComputedStyle(t).fontSize) < 11) bad.push(`text ${t.className}`)
          }
          return bad
        })
        expect(small).toEqual([])
        await shot(page, `pins-${size}-${theme}-edit.png`)
      })
    })
  }
}

test.describe('keyboard and the confirm', () => {
  test.use({ viewport: DESKTOP })

  test('Tab reaches the fold, Enter opens it, a test key arms on one press and cools on Escape', async ({ page }) => {
    await open(page, 'dark', '')
    await page.keyboard.press('Tab')
    await expect(page.locator('.ww-fold-btn')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.ww-fold-body')).toBeVisible()
    await page.keyboard.press('Tab')
    const key = page.locator('.pp-test').first()
    await expect(key).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(key).toHaveText('Switch 1 s?')
    await page.keyboard.press('Escape')
    await expect(key).toHaveText('Test')
    expect(await page.evaluate(() => (window as unknown as W).__tests)).toEqual([])
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__tests)).toEqual(['r1'])
    const ring = await key.evaluate((el) => { const s = getComputedStyle(el); return `${s.outlineStyle} ${s.outlineWidth}` })
    expect(ring).toMatch(/solid 2px/)
  })

  test('an edited pin reaches the board only on the second Apply', async ({ page }) => {
    await open(page, 'light', 'open=1&adapter=1')
    const saved = () => page.evaluate(() => (window as unknown as W).__saved)
    await page.getByLabel('GPIO pin for Tube light').fill('9')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page.locator('.pp-say')).toHaveText('Press again to confirm. This is a hardware setting.')
    expect(await saved()).toEqual([])
    await page.getByRole('button', { name: 'Apply again to confirm' }).click()
    await expect.poll(saved).toEqual([{ r1: 9 }])
  })

  test('with no save route the map is read-only and says PLANNED', async ({ page }) => {
    await open(page, 'light', 'open=1')
    await expect(page.locator('.pp-foot')).toContainText('PLANNED')
    await expect(page.locator('.pp-row input')).toHaveCount(0)
  })
})
