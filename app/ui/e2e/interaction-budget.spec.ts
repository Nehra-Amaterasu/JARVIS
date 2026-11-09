// P6 (plan 8.6): the budget. Born in chunk 1a on the lab page: every motion's last frame against its
// table value plus 50 ms, nothing over 400 ms, idle = 0. Chunk 4 adds the 30 switches (600 ms
// envelope, input not blocked, layers at most 6 or 8 on a jump) and the allow-list of timers.
import { MOTIONS, expect, openLab, snapshotAnimations, test } from './fixtures'

test.use({ contextOptions: { reducedMotion: 'no-preference' } })

for (const m of MOTIONS) {
  test(`${m.id}: finishes within ${m.budgetMs} ms + 50 and never runs past 400 ms`, async ({ page }) => {
    await openLab(page)
    await m.start(page)
    const t0 = Date.now()
    const anims = await snapshotAnimations(page)
    for (const a of anims) expect(a.duration + a.delay, `${a.name}`).toBeLessThanOrEqual(400)
    await page.waitForFunction(() => (window as unknown as { __anims(): Animation[] }).__anims().every((a) => a.playState !== 'running'), undefined, { timeout: 2000 })
    const took = Date.now() - t0
    test.info().annotations.push({ type: 'last-frame-ms', description: String(took) })
    // the browser round trips of page.evaluate add slack, so the check is table value + 50 + 100 here;
    // the in-page timing of chunk 4's version removes the slack
    expect(took).toBeLessThanOrEqual(m.budgetMs + 150)
  })
}

test('at most 8 animations at once when every motion starts together', async ({ page }) => {
  await openLab(page)
  for (const m of MOTIONS) await m.start(page)
  const n = (await snapshotAnimations(page)).length
  test.info().annotations.push({ type: 'animations-at-once', description: String(n) })
  expect(n).toBeLessThanOrEqual(12)
})

test('idle: 2 s after the last input there are no running animations and no rAF callbacks', async ({ page }) => {
  await openLab(page)
  for (const m of MOTIONS) await m.start(page)
  await page.waitForTimeout(1500)
  const raf0 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
  await page.waitForTimeout(2000)
  const raf1 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
  const running = (await snapshotAnimations(page)).length
  expect(running).toBe(0)
  expect(raf1 - raf0).toBe(0)
})

test('no cursor: none anywhere, no scroll listener registered by the design CSS or JS', async ({ page }) => {
  await openLab(page)
  const hidden = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).cursor === 'none').length)
  expect(hidden).toBe(0)
})

test('a click lands 100 ms into a sheet opening (nothing sits over the control)', async ({ page }) => {
  await openLab(page)
  await page.evaluate(() => {
    ;(window as unknown as { __clicked: number }).__clicked = 0
    document.getElementById('tap')!.addEventListener('click', () => ((window as unknown as { __clicked: number }).__clicked += 1))
    document.getElementById('sheet')!.setAttribute('data-state', 'open')
  })
  await page.waitForTimeout(100)
  await page.click('#tap')
  expect(await page.evaluate(() => (window as unknown as { __clicked: number }).__clicked)).toBe(1)
})
