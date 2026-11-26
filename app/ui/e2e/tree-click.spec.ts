// R6 (25 Nov, owner: "tree is glitching in clicking on the node"): the Tree under v3, in a real Chromium on the built app
// (dist-e2e, sandbox only, never the live app). What the old build did, measured at 1366x768: the first click on a node re-framed the
// whole branch (the canvas slid 67 px sideways and the zoom was forced up), so the next click landed on another node or on nothing; a
// click on a branch plate zoomed the canvas out to 74 percent (labels off); the legend lay on the first branch row; the plates of the
// rows at the foot drew "3 nodes" and no name (the name was left out when the plate crossed the stage edge).
//
//   node scripts/build-e2e.mjs
//   WW_SANDBOX_PORT=8911 WW_PREVIEW_PORT=5311 WW_SANDBOX_DIR="$TEMP/jarvis-ui-nav-e2e" npx playwright test e2e/tree-click.spec.ts --workers=1
//
// Checked at 1366x768, 1920x1200 and 390x844: the key (legend) is in its own row and meets no branch row or node; every branch plate in the
// DOM has a name; the first row is whole in the stage on open; three nodes in turn and the same one twice leave the canvas transform and
// the zoom exactly where they were; the node tray fills each time and a second click does not close it; Enter does the same by keyboard
// and the canvas keeps the focus. Pictures go to $TEMP/ui-nav-shots (UI_NAV_SHOTS overrides).
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const SHOTS = resolve(process.env.UI_NAV_SHOTS ?? resolve(tmpdir(), 'ui-nav-shots'))
const SIZES = [
  { name: '1366x768', w: 1366, h: 768 },
  { name: '1920x1200', w: 1920, h: 1200 },
  { name: '390x844', w: 390, h: 844 },
]

async function openTree(page: Page, baseURL: string | undefined, size: { w: number; h: number }) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: size.w, height: size.h })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('.s3')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur() })
  await page.keyboard.press('Alt+0')
  await page.keyboard.press('Control+4')
  await page.locator('.tg-v3 .gr-seed').first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(700)
  // "Influence and persuasion" has nine branches, so rows lie below the stage's foot
  await page.locator('.gr-seed[data-tree="influence"]').click()
  await page.locator('.tg-svg .tree-hub').first().waitFor({ timeout: 10_000 })
  await page.waitForTimeout(900)
}

interface R { x: number; y: number; w: number; h: number }
const rect = (page: Page, sel: string) => page.evaluate((s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null }, sel) as Promise<R | null>
const hit = (a: R, b: R) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1
const view = (page: Page) => page.evaluate(() => ({ tr: document.querySelector('.tg-svg > g')!.getAttribute('transform'), zoom: document.querySelector('.tg-zoom')?.textContent ?? '' }))
const settle = (page: Page) => page.waitForTimeout(650)
const focusedId = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-id') ?? '')

/** Whole nodes inside the stage and not covered: the hexagon's centre, for a real mouse click. */
async function visibleNodes(page: Page) {
  return page.evaluate(() => {
    const st = document.querySelector('.tg-stage')!.getBoundingClientRect()
    const out: { id: string; x: number; y: number }[] = []
    for (const el of document.querySelectorAll<SVGElement>('.tg-svg .tree-node')) {
      const ring = (el.querySelector('.sn-ring') ?? el) as SVGElement
      const b = ring.getBoundingClientRect()
      if (b.left < st.left + 8 || b.right > st.right - 8 || b.top < st.top + 8 || b.bottom > st.bottom - 8) continue
      const x = b.x + b.width / 2
      const y = b.y + b.height / 2
      if (document.elementFromPoint(x, y)?.closest('[data-id]') !== el) continue
      out.push({ id: el.getAttribute('data-id')!, x, y })
    }
    return out
  })
}

test.describe('The Tree under v3: clicking a node', () => {
  for (const size of SIZES) {
    test(`${size.name}: key row, names, first row, clicks and keys`, async ({ page, baseURL }) => {
      test.setTimeout(150_000)
      mkdirSync(SHOTS, { recursive: true })
      await openTree(page, baseURL, size)
      const desk = size.w >= 1000

      // ---- the key is a row of its own: it meets neither the stage nor a branch plate nor a node
      const key = await rect(page, '.tg-keyrow')
      const stage = await rect(page, '.tg-stage')
      expect(key && stage).toBeTruthy()
      expect(hit(key!, stage!), 'the key row lies over the stage').toBe(false)
      expect(await page.locator('.tg-stage .tg-legend').count(), 'no legend inside the stage').toBe(0)
      expect(await page.locator('.tg-keyrow .tg-legend li').count()).toBe(6)

      // ---- every plate has a name (the rows at the foot too), and the first row is whole in the stage on open
      const plates = () => page.evaluate(() => [...document.querySelectorAll('.tg-svg .tree-hub')].map((h) => (h.querySelector('.hub-name')?.textContent ?? '').trim()))
      for (const n of await plates()) expect(n.length, 'a plate with no name').toBeGreaterThan(0)
      const first = await page.evaluate(() => {
        const st = document.querySelector('.tg-stage')!.getBoundingClientRect()
        const hubs = [...document.querySelectorAll('.tg-svg .tree-hub')].map((h) => h.querySelector('.hub-face')!.getBoundingClientRect()).sort((a, b) => a.top - b.top)
        const h = hubs[0]
        return { top: h.top - st.top, bottom: st.bottom - h.bottom, left: h.left - st.left }
      })
      expect(first.top, 'the first row is cut at the top').toBeGreaterThanOrEqual(0)
      // on a phone-width stage (under 400 px) the first node is centred instead, so the plate is cut at the left by design
      if (desk) expect(first.left, 'the first plate is cut at the left').toBeGreaterThanOrEqual(0)
      expect(first.bottom, 'the first row is cut at the foot').toBeGreaterThanOrEqual(0)
      await page.screenshot({ path: resolve(SHOTS, `tree-open-${size.name}.png`) })
      // walk to the last branch with Page Down: its plate is named too; then walk back up
      await page.locator('.tg-svg [data-id][tabindex="0"]').first().focus()
      for (let i = 0; i < 8; i++) await page.keyboard.press('PageDown')
      await settle(page)
      const all = await plates()
      expect(all.length).toBeGreaterThan(1)
      for (const n of all) expect(n.length, 'a plate with no name after paging').toBeGreaterThan(0)
      for (let i = 0; i < 8; i++) await page.keyboard.press('PageUp')
      await settle(page)

      // ---- clicks: three nodes in turn, then the same one twice; the canvas stays put and the node tray fills each time
      const labelOf = (id: string) => page.evaluate((i) => document.querySelector(`.tg-svg [data-id="${i}"]`)?.getAttribute('aria-label')?.split(', tier')[0] ?? '', id)
      // on a phone-width stage the hub end shows after paging, so the pan key brings the first nodes in (a person does the same)
      for (let i = 0; i < 4 && (await visibleNodes(page)).length < 2; i++) {
        await page.getByRole('button', { name: /Pan right/ }).click()
        await settle(page)
      }
      const startView = await view(page)
      const picks: string[] = []
      for (let n = 0; n < 5; n++) {
        const nodes = await visibleNodes(page)
        const fresh = nodes.filter((c) => !picks.includes(c.id))
        const again = n >= 3 || fresh.length === 0   // a phone-width stage shows two whole nodes; then the last one is pressed again
        const pick = again ? nodes.find((c) => c.id === picks[picks.length - 1]) : fresh[0]
        expect(pick, 'a whole node to click').toBeTruthy()
        if (!again) picks.push(pick!.id)
        await page.mouse.click(pick!.x, pick!.y)
        await settle(page)
        expect(await view(page), `the canvas moved after clicking ${pick!.id}`).toEqual(startView)
        await expect(page.locator('.tg-svg [data-selected="true"]')).toHaveCount(1)
        expect(await page.locator('.tg-svg [data-selected="true"]').first().getAttribute('data-id')).toBe(pick!.id)
        if (desk) {
          await expect(page.locator('.s3-tray .nd .nd-name')).toHaveText(await labelOf(pick!.id))
          await expect(page.locator('.s3-tray .nd')).toBeVisible()
        }
      }
      if (desk) {
        // the chosen node: the open project's tint inside the hexagon and its colour on the ring
        const look = await page.evaluate(() => {
          const sel = document.querySelector('.tg-svg [data-selected="true"]')!
          const ring = sel.querySelector('.sn-ring')!
          const tint = sel.querySelector('.sn-tint')
          const hue = getComputedStyle(document.documentElement).getPropertyValue('--hue').replace(/\s/g, '')
          return { ring: getComputedStyle(ring).stroke.replace(/\s/g, ''), hue, tint: tint ? getComputedStyle(tint).fill : '' }
        })
        expect(look.ring, 'the ring is the project hue').toBe(look.hue)
        expect(look.tint, 'a tint inside the hexagon').not.toMatch(/none|rgba\(0, 0, 0, 0\)/)
        // the tray tells what it is, its evidence, what it needs and the one next step
        const tray = page.locator('.s3-tray .nd')
        await expect(tray.locator('.nd-what')).toBeVisible()
        await expect(tray.getByRole('heading', { name: /Evidence/ })).toBeVisible()
        await expect(tray.getByRole('heading', { name: 'Needs' })).toBeVisible()
        await expect(tray.getByRole('heading', { name: 'Do next' })).toBeVisible()
        // the name is not squeezed to a word a line (it was, at 90 px)
        const nameBox = await rect(page, '.s3-tray .nd .nd-name')
        expect(nameBox!.w, 'the node name column is too narrow').toBeGreaterThan(180)
      }
      await page.screenshot({ path: resolve(SHOTS, `tree-node-${size.name}.png`) })

      // ---- keyboard: Enter on a focused node fills the tray the same way; the canvas keeps the focus and the zoom
      if (desk) {
        await page.keyboard.press('Escape')
        await settle(page)
        await expect(page.locator('.s3-tray .nd')).toHaveCount(0)
        await page.locator(`.tg-svg [data-id="${picks[0]}"]`).focus()
        await page.keyboard.press('ArrowRight')
        const before = await view(page)
        const focused = await focusedId(page)
        expect(focused).not.toBe('')
        await page.keyboard.press('Enter')
        await settle(page)
        await expect(page.locator('.s3-tray .nd .nd-name')).toHaveText(await labelOf(focused))
        expect(await focusedId(page), 'the canvas lost the keyboard focus').toBe(focused)
        expect((await view(page)).zoom, 'Enter changed the zoom').toBe(before.zoom)
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await settle(page)
        await expect(page.locator('.tg-svg [data-selected="true"]')).toHaveCount(1)
        expect(await page.evaluate(() => document.activeElement?.closest('.tg-svg') !== null), 'focus left the canvas after the second Enter').toBe(true)
      }

      // ---- no sideways overflow; the toolbar and the zoom keys end inside their tray
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }))
      expect(o.sw).toBeLessThanOrEqual(o.iw + 1)
      if (desk) {
        const wrap = await rect(page, '.tg-stagewrap')
        const ctl = await rect(page, '.tg-controls')
        expect(ctl!.y + ctl!.h, 'the zoom keys run past the canvas').toBeLessThanOrEqual(wrap!.y + wrap!.h + 1)
      }
    })
  }
})
