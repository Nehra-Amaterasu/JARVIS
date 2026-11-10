// P5 (plan 8.6): frame-rate traces. Born in chunk 10 (Tree) and 14 (all). Chunk 1a ships the in-page
// sampler (same method as the in-app glass sampler: p5 fps = 1000 / the 95th-percentile frame gap)
// and runs it over the lab's motions so the harness is proven. Per the plan, headless Chromium
// rasterises in software, so this records `raster` and reports "floors not tested" unless the
// run is on a GPU: no frame-rate floor is asserted here, only that a number is measured.
import { MOTIONS, expect, openLab, test } from './fixtures'
import { openTreeFrame } from './treeHarness'

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

test('20 workspace switches with glass on and off, 1x and 4x CPU', async () => {
  test.skip(true, 'chunk 14 runs the workspace-switch traces; the Tree part below is chunk 10 (plan 8.6 P5)')
})

// ---- chunk 10: the Tree (plan 8.6 P5, 5.7.2 #4, 5.7.6 rule 4) -----------------------------------------------
// The real frame, the real Tree page and the real bank in a real Chromium (treeHarness.ts). Rest-state rAF
// counts and the throw distance are asserted; the frame-rate floor is a hard gate only on a GPU run.

test('the glide: a fast throw moves the view, the rAF loop stops at rest, and nothing runs after it', async ({ page }) => {
  await openTreeFrame(page, { ws: 'tree' })
  await page.waitForSelector('.ww-tree-stage')
  const stage = page.locator('.ww-tree-stage')
  await expect(stage).toHaveAttribute('data-moving', 'false')
  await page.waitForTimeout(700) // the first view and the switch settle
  const idle = async (ms: number) => {
    const a = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    await page.waitForTimeout(ms)
    return (await page.evaluate(() => (window as unknown as { __raf: number }).__raf)) - a
  }
  const baseline = await idle(500) // anything else on the page that asks for frames while the Tree is idle
  const tf = () => page.locator('.tree-svg > g').first().getAttribute('transform')
  const box = (await stage.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const num = (s: string | null) => (s ?? '').match(/-?[\d.]+/g)!.slice(0, 2).map(Number)
  const travel = Math.hypot(8 * 40, 8 * 6)
  // One throw: 8 quick moves, then the button up straight away (the release velocity is taken over the last 80 ms).
  // On a loaded machine the CDP round trips can stretch past that window and the release carries no speed, so a
  // throw that did not glide is repeated (the other way, to stay inside the bounds) up to 3 times, and the count is recorded.
  const throwOnce = async (dir: 1 | -1) => {
    const start = await tf()
    const framesBefore = Number((await stage.getAttribute('data-frames')) ?? 0)
    const rafBefore = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    // timestamps taken in the page, so Playwright's own polling interval (up to 1 s) is not counted as glide
    await page.evaluate(() => {
      const w = window as unknown as { __up: number; __rest: number }
      w.__up = 0
      w.__rest = 0
      window.addEventListener('pointerup', () => (w.__up = performance.now()), { once: true, capture: true })
      new MutationObserver((_m, o) => {
        const el = document.querySelector('.ww-tree-stage')!
        if (w.__up && el.getAttribute('data-moving') === 'false') {
          w.__rest = performance.now()
          o.disconnect()
        }
      }).observe(document.querySelector('.ww-tree-stage')!, { attributes: true, attributeFilter: ['data-moving'] })
    })
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    const t0 = Date.now()
    for (let i = 1; i <= 8; i++) await page.mouse.move(cx + dir * -i * 40, cy - dir * i * 6)
    const dragMs = Date.now() - t0
    await page.mouse.up()
    await expect(stage).toHaveAttribute('data-moving', 'false', { timeout: 3000 })
    const glideMs = Math.round(await page.evaluate(() => { const w = window as unknown as { __up: number; __rest: number }; return w.__rest - w.__up }))
    const [sx, sy] = num(start)
    const [ex, ey] = num(await tf())
    return {
      dragMs, glideMs, moved: Math.hypot(ex - sx, ey - sy),
      frames: Number(await stage.getAttribute('data-frames')) - framesBefore,
      rafUsed: (await page.evaluate(() => (window as unknown as { __raf: number }).__raf)) - rafBefore,
    }
  }
  let r = await throwOnce(1)
  let attempts = 1
  while (r.moved <= travel + 20 && attempts < 3) { r = await throwOnce(attempts % 2 ? -1 : 1); attempts++ }
  const { dragMs, glideMs, frames, rafUsed, moved } = r
  test.info().annotations.push(
    { type: 'throw-attempts', description: String(attempts) }, { type: 'drag-ms', description: String(dragMs) }, { type: 'glide-ms', description: String(glideMs) },
    { type: 'gesture-frames (8 drag moves + the glide)', description: String(frames) }, { type: 'raf-callbacks-in-gesture', description: String(rafUsed) },
    { type: 'pointer-travel-px', description: travel.toFixed(0) }, { type: 'view-moved-px', description: moved.toFixed(0) },
    { type: 'throw-distance-px', description: (moved - travel).toFixed(0) }, { type: 'idle-raf-per-500ms', description: String(baseline) },
  )
  expect(glideMs).toBeLessThan(800) // 450 ms of inertia at most; this throw stays inside the bounds, so no rubber-band return follows
  expect(frames).toBeLessThanOrEqual(8 + 40) // the drag's own paints, then 450 ms of glide at most: 27 frames at 60 Hz
  expect(moved).toBeGreaterThan(travel + 20) // a real throw: the view travels further than the pointer did
  expect(moved).toBeLessThan(travel + 330) // the throw adds at most tau*(v0 - rest) = 330 px at the 3 px/ms cap
  // at rest: no frame requested by the Tree. The page may have its own background callbacks, so compare with the idle baseline.
  expect(await idle(700)).toBeLessThanOrEqual(baseline + 1)
  await expect(stage).toHaveAttribute('data-moving', 'false')
})

test('a drag past the edge is resisted, and on release the view comes back and some of the tree is back on the stage', async ({ page }) => {
  await openTreeFrame(page, { ws: 'tree' })
  await page.waitForSelector('.ww-tree-stage')
  await page.waitForTimeout(700)
  const stage = page.locator('.ww-tree-stage')
  const box = (await stage.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const gx = () => page.locator('.tree-svg > g').first().evaluate((g) => g.getBoundingClientRect().right)
  const before = await gx()
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const pull = 9000
  for (let i = 1; i <= 90; i++) await page.mouse.move(cx - i * 100, cy)
  const during = await gx()
  const pulled = before - during
  test.info().annotations.push({ type: 'pointer-pull-px', description: String(pull) }, { type: 'view-followed-px', description: pulled.toFixed(0) })
  expect(pulled).toBeLessThan(pull * 0.8) // resisted: past the bound the view follows at 0.35 of the pointer
  await page.mouse.up()
  await expect(stage).toHaveAttribute('data-moving', 'false', { timeout: 3000 })
  const after = await gx()
  test.info().annotations.push({ type: 'content-right-edge-px (pulled, returned, stage left)', description: `${during.toFixed(0)}, ${after.toFixed(0)}, ${box.x.toFixed(0)}` })
  expect(after).toBeGreaterThan(during + 100) // it came back
  expect(after).toBeGreaterThanOrEqual(box.x) // and some of the tree is on the stage again (the bound is 120 px of the padded view box)
})

test('p5 fps over a Tree pan, glide and zoom; floors are asserted only on a GPU run', async ({ page }) => {
  await openTreeFrame(page, { ws: 'tree' })
  await page.waitForSelector('.ww-tree-stage')
  await page.waitForTimeout(700)
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
  const box = (await page.locator('.ww-tree-stage').boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  for (let round = 0; round < 3; round++) {
    await page.mouse.down()
    for (let i = 1; i <= 20; i++) await page.mouse.move(cx + (round % 2 ? i : -i) * 12, cy + i * 3)
    await page.mouse.up() // a glide follows
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, round % 2 ? -120 : 120)
    await page.waitForTimeout(600)
  }
  const { p5, max, n } = await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __run: boolean }
    w.__run = false
    const s = [...w.__gaps].sort((a, b) => a - b)
    const p95 = s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]
    return { p5: 1000 / p95, max: s[s.length - 1], n: s.length }
  })
  test.info().annotations.push({ type: 'tree-p5-fps', description: p5.toFixed(1) }, { type: 'max-gap-ms', description: max.toFixed(1) }, { type: 'frames', description: String(n) }, { type: 'raster', description: raster })
  expect(n).toBeGreaterThan(30)
  expect(p5).toBeGreaterThan(0)
  if (raster === 'gpu') expect(p5).toBeGreaterThanOrEqual(38) // the P5 floor, any machine (55 is the target on a GPU)
  else test.info().annotations.push({ type: 'floors', description: 'not tested (software raster)' })
})

