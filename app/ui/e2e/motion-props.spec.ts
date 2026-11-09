// P2 (plan 8.6): no layout animation in a real run. Born in chunk 1a on the lab page; chunk 4 adds
// the 3 s scripted scroll on every workspace and the 30 switches.
import { MOTIONS, expect, openLab, snapshotAnimations, test } from './fixtures'

// plan 5.7.6 rule 1: transform and opacity, clip-path on small elements, paint-only colour at <= 160 ms
const ALLOWED = new Set(['opacity', 'transform', 'clipPath', 'clip-path', 'backgroundColor', 'borderColor', 'color', 'background-color', 'border-color'])
const COLOUR = new Set(['backgroundColor', 'borderColor', 'color', 'background-color', 'border-color'])

test('keyframe audit: every motion animates only allowed properties, colour only at 160 ms or less', async ({ page }) => {
  await openLab(page)
  for (const m of MOTIONS) {
    await m.start(page)
    for (const a of await snapshotAnimations(page)) {
      for (const p of a.props) {
        expect(ALLOWED.has(p), `${m.id} ${a.name}: ${p}`).toBe(true)
        if (COLOUR.has(p)) expect(a.duration, `${m.id} ${a.name}`).toBeLessThanOrEqual(160)
      }
    }
  }
})

test('hovering and pressing animate transform and opacity, not layout', async ({ page }) => {
  await openLab(page)
  await page.hover('#lift')
  await page.mouse.down()
  const anims = [...(await snapshotAnimations(page))]
  await page.mouse.up()
  for (const a of anims) for (const p of a.props) expect(ALLOWED.has(p), `${a.name}: ${p}`).toBe(true)
})

test('layout does not move while the motions run (card and frame boxes are stable)', async ({ page }) => {
  await openLab(page)
  const box = () => page.evaluate(() => ['root', 'centre', 'fill'].map((id) => { const e = document.getElementById(id)!; return [e.offsetWidth, e.offsetHeight] }))
  const before = await box()
  for (const m of MOTIONS) await m.start(page)
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(60)
    expect(await box()).toEqual(before)
  }
})

test('layout count during the motions is bounded and will-change is never set', async ({ page }) => {
  await openLab(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount')!.value
  const a = await layouts()
  for (const m of MOTIONS) await m.start(page)
  await page.waitForTimeout(600)
  const used = (await layouts()) - a
  // the attribute writes themselves cause style recalcs; the bound is generous and the number is recorded
  test.info().annotations.push({ type: 'layout-count', description: String(used) })
  expect(used).toBeLessThanOrEqual(MOTIONS.length + 2)
  const wc = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).willChange !== 'auto').length)
  expect(wc).toBe(0)
})
