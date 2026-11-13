// A.B05 in a real Chromium: Shell v2 with the app.shell flag ON, on the built app (dist-e2e) against the sandbox.
//
// The flag is set the way a person sets it: the URL fragment `shell=v2` (shell/flag.ts), next to the sandbox token
// `t=ww-e2e`. The fragment is written to localStorage, and every test starts in a fresh browser context, so no
// test leaks the flag into another. Needs `npm run bundle:check` first (it builds dist-e2e); skips otherwise.
//
// Proves: every section and view reachable by keyboard alone; the rail is one tab stop with roving tabindex;
// Ctrl+1..5 follow the binding table and Alt+0 swaps product; the palette opens, closes and returns focus;
// every shell control's hit area is 44 px or more, measured from bounding boxes; no vertical document scroll at
// 1366x768 (and the T720 floor); one column at 390 px. Screenshots go to test-results/jury-b05 (git-ignored).
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// JURY_SHOTS sends the jury screenshots elsewhere (outside the repository); the default stays git-ignored
const SHOTS = process.env.JURY_SHOTS ?? resolve('test-results', 'jury-b05')
const JARVIS = ['core', 'room', 'senses', 'memory', 'console']
const WW = ['day', 'focus', 'study', 'tree', 'career']
const VIEWS: Record<string, string[]> = {
  core: ['talk', 'sound'], room: ['switches', 'rules'], senses: ['presence', 'signal', 'teach'],
  memory: ['recall', 'beliefs', 'people', 'keep'], console: ['health', 'events', 'connections', 'hardware', 'crew'],
  day: ['today', 'week', 'month', 'body', 'close'], focus: ['start', 'session', 'rest', 'drill'], study: ['papers', 'practice', 'plan', 'library', 'dmat'],
  tree: ['tree'], career: ['pipeline', 'certs', 'abroad', 'money', 'ladder'],
}

async function open(page: Page, baseURL: string | undefined, flag = 'shell=v2') {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npm run bundle:check` first')
  await page.goto(`/#t=ww-e2e${flag ? `&${flag}` : ''}`)
  if (flag) await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
}

const pageRoot = (page: Page) => page.locator('.s2-page')

/** Leave any text field a legacy page focused, so single keys like ] are not swallowed (setup, not a key path). */
const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function product(page: Page) {
  return page.locator('[data-shell="v2"]').getAttribute('data-product')
}

async function toProduct(page: Page, want: 'jarvis' | 'ww') {
  if ((await product(page)) !== want) await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', want)
}

test.describe('Shell v2, flag on', () => {
  test('flag off is today\'s frame: dock, ticker, no shell root, no clay attribute', async ({ page, baseURL }) => {
    await open(page, baseURL, '')
    await expect(page.locator('.app .dock')).toBeVisible()
    await expect(page.locator('.app .ticker')).toBeVisible()
    await expect(page.locator('[data-shell]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? '')).not.toMatch(/^clay-/)
  })

  test('geometry at 1366x768: title 48, rail 64, canvas 1302 x 720, no document scroll', async ({ page, baseURL }) => {
    await open(page, baseURL)
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!
    expect((await box('.s2-title')).height).toBe(48)
    const rail = await box('.s2-rail')
    expect(rail.width).toBe(64)
    expect(rail.height).toBe(720)
    const canvas = await box('.s2-canvas')
    expect([canvas.x, canvas.y, canvas.width, canvas.height]).toEqual([64, 48, 1302, 720])
    for (const p of ['jarvis', 'ww'] as const) {
      await toProduct(page, p)
      for (const n of [1, 2, 3, 4, 5]) {
        await page.keyboard.press(`Control+${n}`)
        await page.waitForTimeout(150)
        const s = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, bs: document.body.scrollHeight, sy: scrollY }))
        expect(s.sh, `${p} slot ${n}`).toBeLessThanOrEqual(s.ih)
        expect(s.bs).toBeLessThanOrEqual(s.ih)
        expect(s.sy).toBe(0)
      }
    }
  })

  test('T720 floor: canvas is 1302 x 672 and the document still does not scroll', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1366, height: 720 })
    await open(page, baseURL)
    const c = (await page.locator('.s2-canvas').boundingBox())!
    expect([c.width, c.height]).toEqual([1302, 672])
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  })

  test('Ctrl+1..5 follow the table and Alt+0 swaps product; data-product, data-section, data-view on the page root', async ({ page, baseURL }) => {
    await open(page, baseURL)
    for (const [p, order] of [['jarvis', JARVIS], ['ww', WW]] as const) {
      await toProduct(page, p)
      await expect(page.locator('html')).toHaveAttribute('data-product', p)
      await expect(page.locator('html')).toHaveAttribute('data-theme', p === 'jarvis' ? 'clay-dark' : 'clay-light')
      for (const [i, sec] of order.entries()) {
        await page.keyboard.press(`Control+${i + 1}`)
        await expect(pageRoot(page)).toHaveAttribute('data-section', sec)
        await expect(pageRoot(page)).toHaveAttribute('data-product', p)
        await expect(pageRoot(page)).toHaveAttribute('data-view', sec === 'day' ? 'today' : /.+/)
        // Alt+n is the alias
        await page.keyboard.press(`Alt+${((i + 1) % 5) + 1}`)
        await expect(pageRoot(page)).toHaveAttribute('data-section', order[(i + 1) % 5])
      }
    }
    // Ctrl+0 is left to the browser (zoom reset), not bound
    const before = await product(page)
    await page.keyboard.press('Control+0')
    expect(await product(page)).toBe(before)
  })

  test('every section and every view is reachable by keyboard alone', async ({ page, baseURL }) => {
    await open(page, baseURL)
    const seen: string[] = []
    for (const [p, order] of [['jarvis', JARVIS], ['ww', WW]] as const) {
      await toProduct(page, p)
      for (const [i, sec] of order.entries()) {
        await page.keyboard.press(`Control+${i + 1}`)
        await expect(pageRoot(page)).toHaveAttribute('data-section', sec)
        await blurText(page)
        // step back to the first view, then forward through every one with ]
        for (let k = 0; k < 5; k++) await page.keyboard.press('[')
        for (const [j, v] of VIEWS[sec].entries()) {
          if (j > 0) await page.keyboard.press(']')
          await expect(pageRoot(page)).toHaveAttribute('data-view', v)
          seen.push(`${sec}.${v}`)
          await blurText(page)
        }
      }
    }
    // 36 since day.month and focus.drill joined the id table (D-V2-10, D-V2-11; __tests__/shell/viewCount.test.ts)
    expect(seen).toHaveLength(36)
  })

  test('the rail is one tab stop with roving tabindex; arrows move, Enter opens, Tab leaves', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await toProduct(page, 'jarvis')
    await page.keyboard.press('Control+1')
    const slots = page.locator('.s2-rail [data-rove]')
    await expect(slots).toHaveCount(6) // five sections and the Ask orb
    const zero = async () => slots.evaluateAll((els) => els.filter((e) => e.getAttribute('tabindex') === '0').length)
    expect(await zero()).toBe(1)
    // Tab from the title bar reaches the rail's single stop, the active section
    await page.locator('.s2-title').focus().catch(() => undefined)
    let guard = 0
    while (!(await page.evaluate(() => !!document.activeElement?.closest('.s2-rail'))) && guard++ < 25) await page.keyboard.press('Tab')
    await expect(page.locator('.s2-rail [data-slot="core"]')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.s2-rail [data-slot="room"]')).toBeFocused()
    expect(await zero()).toBe(1)
    await page.keyboard.press('End')
    await expect(page.locator('.s2-rail [data-ask]')).toBeFocused()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(pageRoot(page)).toHaveAttribute('data-section', 'senses')
    // one Tab leaves the rail entirely: no second stop inside it
    await page.locator('.s2-rail [data-slot="senses"]').focus()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.s2-rail'))).toBe(false)
  })

  test('palette: Ctrl+K opens with focus in the field, Esc closes and focus returns; hints only from bindings', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await toProduct(page, 'jarvis')
    const slot = page.locator('.s2-rail [data-slot="core"]')
    await page.keyboard.press('Control+1')
    await slot.focus()
    await page.keyboard.press('Control+k')
    const dialog = page.locator('[data-overlay="palette"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('input')).toBeFocused()
    // paged at 7 rows, so the list never scrolls
    expect(await dialog.locator('[role="option"]').count()).toBeLessThanOrEqual(7)
    const hints = await dialog.locator('kbd').allTextContents()
    for (const h of hints) expect(h).toMatch(/^(Ctrl [1-5K]|Alt [0RN]|\?|\[|\]|Alt Left)$/)
    // Tab stays inside the dialog
    await page.keyboard.press('Tab')
    await expect(dialog.locator('input')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(slot).toBeFocused()
    // Go by typing: Ctrl+K, a few letters, Enter
    await page.keyboard.press('Control+k')
    await page.keyboard.type('console')
    await page.keyboard.press('Enter')
    await expect(pageRoot(page)).toHaveAttribute('data-section', 'console')
    // a planned verb opens "What is coming" and runs nothing
    await page.keyboard.press('Control+k')
    await page.keyboard.type('wake word')
    const planned = dialog.locator('[data-planned]')
    if (await planned.count()) {
      await page.keyboard.press('Enter')
      await expect(page.locator('[data-overlay="roadmap"]')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-overlay="roadmap"]')).toHaveCount(0)
    } else {
      await page.keyboard.press('Escape')
    }
  })

  test('shortcuts sheet lists the binding table and closes with Esc', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await blurText(page)
    await page.keyboard.press('Shift+?')
    const sheet = page.locator('[data-overlay="shortcuts"]')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-binding="slot.1"]')).toContainText('Ctrl 1')
    await expect(sheet.locator('[data-binding="product.swap"]')).toContainText('Alt 0')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })

  test('hit areas: every shell control is at least 44 x 44 px, measured from bounding boxes', async ({ page, baseURL }) => {
    await open(page, baseURL)
    const small: string[] = []
    for (const p of ['jarvis', 'ww'] as const) {
      await toProduct(page, p)
      for (const n of [1, 2, 3, 4, 5]) {
        await page.keyboard.press(`Control+${n}`)
        await page.waitForTimeout(100)
        const bad = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('.s2-title button, .s2-rail button, .s2-views [role="tab"]')]
            .filter((el) => el.offsetParent !== null)
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width < 44 || r.height < 44)
            .map(({ el, r }) => `${el.className || el.tagName} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`))
        small.push(...bad.map((b) => `${p}.${n}: ${b}`))
      }
    }
    expect(small).toEqual([])
  })

  test('390 px: one column, rail as a bottom bar, no horizontal or vertical document scroll', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, baseURL)
    for (const p of ['jarvis', 'ww'] as const) {
      await toProduct(page, p)
      const canvas = (await page.locator('.s2-canvas').boundingBox())!
      const rail = (await page.locator('.s2-rail').boundingBox())!
      expect(canvas.x).toBe(0)
      expect(canvas.width).toBe(390)
      expect(rail.width).toBe(390)
      expect(rail.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1)
      const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }))
      expect(doc.sw).toBeLessThanOrEqual(doc.iw)
      expect(doc.sh).toBeLessThanOrEqual(doc.ih)
      const slots = await page.locator('.s2-rail [data-rove]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.width, r.height]))
      expect(slots).toHaveLength(6)
      for (const [w, h] of slots) expect(Math.min(w, h)).toBeGreaterThanOrEqual(44)
      // the Resume pill is its own row under the title bar
      const pill = (await page.locator('.s2-pillrow .s2-pill').boundingBox())!
      expect(pill.height).toBeGreaterThanOrEqual(44)
      expect(pill.y).toBeGreaterThanOrEqual(48)
    }
  })

  test('screenshots for the jury at 1366x768 and 390x844', async ({ page, baseURL }) => {
    mkdirSync(SHOTS, { recursive: true })
    await open(page, baseURL)
    const shots: [string, 'jarvis' | 'ww', number][] = [['core', 'jarvis', 1], ['room', 'jarvis', 2], ['console', 'jarvis', 5], ['day', 'ww', 1], ['study', 'ww', 3], ['career', 'ww', 5]]
    for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size)
      for (const [name, p, n] of shots) {
        await toProduct(page, p)
        await page.keyboard.press(`Control+${n}`)
        await expect(pageRoot(page)).toHaveAttribute('data-section', name)
        await page.waitForTimeout(900)
        await page.screenshot({ path: resolve(SHOTS, `${name}-${size.width}x${size.height}.png`) })
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(200)
    await page.screenshot({ path: resolve(SHOTS, 'palette-1366x768.png') })
  })
})
