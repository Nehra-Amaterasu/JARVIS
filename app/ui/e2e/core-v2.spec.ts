// A.J01 in a real Chromium: the rebuilt Core Talk view of shell v2.
//
// Part 1, the built app (dist-e2e) against the sandbox, flag on through the `#t=ww-e2e&shell=v2` fragment as
// e2e/shell-v2.spec.ts does. The sandbox core is asleep, so this is the honest first screen: no document scroll at
// 1366 x 768 and no part of the view below the fold, the spec's tab order, every control 44 px, the 390 px phone
// layout in one column with no sideways scroll, reduced motion with no running animation, and a flag-off check that
// the classic page still renders. Needs `npm run bundle:check` first; skips otherwise.
//
// Part 2, the jury page: the same CoreTalkView on stamped fixtures (asleep, thinking, speaking), built in memory by
// Vite from a two-line entry written into test-results (gallery.spec.ts does the same), in the light and the dark clay
// theme. A fixture voice frame enters only when the test calls window.__pulse; nothing animates by itself.
//
// Screenshots go to JURY_SHOTS (default test-results/jury-j01, which Playwright empties on each run, so the jury run
// passes a folder outside the repository). VITE_ART_TRACK=private in the environment shows the staged centrepiece.
//
// RC1 (the rework after the wave 6 jury) adds: a stand-in for the shell's title bar, view row and rail on the desktop
// jury page (the empty 100 px band the jury read as dead space was this harness, not the view), text contrast and size
// MEASURED from computed colours with the WCAG formula in both themes, the bounded thinking motion, the organ focus
// ring, and the phone geometry (a square stage, the words under the ring, the input above a one-row pipeline).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from './fixtures'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.JURY_SHOTS ? resolve(process.env.JURY_SHOTS) : resolve(ROOT, 'test-results', 'jury-j01')
const TRACK = process.env.VITE_ART_TRACK === 'private' ? 'private' : 'customer'
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
        if (cs.visibility !== 'visible' || el.closest('[hidden], .jc-sr, .vh-sr, .vh-meter')) continue
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
async function openCore(page: Page, baseURL: string | undefined) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npm run bundle:check` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  const shell = page.locator('[data-shell="v2"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  if ((await shell.getAttribute('data-product')) !== 'jarvis') await page.keyboard.press('Alt+0')
  await page.keyboard.press('Control+1')
  await expect(page.locator('.s2-page[data-view="talk"] .jc')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(400)
}

test.describe('Core v2, the app (flag on)', () => {
  test('1366 x 768: no document scroll, nothing of the view clipped or below the fold', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openCore(page, baseURL)
    const m = await page.evaluate(() => {
      const jc = document.querySelector<HTMLElement>('.jc')!
      const box = jc.getBoundingClientRect()
      const parts = [...document.querySelectorAll<HTMLElement>('.jc-left > *, .jc-right > *, .jc-vh .vh-strip, .jc-vh .vh-legend, .jc-organ, .jc-rib-node')]
      const out = parts.map((el) => {
        const r = el.getBoundingClientRect()
        return { cls: el.className.toString().slice(0, 40), top: r.top, bottom: r.bottom, left: r.left, right: r.right, sh: el.scrollHeight, ch: el.clientHeight }
      })
      return {
        doc: { sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth },
        jc: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, sh: jc.scrollHeight, ch: jc.clientHeight, w: box.width, h: box.height },
        parts: out,
      }
    })
    expect(m.doc.sh).toBeLessThanOrEqual(m.doc.ih)
    expect(m.doc.sw).toBeLessThanOrEqual(m.doc.iw)
    expect(m.jc.sh).toBeLessThanOrEqual(m.jc.ch)
    // the shell's page box: 1302 wide; 665 tall with today's title bar and view row (the spec's J box is 652 inside it)
    expect(Math.round(m.jc.w)).toBe(1302)
    expect(m.jc.h).toBeGreaterThanOrEqual(652)
    const left = m.parts.filter((p) => ['jc-organ', 'jc-rib-node'].includes(p.cls.split(' ')[0]))
    expect(left.length).toBe(9) // five organs and four ribbon nodes, every one inside the left column
    for (const p of left) expect(p.right, `${p.cls} inside the 720 px column`).toBeLessThanOrEqual(m.jc.left + 8 + 720 + 0.5)
    for (const p of m.parts) {
      expect(p.bottom, `${p.cls} bottom`).toBeLessThanOrEqual(m.jc.bottom - 7)
      expect(p.right, `${p.cls} right`).toBeLessThanOrEqual(m.jc.right - 7)
      expect(p.bottom, `${p.cls} below the fold`).toBeLessThanOrEqual(m.doc.ih)
    }
    await page.screenshot({ path: shot(`app-1366-dark-asleep-${TRACK}`) })
  })

  test('keyboard: Wake, mode, Anatomy, Pause, ribbon, organs, turns, composer, in that order', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openCore(page, baseURL)
    await page.locator('.jc-wake').focus()
    const seen: string[] = []
    for (let i = 0; i < 12; i++) {
      const id = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        if (!a || !a.closest('.jc')) return 'outside'
        if (a.classList.contains('jc-wake') || a.classList.contains('jc-sleep')) return 'wake'
        if (a.closest('.jc-mode')) return 'mode'
        if (a.classList.contains('jc-anat-key')) return 'anatomy'
        if (a.classList.contains('vh-pause')) return 'pause'
        if (a.closest('.jc-ribbon')) return 'ribbon'
        if (a.closest('.jc-organs')) return 'organs'
        if (a.closest('.jc-convo-head')) return 'earlier'
        if (a.closest('.jc-strata')) return 'turns'
        if (a.classList.contains('jc-composer-field')) return 'composer'
        if (a.classList.contains('jc-send')) return 'send'
        return a.className.toString()
      })
      if (seen[seen.length - 1] !== id) seen.push(id)
      if (id === 'send') break
      await page.keyboard.press('Tab')
    }
    expect(seen).toEqual(['wake', 'mode', 'anatomy', 'pause', 'ribbon', 'organs', 'earlier', 'composer', 'send'])
    // Alt+I opens Anatomy; Esc closes it and focus comes back
    await page.locator('.jc-wake').focus()
    await page.keyboard.press('Alt+i')
    await expect(page.locator('dialog.jc-drawer[open]')).toHaveCount(1)
    await page.screenshot({ path: shot(`app-1366-dark-anatomy-${TRACK}`) })
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog.jc-drawer[open]')).toHaveCount(0)
  })

  test('every control of the view is at least 44 x 44 px', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openCore(page, baseURL)
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.jc button, .jc input, .jc a[href], .jc [tabindex="0"]')]
        .filter((el) => el.offsetParent !== null && !el.closest('dialog') && !el.classList.contains('jc-turn'))
        .map((el) => ({ el: `${el.tagName}.${el.className.toString().slice(0, 30)}`, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }))
        .filter((r) => r.h < 44 || r.w < 44),
    )
    expect(small).toEqual([])
  })

  test('390 px: one column, no sideways scroll, a square stage, the input above a one-row pipeline, 44 px targets', async ({ page, baseURL }) => {
    await page.setViewportSize(PHONE)
    await openCore(page, baseURL)
    const m = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect()
      const nodes = [...document.querySelectorAll('.jc-rib-node')].map((n) => n.getBoundingClientRect())
      return {
        sw: document.documentElement.scrollWidth, iw: innerWidth,
        jcW: document.querySelector('.jc')!.scrollWidth, jcCW: document.querySelector('.jc')!.clientWidth,
        ribbon: document.querySelector('.jc-ribbon')!.getAttribute('data-orientation'),
        compact: document.querySelector('.jc-organs')!.hasAttribute('data-compact'),
        cols: getComputedStyle(document.querySelector('.jc')!).gridTemplateColumns.split(' ').length,
        stage: box('.jc-vh .vh-stage'), ring: box('.jc-sigil'), pose: box('.jc-pose'), composer: box('.jc-composer'), rib: box('.jc-ribbon'),
        nodeTops: nodes.map((n) => Math.round(n.top)),
        small: [...document.querySelectorAll<HTMLElement>('.jc button, .jc input, .jc a[href], .jc [tabindex="0"]')]
          .filter((el) => el.offsetParent !== null && !el.closest('dialog') && !el.classList.contains('jc-turn'))
          .map((el) => ({ el: `${el.tagName}.${el.className.toString().slice(0, 30)}`, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }))
          .filter((r) => r.h < 44 || r.w < 44),
      }
    })
    expect(m.sw).toBeLessThanOrEqual(m.iw)
    expect(m.jcW).toBeLessThanOrEqual(m.jcCW)
    expect(m.compact).toBe(true)
    expect(m.cols).toBe(1)
    // the stage is square and the ring is whole inside it, its words under it, never over it
    expect(Math.abs(m.stage.width - m.stage.height)).toBeLessThanOrEqual(2)
    expect(m.ring.left).toBeGreaterThanOrEqual(m.stage.left - 1)
    expect(m.ring.right).toBeLessThanOrEqual(m.stage.right + 1)
    expect(m.pose.top).toBeGreaterThanOrEqual(m.ring.bottom - 12) // the ring box ends at the bezel's lower notch
    expect(m.pose.bottom).toBeLessThanOrEqual(m.stage.bottom)
    // one compact four-step strip, and the input above it
    expect(m.ribbon).toBe('row')
    expect(new Set(m.nodeTops).size).toBe(1)
    expect(m.rib.height).toBeLessThanOrEqual(64)
    expect(m.composer.bottom).toBeLessThanOrEqual(m.rib.top)
    expect(m.small).toEqual([])
    await page.screenshot({ path: shot(`app-390-dark-asleep-${TRACK}`) })
  })

  test('text contrast and size, measured: 4.5:1 and 11 px at 1366 and 390, with Anatomy open', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openCore(page, baseURL)
    expectReadable(await measureText(page, '.jc'), 'app 1366 asleep')
    await page.keyboard.press('Alt+i')
    await expect(page.locator('dialog.jc-drawer[open]')).toHaveCount(1)
    expectReadable(await measureText(page, 'dialog.jc-drawer[open]'), 'app Anatomy')
    await page.keyboard.press('Escape')
    await page.setViewportSize(PHONE)
    await page.waitForTimeout(300)
    expectReadable(await measureText(page, '.jc'), 'app 390 asleep')
  })

  test('reduced motion: the static voice picture and no running animation', async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(DESKTOP)
    await openCore(page, baseURL)
    await page.waitForTimeout(1000)
    const r = await page.evaluate(() => ({
      running: document.getAnimations().filter((a) => a.playState === 'running').length,
      form: document.querySelector('.jc .vh')?.getAttribute('data-form'),
    }))
    expect(r.running).toBe(0)
    expect(r.form).toBe('static')
  })

  test('the organ tiles: a 2 px focus ring at 3:1 or more, and a solid edge while focused', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openCore(page, baseURL)
    await page.locator('.jc-organ').first().focus()
    await page.keyboard.press('ArrowRight') // keyboard focus, so :focus-visible holds
    const f = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const cs = getComputedStyle(el)
      return { organ: el.classList.contains('jc-organ'), width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset, colour: cs.outlineColor, border: cs.borderTopStyle }
    })
    expect(f.organ).toBe(true)
    expect(f).toMatchObject({ width: '2px', style: 'solid', offset: '3px', border: 'solid' })
    const ground = await page.evaluate(() => getComputedStyle(document.querySelector('.jc')!.closest('[data-shell]') ?? document.body).backgroundColor)
    const lum = (c: string) => {
      const p = (/rgba?\(([^)]+)\)/.exec(c)?.[1] ?? '0,0,0').split(/[\s,]+/).map(Number)
      const ch = (x: number) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * ch(p[0]) + 0.7152 * ch(p[1]) + 0.0722 * ch(p[2])
    }
    const a = lum(f.colour)
    const b = lum(ground)
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3)
  })

  test('flag off: the classic frame still renders the old Core page', async ({ page, baseURL }) => {
    const res = await fetch(baseURL!).catch(() => null)
    test.skip(!res || !res.ok, 'dist-e2e is not built')
    await page.goto('/#t=ww-e2e')
    await expect(page.locator('.app .dock')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-shell]')).toHaveCount(0)
    await expect(page.locator('.jc')).toHaveCount(0)
  })
})

/* ================================================================ part 2: the jury page on fixtures */
const URL_ = 'http://core-v2.test/'
const FONTS = `html{--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
let bundle: Promise<{ js: string; css: string }> | null = null

function buildJury() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'test-results', 'core-v2-entry')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, 'entry.tsx')
    const src = posix(resolve(ROOT, 'src'))
    writeFileSync(entry, [
      `import '${src}/styles/design/clay/index.css'`,
      `import { createElement } from 'react'`,
      `import { createRoot } from 'react-dom/client'`,
      `import { VoiceSignal } from '${src}/jarvis/voice'`,
      `import { CoreFixture, pulse } from '${src}/jarvis/core/fixtures'`,
      `const q = new URLSearchParams(location.search)`,
      `document.documentElement.setAttribute('data-theme', 'clay-' + (q.get('theme') === 'light' ? 'light' : 'dark'))`,
      `document.documentElement.setAttribute('data-product', 'jarvis')`,
      `const signal = new VoiceSignal()`,
      `let seq = 0`,
      `;(window as any).__pulse = (ch: 'in' | 'out') => pulse(signal, ch, seq++)`,
      `createRoot(document.getElementById('root')!).render(createElement(CoreFixture, { kind: (q.get('kind') ?? 'asleep') as any, motion: 'auto', signal }))`,
      '',
    ].join('\n'))
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, assetsInlineLimit: 100_000_000, lib: { entry, formats: ['iife'], name: 'CoreJury', fileName: 'core' } },
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

async function openJury(page: Page, kind: string, theme: 'light' | 'dark', size: { width: number; height: number }, boxH = 668) {
  await page.setViewportSize(size)
  const { js, css } = await buildJury()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  // the shell's page box: under the 48 px title bar and the 52 px view row, right of the 64 px rail (1302 x 668)
  const desk = size.width >= 900
  const box = desk ? `position:fixed;left:64px;top:100px;width:1302px;height:${boxH}px` : 'position:fixed;left:0;top:0;right:0;bottom:0'
  // The band above the box is the shell's title bar (48) and view row (52), the strip left of it the rail (64). The
  // wave 6 jury read the empty band as dead space in the view, so the desktop page draws a plain stand-in of that
  // chrome: inert, aria-hidden, the shell's own words. It is the harness, not the view under test.
  const chrome = desk
    ? `<div aria-hidden="true" data-standin="shell" style="position:fixed;inset:0 0 auto 0;height:48px;display:flex;align-items:center;gap:24px;padding:0 16px;border-bottom:1px solid var(--edge-hair);font:600 14px/1 var(--font-mono);letter-spacing:.12em;color:var(--ink-1)">JARVIS<span style="font:400 13px/1 var(--font-ui);letter-spacing:0;color:var(--ink-2)">Core / Talk</span></div>` +
      `<div aria-hidden="true" data-standin="rail" style="position:fixed;left:0;top:48px;bottom:0;width:64px;border-right:1px solid var(--edge-hair)"></div>` +
      `<div aria-hidden="true" data-standin="views" style="position:fixed;left:72px;top:56px;height:36px;display:flex;align-items:center;gap:28px;padding:0 16px;font:600 13px/1 var(--font-ui);color:var(--ink-1)">Talk<span style="color:var(--ink-2);font-weight:400">Sound</span></div>`
    : ''
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Core v2</title><style>${FONTS}</style><style>${css}</style><style>body{margin:0;background:var(--surface-ground)}</style></head><body>${chrome}<div style="${box}"><div id="root" style="position:absolute;inset:0"></div></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?kind=${kind}&theme=${theme}`)
  await page.locator('.jc').waitFor()
  await page.waitForTimeout(600)
}

/** The rows of the transcript well that are cut by its top edge (the well must show whole turns only). */
const cutTurns = (page: Page) => page.evaluate(() => {
  const ol = document.querySelector('.jc-strata .jc-turns')
  if (!ol) return 0
  const top = ol.getBoundingClientRect().top
  return [...ol.querySelectorAll('.jc-turn')].filter((r) => r.getBoundingClientRect().top < top - 0.5).length
})

test.describe('Core v2, the jury page (fixtures, SIMULATED)', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme}: asleep, thinking and speaking at 1366, and the phone at 390`, async ({ page }) => {
      await openJury(page, 'asleep', theme, DESKTOP)
      expect(await page.evaluate(() => document.querySelector('.jc')!.scrollHeight <= document.querySelector('.jc')!.clientHeight)).toBe(true)
      await page.screenshot({ path: shot(`jury-1366-${theme}-asleep-${TRACK}`) })

      expectReadable(await measureText(page, '.jc'), `jury ${theme} 1366 asleep`)

      await openJury(page, 'thinking', theme, DESKTOP)
      // the well fills with whole turns: at least the four of wave 6, none cut by the top edge
      expect(await page.locator('.jc-strata .jc-turn').count()).toBeGreaterThanOrEqual(5)
      expect(await cutTurns(page)).toBe(0)
      // one clock: the strip says THINKING with no number; the THINK step carries the seconds with its own lamp
      await expect(page.locator('.jc-vh [data-testid="vh-state"]')).toHaveText('THINKING')
      await expect(page.locator('.jc-vh [data-testid="vh-number"]')).toHaveText(/^no level/)
      await expect(page.locator('.jc-rib-step[data-stage="think"]')).toHaveAttribute('data-state', 'simulated')
      expectReadable(await measureText(page, '.jc'), `jury ${theme} 1366 thinking`)
      await page.waitForTimeout(5000) // the bounded sigil motion has ended: the screenshot shows the formed pose
      await page.screenshot({ path: shot(`jury-1366-${theme}-thinking-${TRACK}`) })

      await openJury(page, 'speaking', theme, DESKTOP)
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => (window as unknown as { __pulse: (c: string) => void }).__pulse('out'))
        await page.waitForTimeout(45)
      }
      await expect(page.locator('.jc-sigil[data-state="simulated"]')).toHaveCount(1)
      const lit = Number(await page.locator('.jc-sigil').getAttribute('data-lit'))
      expect(lit).toBeGreaterThan(0)
      await page.screenshot({ path: shot(`jury-1366-${theme}-speaking-${TRACK}`) })
      // the frame turns stale after 400 ms: the ring goes hollow again on its own, with no frame
      await page.waitForTimeout(700)
      await expect(page.locator('.jc-sigil')).toHaveAttribute('data-lit', '0')

      await openJury(page, 'asleep', theme, PHONE)
      expectReadable(await measureText(page, '.jc'), `jury ${theme} 390 asleep`)
      await page.screenshot({ path: shot(`jury-390-${theme}-asleep-${TRACK}`) })

      await openJury(page, 'thinking', theme, PHONE)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator('.jc-strata .jc-turn').count()).toBe(3)
      expectReadable(await measureText(page, '.jc'), `jury ${theme} 390 thinking`)
      await page.waitForTimeout(5000)
      await page.screenshot({ path: shot(`jury-390-${theme}-thinking-${TRACK}`), fullPage: false })
      await page.locator('.jc').evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await page.screenshot({ path: shot(`jury-390-${theme}-thinking-bottom-${TRACK}`) })
    })
  }

  test('one canvas at 1302 x 720: no primary part clipped, outside the box or below the fold', async ({ page }) => {
    await openJury(page, 'thinking', 'dark', { width: 1366, height: 820 }, 720)
    const m = await page.evaluate(() => {
      const jc = document.querySelector<HTMLElement>('.jc')!
      const box = jc.getBoundingClientRect()
      const sel = '.jc-controls, .jc-stage, .jc-ribbon, .jc-organs, .jc-organ, .jc-rib-node, .jc-convo-head, .jc-strata, .jc-composer'
      const parts = [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
        const r = el.getBoundingClientRect()
        return { cls: el.className.toString().slice(0, 30), top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      })
      return { box: { w: box.width, h: box.height, top: box.top, bottom: box.bottom, left: box.left, right: box.right }, sh: jc.scrollHeight, ch: jc.clientHeight, ih: innerHeight, parts }
    })
    expect([Math.round(m.box.w), Math.round(m.box.h)]).toEqual([1302, 720])
    expect(m.sh).toBeLessThanOrEqual(m.ch)
    for (const p of m.parts) {
      expect(p.top, `${p.cls} top`).toBeGreaterThanOrEqual(m.box.top)
      expect(p.bottom, `${p.cls} bottom`).toBeLessThanOrEqual(m.box.bottom)
      expect(p.right, `${p.cls} right`).toBeLessThanOrEqual(m.box.right)
      expect(p.left, `${p.cls} left`).toBeGreaterThanOrEqual(m.box.left)
      expect(p.bottom, `${p.cls} below the fold`).toBeLessThanOrEqual(m.ih)
    }
    await page.screenshot({ path: shot(`jury-1302x720-dark-thinking-${TRACK}`) })
  })

  test('thinking: one bounded motion (the sigil forming, at most 5 s), stopped by Pause and absent under reduced motion', async ({ page }) => {
    await openJury(page, 'thinking', 'dark', DESKTOP)
    const t = await page.evaluate(() => document.getAnimations().map((a) => {
      const c = a.effect?.getComputedTiming()
      return { end: Number(c?.endTime ?? Infinity), iterations: Number(c?.iterations ?? Infinity), inEye: !!((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest?.('.jc-eye') }
    }))
    expect(t.length).toBeGreaterThan(0)
    expect(t.every((a) => a.inEye)).toBe(true) // the only motion on the view is the eye's sigil
    expect(Math.max(...t.map((a) => a.end))).toBeLessThanOrEqual(5000)
    // Pause stops it at once: the formed sigil, still
    await page.locator('.jc-vh .vh-pause').click()
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0)
    await page.locator('.jc-vh .vh-pause').click()
    // reduced motion: no animation at all, the sigil drawn whole
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openJury(page, 'thinking', 'dark', DESKTOP)
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
    await expect(page.locator('.jc-eye[data-pose="thinking"] .g-sigil path').first()).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  })

  test('idle (asleep): no animation frame requested and no running animation once settled', async ({ page }) => {
    await openJury(page, 'asleep', 'dark', DESKTOP)
    const r = await page.evaluate(async () => {
      let frames = 0
      const orig = window.requestAnimationFrame
      window.requestAnimationFrame = (cb) => { frames++; return orig(cb) }
      await new Promise((res) => setTimeout(res, 1500))
      window.requestAnimationFrame = orig
      return { frames, running: document.getAnimations().filter((a) => a.playState === 'running').length }
    })
    expect(r.frames).toBe(0)
    expect(r.running).toBe(0)
  })
})
