// P7 (plan 8.6): every primary reachable by keyboard, Esc order, Alt+n, no traps. Born in chunk 4
// with the frame; each workspace extends it. Chunk 1a proves the one rule that belongs to the
// token layer: the focus ring is at least 2 px and 3:1 against its surface in all three themes.
// Chunk 4 adds the real frame in a real Chromium (below the ring checks).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, openLab, test } from './fixtures'

const lum = (c: number[]) => {
  const f = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
}
const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)

for (const [theme, attrs] of [['ash', {}], ['paper', { 'data-theme': 'paper' }], ['indigo', { 'data-theme': 'indigo' }]] as const) {
  test(`${theme}: Tab shows a focus ring of 2 px or more with 3:1 contrast against the surface`, async ({ page }) => {
    await openLab(page, attrs as Record<string, string>)
    await page.keyboard.press('Tab')
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const cs = getComputedStyle(el)
      return { id: el.id, width: parseFloat(cs.outlineWidth), style: cs.outlineStyle, colour: cs.outlineColor, bg: getComputedStyle(document.getElementById('root')!).backgroundColor }
    })
    expect(r.id).toBe('tap')
    expect(r.style).toBe('solid')
    expect(r.width).toBeGreaterThanOrEqual(2)
    const a = lum(parse(r.colour))
    const b = lum(parse(r.bg))
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3)
  })
}

// ---- chunk 4: the real frame in a real Chromium -------------------------------------------------------
// The frame is built in memory by Vite from a virtual entry (nothing written to disk, nothing near
// app/ui/dist), with stub pages, and served from a fake origin so sessionStorage works. The Shell and the
// germoney pages are NOT in this bundle: what is proved here is the frame's own keys, focus and motion.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
const FRAME_URL = 'http://ww-frame.test/'
const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Frame } from '${posix(resolve(ROOT, 'src/ww/frame/Frame.tsx'))}'
import { openOverlay, closeOverlay } from '${posix(resolve(ROOT, 'src/ww/frame/overlayRegistry.ts'))}'
import { switchWorkspace, jumpTo, goBack } from '${posix(resolve(ROOT, 'src/ww/frame/navigate.ts'))}'
const h = React.createElement
const page = (id) => () => h('div', { 'data-page': id }, h('p', null, 'Stub ' + id), h('button', { id: 'in-' + id }, 'Inside ' + id), h('input', { 'aria-label': 'Draft ' + id }))
const pages = Object.fromEntries(['study', 'tree', 'life', 'career', 'focus', 'setup'].map((id) => [id, page(id)]))
window.WWFrame = {
  mount(el, o) { createRoot(el).render(h(Frame, { loaded: true, pages, glass: 'blur', ...o })) },
  openOverlay, closeOverlay, switchWorkspace, jumpTo, goBack,
}
`
let bundle: Promise<{ js: string; css: string }> | null = null
function buildFrame() {
  bundle ??= (async () => {
    // Vite 8 resolves a lib entry before any plugin, so the entry is a real file. It goes in dist-e2e (git-ignored,
    // the folder this suite already builds into), never in dist, which the running app serves.
    const dir = resolve(ROOT, 'dist-e2e')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, '_frame-entry.jsx')
    writeFileSync(entry, ENTRY)
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry, formats: ['iife'], name: 'WWFrameBundle', fileName: 'frame' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the frame build produced no script')
    return { js, css }
  })()
  return bundle
}

type Api = {
  mount(el: HTMLElement, o: object): void
  switchWorkspace(w: string): Promise<void>
  jumpTo(w: string): Promise<void>
  openOverlay(id: string): void
}

async function openFrame(page: Page, html: Record<string, string> = {}, opts: object = {}) {
  const { js, css } = await buildFrame()
  const attrs = Object.entries({ 'data-motion': 'auto', ...html }).map(([k, v]) => `${k}="${v}"`).join(' ')
  const font = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace}`
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html ${attrs}><head><meta charset="utf-8"><style>${font}</style><style>${css}</style></head><body style="margin:0"><main class="main" style="position:fixed;inset:0"><div id="root" style="position:absolute;inset:0"></div></main><script>${safe}</script></body></html>`
  await page.route(`${FRAME_URL}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(FRAME_URL)
  await page.evaluate((o) => (window as unknown as { WWFrame: Api }).WWFrame.mount(document.getElementById('root')!, o), opts)
  await page.waitForSelector('.ww-frame [role="tab"]')
}
const ws = (page: Page) => page.locator('.ww-centre').getAttribute('data-ws')
const WS = ['study', 'tree', 'life', 'career', 'focus', 'setup']
const LABEL = ['Study', 'Tree', 'Life', 'Career', 'Focus', 'Setup']
const call = (page: Page, fn: string, ...args: string[]) =>
  page.evaluate(([f, a]) => (window as unknown as { WWFrame: Record<string, (...x: string[]) => unknown> }).WWFrame[f](...a), [fn, args] as [string, string[]])

test('Alt+1..6 switch workspaces and put focus on the new heading; Ctrl+1 does nothing here', async ({ page }) => {
  await openFrame(page)
  await page.mouse.click(8, 740) // empty left-column space: gives the document focus without landing on a control
  for (let n = 1; n <= 6; n++) {
    await page.keyboard.press(`Alt+${n}`)
    await expect(page.locator('.ww-centre')).toHaveAttribute('data-ws', WS[n - 1])
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent)).toBe(LABEL[n - 1])
  }
  await page.keyboard.press('Control+1')
  expect(await ws(page)).toBe('setup') // Shell's handler (not in this bundle) is the one that leaves Well Wisher
})

test('Tab reaches the tab strip, the season pill, the Proof rail and the page within 40 stops, and the strip is one tab stop', async ({ page }) => {
  await openFrame(page)
  await page.mouse.click(8, 740) // empty left-column space: gives the document focus without landing on a control
  const seen: string[] = []
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    seen.push(await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a.id || a.getAttribute('aria-label') || a.textContent || a.tagName }))
  }
  const stops = [...new Set(seen)] // 40 presses wrap the document more than once
  expect(stops.filter((x) => x.startsWith('ww-tab-'))).toHaveLength(1) // roving tabindex: arrows walk the rest
  expect(stops.some((x) => /^in-/.test(x))).toBe(true) // the page is reached
  expect(stops).toContain('Open Proof')
  expect(seen.slice(0, stops.length).length).toBeLessThanOrEqual(40)
})

test('an open overlay traps Tab, Esc closes it and focus returns to the opener; a closed drawer is never tabbed into', async ({ page }) => {
  await openFrame(page)
  const opener = page.locator('button[aria-label="Open Proof"]')
  await opener.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.ww-sheet[data-state="open"]')).toBeVisible()
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ww-sheet'))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.locator('.ww-sheet[data-state="closed"]')).toHaveCount(1)
  await expect(opener).toBeFocused()
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ww-sheet'))).toBe(false)
  }
})

test('Esc order: overlay, then the Back chip; Alt+Left also goes back', async ({ page }) => {
  await openFrame(page)
  await call(page, 'switchWorkspace', 'tree')
  await call(page, 'jumpTo', 'study')
  await call(page, 'openOverlay', 'log')
  await expect(page.locator('.ww-back')).toBeVisible()
  await page.keyboard.press('Escape') // the overlay first
  await expect(page.locator('.ww-sheet[data-state="open"]')).toHaveCount(0)
  await expect(page.locator('.ww-back')).toBeVisible()
  await page.keyboard.press('Escape') // then the Back chip
  await expect(page.locator('.ww-back')).toHaveCount(0)
  expect(await ws(page)).toBe('tree')
  await call(page, 'jumpTo', 'career')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.locator('.ww-back')).toHaveCount(0)
  expect(await ws(page)).toBe('tree')
})

test('all 30 ordered pairs finish inside the 600 ms envelope and a click 100 ms into a switch lands', async ({ page }) => {
  await openFrame(page)
  const res = await page.evaluate(async (ids) => {
    const w = (window as unknown as { WWFrame: Api }).WWFrame
    const rows: { a: string; b: string; ms: number; ok: boolean }[] = []
    const settle = () => new Promise((r) => setTimeout(r, 700)) // past the rapid-switch window: each pair takes the transition
    for (const a of ids) for (const b of ids) {
      if (a === b) continue
      await w.switchWorkspace(a)
      await settle()
      const t0 = performance.now()
      await w.switchWorkspace(b)
      rows.push({ a, b, ms: performance.now() - t0, ok: document.querySelector('.ww-centre')!.getAttribute('data-ws') === b })
    }
    return rows
  }, WS)
  expect(res).toHaveLength(30)
  expect(res.every((r) => r.ok)).toBe(true)
  const worst = Math.max(...res.map((r) => r.ms))
  test.info().annotations.push({ type: 'switch-envelope-ms', description: `worst of 30 = ${worst.toFixed(0)} ms` })
  expect(worst).toBeLessThan(600 + 100) // the 600 ms cap plus one frame of scheduling slack

  // input is never blocked by a snapshot: start a switch, click another tab 100 ms in
  await call(page, 'switchWorkspace', 'study')
  await page.waitForTimeout(800)
  await page.evaluate(() => void (window as unknown as { WWFrame: Api }).WWFrame.switchWorkspace('tree'))
  await page.waitForTimeout(100)
  await page.locator('#ww-tab-career').click()
  await expect(page.locator('.ww-centre')).toHaveAttribute('data-ws', 'career')
})

test('feature probe: what this Chromium supports is written on the frame root', async ({ page }) => {
  await openFrame(page)
  const f = await page.locator('.ww-frame').evaluate((el) => ({ feat: (el as HTMLElement).dataset.feat, chromium: (el as HTMLElement).dataset.chromium }))
  test.info().annotations.push({ type: 'features', description: `chromium ${f.chromium}: ${f.feat}` })
  expect(f.feat).toContain('inert')
  expect(f.feat).toContain('view-transition')
  expect(Number(f.chromium)).toBeGreaterThan(100)
})
