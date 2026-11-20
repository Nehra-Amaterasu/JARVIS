// T01: the Tree under the real shell (flag on): the Grove, one tree and the node drawer, at 1366x768 and 390x844, in the light Well Wisher
// clay ground, on the sandbox (null evidence adapter: every node OPEN or LOCKED, the ledger WAITING with its reason).
//
// It checks the keyboard path end to end (ring, stage, drawer, Esc back), the geometry (readable, 44 px, no sideways scroll, no inner
// scroll on the laptop canvas, no label clipped by the stage), and that an idle stage costs zero animation frames.
// T01_SHOTS=<folder> writes one PNG per state and size (outside the repository).
//
// Own ports: WW_SANDBOX_PORT=8825 WW_PREVIEW_PORT=5225 WW_SANDBOX_DIR=<scratch> npx playwright test e2e/t01-tree.spec.ts
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { PROBE, type Probe } from './probe'

const SHOTS = process.env.T01_SHOTS ? resolve(process.env.T01_SHOTS) : ''
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const WW = ['day', 'focus', 'study', 'tree', 'career']

const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function openTree(page: Page, baseURL: string | undefined) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  await blurText(page)
  if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', 'ww')
  await page.keyboard.press(`Control+${WW.indexOf('tree') + 1}`)
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', 'tree')
  await page.locator('.tg').waitFor({ state: 'attached', timeout: 20_000 })
  await page.waitForTimeout(700)
}

const probe = async (page: Page, at: string, size: { w: number }, problems: string[]) => {
  const m = (await page.evaluate(PROBE)) as Probe
  for (const k of ['small', 'targets', 'sideways', 'wraps', 'ellipsis'] as const) for (const d of m[k]) problems.push(`${at} ${k}: ${d}`)
  if (m.docOverflow > 1) problems.push(`${at} document overflow ${m.docOverflow}px`)
  if (size.w >= 1000) for (const d of m.innerY) problems.push(`${at} inner scroll: ${d}`)
}
const shot = async (page: Page, name: string, w: number) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `t01-${name}-${w}.png`) })
}
const active = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null
  return { id: a?.getAttribute('data-id') ?? null, tree: a?.getAttribute('data-tree') ?? null, cls: a?.className?.toString?.() ?? '' }
})

test.describe('T01: the Tree under the new shell', () => {
  for (const size of SIZES) {
    test(`${size.w}x${size.h}: the Grove, one tree and the node drawer are readable, 44 px, and nothing is clipped`, async ({ page, baseURL }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: size.w, height: size.h })
      await openTree(page, baseURL)
      const problems: string[] = []
      const desk = size.w >= 1000

      // ---- scale 1: the Grove ----
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '1')
      await expect(page.locator('.ww-tree-stage .gr-seed')).toHaveCount(10)
      await expect(page.locator('.gr-seed[data-dashed]')).toHaveCount(10)
      await expect(page.locator('.gr-total')).toHaveText('– –')
      await expect(page.locator('.tg-ledger')).toContainText('WAITING')
      await probe(page, `grove ${size.w}px`, size, problems)
      if (desk) {
        // no seed and no label leaves the stage, and no two seeds (with their labels) overlap
        const boxes = await page.evaluate(() => {
          const st = document.querySelector('.tg-grove-stage')!.getBoundingClientRect()
          const r = (e: Element) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom } }
          return [...document.querySelectorAll('.gr-seed')].map((s) => {
            const parts = [r(s), r(s.querySelector('.gr-name')!)]
            return { name: s.getAttribute('data-tree'), parts, inside: parts.every((p) => p.l >= st.left && p.r <= st.right && p.t >= st.top && p.b <= st.bottom) }
          })
        })
        for (const b of boxes) if (!b.inside) problems.push(`grove: ${b.name} leaves the stage`)
        const hit = (p: { l: number; r: number; t: number; b: number }, q: { l: number; r: number; t: number; b: number }) => p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          if (boxes[i].parts.some((p) => boxes[j].parts.some((q) => hit(p, q)))) problems.push(`grove: ${boxes[i].name} overlaps ${boxes[j].name}`)
        }
      }
      await shot(page, 'grove', size.w)

      // the ring is one composite: Tab reaches one seed, arrows move round it
      await page.locator('.gr-seed').first().focus()
      await page.keyboard.press('ArrowRight')
      expect((await active(page)).tree).toBe((await page.locator('.gr-seed').nth(1).getAttribute('data-tree')))
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('End')
      expect((await active(page)).tree).toBe((await page.locator('.gr-seed').nth(9).getAttribute('data-tree')))
      await page.keyboard.press('Home')
      await page.keyboard.press('Enter')

      // ---- scale 2: one tree ----
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '2')
      await page.locator('.ww-tree-stage .tree-node').first().waitFor({ state: 'attached' })
      await page.waitForTimeout(500)
      await probe(page, `tree ${size.w}px`, size, problems)
      await shot(page, 'tree', size.w)

      // idle costs zero animation frames: count rAF callbacks over 700 ms of nothing
      await page.evaluate(() => {
        const w = window as unknown as { __raf: number }
        w.__raf = 0
        const orig = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = (cb) => { w.__raf += 1; return orig(cb) }
      })
      await page.waitForTimeout(700)
      expect(await page.evaluate(() => (window as unknown as { __raf: number }).__raf), 'animation frames while idle').toBe(0)

      // keyboard in the stage: one tab stop; arrows, brackets, zoom, pan; Tab leaves
      const stops = await page.locator('.tg-svg [data-id][tabindex="0"]').count()
      expect(stops).toBe(1)
      const first = page.locator('.tg-svg [data-id][tabindex="0"]').first()
      await first.focus()
      const start = await active(page)
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowDown')
      const moved = await active(page)
      expect(moved.id, 'arrows move the focus to another node').not.toBe(start.id)
      const t0 = await page.locator('.tg-svg > g').getAttribute('transform')
      await page.keyboard.press('Shift+ArrowRight')
      await page.waitForTimeout(450)
      expect(await page.locator('.tg-svg > g').getAttribute('transform'), 'Shift+arrow pans').not.toBe(t0)
      await page.keyboard.press('PageDown')
      await page.waitForTimeout(450)
      expect((await active(page)).id, 'Page Down: the next branch').not.toBe(moved.id)
      await page.keyboard.press('+')
      await page.waitForTimeout(450)
      const zin = await page.locator('.tg-zoom').textContent()
      await page.keyboard.press('-')
      await page.keyboard.press('-')
      await page.waitForTimeout(450)
      expect(await page.locator('.tg-zoom').textContent(), 'minus zooms out').not.toBe(zin)
      await page.keyboard.press('0')
      await page.waitForTimeout(450)
      // the pan and zoom buttons are real keys
      for (const name of [/Pan left/, /Pan up/, /Zoom in/, /Fit the whole tree/]) await page.getByRole('button', { name }).click()
      await page.waitForTimeout(450)
      // no label is clipped by the stage: every drawn label lies inside the stage box at the first view
      await page.keyboard.press('Escape')   // from the body: back to the Grove only when focus is outside a drawer; the stage is a group, so this goes up a scale
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '1')
      await page.locator('.gr-seed').first().click()
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '2')
      await page.waitForTimeout(600)
      const clipped = await page.evaluate(() => {
        const st = document.querySelector('.tg-stage')!.getBoundingClientRect()
        const out: string[] = []
        for (const t of document.querySelectorAll('.tg-svg .sn-label, .tg-svg .hub-name')) {
          const r = t.getBoundingClientRect()
          if (r.width < 1) continue
          const partly = (r.left < st.left || r.right > st.right || r.top < st.top || r.bottom > st.bottom) && r.right > st.left && r.left < st.right && r.bottom > st.top && r.top < st.bottom
          if (partly) out.push(((t.textContent || '').slice(0, 24)) + ` ${Math.round(r.left - st.left)},${Math.round(r.top - st.top)}`)
        }
        return out
      })
      // a label cut by the edge of a panned stage is expected while panning; at the first view none may be (the stage does not draw a label
      // that would be cut, so this fails if that rule or the framing breaks)
      expect(clipped, `labels cut by the stage at the first view: ${clipped.join('; ')}`).toEqual([])
      // the view controls sit beside or under the stage, never over a drawn node or label
      const overlaps = await page.evaluate(() => {
        const c = document.querySelector('.tg-controls')!.getBoundingClientRect()
        const st = document.querySelector('.tg-stage')!.getBoundingClientRect()
        const seen = (r: DOMRect) => r.left < st.right && st.left < r.right && r.top < st.bottom && st.top < r.bottom   // clipped by the stage means not drawn
        const out: string[] = []
        for (const t of document.querySelectorAll('.tg-svg [data-id], .tg-svg .sn-label, .tg-svg .hub-name')) {
          const r = t.getBoundingClientRect()
          if (r.width < 1 || !seen(r)) continue
          if (r.left < c.right && c.left < r.right && r.top < c.bottom && c.top < r.bottom) out.push(((t.textContent || t.getAttribute('data-id') || '').slice(0, 24)))
        }
        return out
      })
      expect(overlaps, `the view controls cover: ${overlaps.join('; ')}`).toEqual([])

      // ---- scale 3: the node drawer, opened from a node in the stage with Enter ----
      await page.locator('.tg-svg .tree-node[tabindex="0"]').first().focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '3')
      await expect(page.locator('.nd')).toBeFocused()
      // Tab walks the drawer's own keys, and every one is a real button
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('.nd')), 'Tab stays in the drawer').toBe(true)
      await page.keyboard.press('Escape')
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '2')
      await page.locator('.ww-tree-bar').getByRole('button', { name: /^Next/ }).click()
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '3')
      await expect(page.locator('.ww-insp').first()).toBeVisible()
      await page.waitForTimeout(600)
      await probe(page, `node ${size.w}px`, size, problems)
      await shot(page, 'node', size.w)
      // with the drawer open the view controls still cover no node
      const under = await page.evaluate(() => {
        const c = document.querySelector('.tg-controls')!.getBoundingClientRect()
        const st = document.querySelector('.tg-stage')!.getBoundingClientRect()
        const seen = (r: DOMRect) => r.left < st.right && st.left < r.right && r.top < st.bottom && st.top < r.bottom   // clipped by the stage means not drawn
        return [...document.querySelectorAll('.tg-svg [data-id]')].filter((t) => { const r = t.getBoundingClientRect(); return r.width > 1 && seen(r) && r.left < c.right && c.left < r.right && r.top < c.bottom && c.top < r.bottom }).length
      })
      expect(under, 'drawer open: nodes under the view controls').toBe(0)
      // E with no store says why and invents nothing
      await page.locator('.nd').focus()
      await page.keyboard.press('e')
      await expect(page.locator('.nd-msg')).toContainText(/No evidence store/)
      await expect(page.locator('.nd')).toContainText('WAITING')
      await expect(page.locator('.nd')).toContainText('OPEN')
      // Esc closes the drawer and focus goes back to the node
      await page.keyboard.press('Escape')
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '2')
      await page.waitForTimeout(300)
      expect((await active(page)).id, 'focus returns to the node').not.toBeNull()
      // Esc again goes up a scale, to the seed of the tree
      await page.keyboard.press('Escape')
      await expect(page.locator('.tg')).toHaveAttribute('data-scale', '1')
      await page.waitForTimeout(200)
      expect((await active(page)).cls).toContain('gr-seed')

      expect(problems, problems.join('\n')).toEqual([])
    })
  }

  test('1366x768: the Tree and Branches lists are opaque, readable, 44 px rows and inside the window (the hooks cp2 measures)', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1366, height: 768 })
    await openTree(page, baseURL)
    await page.locator('.gr-seed').first().click()
    await expect(page.locator('.tg')).toHaveAttribute('data-scale', '2')
    for (const key of ['Tree', 'Branches']) {
      await page.locator('.ww-tree-key', { hasText: key }).first().click()
      const panel = page.locator('.ww-tree-panel')
      await expect(panel).toBeVisible()
      const r = await panel.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const rows = [...el.querySelectorAll<HTMLElement>('.ww-tree-opt')]
        return { alpha: (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number)[3] ?? 1, minRow: Math.min(...rows.map((o) => o.getBoundingClientRect().height)), rows: rows.length, inside: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight }
      })
      expect(r.alpha, `${key} panel is opaque`).toBe(1)
      expect(r.minRow, `${key} rows`).toBeGreaterThanOrEqual(43.5)
      expect(r.inside, `${key} panel stays in the window`).toBe(true)
      expect(r.rows).toBeGreaterThan(5)
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
    }
  })
})
