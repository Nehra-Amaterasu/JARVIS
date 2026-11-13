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
      const parts = [...document.querySelectorAll<HTMLElement>('.jc-left > *, .jc-right > *, .jc-vh .vh-strip, .jc-vh .vh-legend')]
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
    expect([Math.round(m.jc.w), Math.round(m.jc.h)]).toEqual([1302, 668])
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

  test('390 px: one column, no sideways scroll, the ribbon as rows, the organs as five lamps', async ({ page, baseURL }) => {
    await page.setViewportSize(PHONE)
    await openCore(page, baseURL)
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, iw: innerWidth,
      jcW: document.querySelector('.jc')!.scrollWidth, jcCW: document.querySelector('.jc')!.clientWidth,
      ribbon: document.querySelector('.jc-ribbon')!.getAttribute('data-orientation'),
      compact: document.querySelector('.jc-organs')!.hasAttribute('data-compact'),
      cols: getComputedStyle(document.querySelector('.jc')!).gridTemplateColumns.split(' ').length,
    }))
    expect(m.sw).toBeLessThanOrEqual(m.iw)
    expect(m.jcW).toBeLessThanOrEqual(m.jcCW)
    expect(m.ribbon).toBe('column')
    expect(m.compact).toBe(true)
    expect(m.cols).toBe(1)
    await page.screenshot({ path: shot(`app-390-dark-asleep-${TRACK}`) })
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

async function openJury(page: Page, kind: string, theme: 'light' | 'dark', size: { width: number; height: number }) {
  await page.setViewportSize(size)
  const { js, css } = await buildJury()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  // the shell's page box: under the 48 px title bar and the 52 px view row, right of the 64 px rail (1302 x 668)
  const desk = size.width >= 900
  const box = desk ? 'position:fixed;left:64px;top:100px;width:1302px;height:668px' : 'position:fixed;left:0;top:0;right:0;bottom:0'
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Core v2</title><style>${FONTS}</style><style>${css}</style><style>body{margin:0;background:var(--surface-ground)}</style></head><body><div style="${box}"><div id="root" style="position:absolute;inset:0"></div></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?kind=${kind}&theme=${theme}`)
  await page.locator('.jc').waitFor()
  await page.waitForTimeout(600)
}

test.describe('Core v2, the jury page (fixtures, SIMULATED)', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme}: asleep, thinking and speaking at 1366, and the phone at 390`, async ({ page }) => {
      await openJury(page, 'asleep', theme, DESKTOP)
      expect(await page.evaluate(() => document.querySelector('.jc')!.scrollHeight <= document.querySelector('.jc')!.clientHeight)).toBe(true)
      await page.screenshot({ path: shot(`jury-1366-${theme}-asleep-${TRACK}`) })

      await openJury(page, 'thinking', theme, DESKTOP)
      expect(await page.locator('.jc-strata .jc-turn').count()).toBe(4)
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

      await openJury(page, 'thinking', theme, PHONE)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator('.jc-strata .jc-turn').count()).toBe(3)
      await page.screenshot({ path: shot(`jury-390-${theme}-thinking-${TRACK}`), fullPage: false })
      await page.locator('.jc').evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await page.screenshot({ path: shot(`jury-390-${theme}-thinking-bottom-${TRACK}`) })
    })
  }

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
