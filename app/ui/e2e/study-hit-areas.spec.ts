// P3 for the Study views and the Reader (plan 8.6, chunk 7): every control in Papers, Plan, Library, dMAT, the
// Reader and Add questions has an effective hit rectangle of at least 40 px each way (44 in a group), at 1366x768
// with the mouse and at 390x844 by touch. The real Frame and the real pages, the server's routes from fixtures.
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { openStudy } from './studyFrame'

const SELECTOR = 'button, a[href], [role=radio], input:not([type=hidden]), select, textarea, summary'

/** The effective box: probe elementFromPoint on a 2 px grid over the element grown by 12 px each side, after scrolling it to the middle. */
async function boxes(page: Page, root: string) {
  return page.evaluate(([rootSel, sel]) => {
    const out: { label: string; w: number; h: number }[] = []
    const scope = document.querySelector(rootSel)!
    const els = [...scope.querySelectorAll<HTMLElement>(sel)].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]')
    })
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let x = Math.max(0, r.left - 12); x <= Math.min(innerWidth - 1, r.right + 12); x += 2) {
        for (let y = Math.max(0, r.top - 12); y <= Math.min(innerHeight - 1, r.bottom + 12); y += 2) {
          const hit = document.elementFromPoint(x, y)
          if (hit && (hit === el || el.contains(hit) || (hit as HTMLElement).closest('label')?.contains(el))) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
          }
        }
      }
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)
      out.push({ label: `${el.tagName.toLowerCase()} "${name}"`, w: maxX - minX + 2, h: maxY - minY + 2 })
    }
    return out
  }, [root, SELECTOR] as const)
}

const SIZES = [
  { name: '1366x768', size: { width: 1366, height: 768 }, touch: false },
  { name: '390x844', size: { width: 390, height: 844 }, touch: true },
]

for (const s of SIZES) {
  test.describe(`${s.name}`, () => {
    test.use({ viewport: s.size, hasTouch: s.touch })

    for (const view of ['papers', 'plan', 'library', 'dmat']) {
      test(`Study > ${view}: every control is at least 40 px each way`, async ({ page }) => {
        await openStudy(page, { view })
        await page.waitForTimeout(500)
        const list = await boxes(page, '.ww-centre')
        expect(list.length, 'the view has controls').toBeGreaterThan(3)
        const small = list.filter((b) => b.w < 40 || b.h < 40)
        expect(small, JSON.stringify(small)).toEqual([])
      })
    }

    test('the Reader: steppers, Raw, Save marks and the sheet close are at least 40 px each way', async ({ page }) => {
      await openStudy(page, { view: 'papers' })
      await page.getByRole('button', { name: 'Practice paper' }).click()
      await page.waitForSelector('[data-overlay=reader] .ww-q')
      await page.waitForTimeout(700)
      const list = await boxes(page, '.ww-sheet')
      expect(list.length).toBeGreaterThan(10)
      const small = list.filter((b) => b.w < 40 || b.h < 40)
      expect(small, JSON.stringify(small)).toEqual([])
    })

    test('Add questions: every field and the Add question button are at least 40 px each way', async ({ page }) => {
      await openStudy(page, { view: 'papers', bank: 'empty' })
      await page.getByRole('button', { name: 'Add questions' }).click()
      await page.waitForSelector('[data-overlay=add]')
      await page.waitForTimeout(500)
      const list = await boxes(page, '.ww-sheet')
      expect(list.length).toBeGreaterThan(5)
      const small = list.filter((b) => b.w < 40 || b.h < 40)
      expect(small, JSON.stringify(small)).toEqual([])
    })
  })
}
