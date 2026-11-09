// Chunk 1a acceptance: Core is unchanged apart from the --ink-3 fix. Before and after screenshots of
// Core, local and git-ignored (Core shows live data and draws with three.js): clock, ticker and
// every canvas masked. It needs the built UI served at baseURL (npm run bundle:check builds
// dist-e2e, then the preview server starts) and runs twice, once on the base commit and once on
// this branch, with CORE_SHOT_LABEL=before|after.
import { mkdirSync } from 'node:fs'
import { expect, test } from './fixtures'

test('Core, first screen', async ({ page, baseURL }) => {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npm run bundle:check` first')
  const label = process.env.CORE_SHOT_LABEL ?? 'after'
  mkdirSync('e2e/__core__', { recursive: true })
  await page.goto('/')
  await page.waitForTimeout(1500)
  await page.screenshot({
    path: `e2e/__core__/core-${label}.png`,
    mask: [page.locator('canvas'), page.locator('.ticker'), page.locator('[data-volatile]')],
  })
  expect(true).toBe(true)
})
