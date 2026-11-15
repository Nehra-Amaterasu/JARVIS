// A.J04 in a real Chromium: the Memory section of shell v2 (Recall, Beliefs, People, Keep).
//
// Part 1, the jury page: the real views on stamped fixtures (every state SIMULATED), built in memory by Vite from a small entry
// written into test-results (as core-v2.spec.ts does), in the dark clay theme. It checks, at 1366 x 768 and at 390 x 844: no
// document scroll and nothing of the view clipped or below the fold, every control 44 px, text 11 px and 4.5:1, the keyboard
// path (search, the map with arrows, Enter, Fix with the two-line diff and Undo, the capture line, Delete with the count),
// and the reduced-motion form of the recall path. Screenshots go to JURY_SHOTS (default test-results/jury-j04).
//
// Part 2, the built app (dist-e2e) against the sandbox, flag on through `#t=ww-e2e&shell=v2`: the four views open under the
// real shell with the sandbox's own (empty or partial) store, with honest states and no document scroll. Needs
// `npx vite build --outDir dist-e2e` first; skips otherwise.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from './fixtures'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.JURY_SHOTS ? resolve(process.env.JURY_SHOTS) : resolve(ROOT, 'test-results', 'jury-j04')
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }
const shot = (name: string) => { mkdirSync(SHOTS, { recursive: true }); return resolve(SHOTS, `${name}.png`) }

/* ================================================================ the jury page */
const URL_ = 'http://j04.test/'
const FONTS = `html{--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
let bundle: Promise<{ js: string; css: string }> | null = null

function buildJury() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'test-results', 'j04-entry')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, 'entry.tsx')
    const src = posix(resolve(ROOT, 'src'))
    writeFileSync(entry, [
      `import '${src}/styles/design/clay/index.css'`,
      `import { createElement } from 'react'`,
      `import { createRoot } from 'react-dom/client'`,
      `import { MemoryFixture } from '${src}/jarvis/memory/MemoryFixture'`,
      `const q = new URLSearchParams(location.search)`,
      `document.documentElement.setAttribute('data-theme', 'clay-' + (q.get('theme') === 'light' ? 'light' : 'dark'))`,
      `document.documentElement.setAttribute('data-product', 'jarvis')`,
      `createRoot(document.getElementById('root')!).render(createElement(MemoryFixture, { kind: (q.get('kind') ?? 'recall') as any }))`,
      '',
    ].join('\n'))
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, assetsInlineLimit: 100_000_000, lib: { entry, formats: ['iife'], name: 'J04Jury', fileName: 'j04' } },
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

async function openJury(page: Page, kind: string, size: { width: number; height: number }, theme: 'dark' | 'light' = 'dark') {
  await page.setViewportSize(size)
  const { js, css } = await buildJury()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const desk = size.width >= 900
  const box = desk ? 'position:fixed;left:64px;top:100px;width:1302px;height:668px' : 'position:fixed;left:0;top:0;right:0;bottom:0'
  const chrome = desk
    ? `<div aria-hidden="true" data-standin="shell" style="position:fixed;inset:0 0 auto 0;height:48px;display:flex;align-items:center;gap:24px;padding:0 16px;border-bottom:1px solid var(--edge-hair);font:600 14px/1 var(--font-mono);letter-spacing:.12em;color:var(--ink-1)">JARVIS<span style="font:400 13px/1 var(--font-ui);letter-spacing:0;color:var(--ink-2)">Memory</span></div>` +
      `<div aria-hidden="true" data-standin="rail" style="position:fixed;left:0;top:48px;bottom:0;width:64px;border-right:1px solid var(--edge-hair)"></div>`
    : ''
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Memory</title><style>${FONTS}</style><style>${css}</style><style>body{margin:0;background:var(--surface-ground)}</style></head><body>${chrome}<div style="${box}"><div id="root" style="position:absolute;inset:0"></div></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?kind=${kind}&theme=${theme}`)
  await page.locator('.jm').waitFor()
  await page.waitForTimeout(500)
}

/* ================================================================ measured text */
type TextCheck = { text: string; cls: string; ratio: number; size: number }
async function measureText(page: Page, roots: string): Promise<TextCheck[]> {
  return page.evaluate((sel) => {
    type C = { r: number; g: number; b: number; a: number }
    const parse = (v: string): C | null => {
      let m = /rgba?\(([^)]+)\)/.exec(v)
      if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
      m = /color\(srgb ([^)]+)\)/.exec(v)
      if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 } }
      return null
    }
    const colours = (v: string): C[] => (v.match(/(rgba?\([^)]+\)|color\(srgb [^)]+\))/g) ?? []).map(parse).filter((c): c is C => !!c)
    const over = (f: C, b: C): C => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 })
    const lum = (c: C) => { const ch = (x: number) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b) }
    const ratio = (a: C, b: C) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    const grounds = (el: Element): C[] => {
      const layers: C[] = []
      let stops: C[] | null = null
      const r = el.getBoundingClientRect()
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).filter((n) => n === el || !el.contains(n))
      const from = stack.indexOf(el)
      const chain: Element[] = []
      for (let n: Element | null = el; n; n = n.parentElement) chain.push(n)
      for (const n of [...(from >= 0 ? stack.slice(from) : chain), document.body, document.documentElement]) {
        const cs = getComputedStyle(n)
        const img = cs.backgroundImage
        if (!stops && img && img !== 'none' && img.includes('gradient')) stops = colours(img)
        const bg = parse(cs.backgroundColor)
        if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break }
      }
      let base: C = { r: 255, g: 255, b: 255, a: 1 }
      for (let i = layers.length - 1; i >= 0; i--) base = layers[i].a >= 1 ? layers[i] : over(layers[i], base)
      return stops && stops.length ? stops.map((s) => (s.a >= 1 ? s : over(s, base))) : [base]
    }
    const opacity = (el: Element) => { let o = 1; for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity || 1); return o }
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
        if (cs.visibility !== 'visible' || el.closest('[hidden], .jm-sr, .jm-hollow-art')) continue
        let shown = true
        for (let n: Element | null = el; n; n = n.parentElement) if (getComputedStyle(n).display === 'none') shown = false
        if (!shown) continue
        const svg = el instanceof SVGElement
        const fg0 = parse(svg ? cs.fill : cs.color)
        if (!fg0) continue
        const fg = { ...fg0, a: fg0.a * opacity(el) }
        if (fg.a <= 0.01) continue
        const worst = Math.min(...grounds(el).map((g) => ratio(over(fg, g), g)))
        const size = svg ? parseFloat(cs.fontSize) * (r.width / ((el as SVGGraphicsElement).getBBox?.().width || r.width)) : parseFloat(cs.fontSize)
        out.push({ text: own.slice(0, 40), cls: `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]}`, ratio: Math.round(worst * 100) / 100, size: Math.round(size * 10) / 10 })
      }
    }
    probe.remove()
    return out
  }, roots)
}

function expectReadable(rows: TextCheck[], where: string) {
  expect(rows.length, `${where}: some text was measured`).toBeGreaterThan(8)
  expect(rows.filter((r) => r.ratio < 4.5), `${where}: text under 4.5:1`).toEqual([])
  expect(rows.filter((r) => r.size < 10.9), `${where}: text under 11 px`).toEqual([])
}

/** Every visible real control and its box: keys, fields, links and radios must be 44 px high and wide. */
async function smallControls(page: Page) {
  return page.evaluate(() => {
    const out: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('.jm button, .jm input:not([type="file"]), .jm textarea, .jm [role="radio"], .jm a[href]')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      let shown = true
      for (let n: Element | null = el; n; n = n.parentElement) if (getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') shown = false
      if (!shown) continue
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  })
}

const noScroll = (page: Page) => page.evaluate(() => {
  const jm = document.querySelector<HTMLElement>('.jm')!
  return { jmFits: jm.scrollHeight <= jm.clientHeight + 1, docW: document.documentElement.scrollWidth <= innerWidth, docH: document.documentElement.scrollHeight <= innerHeight + 1 }
})

/** The parts of the view that are cut by the box or sit below its bottom edge. */
const clipped = (page: Page) => page.evaluate(() => {
  const box = document.querySelector<HTMLElement>('.jm')!.getBoundingClientRect()
  const out: string[] = []
  for (const el of document.querySelectorAll<HTMLElement>('.jm > *')) {
    const r = el.getBoundingClientRect()
    if (r.bottom > box.bottom + 1 || r.right > box.right + 1 || r.left < box.left - 1) out.push(`${el.className.toString().split(' ')[0]} bottom ${Math.round(r.bottom)} of ${Math.round(box.bottom)}`)
  }
  return out
})

const KINDS = ['recall', 'recall-lit', 'recall-many', 'recall-empty', 'strata', 'trail', 'results', 'beliefs', 'people', 'keep'] as const

test.describe('Memory, the jury page (fixtures, SIMULATED)', () => {
  for (const kind of KINDS) {
    test(`${kind}: 1366 x 768 fits, every control 44 px, text readable`, async ({ page }) => {
      await openJury(page, kind, DESKTOP)
      await page.screenshot({ path: shot(`j04-${kind}-1366`) })
      const m = await noScroll(page)
      expect(m.jmFits, `${kind}: the view scrolls inside itself`).toBe(true)
      expect(m.docH && m.docW, `${kind}: the document scrolls`).toBe(true)
      expect(await clipped(page), `${kind}: parts outside the box`).toEqual([])
      expect(await smallControls(page), `${kind}: controls under 44 px`).toEqual([])
      expectReadable(await measureText(page, '.jm'), `${kind} 1366`)
    })
    test(`${kind}: 390 x 844 is one column with no sideways scroll`, async ({ page }) => {
      await openJury(page, kind, PHONE)
      await page.screenshot({ path: shot(`j04-${kind}-390`) })
      expect((await noScroll(page)).docW, `${kind}: sideways scroll`).toBe(true)
      expect(await smallControls(page), `${kind}: controls under 44 px`).toEqual([])
      expectReadable(await measureText(page, '.jm'), `${kind} 390`)
    })
  }

  test('light theme: the same views read (recall and keep)', async ({ page }) => {
    for (const kind of ['recall', 'keep'] as const) {
      await openJury(page, kind, DESKTOP, 'light')
      await page.screenshot({ path: shot(`j04-${kind}-1366-light`) })
      expectReadable(await measureText(page, '.jm'), `${kind} light`)
    }
  })

  test('the count on the stage equals the store, and above 120 the stage shows clusters that zoom', async ({ page }) => {
    await openJury(page, 'recall', DESKTOP)
    // 40 memories + 6 people + 5 beliefs + 4 topics are laid out and all drawn
    await expect(page.getByTestId('count-line')).toHaveText(/55 drawn.* of 55 laid out/)
    await expect(page.locator('[data-testid="idle"] [data-id="facts"] .jm-num')).toHaveText('40')
    await openJury(page, 'recall-many', DESKTOP)
    await expect(page.locator('.jm-const')).toHaveAttribute('data-mode', 'clusters')
    expect(await page.locator('.jm-cluster').count()).toBeGreaterThanOrEqual(3)
    const sum = await page.locator('.jm-cluster .jm-cl-n').allTextContents()
    expect(sum.map((t) => Number(t.replace(/[^\d]/g, ''))).reduce((a, b) => a + b, 0)).toBe(355)
    await page.locator('.jm-cluster').first().click()
    await expect(page.locator('.jm-const')).toHaveAttribute('data-mode', 'group')
    expect(await page.locator('.jm-node:not(.jm-cluster)').count()).toBeLessThanOrEqual(120)
    await page.getByTestId('zoom-out').click()
    await expect(page.locator('.jm-const')).toHaveAttribute('data-mode', 'clusters')
  })

  test('an empty store draws hollow forms with the reason, no number', async ({ page }) => {
    await openJury(page, 'recall-empty', DESKTOP)
    await expect(page.getByTestId('constellation-hollow')).toContainText('nothing is stored yet')
    await expect(page.locator('.jm-node')).toHaveCount(0)
  })

  test('keyboard path: recall, the map, Fix with the diff, Undo, capture; Delete is PLANNED without a route', async ({ page }) => {
    await openJury(page, 'recall', DESKTOP)
    await page.keyboard.press('Tab') // the recall field
    await expect(page.locator('#jm-q')).toBeFocused()
    await page.keyboard.type('the spare key')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('recall-path')).toHaveCount(1)
    await expect(page.locator('.jm-node[data-lit="true"]').first()).toBeVisible()
    expect(await page.locator('.jm-rank').count()).toBeGreaterThanOrEqual(2)
    await page.screenshot({ path: shot('j04-recall-path-1366') })

    // into the map and across it with the arrows
    await page.getByTestId('constellation').focus()
    await page.keyboard.press('ArrowRight')
    const first = await page.getByTestId('constellation').getAttribute('aria-activedescendant')
    expect(first).toBeTruthy()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('detail')).toBeVisible()

    // Fix: two lines, old struck and new underlined, then Undo
    await page.getByTestId('fix-key').click()
    const field = page.locator('#jm-fix-field')
    await expect(field).toBeFocused()
    await field.fill('The spare key lives in the red tin by the door')
    await expect(page.locator('.jm-diff [data-k="del"]').first()).toBeVisible()
    await expect(page.locator('.jm-diff [data-k="add"]').first()).toBeVisible()
    await page.screenshot({ path: shot('j04-fix-1366') })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('echo')).toContainText('fixed')
    await page.getByTestId('undo-fix').click()
    await expect(page.getByTestId('echo')).toContainText('undone')

    // Delete is drawn PLANNED: it sends nothing and says why
    await page.locator('[data-planned="delete"]').click({ force: true }) // aria-disabled, so Playwright would wait for it to be enabled
    await expect(page.getByTestId('note')).toContainText('not built')

    // the capture line: the verb is there, type the fact, Enter
    const cap = page.locator('.jm-dock input')
    await cap.focus()
    await page.keyboard.type('remember the bike lock code is on the card')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('echo')).toContainText('stored, source: typed')
  })

  test('Delete with a route names the count, asks, then the item is gone with no reward', async ({ page }) => {
    await openJury(page, 'recall-delete', DESKTOP)
    await page.getByTestId('constellation').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    const before = await page.locator('.jm-node').count()
    await page.keyboard.press('Shift+Tab') // out of the map is not needed: Delete works on the focused map
    await page.getByTestId('constellation').focus()
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('delete-line')).toContainText(/This removes 1 item .* stay/)
    await page.screenshot({ path: shot('j04-delete-1366') })
    await page.getByRole('button', { name: 'Delete 1 item' }).click()
    await expect(page.getByTestId('echo')).toContainText('removed 1 item')
    await expect.poll(() => page.locator('.jm-node').count()).toBeLessThan(before)
  })

  test('the recall path draws once in 240 ms, and not at all under reduced motion', async ({ page }) => {
    await openJury(page, 'recall', DESKTOP)
    await page.locator('#jm-q').fill('the spare key')
    await page.keyboard.press('Enter')
    const d = await page.locator('.jm-reveal').evaluate((el) => getComputedStyle(el).animationDuration)
    expect(d).toBe('0.24s')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const none = await page.locator('.jm-reveal').evaluate((el) => getComputedStyle(el).animationName)
    expect(none).toBe('none')
  })

  test('Beliefs: three sockets, a Wrong row is struck in place, a chip of origin on every row', async ({ page }) => {
    await openJury(page, 'beliefs', DESKTOP)
    await expect(page.getByTestId('sockets')).toHaveAttribute('aria-label', '3 of 3 questions on the board')
    expect(await page.locator('[data-testid="belief-row"] .jm-origin').count()).toBe(3)
    await page.getByTestId('belief-wrong').first().click()
    await expect(page.locator('[data-testid="belief-row"][data-state="rejected"] .jm-b-claim[data-struck="true"]')).toHaveCount(1)
    expect(await page.getByTestId('belief-row').count()).toBe(3) // struck in place, not hidden
    await page.getByTestId('learned-keep').first().click()
    await expect(page.getByTestId('board-say')).toContainText('Kept')
  })

  test('People: alphabetical, never ranked, a dashed bar for a missing date', async ({ page }) => {
    await openJury(page, 'people', DESKTOP)
    const names = await page.locator('[data-testid="people-list"] .jm-list-t').allTextContents()
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
    await expect(page.locator('[data-testid="people-list"] .jm-last[data-empty="true"]')).toHaveCount(1)
    await page.locator('.jm-bead').first().click()
    await expect(page.getByTestId('person-card')).toContainText('messages')
  })

  test('Keep: Share a review writes nothing in a fixture and says so; the destructive plates are PLANNED', async ({ page }) => {
    await openJury(page, 'keep', DESKTOP)
    await page.getByTestId('share-review').click()
    await expect(page.getByTestId('review-line')).toContainText('fixture: no file was written')
    expect(await page.locator('.jm-plate[data-planned="true"]').count()).toBe(3)
    await expect(page.getByTestId('holdings').locator('[data-id="facts"] .jm-num')).toHaveText('40')
  })
})

/* ================================================================ part 2: the app */
async function openMemory(page: Page, baseURL: string | undefined, view: string) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto(`/#t=ww-e2e&shell=v2`)
  const shell = page.locator('[data-shell="v2"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  if ((await shell.getAttribute('data-product')) !== 'jarvis') await page.keyboard.press('Alt+0')
  // Ctrl+4 is Memory (the fourth JARVIS section); `]` steps to the next view of the section (shell/keymap.ts)
  await page.keyboard.press('Control+4')
  await page.waitForTimeout(300)
  for (let i = 0; i < ['recall', 'beliefs', 'people', 'keep'].indexOf(view); i++) { await page.keyboard.press(']'); await page.waitForTimeout(200) }
  await expect(page.locator(`.s2-page[data-view="${view}"] .jm`)).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(800)
}

test.describe('Memory, the app (flag on, sandbox store)', () => {
  for (const view of ['recall', 'beliefs', 'people', 'keep']) {
    test(`${view}: opens under the real shell, no document scroll at 1366 x 768 and no sideways scroll at 390`, async ({ page, baseURL }) => {
      await page.setViewportSize(DESKTOP)
      await openMemory(page, baseURL, view)
      const m = await noScroll(page)
      expect(m.docH && m.docW).toBe(true)
      expect(m.jmFits).toBe(true)
      expect(await smallControls(page)).toEqual([])
      await page.screenshot({ path: shot(`j04-app-${view}-1366`) })
      await page.setViewportSize(PHONE)
      await page.waitForTimeout(400)
      expect((await noScroll(page)).docW).toBe(true)
      await page.screenshot({ path: shot(`j04-app-${view}-390`) })
    })
  }
  test('keep: Share a review has a home here under the flag', async ({ page, baseURL }) => {
    await page.setViewportSize(DESKTOP)
    await openMemory(page, baseURL, 'keep')
    await expect(page.getByTestId('share-review')).toBeVisible()
  })
  test('flag off: the classic frame still renders and holds none of the new Memory', async ({ page, baseURL }) => {
    const res = await fetch(baseURL!).catch(() => null)
    test.skip(!res || !res.ok, 'dist-e2e is not built')
    await page.goto('/#t=ww-e2e')
    await expect(page.locator('.app .dock')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-shell]')).toHaveCount(0)
    await expect(page.locator('.jm')).toHaveCount(0)
  })
})
