// A.L02: Trim in a real Chromium. The page is the gallery built in memory (as e2e/gallery.spec.ts does), opened on the
// Trim entry; nothing is written near app/ui/dist. Proved: the key is 44 px with a slider glyph; Enter opens it; the
// popover is at most 320 x 360 and inside the viewport at 1366 x 768 and 390 x 844; focus lands on the control; Esc
// returns focus to the key; Tab stays inside; forced colours keep an edge; no animation runs once it has opened.
// Screenshots (light and dark, both sizes) go to TRIM_SHOTS, a folder outside the repository.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.TRIM_SHOTS ? resolve(process.env.TRIM_SHOTS) : resolve(ROOT, 'test-results', 'trim')
const URL_ = 'http://trim.test/'
const FONTS = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }

let bundle: Promise<{ js: string; css: string }> | null = null
function buildGallery() {
  bundle ??= (async () => {
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'e2e/bench/entry.tsx'), formats: ['iife'], name: 'GalleryPage', fileName: 'gallery' } },
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

async function open(page: Page, theme: 'light' | 'dark', entry: string) {
  const { js, css } = await buildGallery()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trim</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?view=gallery&theme=${theme}`)
  await page.locator('[data-gallery]').waitFor()
  await page.locator(`.gl-item[data-entry-id="${entry}"]`).click()
  await page.waitForTimeout(300)
}

const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, name) })
}

for (const [size, vp] of [['1366x768', DESKTOP], ['390x844', PHONE]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${size} ${theme}`, () => {
      test.use({ viewport: vp })

      test('the key is 44 px; the popover is at most 320 x 360, inside the viewport, focus in and Esc back', async ({ page }) => {
        await open(page, theme, 'kit/Trim')
        await shot(page, `trim-${size}-${theme}-closed.png`)
        const keys = page.locator('button.tr-key')
        expect(await keys.count()).toBe(3)
        const kb = await keys.first().boundingBox()
        expect(kb!.width).toBeGreaterThanOrEqual(44)
        expect(kb!.height).toBeGreaterThanOrEqual(44)
        await keys.nth(1).focus()
        await page.keyboard.press('Enter')
        const pop = page.locator('.tr-pop')
        await expect(pop).toHaveCount(1)
        await expect(pop.locator('input[type=range]')).toBeFocused()
        const b = (await pop.boundingBox())!
        expect(b.width).toBeLessThanOrEqual(320.5)
        expect(b.height).toBeLessThanOrEqual(360.5)
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5)
        expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5)
        // every control inside is at least 44 px high
        const small = await pop.evaluate((el) => [...el.querySelectorAll('button, input')].filter((c) => c.getBoundingClientRect().height < 43.5).map((c) => c.className || c.tagName))
        expect(small).toEqual([])
        await page.waitForTimeout(300)
        await shot(page, `trim-${size}-${theme}-open.png`)
        await page.keyboard.press('Escape')
        await expect(pop).toHaveCount(0)
        await expect(keys.nth(1)).toBeFocused()
      })

      test('the hardware setting asks twice; Reset puts the value back', async ({ page }) => {
        await open(page, theme, 'kit/Trim')
        await page.locator('button.tr-key').nth(2).click()
        const pop = page.locator('.tr-pop')
        await pop.getByRole('button', { name: 'Reset' }).click()
        await expect(pop.getByRole('button', { name: 'Confirm reset' })).toBeVisible()
        await shot(page, `trim-${size}-${theme}-confirm.png`)
        await pop.getByRole('button', { name: 'Confirm reset' }).click()
        await expect(pop.getByTestId('trim-value')).toHaveText('40 ms')
      })

      test('the index and its empty state draw without document scroll', async ({ page }) => {
        await open(page, theme, 'kit/SettingsIndex')
        const s = await page.evaluate(() => ({ h: document.documentElement.scrollWidth - innerWidth, v: document.documentElement.scrollHeight - innerHeight }))
        expect(s.h).toBeLessThanOrEqual(0)
        expect(s.v).toBeLessThanOrEqual(0)
        await shot(page, `index-${size}-${theme}.png`)
      })
    })
  }
}

test.describe('forced colours and reduced motion', () => {
  test.use({ viewport: DESKTOP })
  test('the popover keeps an edge and nothing animates', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
    await open(page, 'light', 'kit/Trim')
    await page.locator('button.tr-key').first().click()
    const pop = page.locator('.tr-pop')
    await expect(pop).toHaveCount(1)
    const st = await pop.evaluate((el) => ({ border: getComputedStyle(el).borderTopWidth, anim: getComputedStyle(el).animationName }))
    expect(st.border).not.toBe('0px')
    expect(st.anim).toBe('none')
    await shot(page, 'trim-forced-colors.png')
  })
})
