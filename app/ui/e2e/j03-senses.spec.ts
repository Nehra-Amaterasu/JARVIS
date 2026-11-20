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
    await expect(root.locator('[aria-label="Sensing"] [role="radio"][aria-checked="true"]')).toContainText('OFF')
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

/* ================================================================ part 3: the lifted section (EL-SENSES) in the built app
   Folded in from the separate el-senses spec: geometry at 1366 x 768 and 390 x 844, the keyboard paths of the select and the
   key, the rocker's lit half against its unlit half (3:1 for a state), and the portalled select list on the Teach desk with
   a long session list (inside the viewport, opaque, its last option reachable). The sandbox shows WAITING, which is what is
   measured. Screenshots go to EL_SENSES_SHOTS (outside the repository) when it is set. */
const EL_SHOTS = process.env.EL_SENSES_SHOTS ? resolve(process.env.EL_SENSES_SHOTS) : ''
async function elShot(page: Page, name: string) {
  if (!EL_SHOTS) return
  mkdirSync(EL_SHOTS, { recursive: true })
  await page.locator('.s2-page').first().screenshot({ path: resolve(EL_SHOTS, name) })
}

const measureLifted = (page: Page) => page.evaluate(() => {
  const js = document.querySelector<HTMLElement>('.s2-page .js')!
  const visible = (e: HTMLElement) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden="true"]') && !e.closest('dialog')
  const small = [...js.querySelectorAll<HTMLElement>('button, input, [role="combobox"], [tabindex="0"]')].filter(visible)
    .map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width < 43.5 || r.height < 43.5)
    .map(({ e, r }) => `${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  const tiny = [...js.querySelectorAll<HTMLElement>('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) && parseFloat(getComputedStyle(e).fontSize) < 10.95)
    .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 24)}`)
  const ellipsis = [...js.querySelectorAll<HTMLElement>('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').map((e) => String(e.className).slice(0, 28))
  const outlined = [...js.querySelectorAll<HTMLElement>('.js-panel, .js-key, .js-choice, .js-tile, .js-chip, .js-select, .js-well, .js-link, .js-chan')]
    .filter((e) => visible(e) && ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(getComputedStyle(e).getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0))
    .map((e) => String(e.className).slice(0, 28))
  const slots = [...document.querySelectorAll<HTMLElement>('.s2-page [data-testid="senses-sentence"]')]
  const slot = slots[0]?.getBoundingClientRect()
  const jsBox = js.getBoundingClientRect()
  return {
    docY: document.documentElement.scrollHeight - innerHeight, docX: document.documentElement.scrollWidth - innerWidth,
    jsY: js.scrollHeight - js.clientHeight, jsX: js.scrollWidth - js.clientWidth,
    small, tiny, ellipsis, outlined, nativeSelects: js.querySelectorAll('select').length,
    sentences: slots.length, sentenceHeight: slot ? Math.round(slot.height) : 0, sentenceBelowView: slot ? slot.top >= jsBox.bottom - 1 : false,
    primaries: js.querySelectorAll('.js-primary:not([aria-disabled="true"])').length,
  }
})

test.describe('Senses, lifted (1366 x 768)', () => {
  test.use({ viewport: { width: 1366, height: 768 } })
  for (const view of ['presence', 'signal', 'teach'] as const) {
    test(`${view}: no scroll, nothing cut, targets 44 px, text 11 px, nothing outlined, the sentence in its one slot`, async ({ page, baseURL }) => {
      await openSenses(page, baseURL, view)
      const m = await measureLifted(page)
      expect(m.docY, 'document scroll').toBeLessThanOrEqual(0)
      expect(m.docX).toBeLessThanOrEqual(0)
      expect(m.jsY, 'the view scrolls inside').toBeLessThanOrEqual(1)
      expect(m.jsX).toBeLessThanOrEqual(1)
      expect(m.small, 'targets under 44 px').toEqual([])
      expect(m.tiny, 'text under 11 px').toEqual([])
      expect(m.ellipsis, 'text cut with an ellipsis').toEqual([])
      expect(m.outlined, 'a surface drawn by a border').toEqual([])
      expect(m.nativeSelects).toBe(0)
      expect(m.sentences, 'the honesty sentence appears once').toBe(1)
      expect(m.sentenceBelowView, 'it sits in the fixed slot under the view').toBe(true)
      expect(m.sentenceHeight, 'on one line').toBeLessThanOrEqual(28)
      expect(m.primaries, 'one warm fill at most').toBeLessThanOrEqual(1)
      await elShot(page, `${view}-1366.png`)
    })
  }

  test('Presence keyboard: the scenario select opens from the keyboard, its list is opaque and inside the viewport, Escape returns the focus', async ({ page, baseURL }) => {
    await openSenses(page, baseURL, 'presence')
    const trigger = page.getByRole('combobox', { name: 'Simulated scenario' })
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    const list = page.getByRole('listbox', { name: 'Simulated scenario' })
    await expect(list).toBeVisible()
    const bg = await list.evaluate((e) => getComputedStyle(e).backgroundColor)
    const alpha = /rgba\(.*,\s*([\d.]+)\)/.exec(bg)?.[1]
    expect(alpha === undefined || Number(alpha) === 1, `the list background must be opaque, got ${bg}`).toBe(true)
    const box = await list.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(1366)
    expect(box!.y + box!.height).toBeLessThanOrEqual(768)
    await expect(list.getByRole('option').first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('Presence: the rockers say their words, the unlit and lit halves differ by 3:1, and the strip is a labelled Predicting group', async ({ page, baseURL }) => {
    await openSenses(page, baseURL, 'presence')
    await expect(page.locator('.js-ctl-label', { hasText: 'Sensing' })).toBeVisible()
    await expect(page.locator('.js-ctl-label', { hasText: 'Fan' })).toBeVisible()
    const group = page.getByRole('group', { name: 'Predicting' })
    await expect(group.getByRole('group', { name: 'Corrections' })).toBeVisible()
    await expect(group.getByRole('group', { name: 'Corrections' }).getByRole('button', { name: 'Right' })).toBeVisible()
    await expect(group.getByRole('group', { name: 'Fan control' })).toBeVisible()
    // a state is told by more than its letters: the lit half is at least 3:1 against the unlit one, and its word 4.5:1 on it
    const ratios = await page.evaluate(() => {
      const lum = (rgb: string) => {
        const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(rgb)!
        const c = [m[1], m[2], m[3]].map((v) => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
      }
      const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
      const face = (e: Element) => { let n: Element | null = e; while (n) { const b = getComputedStyle(n).backgroundColor; if (!/rgba?\(.*,\s*0\)$/.test(b) && b !== 'transparent') return b; n = n.parentElement } return 'rgb(0,0,0)' }
      return ['Sensing', 'Fan'].map((name) => {
        const halves = [...document.querySelectorAll<HTMLElement>(`.js [aria-label="${name}"] [role="radio"]`)]
        const on = halves.find((h) => h.getAttribute('aria-checked') === 'true')
        const off = halves.find((h) => h.getAttribute('aria-checked') !== 'true')
        if (!on || !off) return { name, halves: halves.length, between: 0, word: 0 }
        return { name, halves: halves.length, between: ratio(face(on), face(off)), word: ratio(getComputedStyle(on).color, face(on)) }
      })
    })
    for (const r of ratios) {
      expect(r.halves, `${r.name} rocker has two halves`).toBe(2)
      expect(r.between, `${r.name}: lit half against the unlit half`).toBeGreaterThanOrEqual(3)
      expect(r.word, `${r.name}: the word on the lit half`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('Signal keyboard: Go to Presence is a 44 px key and Enter takes the view to Presence', async ({ page, baseURL }) => {
    await openSenses(page, baseURL, 'signal')
    const key = page.getByRole('button', { name: 'Go to Presence' })
    const box = await key.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(43.5)
    await key.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.s2-page[data-view="presence"] .js-presence')).toBeVisible({ timeout: 10_000 })
  })

  test('Signal: the dial, the one ledger card, WAITING lamps with no source, both columns end on one line', async ({ page, baseURL }) => {
    await openSenses(page, baseURL, 'signal')
    await expect(page.locator('.js-dial')).toHaveCount(1)
    await expect(page.locator('.js-p-ledger')).toHaveCount(1)
    await expect(page.locator('.js-p-events')).toHaveCount(0)
    const ends = await page.evaluate(() => {
      const left = document.querySelector<HTMLElement>('.js-narration')!.getBoundingClientRect().bottom
      const right = document.querySelector<HTMLElement>('.js-go')!.getBoundingClientRect().bottom
      return { left: Math.round(left), right: Math.round(right) }
    })
    expect(Math.abs(ends.left - ends.right), 'both columns end on the same line').toBeLessThanOrEqual(1)
    const bars = await page.locator('.js-spectrum .js-bar').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
    expect(bars).toHaveLength(51)
    expect(Math.min(...bars), 'the waiting pose is a visible envelope, not a row of slivers').toBeGreaterThan(20)
  })

  test('Teach: the four steps count n of 4, the copy chip (when a step has a command) is a focusable 44 px key', async ({ page, baseURL }) => {
    await openSenses(page, baseURL, 'teach')
    await expect(page.getByTestId('steps-count')).toHaveText(/^(\d of 4|-- of 4)$/)
    const chips = page.locator('.js-todo .js-copy')
    if (await chips.count()) {
      await chips.first().focus()
      await expect(chips.first()).toBeFocused()
      const box = await chips.first().boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(43.5)
    }
    await expect(page.getByTestId('mini-reason')).toBeVisible()
  })

  test('Teach: the session list of the Phone tab, with eight invented sessions, opens whole inside the viewport and its last option is reachable', async ({ page, baseURL }) => {
    const idle = { name: 'narrate', state: 'idle', stage: '', fraction: 0, error: null, started: null, finished: null }
    await page.route('**/api/aankhen/narrate/sessions', (route) => route.fulfill({
      json: {
        sessions: Array.from({ length: 8 }, (_, i) => ({ day: `2026-01-0${i + 1}`, session: `s${i + 1}`, folder: `2026-01-0${i + 1}_s${i + 1}`, labelled: i % 2 === 0, has_raw: true })),
        audio: [], job: idle,
      },
    }))
    await openSenses(page, baseURL, 'teach')
    await page.getByRole('radio', { name: 'Phone', exact: true }).click()
    const trigger = page.getByRole('combobox', { name: 'Narration session' })
    await expect(trigger).toBeVisible()
    await trigger.click()
    const list = page.getByRole('listbox', { name: 'Narration session' })
    await expect(list).toBeVisible()
    await expect(list.getByRole('option')).toHaveCount(9)
    const inside = await list.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight, vw: innerWidth } })
    expect(inside.top).toBeGreaterThanOrEqual(0)
    expect(inside.bottom).toBeLessThanOrEqual(inside.vh)
    expect(inside.left).toBeGreaterThanOrEqual(0)
    expect(inside.right).toBeLessThanOrEqual(inside.vw)
    await page.keyboard.press('End')
    const last = list.getByRole('option').last()
    await expect(last).toBeFocused()
    // the last option is the thing under the pointer at its own centre: no card clips it, nothing covers it
    const hit = await last.evaluate((e) => {
      const r = e.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!top && (top === e || e.contains(top)) && r.bottom <= innerHeight && r.top >= 0
    })
    expect(hit, 'the last session is hit-testable').toBe(true)
    await page.keyboard.press('Enter')
    await expect(list).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await elShot(page, 'teach-phone-1366.png')
  })
})

test.describe('Senses, lifted (390 x 844)', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  for (const view of ['presence', 'signal', 'teach'] as const) {
    test(`${view} at 390 px: no sideways scroll, targets 44 px, text 11 px`, async ({ page, baseURL }) => {
      await openSenses(page, baseURL, view)
      const m = await measureLifted(page)
      expect(m.docX, 'the page scrolls sideways').toBeLessThanOrEqual(0)
      expect(m.jsX, 'the view scrolls sideways').toBeLessThanOrEqual(1)
      expect(m.small, 'targets under 44 px').toEqual([])
      expect(m.tiny, 'text under 11 px').toEqual([])
      expect(m.ellipsis).toEqual([])
      await elShot(page, `${view}-390.png`)
    })
  }
  test('Signal at 390 px: the score and its threshold each read on one line', async ({ page, baseURL }) => {
    await openSenses(page, baseURL, 'signal')
    const lines = await page.evaluate(() => {
      const oneLine = (sel: string) => {
        const e = document.querySelector<HTMLElement>(sel)!
        const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.3
        return e.getBoundingClientRect().height <= lh * 1.5
      }
      return { score: oneLine('[data-testid="motion-score"]'), thr: oneLine('.js-thr') }
    })
    expect(lines).toEqual({ score: true, thr: true })
  })
})
