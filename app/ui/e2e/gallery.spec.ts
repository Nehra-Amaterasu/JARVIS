// The What is new gallery (package N01) in a real Chromium.
//
// The page is the real WhatIsNew view, built in memory by Vite from e2e/bench/entry.tsx (`?view=gallery`) and served from a
// fake origin, the way bench.spec.ts builds the bench; nothing is written near app/ui/dist and no token or port is used (8790
// is only started because the shared config starts the sandbox). The shell route to the same view (Alt+N, N02) is tested last
// and skips, with its reason, until N02 has mounted the place.
//
// Proved: no document scroll at 1366 x 768 and at 390 x 844 (the index and the specimen pane scroll inside themselves); the
// index is one tab stop with arrow keys; the filter, the theme switch, the section theme and the state switch work; every
// control is 44 px; the focus ring is drawn; zero animation frames and no running animation at idle; forced colours keep an
// edge on every control; no page error while all entries are opened one after another.
// Screenshots for the jury go to GALLERY_SHOTS (default test-results/gallery, which Playwright empties on every run, so the
// jury run passes a folder outside the repository).
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.GALLERY_SHOTS ? resolve(process.env.GALLERY_SHOTS) : resolve(ROOT, 'test-results', 'gallery')
const URL_ = 'http://gallery.test/'
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
    if (!js) throw new Error('the gallery build produced no script')
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    return { js, css }
  })()
  return bundle
}

async function openGallery(page: Page, theme: 'light' | 'dark' = 'light') {
  const { js, css } = await buildGallery()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>What is new</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?view=gallery&theme=${theme}`)
  await page.locator('[data-gallery]').waitFor()
  await page.waitForTimeout(500) // the one-frame number spring of the kit and the art image loads settle before anything is measured
}

const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, name) })
}
const pick = (page: Page, id: string) => page.locator(`.gl-item[data-entry-id="${id}"]`).click()
const noScroll = (page: Page) => page.evaluate(() => {
  const d = document.documentElement
  return { v: d.scrollHeight - innerHeight, h: d.scrollWidth - innerWidth, body: document.body.scrollHeight - innerHeight }
})

test.describe('at 1366 x 768', () => {
  test.use({ viewport: DESKTOP })

  test('draws, does not scroll the document, scrolls inside itself, and is composed', async ({ page }) => {
    await openGallery(page)
    const s = await noScroll(page)
    expect(s.v, 'vertical document scroll').toBeLessThanOrEqual(0)
    expect(s.h, 'horizontal document scroll').toBeLessThanOrEqual(0)
    const box = await page.locator('[data-gallery]').boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(1366 - 1)
    expect(box!.height).toBeGreaterThanOrEqual(768 - 1)
    // the index holds dozens of entries, so it scrolls in itself
    const idx = await page.locator('.gl-index').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
    expect(idx.sh).toBeGreaterThan(idx.ch)
    await expect(page.locator('article.gl-specimen')).toHaveCount(1)
    await shot(page, 'desktop-light-first.png')
  })

  test('the index is one tab stop; arrow keys move and the specimen follows; Home and End jump', async ({ page }) => {
    await openGallery(page)
    expect(await page.locator('.gl-item[tabindex="0"]').count()).toBe(1)
    const first = await page.locator('article.gl-specimen').getAttribute('data-entry')
    await page.locator('.gl-item[tabindex="0"]').focus()
    await page.keyboard.press('ArrowDown')
    const second = await page.locator('article.gl-specimen').getAttribute('data-entry')
    expect(second).not.toBe(first)
    await expect(page.locator('.gl-item[aria-current="true"]')).toHaveCount(1)
    await expect(page.locator('.gl-item[aria-current="true"]')).toBeFocused()
    await page.keyboard.press('End')
    const last = await page.locator('.gl-item').last().getAttribute('data-entry-id')
    expect(await page.locator('article.gl-specimen').getAttribute('data-entry')).toBe(last)
    await page.keyboard.press('Home')
    expect(await page.locator('article.gl-specimen').getAttribute('data-entry')).toBe(first)
  })

  test('the group filter, the theme switch, the section theme and the state switch work', async ({ page }) => {
    await openGallery(page)
    const total = await page.locator('.gl-item').count()
    const filter = page.getByRole('radiogroup', { name: 'Filter by group' })
    await filter.getByRole('radio', { name: /^Lamp/ }).click()
    const lamp = await page.locator('.gl-item').count()
    expect(lamp).toBeGreaterThan(0)
    expect(lamp).toBeLessThan(total)
    await filter.getByRole('radio', { name: /^All/ }).click()
    expect(await page.locator('.gl-item').count()).toBe(total)

    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'clay-dark')
    await page.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'clay-light')

    await page.getByLabel('Section').selectOption('study')
    await expect(page.locator('.gl-pane')).toHaveAttribute('data-section', 'study')

    await pick(page, 'kit/Switch')
    const all = await page.locator('.gl-state').count()
    expect(all).toBeGreaterThan(1)
    await page.getByRole('group', { name: 'How to draw the specimen' }).getByRole('radiogroup', { name: 'State' }).getByRole('radio').nth(1).click()
    await expect(page.locator('.gl-state')).toHaveCount(1)
  })

  test('every control is 44 px and the focus ring is drawn', async ({ page }) => {
    await openGallery(page)
    const small = await page.evaluate(() => {
      const bad: string[] = []
      document.querySelectorAll('.gl-radio, .gl-select select, .gl-item').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width < 44 || r.height < 44) bad.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`)
      })
      return bad
    })
    expect(small).toEqual([])
    await page.locator('.gl-item[tabindex="0"]').focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    const ring = await page.locator('.gl-item[tabindex="0"]').evaluate((el) => { const cs = getComputedStyle(el); return { w: cs.outlineWidth, s: cs.outlineStyle } })
    expect(ring.s).toBe('solid')
    expect(parseFloat(ring.w)).toBeGreaterThanOrEqual(2)
  })

  test('idle: no animation frame, no running animation, no timer-driven change', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: number }
      w.__raf = 0
      const orig = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (cb) => { w.__raf++; return orig(cb) }
    })
    await openGallery(page)
    await page.waitForTimeout(800)
    const before = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    const html0 = await page.locator('.gl-pane').innerHTML()
    await page.waitForTimeout(2000)
    const after = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    expect(after - before, 'animation frames in two idle seconds').toBe(0)
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0)
    expect(await page.locator('.gl-pane').innerHTML(), 'DOM churn at idle').toBe(html0)
  })

  test('opens every entry in turn without a page error or a console error', async ({ page }) => {
    const errs: string[] = []
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`) })
    await openGallery(page)
    const ids = await page.locator('.gl-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-entry-id')!))
    expect(ids.length).toBeGreaterThan(50)
    for (const id of ids) {
      await pick(page, id)
      await expect(page.locator('article.gl-specimen')).toHaveAttribute('data-entry', id)
    }
    expect(errs).toEqual([])
  })

  test('forced colours: every control keeps an edge', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await openGallery(page)
    const bad = await page.evaluate(() => {
      const out: string[] = []
      document.querySelectorAll('.gl-radio, .gl-select select').forEach((el) => {
        const cs = getComputedStyle(el)
        if (parseFloat(cs.borderTopWidth) < 1 || cs.borderTopStyle === 'none') out.push(el.className)
      })
      return out
    })
    expect(bad).toEqual([])
    await shot(page, 'desktop-forced-colors.png')
  })

  test('screenshots for the jury: both themes and the four showpieces', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await openGallery(page, theme)
      await pick(page, 'kit/Switch')
      await shot(page, `desktop-${theme}-switch.png`)
      await pick(page, 'kit/Key')
      await shot(page, `desktop-${theme}-key.png`)
      await pick(page, 'section/themes')
      await shot(page, `desktop-${theme}-sections.png`)
      await pick(page, 'theme/clay')
      await shot(page, `desktop-${theme}-themes.png`)
      await pick(page, 'manifest/art-ids')
      await page.waitForTimeout(400)
      await shot(page, `desktop-${theme}-art-ids.png`)
      await pick(page, 'voice/VoiceHill')
      await shot(page, `desktop-${theme}-voice.png`)
      await pick(page, 'art/Ridge')
      await shot(page, `desktop-${theme}-ridge.png`)
    }
  })
})

test.describe('at 390 x 844', () => {
  test.use({ viewport: PHONE })

  test('reflows to one column with no document scroll and 44 px targets', async ({ page }) => {
    await openGallery(page)
    const s = await noScroll(page)
    expect(s.v).toBeLessThanOrEqual(0)
    expect(s.h, 'horizontal document scroll').toBeLessThanOrEqual(0)
    const cols = await page.locator('[data-gallery]').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    expect(cols).toBe(1)
    const [side, pane] = await Promise.all([page.locator('.gl-side').boundingBox(), page.locator('.gl-main').boundingBox()])
    expect(side!.y + side!.height).toBeLessThanOrEqual(pane!.y + 1)
    const small = await page.evaluate(() => {
      const bad: string[] = []
      document.querySelectorAll('.gl-radio, .gl-select select, .gl-item').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && (r.width < 44 || r.height < 44)) bad.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`)
      })
      return bad
    })
    expect(small).toEqual([])
    await shot(page, 'phone-light-first.png')
    await pick(page, 'kit/Key')
    await shot(page, 'phone-light-key.png')
    await page.getByRole('radio', { name: 'Dark' }).click()
    await pick(page, 'section/themes')
    await shot(page, 'phone-dark-sections.png')
  })
})

test.describe('in the shell', () => {
  test.use({ viewport: DESKTOP })

  test('Alt+N opens the gallery (skips until N02 has mounted the place app.new)', async ({ page, baseURL }) => {
    const res = await fetch(baseURL!).catch(() => null)
    test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npm run bundle:check` first')
    await page.goto('/#t=ww-e2e&shell=v2')
    await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Alt+n')
    const here = await page.locator('[data-gallery]').waitFor({ timeout: 4000 }).then(() => true, () => false)
    test.skip(!here, 'the place app.new is not mounted on this branch (N02 owns the shell)')
    const s = await noScroll(page)
    expect(s.v).toBeLessThanOrEqual(0)
    const canvas = await page.locator('[data-gallery]').boundingBox()
    expect(Math.round(canvas!.width)).toBe(1302)
    expect(Math.round(canvas!.height)).toBe(720)
  })
})
