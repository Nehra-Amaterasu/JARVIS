// P4 (plan 8.6): 3 themes x 6 workspaces x 3 viewports against baselines. The screenshot half is
// born in chunk 1b (kitchen sink), 4 (frame) and 6 to 12 (each workspace adds rows), and needs the
// fixture sandbox (`ww_sandbox --fixture`, not built yet) so no baseline contains real data.
// Chunk 1a ships the part that needs no page: the computed token values in a real Chromium for
// every theme and workspace, so a typo in a token file fails here before it fails a screenshot.
import { expect, openLab, test } from './fixtures'
import { openKitchen } from './kitchen'

const THEMES: Record<string, { 'data-theme'?: string }> = { ash: {}, paper: { 'data-theme': 'paper' }, indigo: { 'data-theme': 'indigo' } }
const ACCENT: Record<string, Record<string, string>> = {
  ash: { study: '#ff7a2e', tree: '#4fd1a1', life: '#ff8fa3', career: '#b794ff', focus: '#f5f6f8', setup: '#a9b8d0' },
  paper: { study: '#a63a06', tree: '#0b6b4d', life: '#a3263f', career: '#5b2bb3', focus: '#1a1814', setup: '#34506e' },
  indigo: { study: '#9aa0ff', tree: '#7fe0c0', life: '#ffa0b4', career: '#c3a8ff', focus: '#eef0ff', setup: '#b8c4ff' },
}
const toRgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

for (const [theme, attrs] of Object.entries(THEMES)) {
  for (const [ws, hex] of Object.entries(ACCENT[theme])) {
    test(`${theme} / ${ws}: the centre's --accent is the workspace accent of plan 5.7.5`, async ({ page }) => {
      await openLab(page, attrs as Record<string, string>)
      await page.evaluate((w) => document.getElementById('centre')!.setAttribute('data-ws', w), ws)
      const v = await page.evaluate(() => {
        const probe = document.createElement('i')
        probe.style.color = 'var(--accent)'
        document.getElementById('centre')!.appendChild(probe)
        return getComputedStyle(probe).color
      })
      expect(v).toBe(toRgb(hex))
    })
  }
}

test('a theme change re-resolves the tokens with no reload and keeps the DOM nodes', async ({ page }) => {
  await openLab(page)
  const before = await page.evaluate(() => { (document.getElementById('c1') as HTMLElement & { __tag?: number }).__tag = 7; return getComputedStyle(document.getElementById('root')!).getPropertyValue('--surface-0').trim() })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'paper'))
  const after = await page.evaluate(() => ({ s: getComputedStyle(document.getElementById('root')!).getPropertyValue('--surface-0').trim(), tag: (document.getElementById('c1') as HTMLElement & { __tag?: number }).__tag }))
  expect(before).toBe('#050506')
  expect(after.s).toBe('#f4f1ea')
  expect(after.tag).toBe(7)
})

// ---- chunk 1b: the kitchen sink in 3 themes x 3 viewports, plus the overlays -------------------------------------
// Baselines are created from the sink (fictional strings, no owner data) with `npm run e2e:update` and reviewed
// as a set; an update is never automatic. Motion is forced calm and animations disabled so a frame is a state.
const THEME_ATTRS: Record<string, Record<string, string>> = { ash: {}, paper: { 'data-theme': 'paper' }, indigo: { 'data-theme': 'indigo' } }
const VIEWPORTS = [
  { name: '1366', size: { width: 1366, height: 768 } },
  { name: '1920', size: { width: 1920, height: 1080 } },
  { name: '390', size: { width: 390, height: 844 } },
]
const SHOT = { animations: 'disabled' as const, caret: 'hide' as const, maxDiffPixelRatio: 0.002, threshold: 0.2 }

/** Skeletons appear after 200 ms; wait past it so the frame is the settled state. */
const settle = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(450)
  await page.evaluate(() => window.scrollTo(0, 0))
}

for (const vp of VIEWPORTS) {
  test.describe(`kitchen sink at ${vp.name}`, () => {
    test.use({ viewport: vp.size })
    for (const [theme, attrs] of Object.entries(THEME_ATTRS)) {
      test(`${theme}: the whole sink matches its baseline`, async ({ page }) => {
        await openKitchen(page, { html: attrs })
        await settle(page)
        await expect(page).toHaveScreenshot(`kitchen-${theme}-${vp.name}.png`, { ...SHOT, fullPage: true })
      })
    }
  })
}

test.describe('kitchen sink overlays', () => {
  test.use({ viewport: { width: 1366, height: 768 } })
  for (const theme of Object.keys(THEME_ATTRS)) {
    test(`${theme}: the drawer`, async ({ page }) => {
      await openKitchen(page, { html: THEME_ATTRS[theme], overlay: 'drawer' })
      await settle(page)
      await expect(page).toHaveScreenshot(`overlay-drawer-${theme}-1366.png`, SHOT)
    })
  }
  test('ash: the popover', async ({ page }) => {
    await openKitchen(page, { overlay: 'popover' })
    await settle(page)
    await expect(page).toHaveScreenshot('overlay-popover-ash-1366.png', SHOT)
  })
  test('ash: the toast', async ({ page }) => {
    await openKitchen(page, { overlay: 'toast' })
    await settle(page)
    await expect(page).toHaveScreenshot('overlay-toast-ash-1366.png', SHOT)
  })
})
test('ash: the sheet at 390', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await openKitchen(page, { overlay: 'sheet' })
  await settle(page)
  await expect(page).toHaveScreenshot('overlay-sheet-ash-390.png', SHOT)
  await ctx.close()
})

// ---- non-pixel assertions on the same page ------------------------------------------------------------------------
for (const vp of VIEWPORTS) {
  for (const theme of Object.keys(THEME_ATTRS)) {
    test(`${theme} at ${vp.name}: one primary, no sideways scroll, selected states clear 4.5:1 and the accent is the Study accent`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: vp.size, colorScheme: 'dark' })
      const page = await ctx.newPage()
      await openKitchen(page, { html: THEME_ATTRS[theme] })
      expect(await page.locator('[data-primary]').count()).toBe(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      const accent = await page.evaluate(() => {
        const probe = document.createElement('i')
        probe.style.color = 'var(--accent)'
        document.querySelector('.ww-centre')!.appendChild(probe)
        return getComputedStyle(probe).color
      })
      expect(accent).toBe(toRgb(ACCENT[theme].study))
      // per-child contrast of every selected state, computed in the page against the opaque colour behind it
      const rows = await page.evaluate(() => {
        const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number)
        const lum = (r: number, g: number, b: number) => {
          const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
        }
        const behind = (el: Element): [number, number, number] => {
          // composite the translucent backgrounds from the root down
          const chain: Element[] = []
          for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e)
          let rgb: [number, number, number] = [255, 255, 255]
          for (const e of chain) {
            const [r, g, b, a = 1] = parse(getComputedStyle(e).backgroundColor)
            if (a > 0) rgb = [r * a + rgb[0] * (1 - a), g * a + rgb[1] * (1 - a), b * a + rgb[2] * (1 - a)]
          }
          return rgb
        }
        const out: { what: string; ratio: number }[] = []
        for (const el of document.querySelectorAll('.ww-seg-opt[aria-checked="true"], .ww-chip[aria-pressed="true"], .ww-chip[data-cycle-state="learned"], .ww-chip[data-cycle-state="solid"], .ww-tapopt[data-active="true"]')) {
          const [fr, fg, fb] = parse(getComputedStyle(el).color)
          const [br, bg, bb] = behind(el)
          const a = lum(fr, fg, fb), b = lum(br, bg, bb)
          out.push({ what: (el.textContent ?? '').trim().slice(0, 20), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })
        }
        return out
      })
      expect(rows.length).toBeGreaterThan(3)
      for (const r of rows) expect(r.ratio, r.what).toBeGreaterThanOrEqual(4.5)
      await ctx.close()
    })
  }
}
