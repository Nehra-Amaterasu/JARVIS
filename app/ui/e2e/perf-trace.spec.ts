// P5 (plan 8.6): frame-rate traces. Born in chunk 10 (Tree) and 14 (all). Chunk 1a ships the in-page
// sampler (same method as the in-app glass sampler: p5 fps = 1000 / the 95th-percentile frame gap)
// and runs it over the lab's motions so the harness is proven. Per the plan, headless Chromium
// rasterises in software, so this records `raster` and reports "floors not tested" unless the
// run is on a GPU: no frame-rate floor is asserted here, only that a number is measured.
import { MOTIONS, expect, openLab, test } from './fixtures'

test.use({ contextOptions: { reducedMotion: 'no-preference' } })

test('the sampler measures a p5 over the lab motions and records the raster mode', async ({ page }) => {
  await openLab(page)
  const raster = await page.evaluate(() => {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const r = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'none'
    return /swiftshader|software|llvmpipe/i.test(r) || r === 'none' ? 'software' : 'gpu'
  })
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __run: boolean }
    w.__gaps = []
    w.__run = true
    let last = 0
    const tick = (t: number) => {
      if (last) w.__gaps.push(t - last)
      last = t
      if (w.__run) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  for (const m of MOTIONS) await m.start(page)
  await page.waitForTimeout(700)
  const { p5, max, n } = await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __run: boolean }
    w.__run = false
    const s = [...w.__gaps].sort((a, b) => a - b)
    const p95 = s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]
    return { p5: 1000 / p95, max: s[s.length - 1], n: s.length }
  })
  test.info().annotations.push({ type: 'p5-fps', description: p5.toFixed(1) }, { type: 'max-gap-ms', description: max.toFixed(1) }, { type: 'raster', description: raster })
  expect(n).toBeGreaterThan(10)
  expect(p5).toBeGreaterThan(0)
  if (raster === 'software') test.info().annotations.push({ type: 'floors', description: 'not tested (software raster)' })
})

test('20 workspace switches with glass on and off, 1x and 4x CPU; Tree pan, glide and zoom', async () => {
  test.skip(true, 'needs the frame (chunk 4) and the Tree (chunk 10); the floors are a hard gate only on a gpu run (plan 8.6 P5)')
})
