// P4 for the Study views and the Reader (plan 8.6, chunk 7): the real Frame and pages in three themes and three
// viewports. Non-pixel assertions run everywhere (one primary, no horizontal scroll at 390 and 1280, at most 7 cards in
// the first 682 px, the Reader's stems typeset); the Papers view and the Reader also have screenshot baselines
// (Windows only, from fictional fixtures; `npm run e2e:update` makes them and the diff is reviewed, never automatic).
import { expect, test } from '@playwright/test'
import { openStudy } from './studyFrame'

const THEMES: Record<string, Record<string, string>> = { ash: {}, paper: { 'data-theme': 'paper' }, indigo: { 'data-theme': 'indigo' } }
const VIEWPORTS = [
  { name: '1366', size: { width: 1366, height: 768 } },
  { name: '1920', size: { width: 1920, height: 1080 } },
  { name: '390', size: { width: 390, height: 844 } },
]
const SHOT = { animations: 'disabled' as const, caret: 'hide' as const, maxDiffPixelRatio: 0.002, threshold: 0.2 }
const settle = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}

for (const [theme, html] of Object.entries(THEMES)) {
  for (const vp of VIEWPORTS) {
    test.describe(`${theme} / ${vp.name}`, () => {
      test.use({ viewport: vp.size, colorScheme: theme === 'paper' ? 'light' : 'dark' })

      test('Papers: one primary, no horizontal scroll, at most 7 cards in the first 682 px, Study accent', async ({ page }) => {
        await openStudy(page, { html: { 'data-motion': 'calm', ...html }, view: 'papers' })
        await settle(page)
        const r = await page.evaluate(() => {
          const centre = document.querySelector('.ww-centre') as HTMLElement
          const scroller = document.querySelector('.ww-scroll') as HTMLElement
          const cards = [...document.querySelectorAll('.ww-centre [data-card]')].filter((c) => c.getBoundingClientRect().top < 682)
          return {
            primaries: document.querySelectorAll('[data-primary="true"]').length,
            doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            scroller: scroller.scrollWidth <= scroller.clientWidth,
            cards: cards.length,
            accent: getComputedStyle(centre).getPropertyValue('--accent').trim(),
          }
        })
        expect(r.primaries).toBe(1)
        expect(r.doc).toBe(true)
        expect(r.scroller).toBe(true)
        expect(r.cards).toBeLessThanOrEqual(7)
        expect(r.accent).toMatch(/^#/)
      })

      for (const view of ['plan', 'library', 'dmat']) {
        test(`${view}: no horizontal scroll and at most one primary`, async ({ page }) => {
          await openStudy(page, { html: { 'data-motion': 'calm', ...html }, view })
          await settle(page)
          const r = await page.evaluate(() => {
            const scroller = document.querySelector('.ww-scroll') as HTMLElement
            return { scroller: scroller.scrollWidth <= scroller.clientWidth, primaries: document.querySelectorAll('[data-primary="true"]').length }
          })
          expect(r.scroller).toBe(true)
          expect(r.primaries).toBeLessThanOrEqual(1)
        })
      }

      test('Papers baseline', async ({ page }) => {
        await openStudy(page, { html: { 'data-motion': 'calm', ...html }, view: 'papers' })
        await settle(page)
        await expect(page).toHaveScreenshot(`study-papers-${theme}-${vp.name}.png`, { ...SHOT, fullPage: false })
      })
    })
  }

  test.describe(`${theme} Reader`, () => {
    test.use({ viewport: { width: 1366, height: 768 }, colorScheme: theme === 'paper' ? 'light' : 'dark' })
    test('the Reader: typeset stems, one list, no horizontal scroll inside the sheet', async ({ page }) => {
      await openStudy(page, { html: { 'data-motion': 'calm', ...html }, view: 'papers' })
      await page.getByRole('button', { name: 'Practice paper' }).click()
      await page.waitForSelector('[data-overlay=reader] .ww-q')
      await settle(page)
      const r = await page.evaluate(() => {
        const body = document.querySelector('.ww-sheet-body') as HTMLElement
        return {
          lists: document.querySelectorAll('.ww-sheet ol.ww-paper').length,
          nums: [...document.querySelectorAll('.ww-sheet li.ww-q .ww-q-n')].map((e) => e.textContent),
          typeset: document.querySelectorAll('.ww-sheet .ww-q-stem .katex, .ww-sheet .ww-q-stem .rd-math').length,
          raw: [...document.querySelectorAll('.ww-sheet .ww-q-stem')].some((e) => /\\int|\\sum|\\frac/.test(e.textContent ?? '')),
          fits: body.scrollWidth <= body.clientWidth,
          primaries: document.querySelectorAll('[data-primary="true"]').length,
        }
      })
      expect(r.lists).toBe(1)
      expect(r.nums).toEqual(['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.'])
      expect(r.typeset).toBeGreaterThan(0)
      expect(r.raw, 'no raw backslash command is shown as prose').toBe(false)
      expect(r.fits).toBe(true)
      expect(r.primaries).toBeLessThanOrEqual(1)
    })
  })
}

test.describe('Reader baseline', () => {
  test.use({ viewport: { width: 1366, height: 768 }, colorScheme: 'dark' })
  test('ash / 1366: the Reader with a paper', async ({ page }) => {
    await openStudy(page, { html: { 'data-motion': 'calm' }, view: 'papers' })
    await page.getByRole('button', { name: 'Practice paper' }).click()
    await page.waitForSelector('[data-overlay=reader] .ww-q')
    await settle(page)
    await page.evaluate(() => document.fonts.ready)
    await expect(page).toHaveScreenshot('study-reader-ash-1366.png', { ...SHOT, fullPage: false })
  })
})
