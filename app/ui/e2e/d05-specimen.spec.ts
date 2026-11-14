// Package D05 in a real Chromium: the specimen layout geometry, the strata, the sigil and the rack row.
// Built in memory like e2e/gallery.spec.ts (nothing written near dist). Screenshots go to D05_SHOTS (outside the repository).
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'
import { openRework } from './d03/rework-page'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.D05_SHOTS ? resolve(process.env.D05_SHOTS) : resolve(ROOT, 'test-results', 'd05')
const URL_ = 'http://d05.test/'
const FONTS = "html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}"

let bundle: Promise<{ js: string; css: string }> | null = null
function buildGallery() {
  bundle ??= (async () => {
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'e2e/bench/entry.tsx'), formats: ['iife'], name: 'D05Page', fileName: 'd05' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    return { js, css }
  })()
  return bundle
}

async function open(page: Page, theme: 'light' | 'dark', entry: string) {
  const { js, css } = await buildGallery()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D05</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?view=gallery&theme=${theme}`)
  await page.locator('[data-gallery]').waitFor()
  await page.locator(`.gl-item[data-entry-id="${entry}"]`).click()
  await page.waitForTimeout(500)
}
const shot = async (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: resolve(SHOTS, name) }); await page.locator('.gl-states').screenshot({ path: resolve(SHOTS, name.replace('.png', '-stage.png')) }) }
const scroll = (page: Page) => page.evaluate(() => { const d = document.documentElement; return { v: d.scrollHeight - innerHeight, h: d.scrollWidth - innerWidth } })
const ENTRIES = ['SpecimenLayout', 'StrataCore', 'SigilMark', 'RackRow']

test.describe('desktop 1366 x 768', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('SpecimenLayout geometry: no document scroll, one object wider than 40 percent, leaders drawn', async ({ page }) => {
    await open(page, 'light', 'data/SpecimenLayout')
    const s = await scroll(page)
    expect(s.v).toBeLessThanOrEqual(0)
    expect(s.h).toBeLessThanOrEqual(0)
    const g = await page.locator('[data-component="specimen-layout"][data-state="desktop"]').evaluate((root) => {
      const rb = root.getBoundingClientRect()
      const wide = Array.from(root.querySelectorAll('[data-object="specimen"], .sp-callout')).filter((el) => el.getBoundingClientRect().width > rb.width * 0.4).length
      return { w: (root as HTMLElement).offsetWidth, h: (root as HTMLElement).offsetHeight, wide, leaders: root.querySelectorAll('.sp-leader').length, callouts: root.querySelectorAll('.sp-callout').length }
    })
    expect(g.w).toBe(1302)
    expect(g.h).toBe(720)
    expect(g.wide).toBeLessThanOrEqual(1)
    expect(g.leaders).toBe(g.callouts)
  })

  test('strata rows are 44 px targets', async ({ page }) => {
    await open(page, 'light', 'data/StrataCore')
    const small = await page.evaluate(() => Array.from(document.querySelectorAll('.sp-strata-row')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44) }).map((e) => e.className))
    expect(small).toEqual([])
  })

  test('RackRow: rockers never change the lamp; Relay 6 is not confirmed', async ({ page }) => {
    await open(page, 'light', 'data/RackRow')
    const rows = page.locator('[data-component="rack-row"]')
    await expect(rows.nth(5)).toHaveAttribute('data-state', 'unconfirmed')
    const before = await rows.first().getAttribute('data-state')
    await rows.first().locator('[role="radio"]').first().click()
    expect(await rows.first().getAttribute('data-state')).toBe(before)
  })

  test('idle: zero animation frames, and screenshots in both themes', async ({ page }) => {
    await page.addInitScript(() => { const w = window as unknown as { __raf: number }; w.__raf = 0; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { w.__raf++; return o(cb) } })
    for (const theme of ['light', 'dark'] as const) {
      for (const e of ENTRIES) {
        await open(page, theme, `data/${e}`)
        await shot(page, `desktop-${theme}-${e}.png`)
      }
    }
    await page.waitForTimeout(600)
    const a = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    await page.waitForTimeout(1500)
    const b = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    expect(b - a).toBe(0)
  })

  test('forced colours: the rack draws', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await open(page, 'light', 'data/RackRow')
    await shot(page, 'desktop-forced-RackRow.png')
    expect(await page.locator('[data-component="rack-row"]').count()).toBeGreaterThanOrEqual(6)
  })
})

test.describe('phone 390 x 844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('reflow: no document scroll, specimen first, carousel dots', async ({ page }) => {
    await open(page, 'light', 'data/SpecimenLayout')
    const s = await scroll(page)
    expect(s.h).toBeLessThanOrEqual(0)
    expect(s.v).toBeLessThanOrEqual(0)
    const g = await page.locator('[data-component="specimen-layout"][data-state="reflow"]').first().evaluate((root) => ({ firstIsRule: root.firstElementChild?.classList.contains('sp-rule'), dots: root.querySelectorAll('.sp-dot').length }))
    expect(g.firstIsRule).toBe(true)
    expect(g.dots).toBeGreaterThan(1)
  })

  test('screenshots in both themes, no horizontal scroll', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      for (const e of ENTRIES) {
        await open(page, theme, `data/${e}`)
        await shot(page, `phone-${theme}-${e}.png`)
        const s = await scroll(page)
        expect(s.h, `${e} horizontal scroll`).toBeLessThanOrEqual(0)
      }
    }
  })
})

// RD2: the whole specimen assembled, bare (the wave 6 pictures were gallery crops at 1.5x zoom).
test.describe('RD2: the assembled specimen', () => {
  test('at 1366 x 768 the 1302 x 720 canvas holds specimen, callouts, leaders and footer with nothing clipped', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openRework(page, 'id=data%2FSpecimenLayout&stage=1&theme=light')
    const r = await page.evaluate(() => {
      const stage = document.querySelector('[data-stage]')!.getBoundingClientRect()
      const out: string[] = []
      const inside = (name: string, el: Element) => {
        const b = el.getBoundingClientRect()
        if (b.left < stage.left - 0.5 || b.top < stage.top - 0.5 || b.right > stage.right + 0.5 || b.bottom > stage.bottom + 0.5) out.push(`${name} leaves the canvas: ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.right)},${Math.round(b.bottom)}`)
      }
      const sp = document.querySelector('[data-object="specimen"]')!
      inside('specimen', sp)
      document.querySelectorAll('.sp-callout').forEach((c, i) => inside(`callout ${i + 1}`, c))
      inside('footer', document.querySelector('.sp-footer')!)
      // every drawn child of the specimen and of the footer stays inside its parent box (overflow is hidden: a child past the edge is a clipped one)
      const within = (name: string, box: Element, sel: string) => {
        const pb = box.getBoundingClientRect()
        box.querySelectorAll(sel).forEach((el) => {
          const b = el.getBoundingClientRect()
          if (b.width && (b.bottom > pb.bottom + 0.5 || b.right > pb.right + 0.5 || b.top < pb.top - 0.5 || b.left < pb.left - 0.5)) out.push(`${name}: ${el.className || el.tagName} past the box`)
        })
      }
      within('specimen', sp, '.sp-strata-row, .sp-strata-cap, .sp-strata-svg')
      within('footer', document.querySelector('.sp-footer')!, '.k-rail-row, .k-key, button')
      // the datum must not run through a callout's text: the plate is painted above the svg
      const plate = document.querySelectorAll('.sp-callout')[2]
      const pb = plate.getBoundingClientRect()
      const top = document.elementFromPoint(pb.left + pb.width / 2, pb.top + pb.height / 2)
      if (!plate.contains(top)) out.push('the datum line is painted over the third callout')
      return out
    })
    expect(r).toEqual([])
  })

  test('at 390 px it is one column and the callouts follow as a swipe list with a dot each', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openRework(page, 'id=data%2FSpecimenLayout&w=358&theme=light')
    const f = page.locator('[data-form="reflow 390"]')
    await expect(f.locator('[data-component="specimen-layout"]')).toHaveAttribute('data-state', 'reflow')
    expect(await f.locator('.sp-card').count()).toBe(4)
    expect(await f.locator('.sp-dot').count()).toBe(4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
    const b = await f.locator('.sp-specimen').boundingBox()
    expect(b!.width).toBeLessThanOrEqual(358.5)
  })

  test('state names are short: none of the entries has a label over 20 characters', async ({ page }) => {
    await openRework(page, 'theme=light')
    const longest = await page.evaluate(() => [...document.querySelectorAll('[data-entry]')].map((e) => (e as HTMLElement).dataset.form ?? '').filter((l) => l.length > 20))
    expect(longest).toEqual([])
  })

  test('the rocker of a rack row shows a 2 px focus ring, and the confirmed lamp still waits for the board', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openRework(page, 'id=data%2FRackRow&theme=light')
    const half = page.locator('[data-form="six units"] .k-rocker-half[aria-checked="true"]').first()
    await page.keyboard.press('Tab')
    await half.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(half).toBeFocused()
    const o = await half.evaluate((el) => { const s = getComputedStyle(el); return { w: s.outlineWidth, st: s.outlineStyle } })
    expect(o).toEqual({ w: '2px', st: 'solid' })
    // Relay 6 is marked confirmed but never reported: it must draw as sent, not acknowledged
    await expect(page.locator('[data-form="six units"] [data-component="rack-row"]').nth(5)).toHaveAttribute('data-state', 'unconfirmed')
  })
})
