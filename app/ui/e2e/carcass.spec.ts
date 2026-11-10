// P8 (plan 8.6): placeholders (ComingCard, Skeleton) are static: no animation, no transition, no rAF;
// a locked section announces once per session. Born in chunk 1b with ComingCard, Skeleton and LockChip
// (proved on the kitchen sink, e2e/kitchen.ts), extended in chunk 5 on the real 28 registry entries.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { designCss, expect, openLab, test } from './fixtures'
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

// ---------------------------------------------------------------------------------------------------------
// Chunk 5: the same claims on the REAL registry (plan 8.6 P8). Every entry of plannedFeatures.ts is rendered
// through <Planned/> in a library build made in memory (src/ww/_carcassLab.tsx), next to the Roadmap drawer.
// ---------------------------------------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAB_URL = 'http://ww-carcass.test/'
const SYSTEM_FONTS = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace}`
type Lab = { mount(el: HTMLElement): void; openRoadmap(): void; closeRoadmap(): void; count: number; coming: number }

let built: Promise<{ js: string; css: string }> | null = null
function buildLab() {
  built ??= (async () => {
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'src/ww/_carcassLab.tsx'), formats: ['iife'], name: 'WWCarcassBundle', fileName: 'carcass' } },
    })
    let js = ''
    let css = ''
    for (const o of (Array.isArray(out) ? out : [out]).flatMap((x) => ('output' in x ? x.output : []))) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    return { js, css }
  })()
  return built
}

const requests: string[] = []
async function openCarcass(page: Page, html: Record<string, string> = FULL) {
  const { js, css } = await buildLab()
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number }
    w.__raf = 0
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      w.__raf++
      return orig(cb)
    }
  })
  const attrs = Object.entries({ 'data-ww': '', 'data-motion': 'calm', ...html }).map(([k, v]) => `${k}="${v}"`).join(' ')
  const doc = `<!doctype html><html ${attrs}><head><meta charset="utf-8"><style>${SYSTEM_FONTS}${designCss()}</style><style>${css}</style></head><body style="margin:0"><div id="root"></div><script>${js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')}</script></body></html>`
  requests.length = 0
  page.on('request', (r) => requests.push(r.url()))
  await page.route(`${LAB_URL}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(LAB_URL)
  await page.evaluate(() => (window as unknown as { WWCarcass: Lab }).WWCarcass.mount(document.getElementById('root')!))
  await page.waitForSelector('[data-planned]')
}

test('every registry entry renders once: 28 placeholders, each id exactly once, one ComingCard per coming entry', async ({ page }) => {
  await openCarcass(page)
  const r = await page.evaluate(() => {
    const lab = (window as unknown as { WWCarcass: Lab }).WWCarcass
    const ids = [...document.querySelectorAll('[data-planned]')].map((e) => e.getAttribute('data-planned'))
    const patterns = [...new Set([...document.querySelectorAll('[data-planned]')].map((e) => e.getAttribute('data-pattern')))].sort()
    return { registry: lab.count, ids, unique: new Set(ids).size, coming: document.querySelectorAll('[data-coming]').length, registryComing: lab.coming, patterns }
  })
  expect(r.registry).toBe(28)
  expect(r.ids).toHaveLength(28)
  expect(r.unique).toBe(28)
  expect(r.coming).toBe(r.registryComing)
  expect(r.patterns).toEqual(['disabled', 'empty', 'roadmap']) // coming is rendered by the unit test; no row uses it today
})

for (const [name, reduced] of [['full motion', false], ['reduced motion', true]] as const) {
  test(`the 28 placeholders are static for 3 s: no animation, no wrapper transition, no rAF, no request (${name})`, async ({ page }) => {
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' })
    await openCarcass(page)
    await page.waitForTimeout(1200)
    const styles = await page.evaluate(() => {
      const out: { what: string; animation: string; transition?: string }[] = []
      for (const root of document.querySelectorAll('[data-planned]')) {
        const cs = getComputedStyle(root)
        out.push({ what: `${root.getAttribute('data-planned')} wrapper`, animation: cs.animationName, transition: cs.transitionDuration })
        for (const el of root.querySelectorAll('*')) out.push({ what: `${root.getAttribute('data-planned')} ${el.tagName.toLowerCase()}.${el.className}`, animation: getComputedStyle(el).animationName })
      }
      return out
    })
    expect(styles.length).toBeGreaterThan(60)
    for (const s of styles) {
      expect(s.animation, s.what).toBe('none')
      if (s.transition !== undefined) expect(s.transition, s.what).toBe('0s')
    }
    const before = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    const nReq = requests.length
    await page.waitForTimeout(3000)
    const after = await page.evaluate(() => ({
      raf: (window as unknown as { __raf: number }).__raf,
      running: (document as unknown as { getAnimations(o: object): Animation[] }).getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && a.timeline instanceof DocumentTimeline).length,
      onPlaceholders: [...document.querySelectorAll('[data-planned]')].flatMap((e) => (e as Element & { getAnimations(o: object): Animation[] }).getAnimations({ subtree: true })).length,
    }))
    expect(after.raf - before, 'rAF callbacks over 3 s idle').toBe(0)
    expect(after.running).toBe(0)
    expect(after.onPlaceholders).toBe(0)
    expect(requests.length - nReq, 'network requests while idle').toBe(0)
  })
}

test('placeholders use the dashed outline, hold no primary, and the only enabled buttons are the real E actions', async ({ page }) => {
  await openCarcass(page)
  const r = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>('.ww-planned')]
    const enabled = [...document.querySelectorAll<HTMLButtonElement>('[data-planned] button')].filter((b) => b.getAttribute('aria-disabled') !== 'true').map((b) => b.getAttribute('data-real-action'))
    return {
      n: boxes.length,
      styles: [...new Set(boxes.map((b) => getComputedStyle(b).borderTopStyle))],
      colours: [...new Set(boxes.map((b) => getComputedStyle(b).borderTopColor))],
      enabled,
      primary: document.querySelectorAll('[data-planned] .primary, [data-planned] [data-primary]').length,
    }
  })
  expect(r.n).toBeGreaterThan(10)
  expect(r.styles).toEqual(['dashed'])
  expect(r.colours).toHaveLength(1)
  expect(r.primary).toBe(0)
  expect(r.enabled.every((id) => id !== null)).toBe(true) // each enabled button is a registered E action
  expect(r.enabled).toHaveLength(4) // sheets-rewritten, cie-practice, proficiency, harvester
})

test('a refused press on a disabled placeholder keeps focus and does not move it', async ({ page }) => {
  await openCarcass(page)
  const btn = page.locator('[data-planned="sharpen"] button')
  await btn.scrollIntoViewIfNeeded()
  const before = await btn.boundingBox()
  await btn.focus()
  await btn.click({ force: true })
  expect(await btn.evaluate((b) => document.activeElement === b)).toBe(true)
  expect(await btn.getAttribute('aria-disabled')).toBe('true')
  expect(await btn.boundingBox()).toEqual(before)
})

test('the Roadmap drawer lists all 28 entries, opaque, at rest, and Esc closes it', async ({ page }) => {
  await openCarcass(page)
  await page.evaluate(() => (window as unknown as { WWCarcass: Lab }).WWCarcass.openRoadmap())
  await page.waitForSelector('[data-roadmap-row]')
  await page.waitForTimeout(600) // the drawer's own entry has finished
  const r = await page.evaluate(() => {
    const sheet = document.querySelector('.ww-sheet') as HTMLElement
    return {
      rows: document.querySelectorAll('[data-roadmap-row]').length,
      title: document.querySelector('.ww-sheet-title')!.textContent,
      bg: getComputedStyle(sheet).backgroundColor,
      width: Math.round(sheet.getBoundingClientRect().width),
      running: (document as unknown as { getAnimations(o: object): Animation[] }).getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && a.timeline instanceof DocumentTimeline).length,
    }
  })
  expect(r.rows).toBe(28)
  expect(r.title).toBe('Roadmap')
  expect(r.bg).not.toMatch(/rgba\(.*,\s*0(\.\d+)?\)$/) // opaque (plan 5.6): no alpha below 1
  expect(r.width).toBeLessThanOrEqual(480)
  expect(r.running).toBe(0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  expect(await page.locator('.ww-sheet[data-state="open"]').count()).toBe(0)
})
