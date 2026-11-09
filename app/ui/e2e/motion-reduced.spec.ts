// P1 (plan 8.6): every animation respects prefers-reduced-motion and data-motion, in a real Chromium.
// Born in chunk 1a on the lab page (fixtures.ts). Chunk 4 extends it to all 30 workspace switches,
// every overlay and the Tree pan once those exist.
import { MOTIONS, expect, isIdentityTransform, openLab, setHtmlAttr, snapshotAnimations, test } from './fixtures'

const COLOUR_OR_OPACITY = new Set(['opacity', 'color', 'backgroundColor', 'borderColor', 'background-color', 'border-color', 'transform', 'clipPath'])

async function assertReduced(page: import('@playwright/test').Page, motionId: string) {
  const m = MOTIONS.find((x) => x.id === motionId)!
  await m.start(page)
  for (const at of [0, 50, 100, 200]) {
    await page.waitForTimeout(at === 0 ? 0 : 50 + (at === 200 ? 50 : 0))
    for (const a of await snapshotAnimations(page)) {
      expect(a.duration, `${motionId} ${a.name} duration at ${at} ms`).toBeLessThanOrEqual(120)
      for (const p of a.props) expect(COLOUR_OR_OPACITY.has(p), `${motionId}: ${p}`).toBe(true)
      for (const t of a.transforms) expect(isIdentityTransform(t), `${motionId} ${a.name}: transform ${t}`).toBe(true)
    }
  }
}

test.describe('OS reduce', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })
  for (const m of MOTIONS) {
    test(`${m.id}: only opacity or colour, 120 ms or shorter, no moving transform`, async ({ page }) => {
      await openLab(page)
      await assertReduced(page, m.id)
    })
  }
  test('the tokens resolve to the collapsed values', async ({ page }) => {
    await openLab(page)
    const v = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('root')!)
      return ['--dur-switch-in', '--dur-travel', '--dur-celebrate', '--dur-hold', '--stagger', '--dist-rise'].map((n) => cs.getPropertyValue(n).trim())
    })
    expect(v).toEqual(['120ms', '120ms', '120ms', '120ms', '0ms', '0px'])
  })
  test('hold shows no fill: the confirm dialog is the only path', async ({ page }) => {
    await openLab(page)
    await MOTIONS.find((m) => m.id === 'hold')!.start(page)
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.ww-hold-fill')!).display)).toBe('none')
    expect(await snapshotAnimations(page)).toEqual([])
  })
  test('scroll-driven headers are off (final state)', async ({ page }) => {
    await openLab(page)
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('title')!).animationName)).toBe('none')
  })
  test('data-motion="full" keeps travel even though the OS says reduce', async ({ page }) => {
    await openLab(page, { 'data-motion': 'full' })
    await MOTIONS.find((m) => m.id === 'sheet')!.start(page)
    const anims = await snapshotAnimations(page)
    expect(anims.some((a) => a.transforms.some((t) => !isIdentityTransform(t)))).toBe(true)
  })
})

test.describe('OS no-preference', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })
  test('data-motion="calm" behaves as reduce', async ({ page }) => {
    await openLab(page, { 'data-motion': 'calm' })
    for (const m of MOTIONS) {
      await m.start(page)
      for (const a of await snapshotAnimations(page)) {
        expect(a.duration, `${m.id} ${a.name}`).toBeLessThanOrEqual(120)
        for (const t of a.transforms) expect(isIdentityTransform(t), `${m.id}: ${t}`).toBe(true)
      }
    }
  })
  test('switching data-motion at run time changes the resolved tokens with no reload', async ({ page }) => {
    await openLab(page)
    const read = () => page.evaluate(() => getComputedStyle(document.getElementById('root')!).getPropertyValue('--dur-switch-in').trim())
    expect(await read()).toBe('360ms')
    await setHtmlAttr(page, 'data-motion', 'calm')
    expect(await read()).toBe('120ms')
  })
  test('no animation is still running 3 s after it started', async ({ page }) => {
    await openLab(page)
    for (const m of MOTIONS) await m.start(page)
    await page.waitForTimeout(3000)
    const running = await page.evaluate(() => (window as unknown as { __anims(): Animation[] }).__anims().filter((a) => a.playState === 'running').length)
    expect(running).toBe(0)
  })
})
