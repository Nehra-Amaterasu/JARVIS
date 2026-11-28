// One look (25 Nov): v3 is the only look offered, with a slim spine, project hues and no look keys, seen in a real Chromium on
// the built app (dist-e2e, built with VITE_LOOK_DEFAULT=off by scripts/build-e2e.mjs, so the fragment look=v3 is what turns v3 on
// here; the production default is proved by the unit test of shell/look.ts). Sandbox only, never the live app.
//
//   node scripts/build-e2e.mjs                (rebuild after a change the browser should see)
//   WW_SANDBOX_PORT=8891 WW_PREVIEW_PORT=5291 WW_SANDBOX_DIR="$TEMP/jarvis-ui-shell-e2e" npx playwright test e2e/one-look.spec.ts
//
// At 1366x768, 1120x720 and 390x844: the spine is 184 px (or the phone's tab bar), folds to a 64 px rail and keeps the choice;
// every project and every section row is reachable by click and by keyboard; Agents is a planned row that opens the planned
// pose; no key anywhere switches the look; rows are 44 px; nothing overlaps or scrolls the document; text is in the reading face
// where it is a title, tab or tray job. One picture per project per size goes to $TEMP/ui-shell-shots (ONE_LOOK_SHOTS overrides).
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const SHOTS = resolve(process.env.ONE_LOOK_SHOTS ?? resolve(tmpdir(), 'ui-shell-shots'))
const SIZES = [
  { name: '1366x768', w: 1366, h: 768 },
  { name: '1120x720', w: 1120, h: 720 },
  { name: '390x844', w: 390, h: 844 },
]
const PROJECTS: Array<{ id: string; entry: string; sections: string[] }> = [
  { id: 'jarvis', entry: 'core', sections: ['core', 'room', 'console'] },
  { id: 'aankhen', entry: 'senses', sections: ['senses'] },
  { id: 'yadaash', entry: 'memory', sections: ['memory'] },
  { id: 'wellwisher', entry: 'day', sections: ['day', 'focus', 'study', 'tree', 'career'] },
]
const phone = (s: { w: number }) => s.w < 700

async function open(page: Page, baseURL: string | undefined, size = SIZES[0], hash = '') {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: size.w, height: size.h })
  await page.goto(`/#t=ww-e2e&shell=v2&look=v3${hash}`)
  await expect(page.locator('.s3')).toBeVisible({ timeout: 15_000 })
}

interface Box { x: number; y: number; width: number; height: number }
async function box(page: Page, sel: string): Promise<Box> {
  const b = await page.locator(sel).first().boundingBox()
  expect(b, `${sel} has a box`).not.toBeNull()
  return b!
}
const overlap = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
const pageRoot = (page: Page) => page.locator('.s2-page')
const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

/** The phone keeps the spine in a sheet: open it, so its rows can be pressed. */
async function openDeck(page: Page, size: { w: number }) {
  if (phone(size) && (await page.locator('.s3').getAttribute('data-deck')) !== 'open') await page.locator('.s3-tabbar .s3-tab').first().click()
}

async function gotoProject(page: Page, id: string, size: { w: number }) {
  await blurText(page)
  await openDeck(page, size)
  const head = page.locator(`#s3-spine .s3-head[data-project="${id}"]`)
  if (await head.count()) await head.first().click() // the open project's head is not a key: it is already open
}

test.describe('One look', () => {
  for (const size of SIZES) {
    test(`${size.name}: the spine, the hues, the rows and the pictures`, async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      mkdirSync(SHOTS, { recursive: true })
      await open(page, baseURL, size)

      // ---- no document scroll, no overlap among the frame's pieces, and no look key anywhere
      const frame = async () => {
        const top = await box(page, '.s3-top')
        const dock = await box(page, '.s3-dock')
        const stage = await box(page, '.s3-stage')
        expect(overlap(top, dock)).toBe(false)
        expect(overlap(top, stage)).toBe(false)
        expect(overlap(stage, dock)).toBe(false)
        const s = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }))
        expect(s.sh).toBeLessThanOrEqual(s.ih)
        expect(s.sw).toBeLessThanOrEqual(s.iw)
        if (!phone(size)) {
          const spine = await box(page, '#s3-spine')
          expect(overlap(spine, top)).toBe(false)
          expect(overlap(spine, stage)).toBe(false)
        }
      }
      await frame()
      const buttons = await page.locator('button').evaluateAll((els) => els.map((e) => `${e.textContent ?? ''} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`))
      expect(buttons.join('|')).not.toMatch(/New look|Current look|Classic UI|New UI/i)
      await page.locator('.s3-iconkey[aria-haspopup]').click()
      await expect(page.locator('.s3-pop')).not.toContainText(/look|classic/i)
      await page.keyboard.press('Escape')

      if (!phone(size)) {
        // ---- width, fold, memory of the fold. 28 Nov (V1): below 1420 px of window the spine starts as its 64 px rail by
        // itself (ShellV3 AUTO_RAIL_BELOW) and the fold key PINS the other state; this block used to start at 184 px at every size
        const auto = size.w < 1420 ? 'rail' : 'full'
        const other = auto === 'rail' ? 'full' : 'rail'
        const px = (s: string) => (s === 'rail' ? 64 : 184)
        expect((await box(page, '#s3-spine')).width).toBe(px(auto))
        await page.locator('.s3-fold').click()
        await expect(page.locator('.s3')).toHaveAttribute('data-spine', other)
        await expect.poll(async () => (await box(page, '#s3-spine')).width).toBe(px(other))
        expect(await page.evaluate(() => localStorage.getItem('app.spine'))).toBe(other)
        if (other === 'full') await page.locator('.s3-fold').click() // the rail picture below is of the rail
        await expect(page.locator('.s3-pn').first()).toBeHidden()
        await frame()
        // a folded row still names itself: the accessible name and the tooltip
        await expect(page.locator('#s3-spine .s3-head[data-project="aankhen"]')).toHaveAttribute('aria-label', /Aankhen/)
        await expect(page.locator('#s3-spine .s3-item[data-section="room"]')).toHaveAttribute('aria-label', 'Room')
        await page.screenshot({ path: resolve(SHOTS, `rail-${size.name}.png`) })
        await page.locator('.s3-fold').click()
        await expect(page.locator('.s3')).toHaveAttribute('data-spine', 'full')
        await page.reload()
        await expect(page.locator('.s3')).toHaveAttribute('data-spine', 'full') // remembered (a pin on a narrow window, automatic on a wide one)
        await expect.poll(async () => (await box(page, '#s3-spine')).width).toBe(184)
        await page.evaluate(() => localStorage.removeItem('app.spine'))
      }

      // ---- every project and every section row by click; rows 44 px; the open project's hue on the root
      for (const p of PROJECTS) {
        await gotoProject(page, p.id, size)
        await expect(pageRoot(page)).toHaveAttribute('data-section', p.entry)
        await expect(page.locator('html')).toHaveAttribute('data-hue', p.id)
        for (const sec of p.sections) {
          await openDeck(page, size)
          const row = page.locator(`#s3-spine .s3-item[data-section="${sec}"]`)
          if (p.sections.length > 1 || p.id === 'yadaash') {
            await row.first().click()
          }
          await expect(pageRoot(page)).toHaveAttribute('data-section', sec)
        }
        await openDeck(page, size)
        const heights = await page.locator('#s3-spine .s3-head, #s3-spine .s3-item').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getBoundingClientRect().height))
        expect(heights.length).toBeGreaterThan(3)
        for (const h of heights) expect(h).toBeGreaterThanOrEqual(43.5)
        for (const h of heights) expect(h).toBeLessThanOrEqual(46)
        if (phone(size)) await page.keyboard.press('Escape')
        await frame()
        await page.waitForTimeout(450) // the first tray rises over 500 ms: let it settle for the picture
        await page.screenshot({ path: resolve(SHOTS, `${p.id}-${size.name}.png`) })
      }

      // ---- the open project's tint and the reading face
      const looks = await page.evaluate(() => {
        const cs = (sel: string) => {
          const el = document.querySelector(sel)
          return el ? getComputedStyle(el) : null
        }
        const tray = cs('.s3-tray[data-step="1"]')
        return {
          trayImage: tray?.backgroundImage ?? '',
          step: cs('.s3-step')?.fontFamily ?? '',
          loc: cs('.s3-loc-p')?.fontFamily ?? '',
          pn: cs('.s3-pn')?.fontFamily ?? '',
          seg: cs('.s3-seg button')?.fontFamily ?? '',
          rulerShown: !!document.querySelector('.s3-ruler') && getComputedStyle(document.querySelector('.s3-ruler')!).display !== 'none',
        }
      })
      expect(looks.rulerShown).toBe(false)
      for (const k of ['step', 'loc', 'pn'] as const) expect(looks[k], k).not.toMatch(/consolas|mono|courier/i)
      // 28 Nov, the design reset: this read "the open project's tint is laid over the first tray as a linear-gradient"; the reset
      // removed every tint, so the first tray now carries no image at all
      expect(looks.trayImage).toBe('none')
    })
  }

  test('keyboard: Tab reaches the spine, ArrowDown walks every row, Enter opens it', async ({ page, baseURL }) => {
    await open(page, baseURL, SIZES[0])
    await blurText(page)
    await page.locator('#s3-spine .s3-item[data-section="core"]').focus()
    const seen: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-section') ?? (document.activeElement as HTMLElement | null)?.getAttribute('data-project') ?? '')
      seen.push(id)
      if (i < 3) await page.keyboard.press('ArrowDown')
    }
    expect(seen).toEqual(['core', 'room', 'console', 'aankhen'])
    await page.keyboard.press('Enter')
    await expect(pageRoot(page)).toHaveAttribute('data-section', 'senses')
    // ArrowDown to Yadaash's head, Enter: memory opens and the Agents row appears
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(pageRoot(page)).toHaveAttribute('data-section', 'memory')
    // the fold key is a real key too
    // 28 Nov: at 1366 px the spine is the rail by itself, so Enter on the fold key pins it open (it used to fold it)
    const was = await page.locator('.s3').getAttribute('data-spine')
    await page.locator('.s3-fold').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.s3')).toHaveAttribute('data-spine', was === 'rail' ? 'full' : 'rail')
    await page.evaluate(() => localStorage.removeItem('app.spine'))
  })

  for (const size of SIZES) {
    test(`${size.name}: Agents is a planned row and opens the planned pose`, async ({ page, baseURL }) => {
      await open(page, baseURL, size)
      await gotoProject(page, 'yadaash', size)
      await openDeck(page, size)
      const row = page.locator('#s3-spine .s3-extra[data-extra="agents"]')
      await expect(row).toHaveCount(1)
      await expect(row).toHaveAttribute('data-state', 'planned')
      await expect(row).toHaveAttribute('aria-label', /Agents are being planned; nothing runs here yet/)
      await row.click()
      await expect(pageRoot(page)).toHaveAttribute('data-section', 'memory') // not a place
      const pose = page.locator('.s2-scrim')
      await expect(pose).toBeVisible()
      await expect(pose).toContainText(/Agents/)
      await page.screenshot({ path: resolve(SHOTS, `agents-pose-${size.name}.png`) })
      await page.keyboard.press('Escape')
      await expect(pose).toHaveCount(0)
    })
  }
})
