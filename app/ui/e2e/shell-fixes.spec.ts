// A.N02 in a real Chromium, shell v2 flag ON, on the built app (dist-e2e) against the sandbox: the B05 review's
// shell fixes. Needs `npm run bundle:check` first; skips otherwise.
//
//   (a) the Well Wisher frame paints with the shell's theme and draws no strip; its season switch, Roadmap and
//       settings sit in the shell's view row, reachable by Tab, each 44 px;
//   (b) a Well Wisher section shows one view switch, the shell's;
//   (d) the Resume pill names the place before, in a labelled nav;
//   (f) Skip to canvas is the first Tab stop and keeps the URL fragment;
//   (g) Alt+N and the palette verb open What is new: the gallery, or an honest "not built yet" plate.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

async function open(page: Page, baseURL: string | undefined) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npm run bundle:check` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
}

async function toProduct(page: Page, want: 'jarvis' | 'ww') {
  const root = page.locator('[data-shell="v2"]')
  if ((await root.getAttribute('data-product')) !== want) await page.keyboard.press('Alt+0')
  await expect(root).toHaveAttribute('data-product', want)
}

const pageRoot = (page: Page) => page.locator('.s2-page')

/** Visible view switches in the canvas: anything labelled "... view" or "... views" that is a tab list or a radio group. */
const viewSwitches = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>('.s2-canvas [role="tablist"], .s2-canvas [role="radiogroup"]')]
    .filter((el) => /views?$/i.test(el.getAttribute('aria-label') ?? '') && el.getClientRects().length > 0)
    .map((el) => el.getAttribute('aria-label')))

test.describe('Shell v2 fixes (A.N02), flag on', () => {
  test('(f) Skip to canvas is the first Tab stop, moves focus to the canvas and keeps the fragment', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const hash = await page.evaluate(() => location.hash)
    await page.keyboard.press('Tab')
    const skip = page.locator('.s2-skip')
    await expect(skip).toBeFocused()
    await expect(skip).toHaveText('Skip to canvas')
    const box = (await skip.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Enter')
    await expect(page.locator('#s2-canvas')).toBeFocused()
    // the fragment carries the token and the route, so the link moves focus by script and leaves it as it was
    expect(await page.evaluate(() => location.hash)).toBe(hash)
  })

  test('(b) every Well Wisher section with views shows exactly one view switch, the shell\'s', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await toProduct(page, 'ww')
    for (const [n, sec, label] of [[1, 'day', 'Day views'], [2, 'focus', 'Focus views'], [3, 'study', 'Study views'], [5, 'career', 'Career views']] as const) {
      await page.keyboard.press(`Control+${n}`)
      await expect(pageRoot(page)).toHaveAttribute('data-section', sec)
      await page.waitForTimeout(700) // the frame's workspace switch settles
      expect(await viewSwitches(page), sec).toEqual([label])
    }
    // and the shell's switch drives the page that hid its own: Day / Week shows Life's week pane
    await page.keyboard.press('Control+1')
    await page.locator('#s2-view-week').click()
    await expect(page.locator('.ww-life')).toHaveAttribute('data-view', 'week')
    await page.locator('#s2-view-today').click()
    await expect(page.locator('.ww-life')).toHaveAttribute('data-view', 'today')
  })

  test('(a) the frame takes the shell\'s theme, draws no strip, and its tools sit in the shell row', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await toProduct(page, 'ww')
    await page.keyboard.press('Control+1')
    await expect(page.locator('.ww-frame')).toBeVisible()
    await expect(page.locator('.ww-strip')).toHaveCount(0)
    const t = await page.evaluate(() => {
      const s2 = getComputedStyle(document.querySelector('.s2')!)
      const ww = getComputedStyle(document.querySelector('.ww-frame')!)
      const centre = getComputedStyle(document.querySelector('.ww-centre')!)
      return { s2bg: s2.backgroundColor, wwbg: ww.backgroundColor, s2ink: s2.color, wwink: ww.color, centreInk: centre.color, scheme: ww.colorScheme }
    })
    expect(t.wwbg).toBe(t.s2bg)
    expect(t.wwink).toBe(t.s2ink)
    expect(t.centreInk).toBe(t.s2ink)
    expect(t.scheme).toBe('light')
    // the tools: in the view row, visible, 44 px, reachable by Tab from the view switch
    const tools = page.locator('.s2-views [data-frame-tools]')
    await expect(tools.locator('[role="radiogroup"][aria-label="Season"]')).toBeVisible()
    await expect(tools.locator('[data-open="roadmap"]')).toBeVisible()
    const small = await tools.locator('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length)
    expect(small).toBe(0)
    await page.locator('#s2-view-today').focus()
    let guard = 0
    while (!(await page.evaluate(() => !!document.activeElement?.closest('[data-frame-tools]'))) && guard++ < 6) await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-frame-tools]'))).toBe(true)
  })

  test('(d) the Resume pill names the place before, and one press goes back there', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await toProduct(page, 'jarvis')
    await page.keyboard.press('Control+1')
    await page.keyboard.press('Control+2')
    await expect(pageRoot(page)).toHaveAttribute('data-section', 'room')
    const pill = page.locator('.s2-title nav[aria-label="Resume"]')
    await expect(pill).toContainText('Core / Talk')
    await pill.locator('button').first().click()
    await expect(pageRoot(page)).toHaveAttribute('data-section', 'core')
    await expect(pill).toContainText('Room / Switches')
  })

  test('(g) Alt+N and the palette verb open What is new, the gallery or an honest plate', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Alt+n')
    await expect(pageRoot(page)).toHaveAttribute('data-section', 'app')
    await expect(pageRoot(page)).toHaveAttribute('data-view', 'new')
    const place = page.locator('[data-place="app.new"]')
    await expect(place).toBeVisible()
    // on a branch without the gallery the plate says so; with it, the plate is absent
    const absent = place.locator('[data-whatisnew="absent"]')
    if (await absent.count()) await expect(absent).toContainText('not built yet')
    // the palette verb reaches the same place from anywhere
    await page.keyboard.press('Control+1')
    await page.keyboard.press('Control+k')
    await page.keyboard.type('what is new')
    await page.keyboard.press('Enter')
    await expect(pageRoot(page)).toHaveAttribute('data-view', 'new')
  })
})
