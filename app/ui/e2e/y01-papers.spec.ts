// Package Y01 in a real Chromium: the Paper Desk and the Review Desk of the gallery entry "Y01" (invented papers, SIMULATED).
// Built in memory by the jury harness's gallery page (nothing is written near dist, no port is used). Proves:
//   geometry   the desk at the shell canvas size (1230 x 664) has no inner scrollbar, no clipped row, every control of the desk at
//              44 px or more; at 390 px it is one column with no sideways scroll
//   keyboard   the Strata is one tab stop with arrows; Enter opens the Review Desk on that question; inside it Enter accepts, N jumps
//              to the least certain, Backspace rejects with an undo, U takes it back, Shift+A accepts the certain ones, Tab stays
//              inside the dialog, Escape closes it and the focus returns to the cell
// Screenshots go to Y01_SHOTS when it is set (outside the repository), else nowhere.
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openGallery, pickEntry, showState } from './jury/lib'

const SHOTS = process.env.Y01_SHOTS ? resolve(process.env.Y01_SHOTS) : ''
const shot = async (page: Page, sel: string, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.locator(sel).first().screenshot({ path: resolve(SHOTS, name) })
}

/** Open the entry and show state i alone. The viewport is wide enough that the desk gets its full 1230 px. */
async function state(page: Page, i: number, theme: 'light' | 'dark' = 'light') {
  await openGallery(page, theme)
  const { states } = await pickEntry(page, 'Y01')
  expect(states.length).toBeGreaterThan(10)
  await showState(page, i, states.length)
  await page.locator('.pp-desk').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

test.describe('Y01 geometry', () => {
  test.use({ viewport: { width: 1760, height: 900 } })

  for (const theme of ['light', 'dark'] as const) {
    test(`the desk at the canvas size has no inner scroll and no target under 44 px (${theme})`, async ({ page }) => {
      await state(page, 0, theme)
      const box = await page.locator('.y01-box').first().boundingBox()
      expect(Math.round(box!.width)).toBe(1230)
      expect(Math.round(box!.height)).toBe(664)
      const m = await page.evaluate(() => {
        const q = (s: string) => document.querySelector<HTMLElement>(s)!
        const inner = q('.pp-desk-in')
        const cols = [...document.querySelectorAll<HTMLElement>('.pp-desk .pp-col')]
        const wrap = q('.pp-gridwrap')
        const rows = [...document.querySelectorAll<HTMLElement>('.pp-row')]
        const last = rows[rows.length - 1].getBoundingClientRect()
        const small = [...document.querySelectorAll<HTMLElement>('.pp-dot, .pp-paper, .pp-pg, .pp-route, .pp-drop-btn')]
          .map((e) => ({ c: e.className, r: e.getBoundingClientRect() }))
          .filter((x) => x.r.width > 0 && (x.r.width < 43.5 || x.r.height < 43.5))
          .map((x) => `${x.c} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`)
        return {
          innerOverflowY: inner.scrollHeight - inner.clientHeight,
          innerOverflowX: inner.scrollWidth - inner.clientWidth,
          colOverflow: cols.map((c) => c.scrollHeight - c.clientHeight),
          wrapClipBottom: Math.round(last.bottom - wrap.getBoundingClientRect().bottom),
          strataOverflow: q('.pp-strata').scrollHeight - q('.pp-strata').clientHeight,
          small,
          dots: document.querySelectorAll('.pp-dot').length,
        }
      })
      expect(m.innerOverflowY, 'the desk scrolls inside').toBeLessThanOrEqual(1)
      expect(m.innerOverflowX).toBeLessThanOrEqual(1)
      for (const o of m.colOverflow) expect(o, 'a column scrolls inside').toBeLessThanOrEqual(1)
      expect(m.wrapClipBottom, 'the last topic row is cut off').toBeLessThanOrEqual(1)
      expect(m.strataOverflow).toBeLessThanOrEqual(1)
      expect(m.small, 'targets under 44 px').toEqual([])
      expect(m.dots).toBe(9 * 6)
      await shot(page, '.y01-box', `desk-1230-${theme}.png`)
    })
  }

  test('the open tray, the empty desk and the review overlay fit the same box', async ({ page }) => {
    for (const i of [1, 4, 5]) {
      await state(page, i)
      const m = await page.evaluate(() => {
        const inner = document.querySelector<HTMLElement>('.y01-box')!
        const over = [...inner.querySelectorAll<HTMLElement>('*')].filter((e) => {
          const r = e.getBoundingClientRect(), b = inner.getBoundingClientRect()
          return r.width > 0 && (r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.top < b.top - 1) && getComputedStyle(e).position !== 'fixed'
        }).map((e) => e.className.toString().slice(0, 40))
        return { over, scroll: inner.scrollHeight - inner.clientHeight }
      })
      expect(m.over, `state ${i}: parts outside the box`).toEqual([])
      expect(m.scroll).toBeLessThanOrEqual(1)
      await shot(page, '.y01-box', `desk-state-${i}.png`)
    }
  })

  test('the Review Desk at 1100 x 620 keeps every action on screen', async ({ page }) => {
    await state(page, 6)
    const m = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('.rv-desk')!
      const r = d.getBoundingClientRect()
      const parts = [...d.querySelectorAll<HTMLElement>('.rv-actions button, .rv-toggles [role="switch"], .rv-foot, .rv-primary')]
      return { h: Math.round(r.height), w: Math.round(r.width), cut: parts.filter((p) => { const b = p.getBoundingClientRect(); return b.bottom > r.bottom + 1 || b.right > r.right + 1 }).map((p) => p.textContent?.slice(0, 20)) }
    })
    expect(m.cut).toEqual([])
    expect(m.h).toBe(620)
    await shot(page, '.y01-review', 'review-1100.png')
  })
})

test.describe('Y01 keyboard path', () => {
  test.use({ viewport: { width: 1760, height: 900 } })

  test('Strata to Review Desk and back, by keys alone', async ({ page }) => {
    await state(page, 0)
    // one tab stop in the grid, and it is a cell
    const stops = await page.locator('.pp-dot[tabindex="0"]').count()
    expect(stops).toBe(1)
    await page.locator('.pp-dot[tabindex="0"]').focus()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    const rc = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.rc)
    expect(rc).toBe('1:5')
    // the callout shows the crop and who tagged it
    await expect(page.locator('.pp-tip')).toContainText('tagged by')
    await page.keyboard.press('Enter')
    const dlg = page.locator('.rv-desk[role="dialog"]')
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('.rv-box[data-sel="true"]')).toHaveAttribute('aria-label', /Q2/)

    const count = () => dlg.locator('.rv-count b').textContent()
    expect(await count()).toBe('0 of 7')
    await page.keyboard.press('Enter')
    expect(await count()).toBe('1 of 7')
    await page.keyboard.press('n')
    await expect(dlg.locator('.rv-box[data-sel="true"]')).toHaveAttribute('aria-label', /Q5/)
    await page.keyboard.press('Backspace')
    await expect(dlg.locator('.rv-undo')).toContainText('Undo within 10 s')
    await page.keyboard.press('u')
    await expect(dlg.locator('.rv-undo')).toHaveCount(0)
    await page.keyboard.press('Shift+A')
    await expect.poll(count).toBe('3 of 7')

    // Tab stays inside the dialog
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => !!document.activeElement?.closest('.rv-desk'))
      expect(inside, `Tab ${i} left the dialog`).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(page.locator('.rv-desk[role="dialog"]')).toHaveCount(0)
    const back = await page.evaluate(() => (document.activeElement as HTMLElement).className)
    expect(back).toContain('pp-dot')
  })

  test('the crop handles move an edge 4 px on Shift+arrow', async ({ page }) => {
    await state(page, 6)
    const handle = page.locator('.rv-handle[data-handle="br"]').first()
    await handle.focus()
    const before = await page.locator('.rv-box[data-sel="true"]').boundingBox()
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowDown')
    const after = await page.locator('.rv-box[data-sel="true"]').boundingBox()
    expect(Math.round(after!.width - before!.width)).toBe(4)
    expect(Math.round(after!.height - before!.height)).toBe(4)
    const size = await handle.boundingBox()
    expect(size!.width).toBeGreaterThanOrEqual(43.5)
    expect(size!.height).toBeGreaterThanOrEqual(43.5)
  })
})

test.describe('Y01 at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('one column, no sideways scroll, the strata fits without an inner scrollbar', async ({ page }) => {
    await state(page, 0)
    const m = await page.evaluate(() => {
      const r = (s: string) => document.querySelector<HTMLElement>(s)!.getBoundingClientRect()
      const wrap = document.querySelector<HTMLElement>('.pp-gridwrap')!
      return {
        page: document.documentElement.scrollWidth - innerWidth,
        wrap: wrap.scrollWidth - wrap.clientWidth,
        sameColumn: Math.abs(r('.pp-col-strata').left - r('.pp-col-list').left) < 2 && Math.abs(r('.pp-col-strata').width - r('.pp-col-list').width) < 2,
        below: r('.pp-col-list').top > r('.pp-col-strata').bottom - 2,
        years: document.querySelectorAll('.pp-yearhead .pp-yh').length,
      }
    })
    expect(m.page).toBeLessThanOrEqual(1)
    expect(m.wrap, 'the grid scrolls sideways').toBeLessThanOrEqual(1)
    expect(m.sameColumn).toBe(true)
    expect(m.below).toBe(true)
    expect(m.years).toBeGreaterThanOrEqual(4)
    await shot(page, '.y01-box', 'desk-390.png')
  })

  test('the empty desk says WAITING and why, and draws no dot', async ({ page }) => {
    await state(page, 1)
    await expect(page.locator('.pp-desk')).toContainText('Waiting: the paper engine is not connected yet')
    await expect(page.locator('.pp-dot')).toHaveCount(0)
    await shot(page, '.y01-box', 'desk-empty-390.png')
  })
})
