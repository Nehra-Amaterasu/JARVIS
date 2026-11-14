// L04 in a real Chromium: Today and both rails measured on the gallery's L04 entry (the jury harness builds the gallery in
// memory, so no server and no dist build are needed). At the desk the entry draws the 1302 x 664 canvas the shell leaves at
// 1366 x 768 under a 0.72 zoom; every measured box is divided by that zoom, so the sizes below are real CSS px.
//
//   (a) no inner scrollbar: the page box, the left rail and the Proof rail each fit their content (scrollHeight <= clientHeight)
//   (b) both rails whole: every part of the left rail and every Proof pin lies inside its rail
//   (c) every focusable part of Today is at least 44 x 44 (Fitts and hit areas, principles 13 and 14)
//   (d) the document never scrolls: not at 1366 x 768 and not at 358 px (the phone form scrolls inside its own box)
//   (e) one accent key, and every callout plate carries a lamp
import { expect, test, type Page } from '@playwright/test'
import { openGallery, pickEntry, showState } from './jury/lib'

async function openToday(page: Page, state: number) {
  await openGallery(page, 'light')
  const { states } = await pickEntry(page, 'L04')
  await showState(page, state, states.length)
  await page.locator('.td').first().waitFor()
  await page.waitForTimeout(150) // the ResizeObserver's first measurement
}

const geometry = (page: Page) => page.evaluate(() => {
  const td = document.querySelector<HTMLElement>('.td')!
  const box = td.closest<HTMLElement>('.td-gallery-box')
  const z = Number(box ? getComputedStyle(box).zoom : 1) || 1
  const lr = document.querySelector<HTMLElement>('.lr')
  const ps = document.querySelector<HTMLElement>('.ps')
  const inside = (outer: HTMLElement | null, sel: string) => {
    if (!outer) return []
    const o = outer.getBoundingClientRect()
    return [...outer.querySelectorAll<HTMLElement>(sel)].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && (r.top < o.top - 1 || r.bottom > o.bottom + 1 || r.left < o.left - 1 || r.right > o.right + 1)
    }).map((e) => e.className || e.tagName)
  }
  const focusable = [...td.querySelectorAll<HTMLElement>('button, input, [tabindex="0"], a[href], summary')].filter((e) => e.getClientRects().length > 0 && !e.closest('[aria-hidden="true"]'))
  const small = focusable.map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width / z < 43.5 || r.height / z < 43.5)
    .map(({ e, r }) => `${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 30)} ${Math.round(r.width / z)}x${Math.round(r.height / z)}`)
  const scrolls = (e: HTMLElement | null) => (e ? e.scrollHeight - e.clientHeight : 0)
  return {
    form: td.dataset.form,
    width: td.offsetWidth,
    tdScroll: scrolls(td),
    lrScroll: scrolls(lr),
    psScroll: scrolls(ps),
    lrOut: inside(lr, '.lr-sec, .lr-foot, .lr-key'),
    psOut: inside(ps, '.ps-pins li, .ps-open'),
    small,
    primaries: td.querySelectorAll('[data-primary]').length,
    plates: td.querySelectorAll('.td-plate').length,
    lamps: [...td.querySelectorAll('.td-plate')].filter((p) => p.querySelector('.lamp-glyph')).length,
    docX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})

test.describe('L04 Today and the rails', () => {
  for (const [i, name] of [[0, 'a full day'], [1, 'first run'], [2, 'nothing read yet']] as const) {
    test(`desk 1366 x 768, ${name}: one canvas, rails whole, no inner scrollbar, 44 px targets`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await openToday(page, i)
      const g = await geometry(page)
      expect(g.form).toBe('desk')
      expect(g.width).toBe(1302)
      expect(g.tdScroll, 'the page box scrolls').toBeLessThanOrEqual(0)
      expect(g.lrScroll, 'the left rail scrolls').toBeLessThanOrEqual(0)
      expect(g.psScroll, 'the Proof rail scrolls').toBeLessThanOrEqual(0)
      expect(g.lrOut, 'parts outside the left rail').toEqual([])
      expect(g.psOut, 'parts outside the Proof rail').toEqual([])
      expect(g.small, 'targets under 44 px').toEqual([])
      expect(g.primaries).toBe(1)
      expect(g.lamps).toBe(g.plates)
    })
  }

  test('the frame rails with every part (Now and Counters too): whole at 664 px, no inner scrollbar, 44 px keys', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openGallery(page, 'light')
    const { states } = await pickEntry(page, 'L04')
    await showState(page, 3, states.length)
    await page.locator('.lr').waitFor()
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => {
      const lr = document.querySelector<HTMLElement>('.lr')!
      const o = lr.getBoundingClientRect()
      const out = [...lr.querySelectorAll<HTMLElement>('.lr-sec, .lr-foot, .lr-key, .lr-phone')].filter((e) => {
        const b = e.getBoundingClientRect()
        return b.height > 0 && (b.bottom > o.bottom + 1 || b.top < o.top - 1)
      }).map((e) => e.className)
      const small = [...lr.querySelectorAll<HTMLElement>('button')].map((b) => b.getBoundingClientRect()).filter((b) => b.width < 43.5 || b.height < 43.5).length
      return { scroll: lr.scrollHeight - lr.clientHeight, out, small, parts: lr.querySelectorAll('.lr-sec').length, phone: !!lr.querySelector('.lr-foot .lr-phone, .lr-foot .lr-phone-key') }
    })
    expect(r.scroll).toBeLessThanOrEqual(0)
    expect(r.out).toEqual([])
    expect(r.small).toBe(0)
    expect(r.parts).toBe(4)
    expect(r.phone).toBe(true)
  })

  test('phone 358 px: the phone form, nothing wider than the screen, 44 px targets, Now first', async ({ page }) => {
    await page.setViewportSize({ width: 358, height: 780 })
    await openGallery(page, 'light')
    const { states } = await pickEntry(page, 'L04')
    await showState(page, 0, states.length)
    await page.locator('.td[data-form="phone"]').waitFor()
    const g = await geometry(page)
    expect(g.form).toBe('phone')
    expect(g.docX, 'the document scrolls sideways').toBeLessThanOrEqual(0)
    expect(g.small, 'targets under 44 px').toEqual([])
    const first = await page.locator('.td .td-plate').first().getAttribute('data-callout')
    expect(first).toBe('now')
  })
})
