// D04 Capture line in a real Chromium: the keyboard path and the jury screenshots.
// Built in memory the way gallery.spec.ts builds the gallery (nothing near app/ui/dist, no token, no port of its own).
// Proved: typing reads as you type; "120" asks "? what is 120" and Enter on it commits nothing; Enter on a clear line commits
// and clears it; the Undo toast puts the text back; Ctrl+Space focuses the line from elsewhere (ww); the jarvis line says
// "unknown verb; try help"; the cursor block is solid (no animation); no document scroll at 1366 x 768 and 390 x 844; zero
// animation frames and running animations at idle.
// Screenshots go to GALLERY_SHOTS (outside the repository).
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.GALLERY_SHOTS ? resolve(process.env.GALLERY_SHOTS) : resolve(ROOT, 'test-results', 'd04')
const URL_ = 'http://d04.test/'
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

async function open(page: Page, theme: 'light' | 'dark', id: string) {
  const { js, css } = await buildGallery()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D04</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?view=gallery&theme=${theme}`)
  await page.locator('[data-gallery]').waitFor()
  await page.waitForTimeout(400)
  await page.locator(`.gl-item[data-entry-id="${id}"]`).click()
  await expect(page.locator('article.gl-specimen')).toHaveAttribute('data-entry', id)
}

const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, name) })
}
const states = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true })
  const n = await page.locator('.gl-state').count()
  for (let i = 0; i < n; i++) {
    const el = page.locator('.gl-state').nth(i)
    await el.scrollIntoViewIfNeeded()
    await el.screenshot({ path: resolve(SHOTS, `${name}-state${i + 1}.png`) })
  }
}
const first = (page: Page) => page.locator('.gl-state').first()

test.describe('keyboard, at 1366 x 768', () => {
  test.use({ viewport: DESKTOP })

  test('reads as you type, asks on "120", commits on a clear line, and Undo puts the text back', async ({ page }) => {
    await open(page, 'light', 'data/CaptureLine')
    const input = first(page).getByRole('textbox', { name: 'Capture' })
    await input.fill('120')
    await expect(first(page).locator('.cl-say')).toContainText('what is 120')
    await expect(first(page).locator('.cl')).toHaveAttribute('data-status', 'ambiguous')
    await input.press('Enter')
    expect(await input.inputValue(), 'an ambiguous line is not committed').toBe('120')
    await expect(first(page).locator('.cl-toast .k-toast, .cl-toast [role]')).toHaveCount(0)

    await input.fill('spent 120 chai')
    await expect(first(page).locator('.cl')).toHaveAttribute('data-status', 'ready')
    await expect(first(page).locator('.cl-chip')).not.toHaveCount(0)
    await input.press('Enter')
    expect(await input.inputValue()).toBe('')
    const undo = first(page).getByRole('button', { name: /undo/i })
    await expect(undo).toBeVisible()
    await undo.click()
    expect(await input.inputValue()).toBe('spent 120 chai')
  })

  test('Ctrl+Space focuses the ww line from elsewhere', async ({ page }) => {
    await open(page, 'light', 'data/CaptureLine')
    await page.locator('.gl-item[tabindex="0"]').focus()
    await page.keyboard.press('Control+Space')
    await expect(first(page).getByRole('textbox', { name: 'Capture' })).toBeFocused()
  })

  test('the jarvis line answers an unknown verb and holds', async ({ page }) => {
    await open(page, 'light', 'data/CaptureLine-jarvis')
    const input = page.locator('.gl-state').nth(3).getByRole('textbox')
    await expect(page.locator('.gl-state').nth(3).locator('.cl-say')).toContainText('unknown verb; try help')
    await input.press('Enter')
    expect(await input.inputValue()).toBe('format c:')
  })

  test('the cursor block is solid and nothing animates at idle', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: number }
      w.__raf = 0
      const orig = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (cb) => { w.__raf++; return orig(cb) }
    })
    await open(page, 'light', 'data/CaptureLine')
    const input = first(page).getByRole('textbox', { name: 'Capture' })
    await input.focus()
    await page.keyboard.type('water 250')
    await page.waitForTimeout(600)
    const block = first(page).locator('.cl-block')
    await expect(block).toHaveCount(1)
    const anim = await block.evaluate((el) => { const cs = getComputedStyle(el); return { name: cs.animationName, run: el.getAnimations().length } })
    expect(anim.name).toBe('none')
    expect(anim.run).toBe(0)
    const before = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    await page.waitForTimeout(1500)
    expect(await page.evaluate(() => (window as unknown as { __raf: number }).__raf) - before).toBe(0)
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0)
  })

  test('no document scroll; screenshots, light and dark', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      for (const id of ['data/CaptureLine', 'data/CaptureLine-jarvis']) {
        await open(page, theme, id)
        const s = await page.evaluate(() => ({ v: document.documentElement.scrollHeight - innerHeight, h: document.documentElement.scrollWidth - innerWidth }))
        expect(s.v).toBeLessThanOrEqual(0)
        expect(s.h).toBeLessThanOrEqual(0)
        await shot(page, `desktop-${theme}-${id.endsWith('jarvis') ? 'jarvis' : 'ww'}.png`)
        await states(page, `desktop-${theme}-${id.endsWith('jarvis') ? 'jarvis' : 'ww'}`)
      }
      await open(page, theme, 'data/CaptureLine')
      await first(page).getByRole('textbox').fill('spent 120 chai')
      await first(page).getByRole('textbox').press('Enter')
      await shot(page, `desktop-${theme}-ww-toast.png`)
    }
  })
})

test.describe('phone, at 390 x 844', () => {
  test.use({ viewport: PHONE })

  test('no horizontal scroll; screenshots', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await open(page, theme, 'data/CaptureLine')
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      expect(over).toBeLessThanOrEqual(0)
      const small = await page.evaluate(() => {
        const bad: string[] = []
        document.querySelectorAll('.cl-enter, .cl-chip-btn, .cl-input').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && (r.width < 44 || r.height < 44)) bad.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`)
        })
        return bad
      })
      expect(small).toEqual([])
      await shot(page, `phone-${theme}-ww.png`)
      await states(page, `phone-${theme}-ww`)
    }
  })
})
