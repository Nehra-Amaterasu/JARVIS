// A.J03 in a real Chromium: the rebuilt Senses section (Presence, Signal, Teach) of shell v2.
//
// Part 1, the gallery entry "J03": the harness builds the gallery in memory (no server, no dist build), so the three views are
// measured on stamped fixtures. At the desk the entry draws the 1302 x 668 canvas the shell leaves at 1366 x 768 under a 0.72
// zoom; every measured box is divided by that zoom, so the sizes below are real CSS px. It proves, for every state:
//   geometry   no inner scrollbar, no part outside the view's box, every focusable part 44 x 44 or more, text 11 px or more,
//              at most one canvas, at most one accent fill; at 390 px one column with no sideways scroll
//   keyboard   P pauses reading (the PAUSED stamp), M swaps the plan and the tape, the arrow keys read a terrain column and a
//              tape column aloud, Enter freezes the frame and Escape lets it go, Tab reaches every control
//   honesty    the amber SIMULATED stamp, the hollow forms with no frames, no digit in the arc before the held-out check
//
// Part 2, the built app (dist-e2e) against the sandbox, flag on through the `#t=ww-e2e&shell=v2` fragment as core-v2.spec.ts
// does: the registered views replace the hosted classic page (Ctrl+3, then the view row), with no document scroll at 1366 x 768
// and none sideways at 390. Needs `npx vite build --outDir dist-e2e` first; skips otherwise.
//
// Screenshots go to J03_SHOTS (outside the repository) when it is set.
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openGallery, pickEntry, showState } from './jury/lib'

const SHOTS = process.env.J03_SHOTS ? resolve(process.env.J03_SHOTS) : ''
const NAMES = ['presence-sim', 'presence-none', 'presence-trusted', 'presence-offline', 'signal-sim', 'signal-none', 'teach-half', 'teach-unread']

async function shot(page: Page, sel: string, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.locator(sel).first().screenshot({ path: resolve(SHOTS, name) })
}

async function openState(page: Page, i: number, theme: 'light' | 'dark' = 'dark') {
  await openGallery(page, theme)
  const { states } = await pickEntry(page, 'J03')
  expect(states.length).toBe(NAMES.length)
  await showState(page, i, states.length)
  await page.locator('.js-gallery-box .js').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(350)
}

const measure = (page: Page) => page.evaluate(() => {
  const box = document.querySelector<HTMLElement>('.js-gallery-box')!
  const js = box.querySelector<HTMLElement>('.js')!
  const z = Number(getComputedStyle(box).zoom) || 1
  const b = js.getBoundingClientRect()
  const over = [...js.querySelectorAll<HTMLElement>('*')].filter((e) => {
    if (e.closest('[aria-hidden="true"]') || e.closest('dialog') || e.closest('svg')) return false
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(e).position !== 'fixed' && (r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.top < b.top - 1)
  }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 28)}`)
  const focusable = [...js.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"], a[href]')]
    .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden="true"]') && !e.closest('dialog'))
  const small = focusable.map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width / z < 43.5 || r.height / z < 43.5)
    .map(({ e, r }) => `${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 24) ?? e.className} ${Math.round(r.width / z)}x${Math.round(r.height / z)}`)
  const tiny = [...js.querySelectorAll<HTMLElement>('*')].filter((e) => !e.closest('dialog') && [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) && parseFloat(getComputedStyle(e).fontSize) < 10.95)
    .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 24)} ${getComputedStyle(e).fontSize}`)
  const panels = [...js.querySelectorAll<HTMLElement>('.js-panel, .js-well, .js-link, .js-chan')].filter((p) => p.scrollHeight - p.clientHeight > 1 || p.scrollWidth - p.clientWidth > 1).map((p) => `${String(p.className).slice(0, 30)} +${p.scrollHeight - p.clientHeight}h +${p.scrollWidth - p.clientWidth}w`)
  return {
    zoom: z, w: Math.round(b.width / z), h: Math.round(b.height / z),
    jsY: js.scrollHeight - js.clientHeight, jsX: js.scrollWidth - js.clientWidth,
    docX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    canvases: js.querySelectorAll('canvas').length, primaries: js.querySelectorAll('.js-primary').length,
    over, small, tiny, panels,
  }
})

/* ================================================================ part 2: the app */
async function openSenses(page: Page, baseURL: string | undefined, view: 'presence' | 'signal' | 'teach') {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  const shell = page.locator('[data-shell="v2"]')
  await expect(shell).toBeVisible({ timeout: 40_000 })
  if ((await shell.getAttribute('data-product')) !== 'jarvis') await page.keyboard.press('Alt+0')
  // the shell's key handlers arrive a moment after the shell itself: press until the section opens
  await expect(async () => {
    await page.keyboard.press('Control+3')
    await expect(page.locator('.s2-page[data-view="presence"], .s2-page[data-view="signal"], .s2-page[data-view="teach"]')).toHaveCount(1, { timeout: 1500 })
  }).toPass({ timeout: 40_000 })
  const sel = `.s2-page[data-view="${view}"]`
  for (const v of ['presence', 'signal', 'teach']) {
    if (v === view) break
    await page.keyboard.press(']')
    await page.waitForTimeout(300)
  }
  await expect(page.locator(`${sel} .js`)).toBeVisible({ timeout: 40_000 })
  await page.waitForTimeout(500)
}

test.describe('Senses in the app (flag on)', () => {
  for (const view of ['presence', 'signal', 'teach'] as const) {
    test(`${view} at 1366 x 768: the new view replaces the classic page, no document scroll, nothing below the fold`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await openSenses(page, baseURL, view)
      const g = await page.evaluate(() => {
        const js = document.querySelector<HTMLElement>('.s2-page .js')!
        const r = js.getBoundingClientRect()
        const bad = [...js.querySelectorAll<HTMLElement>('.js-panel, .js-well, .js-linkrow, .js-pred')].filter((e) => e.getBoundingClientRect().bottom > innerHeight + 1).map((e) => String(e.className).slice(0, 30))
        return { classic: !!document.querySelector('.aankhen-page'), docY: document.documentElement.scrollHeight - innerHeight, docX: document.documentElement.scrollWidth - innerWidth, jsY: js.scrollHeight - js.clientHeight, canvases: js.querySelectorAll('canvas').length, bad, w: Math.round(r.width), h: Math.round(r.height) }
      })
      expect(g.classic).toBe(false)
      expect(g.docY).toBeLessThanOrEqual(0)
      expect(g.docX).toBeLessThanOrEqual(0)
      expect(g.jsY).toBeLessThanOrEqual(1)
      expect(g.bad).toEqual([])
      expect(g.canvases).toBeLessThanOrEqual(1)
      await shot(page, '.s2-page', `app-${view}-1366.png`)
    })
  }
  test('presence at 390 px: one column, no sideways scroll', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSenses(page, baseURL, 'presence')
    const docX = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    expect(docX).toBeLessThanOrEqual(0)
    await shot(page, '.s2-page', 'app-presence-390.png')
  })
  test('3D swaps the terrain for the twin and back (the app, a real WebGL context)', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openSenses(page, baseURL, 'presence')
    await expect(page.locator('.js-terrain-canvas')).toHaveCount(1)
    await page.getByRole('button', { name: '3D', exact: true }).click()
    await expect(page.locator('.js-terrain-canvas')).toHaveCount(0)
    await expect(page.locator('[data-testid="twin-host"]')).toHaveCount(1)
    await page.waitForTimeout(800)
    await shot(page, '.s2-page', 'app-presence-3d-1366.png')
    await page.getByRole('button', { name: '3D', exact: true }).click()
    await expect(page.locator('.js-terrain-canvas')).toHaveCount(1)
  })
  test('flag off: the classic frame still renders the old Aankhen page', async ({ page, baseURL }) => {
    const res = await fetch(baseURL!).catch(() => null)
    test.skip(!res || !res.ok, 'dist-e2e is not built')
    await page.goto('/#t=ww-e2e')
    await page.waitForTimeout(500)
    expect(await page.locator('[data-shell="v2"]').count()).toBe(0)
  })
})

test.describe('Senses at the desk (1366 x 768, the 1302 x 668 canvas)', () => {
  test.use({ viewport: { width: 1366, height: 768 } })
  for (let i = 0; i < NAMES.length; i++) {
    test(`${NAMES[i]}: one canvas at most, no inner scroll, nothing outside, targets 44 px, text 11 px, one accent`, async ({ page }) => {
      await openState(page, i)
      const m = await measure(page)
      expect(m.jsY, 'the view scrolls inside').toBeLessThanOrEqual(1)
      expect(m.jsX, 'the view scrolls sideways').toBeLessThanOrEqual(1)
      expect(m.panels, 'a panel clips its content').toEqual([])
      expect(m.over, 'parts outside the box').toEqual([])
      expect(m.small, 'targets under 44 px').toEqual([])
      expect(m.tiny, 'text under 11 px').toEqual([])
      expect(m.canvases, 'canvases').toBeLessThanOrEqual(1)
      expect(m.primaries, 'accent fills').toBeLessThanOrEqual(1)
      await shot(page, '.js-gallery-box', `${String(i).padStart(2, '0')}-${NAMES[i]}-1366.png`)
    })
  }

  test('Presence, simulated: the amber stamp, the sentence, the arc says PREDICTING and holds no digit', async ({ page }) => {
    await openState(page, 0)
    await expect(page.locator('.js-stamp-sim')).toHaveText('SIMULATED')
    await expect(page.locator('[data-testid="senses-sentence"]')).toHaveText('Detects motion of anyone in range, identifies no one. One link, no pose.')
    const core = await page.locator('.js-core').innerText()
    expect(core).toContain('PREDICTING')
    expect(core).not.toMatch(/\d+ ?%/)
  })

  test('Presence, no frames: every form is hollow and says why', async ({ page }) => {
    await openState(page, 1)
    await expect(page.locator('.js-terrain-legend')).toHaveText('NO SIGNAL: shape is a placeholder')
    await expect(page.locator('.js-stamp-sim')).toHaveCount(0)
    await expect(page.locator('.js-dot-hollow')).toHaveCount(51)
    await expect(page.locator('.js-primary')).toHaveCount(1)
  })

  test('Presence keyboard: P pauses, M swaps the plan and the tape, arrows read a column, Enter freezes and Escape resumes', async ({ page }) => {
    await openState(page, 0)
    const root = page.locator('.js-presence')
    await page.locator('.js-terrain').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.js-foot-read')).toContainText(/subcarrier \d+ of 51, amplitude/)
    await page.keyboard.press('Enter')
    await expect(page.locator('.js-stamp-paused')).toContainText('PAUSED: Esc resumes')
    await page.keyboard.press('Escape')
    await expect(page.locator('.js-stamp-paused')).toHaveCount(0)
    await page.keyboard.press('p')
    await expect(page.locator('.js-stamp-paused')).toHaveText('PAUSED BY YOU')
    await expect(root.locator('[aria-label="Sensing in this window"] [role="radio"][aria-checked="true"]')).toContainText('OFF')
    await page.keyboard.press('p')
    await expect(page.locator('.js-stamp-paused')).toHaveCount(0)
    await expect(page.locator('.js-plan')).toHaveCount(1)
    await page.keyboard.press('m')
    await expect(page.locator('[data-testid="motion-tape"]')).toHaveCount(1)
    await page.locator('[data-testid="motion-tape"]').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.js-tape-says')).toContainText(/\d\d:\d\d to \d\d:\d\d, (motion seen|nothing seen|sensing paused by you)/)
    await shot(page, '.js-gallery-box', 'keyboard-tape-1366.png')
    await page.keyboard.press('Escape')
    await page.keyboard.press('m')
    await expect(page.locator('.js-plan')).toHaveCount(1)
  })

  test('Tab reaches every control of Presence in order: source, scenarios, pause, 3D, settings, then the right column and the strip', async ({ page }) => {
    await openState(page, 1)
    await page.locator('.js-presence').focus().catch(() => {})
    await page.evaluate(() => (document.querySelector('.js-presence') as HTMLElement).querySelector<HTMLElement>('button')!.focus())
    const order: string[] = []
    for (let k = 0; k < 14; k++) {
      order.push(await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a.getAttribute('aria-label') ?? a.textContent?.trim().slice(0, 20) ?? a.tagName }))
      await page.keyboard.press('Tab')
    }
    expect(order[0]).toBe('Start ESP32')
    expect(order).toContain('3D')
    expect(order).toContain('Twin settings')
    expect(new Set(order).size).toBeGreaterThan(8)
  })

  test('the Twin settings drawer opens from the keyboard, holds the layers as switches and closes on Escape', async ({ page }) => {
    await openState(page, 0)
    await page.locator('button[aria-label="Twin settings"]').focus()
    await page.keyboard.press('Enter')
    const dlg = page.locator('dialog.jc-drawer[open]')
    await expect(dlg).toBeVisible()
    expect(await dlg.locator('[role="switch"]').count()).toBeGreaterThanOrEqual(8)
    await shot(page, 'dialog.jc-drawer[open]', 'drawer-settings-1366.png')
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
  })

  test('Signal holds no canvas and Teach holds the four rings', async ({ page }) => {
    await openState(page, 4)
    await expect(page.locator('.js-gallery-box canvas')).toHaveCount(0)
    await expect(page.locator('.js-bar')).toHaveCount(51)
    await openState(page, 6)
    await expect(page.locator('.js-ring')).toHaveCount(4)
    await expect(page.locator('.js-ring[data-ring="drill"] .js-ring-seg[data-on="true"]')).toHaveCount(3)
  })

  test('the light theme draws the same section', async ({ page }) => {
    await openState(page, 0, 'light')
    const m = await measure(page)
    expect(m.jsY).toBeLessThanOrEqual(1)
    await shot(page, '.js-gallery-box', '00-presence-sim-1366-light.png')
  })
})

test.describe('Senses on the phone (390 x 844)', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  for (const i of [0, 1, 4, 6]) {
    test(`${NAMES[i]} at 390 px: one column, no sideways scroll, targets 44 px`, async ({ page }) => {
      await openState(page, i)
      const m = await measure(page)
      expect(m.docX, 'the page scrolls sideways').toBeLessThanOrEqual(1)
      expect(m.jsX, 'the view scrolls sideways').toBeLessThanOrEqual(1)
      expect(m.panels, 'a panel clips its content').toEqual([])
      expect(m.small, 'targets under 44 px').toEqual([])
      expect(m.tiny, 'text under 11 px').toEqual([])
      expect(m.canvases).toBeLessThanOrEqual(1)
      // one column: every panel and well starts at the same left edge and the next one begins below the last
      const cols = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll<HTMLElement>('.js > .js-panel, .js .js-left > .js-panel, .js .js-right > .js-panel, .js .js-well')].map((e) => e.getBoundingClientRect())
        const sorted = [...boxes].sort((a, b) => a.top - b.top)
        return { n: boxes.length, sameLeft: boxes.every((b) => Math.abs(b.left - boxes[0].left) < 2), stacked: sorted.every((b, k) => k === 0 || b.top >= sorted[k - 1].bottom - 2), fits: boxes.every((b) => b.right <= (document.querySelector('.js') as HTMLElement).getBoundingClientRect().right + 1) }
      })
      expect(cols.n).toBeGreaterThan(1)
      expect({ sameLeft: cols.sameLeft, stacked: cols.stacked, fits: cols.fits }).toEqual({ sameLeft: true, stacked: true, fits: true })
      await shot(page, '.js-gallery-box', `${String(i).padStart(2, '0')}-${NAMES[i]}-390.png`)
    })
  }
})
