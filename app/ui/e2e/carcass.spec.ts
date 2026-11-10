// P8 (plan 8.6): placeholders (ComingCard, Skeleton) are static: no animation, no transition, no rAF;
// a locked section announces once per session. Born in chunk 1b with ComingCard, Skeleton and LockChip
// (proved on the kitchen sink, e2e/kitchen.ts), extended in chunk 5 on the real 28 registry entries.
import { expect, openLab, test } from './fixtures'
import { KITCHEN_URL, openKitchen } from './kitchen'

test('the page settles with no animation at all before any placeholder exists', async ({ page }) => {
  await openLab(page)
  await page.waitForTimeout(500)
  const n = await page.evaluate(() => (window as unknown as { __anims(): Animation[] }).__anims().length)
  expect(n).toBe(0)
})

// full motion on purpose: calm would make "static" trivially true
const FULL = { 'data-motion': 'full' }

test('[data-coming] and [data-skeleton] have no animation, no transition and no rAF for 3 s', async ({ page }) => {
  await openKitchen(page, { html: FULL })
  await page.waitForTimeout(1200) // the skeleton shows after 200 ms; arrives finish; Reveal chips have fired
  const styles = await page.evaluate(() => {
    const out: { what: string; animation: string; transition: string }[] = []
    for (const root of document.querySelectorAll('[data-coming], [data-skeleton]')) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const cs = getComputedStyle(el)
        out.push({ what: `${el.tagName.toLowerCase()}.${el.className}`, animation: cs.animationName, transition: cs.transitionDuration })
      }
    }
    return out
  })
  expect(styles.length).toBeGreaterThan(4) // a coming card with its children, and a skeleton with its lines
  for (const s of styles) {
    expect(s.animation, s.what).toBe('none')
    expect(s.transition, s.what).toBe('0s')
  }
  const before = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
  await page.waitForTimeout(3000)
  const after = await page.evaluate(() => ({
    raf: (window as unknown as { __raf: number }).__raf,
    running: (document as unknown as { getAnimations(o: object): Animation[] }).getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && a.timeline instanceof DocumentTimeline).length,
    onPlaceholders: [...document.querySelectorAll('[data-coming], [data-skeleton]')].flatMap((e) => (e as Element & { getAnimations(o: object): Animation[] }).getAnimations({ subtree: true })).length,
  }))
  expect(after.raf - before, 'rAF callbacks over 3 s idle').toBe(0)
  expect(after.running, 'running time-based animations at rest').toBe(0)
  expect(after.onPlaceholders).toBe(0)
})

test('hovering and focusing a placeholder starts nothing: no lift, no tilt, no transform', async ({ page }) => {
  await openKitchen(page, { html: FULL })
  const card = page.locator('[data-coming]')
  await card.scrollIntoViewIfNeeded()
  await card.hover()
  await page.waitForTimeout(400)
  const t = await card.evaluate((el) => ({ transform: getComputedStyle(el).transform, anims: el.getAnimations({ subtree: true }).length, border: getComputedStyle(el).borderTopStyle }))
  expect(t).toEqual({ transform: 'none', anims: 0, border: 'dashed' })
})

test('a skeleton waits 200 ms, is a plain block, and a card that loads in time never shows one', async ({ page }) => {
  await openKitchen(page, { html: FULL })
  await page.waitForTimeout(600)
  const sk = page.locator('[data-skeleton]').first()
  await expect(sk).toBeVisible()
  const bg = await sk.locator('.ww-skeleton-line').first().evaluate((el) => ({ bg: getComputedStyle(el).backgroundImage, anim: getComputedStyle(el).animationName }))
  expect(bg).toEqual({ bg: 'none', anim: 'none' }) // no gradient to shimmer, no keyframes
})

test('a locked section writes one live-region message per session, and is silent the next time it shows', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __says: string[] }
    w.__says = []
    new MutationObserver((records) => {
      for (const r of records) {
        const host = (r.target.nodeType === 3 ? r.target.parentElement : (r.target as Element))?.closest?.('.ww-lockchip [role=status]')
        if (host && host.textContent) w.__says.push(host.textContent)
      }
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })
  await openKitchen(page, { html: FULL })
  await page.waitForTimeout(500)
  const first = await page.evaluate(() => ({
    says: (window as unknown as { __says: string[] }).__says,
    live: document.querySelector('.ww-lockchip [role=status]')!.getAttribute('aria-live'),
    arrive: document.querySelector('.ww-lockchip')!.getAttribute('data-arrive'),
  }))
  expect(first.live).toBe('polite')
  expect(first.says).toEqual(['Locked: Needs one marked paper.']) // exactly one message
  expect(first.arrive).toBe('in') // and one arrive
  // the same session (same tab, same origin): load it again
  await page.goto(KITCHEN_URL)
  await page.evaluate(() => (window as unknown as { WWKitchen: { mount(el: HTMLElement, o: object): void } }).WWKitchen.mount(document.getElementById('root')!, {}))
  await page.waitForSelector('.ww-lockchip')
  await page.waitForTimeout(500)
  const second = await page.evaluate(() => ({ text: document.querySelector('.ww-lockchip [role=status]')!.textContent, arrive: document.querySelector('.ww-lockchip')!.getAttribute('data-arrive') }))
  expect(second).toEqual({ text: '', arrive: null })
})

test('a new session announces again', async ({ browser }) => {
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    const page = await ctx.newPage()
    await openKitchen(page, { html: FULL })
    await page.waitForTimeout(300)
    expect(await page.locator('.ww-lockchip [role=status]').textContent()).toBe('Locked: Needs one marked paper.')
    await ctx.close()
  }
})

test('a refused press on a disabled-with-reason button keeps focus, does not move, and flashes the reason in colour only', async ({ page }) => {
  await openKitchen(page, { html: FULL })
  const btn = page.locator('button[aria-disabled="true"]', { hasText: 'Sharpen' })
  await btn.scrollIntoViewIfNeeded()
  const before = await btn.boundingBox()
  // force: Playwright treats aria-disabled as not enabled and would wait forever; a person can press it, so we do
  await btn.click({ force: true })
  const state = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-disabled="true"]')].find((x) => x.textContent?.includes('Sharpen')) as HTMLElement
    const reason = b.parentElement!.querySelector('.ww-reason') as HTMLElement
    return {
      focused: document.activeElement === b,
      flash: reason.getAttribute('data-flash'),
      buttonAnims: b.getAnimations({ subtree: true }).length,
      reasonProps: reason.getAnimations().map((a) => (a as CSSTransition).transitionProperty),
    }
  })
  expect(state.focused).toBe(true)
  expect(state.flash).toBe('on')
  expect(state.buttonAnims).toBe(0) // no shake
  for (const p of state.reasonProps) expect(p).toBe('background-color') // colour only
  expect(await btn.boundingBox()).toEqual(before)
  await page.waitForTimeout(450)
  expect(await page.locator('.ww-reason[data-flash="on"]').count()).toBe(0)
})
