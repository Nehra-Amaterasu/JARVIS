// A.J05 in a real Chromium: the rebuilt Console section of shell v2 (Health, Events, Connections, Hardware, Crew).
//
// Part 1, the built app (dist-e2e) against the sandbox, flag on through the `#t=ww-e2e&shell=v2` fragment as
// e2e/core-v2.spec.ts does. The keyboard path of the command line (`/` focuses it, Tab completes a verb, a heavy verb asks
// once and Esc cancels without running it, an unknown verb is refused, `help` lists the closed verbs), the geometry of every
// view at 1366 x 768 (no document scroll, no part below the fold, the content box inside the canvas) and at 390 px (one
// column, no sideways scroll), 44 px targets, and that nothing destructive is ever sent. Needs `vite build --outDir
// dist-e2e` first; skips otherwise.
//
// Part 2, the jury page: the same views on stamped fixtures (every value invented, SIMULATED), built in memory by Vite from
// a small entry, at both sizes, with text contrast and size MEASURED from computed colours. Screenshots go to JURY_SHOTS
// (default test-results/jury-j05, which Playwright empties on each run, so the jury run passes a folder outside the repo).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from './fixtures'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.JURY_SHOTS ? resolve(process.env.JURY_SHOTS) : resolve(ROOT, 'test-results', 'jury-j05')
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }
const shot = (name: string) => { mkdirSync(SHOTS, { recursive: true }); return resolve(SHOTS, `${name}.png`) }

/* ================================================================ contrast, measured in the page */
type TextCheck = { text: string; cls: string; ratio: number; size: number }

/**
 * Every visible text in `roots`: its computed colour (or SVG fill) composited by the opacity of its ancestors, over the
 * first opaque background under it (a gradient counts as each of its stops, the worst one wins), the WCAG 2 ratio,
 * and its computed font size. Runs in the page; returns the rows so the test can name each failure.
 */
async function measureText(page: Page, roots: string): Promise<TextCheck[]> {
  return page.evaluate((sel) => {
    type C = { r: number; g: number; b: number; a: number }
    const parse = (v: string): C | null => {
      let m = /rgba?\(([^)]+)\)/.exec(v)
      if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
      }
      m = /color\(srgb ([^)]+)\)/.exec(v)
      if (m) {
        const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number)
        return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }
      }
      return null
    }
    const colours = (v: string): C[] => (v.match(/(rgba?\([^)]+\)|color\(srgb [^)]+\))/g) ?? []).map(parse).filter((c): c is C => !!c)
    const over = (f: C, b: C): C => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 })
    const lum = (c: C) => {
      const ch = (x: number) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
    }
    const ratio = (a: C, b: C) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    /** The backgrounds under `el`: the stack of translucent fills down to the first opaque one, or each gradient stop. */
    // What is painted UNDER a text is not always its ancestor (the stage's words sit on an overlay above the voice
    // picture's well), so the ground is read from the hit-test stack at the text's centre, with every element made
    // hit-testable for the measurement: the text's own element first, then whatever lies beneath it.
    const grounds = (el: Element): C[] => {
      const layers: C[] = []
      let stops: C[] | null = null
      const r = el.getBoundingClientRect()
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).filter((n) => n === el || !el.contains(n))
      const from = stack.indexOf(el)
      // off screen (the phone's column scrolls) the stack is empty: the ancestors are the ground there
      const chain: Element[] = []
      for (let n: Element | null = el; n; n = n.parentElement) chain.push(n)
      // the page's own ground last: a body of height 0 (its boxes are fixed) is not in the hit-test stack
      for (const n of [...(from >= 0 ? stack.slice(from) : chain), document.body, document.documentElement]) {
        const cs = getComputedStyle(n)
        const img = cs.backgroundImage
        if (!stops && img && img !== 'none' && img.includes('gradient')) stops = colours(img)
        const bg = parse(cs.backgroundColor)
        if (bg && bg.a > 0) {
          layers.push(bg)
          if (bg.a >= 1) break
        }
      }
      let base: C = { r: 255, g: 255, b: 255, a: 1 }
      for (let i = layers.length - 1; i >= 0; i--) base = layers[i].a >= 1 ? layers[i] : over(layers[i], base)
      return stops && stops.length ? stops.map((s) => (s.a >= 1 ? s : over(s, base))) : [base]
    }
    const opacity = (el: Element) => {
      let o = 1
      for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity || 1)
      return o
    }
    const out: { text: string; cls: string; ratio: number; size: number }[] = []
    const probe = document.createElement('style')
    probe.textContent = '*, *::before, *::after { pointer-events: auto !important; }'
    document.head.appendChild(probe)
    for (const root of document.querySelectorAll(sel)) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim()
        if (!own) continue
        const r = el.getBoundingClientRect()
        if (r.width <= 1 || r.height <= 1) continue
        const cs = getComputedStyle(el)
        if (cs.visibility !== 'visible' || el.closest('[hidden], .jx-sr, .k-vh, .g-sr, .sp-rack-title')) continue
        let shown = true
        for (let n: Element | null = el; n; n = n.parentElement) if (getComputedStyle(n).display === 'none') shown = false
        if (!shown) continue
        const svg = el instanceof SVGElement
        const fg0 = parse(svg ? cs.fill : cs.color)
        if (!fg0) continue
        const fg = { ...fg0, a: fg0.a * opacity(el) }
        if (fg.a <= 0.01) continue
        const worst = Math.min(...grounds(el).map((g) => ratio(over(fg, g), g)))
        // an SVG text's size is in its viewBox units: measure what is drawn
        const size = svg ? r.height : parseFloat(cs.fontSize)
        out.push({ text: own.slice(0, 40), cls: `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]}`, ratio: Math.round(worst * 100) / 100, size: Math.round(size * 10) / 10 })
      }
    }
    probe.remove()
    return out
  }, roots)
}

function expectReadable(rows: TextCheck[], where: string) {
  expect(rows.length, `${where}: some text was measured`).toBeGreaterThan(10)
  const low = rows.filter((r) => r.ratio < 4.5)
  const small = rows.filter((r) => r.size < 11)
  expect(low, `${where}: text under 4.5:1`).toEqual([])
  expect(small, `${where}: text under 11 px`).toEqual([])
}

/* ================================================================ part 1: the app */
const VIEWS = ['health', 'events', 'connections', 'hardware', 'crew'] as const

async function openView(page: Page, baseURL: string | undefined, view: (typeof VIEWS)[number]) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `vite build --outDir dist-e2e` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  const shell = page.locator('[data-shell="v2"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  if ((await shell.getAttribute('data-product')) !== 'jarvis') await page.keyboard.press('Alt+0')
  await page.keyboard.press('Control+5')
  await page.locator(`#s2-view-${view}`).click()
  await expect(page.locator(`.s2-page[data-view="${view}"] .jx[data-view="${view}"]`)).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const jx = document.querySelector<HTMLElement>('.jx')!
    const box = jx.getBoundingClientRect()
    const parts = [...document.querySelectorAll<HTMLElement>('.jx > section, .jx > section > *, .jx .jx-card')].map((el) => {
      const r = el.getBoundingClientRect()
      return { cls: el.className.toString().slice(0, 40), top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    })
    return {
      doc: { sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth },
      jx: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, sh: jx.scrollHeight, ch: jx.clientHeight, sw: jx.scrollWidth, cw: jx.clientWidth, w: box.width, h: box.height },
      parts,
      small: [...document.querySelectorAll<HTMLElement>('.jx button, .jx input, .jx a[href], .jx [role="tab"], .jx [role="radio"]')]
        .filter((el) => el.offsetParent !== null && !el.closest('.jx-classic'))
        .map((el) => ({ el: `${el.tagName}.${el.className.toString().slice(0, 30)}`, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }))
        .filter((r) => r.h < 43.5 || r.w < 43.5),
    }
  })
}

test.describe('Console, the app (flag on)', () => {
  for (const view of VIEWS) {
    test(`${view}: 1366 x 768 has no document scroll and no part below the fold`, async ({ page, baseURL }) => {
      await page.setViewportSize(DESKTOP)
      await openView(page, baseURL, view)
      const m = await geometry(page)
      expect(m.doc.sh).toBeLessThanOrEqual(m.doc.ih)
      expect(m.doc.sw).toBeLessThanOrEqual(m.doc.iw)
      expect(m.jx.sh).toBeLessThanOrEqual(m.jx.ch + 1)
      expect(m.jx.sw).toBeLessThanOrEqual(m.jx.cw + 1)
      expect(Math.round(m.jx.w)).toBe(1302)
      for (const p of m.parts) {
        expect(p.bottom, `${p.cls} bottom`).toBeLessThanOrEqual(m.jx.bottom - 7)
        expect(p.right, `${p.cls} right`).toBeLessThanOrEqual(m.jx.right - 7)
      }
      await page.screenshot({ path: shot(`app-1366-${view}`) })
    })

    test(`${view}: 390 px is one column with no sideways scroll`, async ({ page, baseURL }) => {
      await page.setViewportSize(PHONE)
      await openView(page, baseURL, view)
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, iw: innerWidth,
        jxw: document.querySelector('.jx')!.scrollWidth, jxc: document.querySelector('.jx')!.clientWidth,
        cols: getComputedStyle(document.querySelector('.jx')!).gridTemplateColumns.split(' ').length,
      }))
      expect(m.sw).toBeLessThanOrEqual(m.iw)
      expect(m.jxw).toBeLessThanOrEqual(m.jxc)
      expect(m.cols).toBe(1)
      await page.screenshot({ path: shot(`app-390-${view}`) })
    })
  }

  test('health: every control of the view is at least 44 x 44 px', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openView(page, baseURL, 'health')
    expect((await geometry(page)).small).toEqual([])
  })

  test('health: / focuses the command line, Tab completes, a heavy verb asks once and Esc cancels', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openView(page, baseURL, 'health')
    const sent: string[] = []
    page.on('request', (r) => { if (r.method() === 'POST') sent.push(new URL(r.url()).pathname) })
    await page.locator('.s2-page').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press('/')
    const input = page.locator('.jx .cl-input')
    await expect(input).toBeFocused()
    // an unknown verb is refused, with the words the spec gives
    await input.fill('rm -rf')
    await expect(page.locator('.jx .cl-say')).toContainText('unknown verb; try help')
    await input.fill('')
    // Tab completes a unique prefix
    await input.pressSequentially('rest')
    await page.keyboard.press('Tab')
    await expect(input).toHaveValue('restart brain')
    await expect(input).toBeFocused()
    // Enter asks once; nothing is sent; Esc cancels and says so
    await page.keyboard.press('Enter')
    const ask = page.locator('.jx .jx-ask')
    await expect(ask).toBeVisible()
    await expect(page.locator('.jx .jx-out[data-kind="ask"]')).toContainText('restart brain')
    await expect(ask.getByRole('button', { name: 'Run restart brain' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    await expect(page.locator('.jx .jx-outs')).toContainText('cancelled, nothing changed')
    expect(sent.filter((p) => /brain\/restart|modules\/unload_all|crew\/steward/.test(p))).toEqual([])
    // a read-only verb answers at once
    await input.focus()
    await input.fill('help')
    await page.keyboard.press('Enter')
    await expect(page.locator('.jx .jx-outs')).toContainText('there is no shell')
    await input.fill('status')
    await page.keyboard.press('Enter')
    await expect(page.locator('.jx .jx-outs .jx-out[data-state]').first()).toBeVisible()
    // the answers take the room of the log; Esc on an empty line clears them and the tabs come back
    await expect(page.locator('.jx .jx-tabs')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.locator('.jx .jx-outs')).toHaveCount(1)
    await expect(page.locator('.jx .jx-tabs')).toBeVisible()
    await page.screenshot({ path: shot('app-1366-health-command') })
  })

  test('events: the filter grammar narrows the list and a bad since: is named', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openView(page, baseURL, 'events')
    const f = page.locator('#jx-filter')
    await f.fill('since:soon')
    await expect(page.locator('.jx-filter-say')).toContainText('try since:30m')
    await f.fill('core !sim since:1h')
    await expect(page.locator('.jx-filter-say')).not.toContainText('try since:30m')
    await f.press('Escape')
    await expect(f).toHaveValue('')
  })

  test('hardware: the firmware folder never shows a closed gate and a flash key together', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openView(page, baseURL, 'hardware')
    await page.getByRole('tab', { name: 'Firmware' }).click()
    await expect(page.locator('.jx-fw')).toBeVisible()
    const closed = await page.locator('[data-flash="closed"]').count()
    const keys = await page.locator('.jx-fw button:has-text("Flash")').count()
    if (closed) expect(keys).toBe(0)
  })
})

/* ================================================================ part 2: the jury page on fixtures */
const URL_ = 'http://console-j05.test/'
const FONTS = `html{--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
let bundle: Promise<{ js: string; css: string }> | null = null

function buildJury() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'test-results', 'console-j05-entry')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, 'entry.tsx')
    const src = posix(resolve(ROOT, 'src'))
    writeFileSync(entry, [
      `import '${src}/styles/design/clay/index.css'`,
      `import { createElement } from 'react'`,
      `import { createRoot } from 'react-dom/client'`,
      `import { ConsoleFixture } from '${src}/jarvis/console/fixtures'`,
      `const q = new URLSearchParams(location.search)`,
      `document.documentElement.setAttribute('data-theme', 'clay-' + (q.get('theme') === 'light' ? 'light' : 'dark'))`,
      `document.documentElement.setAttribute('data-product', 'jarvis')`,
      `createRoot(document.getElementById('root')!).render(createElement(ConsoleFixture, { kind: (q.get('kind') ?? 'health-running') as any }))`,
      '',
    ].join('\n'))
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, assetsInlineLimit: 100_000_000, lib: { entry, formats: ['iife'], name: 'ConsoleJury', fileName: 'console' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    return { js, css }
  })()
  return bundle
}

async function openJury(page: Page, kind: string, theme: 'light' | 'dark', size: { width: number; height: number }) {
  await page.setViewportSize(size)
  const { js, css } = await buildJury()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const desk = size.width >= 900
  const box = desk ? 'position:fixed;left:64px;top:100px;width:1302px;height:668px' : 'position:fixed;left:0;top:0;right:0;bottom:0'
  const chrome = desk
    ? `<div aria-hidden="true" data-standin="shell" style="position:fixed;inset:0 0 auto 0;height:48px;display:flex;align-items:center;gap:24px;padding:0 16px;border-bottom:1px solid var(--edge-hair);font:600 14px/1 var(--font-mono);letter-spacing:.12em;color:var(--ink-1)">JARVIS<span style="font:400 13px/1 var(--font-ui);letter-spacing:0;color:var(--ink-2)">Console</span></div>` +
      `<div aria-hidden="true" data-standin="rail" style="position:fixed;left:0;top:48px;bottom:0;width:64px;border-right:1px solid var(--edge-hair)"></div>`
    : ''
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Console</title><style>${FONTS}</style><style>${css}</style><style>body{margin:0;background:var(--surface-ground)}</style></head><body>${chrome}<div style="${box}"><div id="root" style="position:absolute;inset:0"></div></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?kind=${kind}&theme=${theme}`)
  await page.locator('.jx').waitFor()
  await page.waitForTimeout(500)
}

const KINDS = ['health-running', 'health-first', 'health-fault', 'events', 'events-filtered', 'events-empty', 'connections', 'connections-detail', 'hardware-usb', 'hardware-wifi', 'crew', 'crew-absent'] as const

test.describe('Console, the jury page (fixtures, SIMULATED)', () => {
  for (const kind of KINDS) {
    test(`${kind}: dark, 1366 x 768 geometry and readable text`, async ({ page }) => {
      await openJury(page, kind, 'dark', DESKTOP)
      await page.screenshot({ path: shot(`1366-${kind}`) })
      const m = await geometry(page)
      expect(m.jx.sh, 'the view does not scroll inside itself').toBeLessThanOrEqual(m.jx.ch + 1)
      expect(m.jx.sw).toBeLessThanOrEqual(m.jx.cw + 1)
      for (const p of m.parts) {
        expect(p.bottom, `${p.cls} bottom`).toBeLessThanOrEqual(m.jx.bottom - 7)
        expect(p.right, `${p.cls} right`).toBeLessThanOrEqual(m.jx.right - 7)
      }
      expect(m.small).toEqual([])
      expectReadable(await measureText(page, '.jx'), `${kind} dark`)
    })
  }
  for (const kind of ['health-running', 'events', 'connections', 'hardware-usb', 'crew'] as const) {
    test(`${kind}: dark, the phone at 390`, async ({ page }) => {
      await openJury(page, kind, 'dark', PHONE)
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, jw: document.querySelector('.jx')!.scrollWidth, jc: document.querySelector('.jx')!.clientWidth }))
      expect(m.sw).toBeLessThanOrEqual(m.iw)
      expect(m.jw).toBeLessThanOrEqual(m.jc)
      await page.screenshot({ path: shot(`390-${kind}`) })
    })
  }
  test('health-running: light theme reads too', async ({ page }) => {
    await openJury(page, 'health-running', 'light', DESKTOP)
    await page.screenshot({ path: shot('1366-health-running-light') })
    expectReadable(await measureText(page, '.jx'), 'health light')
  })
})
