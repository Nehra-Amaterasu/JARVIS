// P3 (plan 8.6): effective hit rectangle at least 40 px (44 in groups), no overlapping hit areas, at
// 1366x768 (mouse) and 390x844 (touch). Born in chunk 1b with the primitives; chunk 1a ships the
// measuring helper and proves it on the lab's one control.
import { expect, openLab, test } from './fixtures'

/** The effective box: probe elementFromPoint on a 4 px grid over the element grown by 12 px each side. */
export async function effectiveBox(page: import('@playwright/test').Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const r = el.getBoundingClientRect()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let x = r.left - 12; x <= r.right + 12; x += 4) {
      for (let y = r.top - 12; y <= r.bottom + 12; y += 4) {
        const hit = document.elementFromPoint(x, y)
        if (hit && (hit === el || el.contains(hit))) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        }
      }
    }
    return { w: maxX - minX, h: maxY - minY }
  }, selector)
}

test('the measuring helper reads a 44 px control as at least 40 x 40', async ({ page }) => {
  await openLab(page)
  const b = await effectiveBox(page, '#tap')
  expect(b.w).toBeGreaterThanOrEqual(40)
  expect(b.h).toBeGreaterThanOrEqual(40)
})

test('every page, view and overlay at 1366 and 390', async () => {
  test.skip(true, 'needs the primitives (chunk 1b) and pages (chunks 4 to 12) to measure; this file holds the helper')
})
