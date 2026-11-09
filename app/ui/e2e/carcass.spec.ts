// P8 (plan 8.6): placeholders (ComingCard, Skeleton) are static: no animation, no transition, no rAF;
// a locked section announces once per session. Born in chunk 1b with ComingCard/LockChip, extended
// in chunk 5 on the real 28 registry entries. Nothing renders them yet.
import { expect, openLab, test } from './fixtures'

test('the page settles with no animation at all before any placeholder exists', async ({ page }) => {
  await openLab(page)
  await page.waitForTimeout(500)
  const n = await page.evaluate(() => (window as unknown as { __anims(): Animation[] }).__anims().length)
  expect(n).toBe(0)
})

test('[data-coming] and [data-skeleton] have no animation, no transition and no rAF for 3 s', async () => {
  test.skip(true, 'ComingCard and Skeleton land in chunk 1b; the registry in chunk 5. Assertions are written in the plan (8.6 P8)')
})

test('a locked section writes one live-region message per session', async () => {
  test.skip(true, 'LockChip lands in chunk 1b')
})
