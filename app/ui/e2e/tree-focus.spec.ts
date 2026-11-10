// Chunk 10 in a real Chromium: the Tree and Focus workspaces inside the real frame (treeHarness.ts).
// What happy-dom cannot do: the one-canvas rule at 1366x768 and 1920x1080 (nothing in the centre scrolls),
// the inspector floating at 1366 and docking at 1920, the real press-and-hold, and the left/right collapse
// while a session runs. The glide, the rubber band and the frame rate are in perf-trace.spec.ts.
import { expect, test, type Page } from '@playwright/test'
import { NO_GATE, openTreeFrame } from './treeHarness'

test.use({ contextOptions: { reducedMotion: 'no-preference' }, colorScheme: 'dark' })

const SIZES = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]

/** The centre's scroller: scrollHeight above clientHeight would be a page scroll. */
const noPageScroll = async (page: Page, label: string) => {
  const m = await page.evaluate(() => {
    const s = document.querySelector('.ww-scroll')!
    return { sh: s.scrollHeight, ch: s.clientHeight, sw: s.scrollWidth, cw: s.clientWidth, top: s.scrollTop }
  })
  expect(m.sh, `${label}: vertical scroll ${m.sh} > ${m.ch}`).toBeLessThanOrEqual(m.ch + 1)
  expect(m.sw, `${label}: horizontal scroll ${m.sw} > ${m.cw}`).toBeLessThanOrEqual(m.cw + 1)
  return m
}

for (const vp of SIZES) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.beforeEach(async ({ page }) => page.setViewportSize(vp))

    test('Tree is one canvas: the stage has room, the page does not scroll, with the inspector open too', async ({ page }) => {
      const f = await openTreeFrame(page, { ws: 'tree' })
      await page.waitForSelector('.ww-tree-stage')
      await noPageScroll(page, 'tree, nothing selected')
      const stage = await page.locator('.ww-tree-stage').boundingBox()
      expect(stage!.height).toBeGreaterThan(vp.height * 0.4)
      expect(stage!.width).toBeGreaterThan(500)
      // open the in-progress node (the NEXT one: the first view is centred on it)
      await page.locator(`.tree-node[data-id="${f.inProgress[0]}"]`).click()
      const insp = page.locator('.ww-insp')
      await expect(insp).toBeVisible()
      await noPageScroll(page, 'tree, inspector open')
      const pageW = await page.locator('.ww-tree-page').evaluate((el) => el.getBoundingClientRect().width)
      test.info().annotations.push({ type: 'workspace-width', description: String(Math.round(pageW)) })
      const docked = await page.locator('.ww-tree').getAttribute('data-docked')
      expect(docked, `workspace width ${Math.round(pageW)}`).toBe(vp.width >= 1500 ? 'true' : 'false')
      const ib = (await insp.boundingBox())!
      expect(ib.y + ib.height).toBeLessThanOrEqual(vp.height)
      if (docked === 'true') {
        const sb = (await page.locator('.ww-tree-stage').boundingBox())!
        expect(sb.x + sb.width).toBeLessThanOrEqual(ib.x + 1) // beside the stage, not over it
      }
      // opaque body: the computed background is not transparent and is not glass
      const bg = await insp.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, bf: getComputedStyle(el).backdropFilter, edge: getComputedStyle(el).borderTopWidth }))
      expect(bg.bg).not.toMatch(/rgba\(.*,\s*0(\.\d+)?\)$/)
      expect(bg.bf === 'none' || bg.bf === '').toBe(true)
      expect(bg.edge).toBe('1px')
      // Sharpen prints the server's sentence; nothing was sent by pressing it
      const sharpen = page.getByRole('button', { name: 'Sharpen' })
      await expect(sharpen).toHaveAttribute('aria-disabled', 'true')
      await expect(page.locator('.ww-mastery')).toContainText('Only a mastered node can be sharpened; this one is in progress.')
      // a mastered node: the sentence is the server's, and De-master is the hold control
      await page.locator(`.tree-node[data-id="${f.mastered[0]}"]`).evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      await expect(page.locator('.ww-insp')).toHaveAttribute('data-node', f.mastered[0])
      await expect(page.locator('.ww-mastery')).toContainText(NO_GATE)
      await expect(page.locator('.ww-mastery .ww-hold')).toBeVisible()
      await noPageScroll(page, 'tree, mastered node open')
    })

    test('Tree: the toolbar wraps instead of overflowing and the chips row is one line', async ({ page }) => {
      await openTreeFrame(page, { ws: 'tree' })
      await page.waitForSelector('.ww-tree-stage')
      const bar = (await page.locator('.ww-tree-bar').boundingBox())!
      const chips = (await page.locator('.ww-tree-chips').boundingBox())!
      expect(bar.height).toBeLessThan(vp.height * 0.2)
      expect(chips.height).toBeLessThan(80)
      const overflow = await page.locator('.ww-tree-bar').evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    })

    test('Focus is one canvas: Crucible idle, Crucible running, and Drill', async ({ page }) => {
      await openTreeFrame(page, { ws: 'focus' })
      await page.waitForSelector('.ww-crucible')
      await noPageScroll(page, 'crucible idle')
      await page.getByRole('button', { name: 'Start session' }).click()
      await expect(page.locator('.ww-frame')).toHaveAttribute('data-focus', 'on')
      await noPageScroll(page, 'crucible running')
      await page.getByRole('radio', { name: 'Drill' }).click()
      await page.waitForSelector('.ww-drill')
      await noPageScroll(page, 'drill')
    })
  })
}

test('Fit on the real bank: one chip per branch, in one row, and the SVG branch captions step aside', async ({ page }) => {
  const f = await openTreeFrame(page, { ws: 'tree' })
  await page.waitForSelector('.ww-tree-stage')
  await page.getByRole('button', { name: /Fit/ }).click()
  await expect(page.locator('.ww-tree-stage')).toHaveAttribute('data-moving', 'false', { timeout: 3000 })
  const chips = page.locator('.ww-tree-chips .ww-chip')
  expect(await chips.count()).toBe(f.branches)
  const caption = await page.evaluate(() => {
    const svg = document.querySelector('.tree-svg')!
    const t = document.querySelector('.tree-svg .tree-branch')
    return { far: svg.classList.contains('lod-far'), display: t ? getComputedStyle(t).display : 'none' }
  })
  test.info().annotations.push({ type: 'fit-lod-far', description: String(caption.far) }, { type: 'branch-chips', description: String(f.branches) })
  if (caption.far) expect(caption.display).toBe('none')
  const row = (await page.locator('.ww-tree-chips').boundingBox())!
  expect(row.height).toBeLessThan(80)
})

test('Focus: pressing Start collapses the side columns to a 48 px timer rail and Esc restores them', async ({ page }) => {
  await openTreeFrame(page, { ws: 'focus' })
  await page.waitForSelector('.ww-crucible')
  const leftBefore = (await page.locator('.ww-left').boundingBox())!.width
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.locator('.ww-frame')).toHaveAttribute('data-focus', 'on')
  await expect.poll(async () => Math.round((await page.locator('.ww-left').boundingBox())!.width)).toBe(48)
  await expect(page.locator('.ww-left .ww-focus-rail')).toBeVisible()
  expect(await page.locator('.ww-right').isVisible()).toBe(false)
  await page.keyboard.press('Escape')
  await expect(page.locator('.ww-frame')).not.toHaveAttribute('data-focus', 'on')
  expect(Math.round((await page.locator('.ww-left').boundingBox())!.width)).toBe(Math.round(leftBefore))
  await expect(page.locator('.ww-crucible')).toHaveAttribute('data-running', 'true') // Esc restored the columns; the session goes on
})

test('Focus: End session needs a real 400 ms hold; a short press does nothing; the end is worded as ended', async ({ page }) => {
  await openTreeFrame(page, { ws: 'focus' })
  await page.waitForSelector('.ww-crucible')
  await page.getByRole('button', { name: 'Start session' }).click()
  const hold = page.locator('.ww-crucible .ww-hold')
  await expect(hold).toBeVisible()
  const b = (await hold.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.up()
  await expect(page.locator('.ww-crucible')).toHaveAttribute('data-running', 'true')
  await page.mouse.down()
  await expect(page.locator('.ww-crucible')).toHaveAttribute('data-running', 'false', { timeout: 2000 })
  await page.mouse.up()
  const text = await page.locator('.ww-crucible').innerText()
  expect(text).toContain('Session ended')
  expect(text).not.toMatch(/failed|forfeit|lost/i)
})
