// Chunk 11 (plan 8.6, 9): Career in a real browser. The real Frame hosts the real CareerPage with fictional rows
// (src/ww/career/_lab.tsx, built in memory by Vite like the kitchen sink: nothing on disk, no server, no network).
// It proves what jsdom cannot: the owner's rule that no view scrolls, at 1366x768 and 1920x1080, in all three
// themes; that paging reaches every row in the real layout; and that every control has a 40 px hit area.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { designCss, expect, test } from './fixtures'
import { effectiveBox } from './kitchen'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAB_URL = 'http://ww-career.test/'
const VIEWS = ['Pipeline', 'Certificates', 'Abroad', 'Money', 'Plan'] as const
const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
] as const
const THEMES = [
  { name: 'Ash', attr: null },
  { name: 'Paper', attr: 'paper' },
  { name: 'Indigo', attr: 'indigo' },
] as const

// the lab has no app shell: this is the part of shell.css and mission.css that sizes the frame's page box,
// and a 76 px rail on the left so the frame's width is the one the real app gives it (1366 -> 1290)
const LAB_CSS = `html,body{margin:0;height:100%}body{font-family:system-ui,'Segoe UI',sans-serif;background:var(--surface-0,#000)}
#app{position:absolute;inset:0 0 0 76px}.page{position:absolute;inset:0;overflow:auto;padding:18px 28px 28px 22px}.page.mission{padding-top:10px}
html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace}`

let cached: Promise<{ js: string; css: string }> | null = null
function buildLab() {
  cached ??= (async () => {
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'src/ww/career/_lab.tsx'), formats: ['iife'], name: 'WWCareerBundle', fileName: 'career-lab' } },
    })
    let js = ''
    let css = ''
    for (const o of (Array.isArray(out) ? out : [out]).flatMap((x) => ('output' in x ? x.output : []))) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the Career lab build produced no script')
    return { js, css }
  })()
  return cached
}
const escapeScript = (js: string) => js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')

async function openCareer(page: Page, size: { w: number; h: number }, theme: string | null = null): Promise<void> {
  await page.setViewportSize({ width: size.w, height: size.h })
  const { js, css } = await buildLab()
  const html = `<!doctype html><html data-motion="calm"${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8"><style>${designCss()}</style><style>${css}</style><style>${LAB_CSS}</style></head><body><div id="app"></div><script>${escapeScript(js)}</script></body></html>`
  await page.route(`${LAB_URL}**`, (route) => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(LAB_URL)
  await page.evaluate(() => (window as unknown as { WWCareerBundle: { mountLab(el: HTMLElement): void } }).WWCareerBundle.mountLab(document.getElementById('app')!))
  await page.waitForSelector('.ww-career [data-card]')
  if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
}
const goto = async (page: Page, view: string) => {
  await page.getByRole('radio', { name: view, exact: true }).click()
  await page.waitForSelector(`.ww-career [data-view]`)
  await page.waitForTimeout(80)
}

interface Fit {
  centre: [number, number]
  page: [number, number]
  career: [number, number]
  doc: [number, number]
  lists: { label: string; box: number; content: number; rows: number; clipped: number }[]
  cards: number
  pagerTexts: string[]
}
/** scrollHeight against clientHeight for every box that could scroll, and for every list whether its rows are whole. */
const fit = (page: Page): Promise<Fit> =>
  page.evaluate(() => {
    const pair = (el: Element | null): [number, number] => (el ? [el.scrollHeight, el.clientHeight] : [0, 0])
    const lists = [...document.querySelectorAll<HTMLElement>('.cr-list')].map((l) => {
      const box = l.getBoundingClientRect()
      const items = [...l.querySelectorAll<HTMLElement>('.cr-item')]
      return { label: l.getAttribute('aria-label') ?? '', box: l.clientHeight, content: l.scrollHeight, rows: items.length, clipped: items.filter((i) => i.getBoundingClientRect().bottom > box.bottom + 1).length }
    })
    return {
      centre: pair(document.querySelector('.ww-centre')),
      page: pair(document.querySelector('.ww-centre > .page')),
      career: pair(document.querySelector('.ww-career')),
      doc: [document.documentElement.scrollHeight, innerHeight],
      lists,
      cards: document.querySelectorAll('.ww-career [data-card]').length,
      pagerTexts: [...document.querySelectorAll('[data-pager-text]')].map((e) => e.textContent ?? ''),
    }
  })
function expectNoScroll(f: Fit, where: string) {
  for (const k of ['centre', 'page', 'career', 'doc'] as const) expect(f[k][0], `${where}: ${k} scrollHeight ${f[k][0]} vs clientHeight ${f[k][1]}`).toBeLessThanOrEqual(f[k][1] + 1)
  for (const l of f.lists) {
    if (l.box === 0) continue // a pane that is not showing (Abroad below 1700 px) has no box to overflow
    expect(l.content, `${where}: list "${l.label}" holds ${l.content} px in a ${l.box} px box`).toBeLessThanOrEqual(l.box + 1)
    expect(l.clipped, `${where}: list "${l.label}" clips a row`).toBe(0)
    expect(l.rows, `${where}: list "${l.label}" shows no row`).toBeGreaterThan(0)
  }
}

for (const size of SIZES) {
  test.describe(`${size.w}x${size.h}`, () => {
    for (const view of VIEWS) {
      test(`${view}: the workspace centre does not scroll and no row is clipped`, async ({ page }, info) => {
        await openCareer(page, size)
        await goto(page, view)
        const f = await fit(page)
        expectNoScroll(f, `${view} ${size.w}x${size.h}`)
        info.annotations.push({ type: 'rows', description: `${view} ${size.w}x${size.h}: cards ${f.cards}; ${f.lists.map((l) => `${l.label} ${l.rows} rows in ${l.box}px`).join('; ')}; ${f.pagerTexts.join(' | ') || 'no pager'}` })
        console.log(`[rows] ${view} ${size.w}x${size.h}: cards ${f.cards}; ${f.lists.map((l) => `${l.label} ${l.rows} rows in ${l.box}px`).join('; ')}; ${f.pagerTexts.join(' | ') || 'no pager'}`)
      })
    }
    test('opens on Pipeline with exactly one saffron fill', async ({ page }) => {
      await openCareer(page, size)
      await expect(page.getByRole('radio', { name: 'Pipeline', exact: true })).toHaveAttribute('aria-checked', 'true')
      expect(await page.locator('.ww-career [data-primary]').count()).toBe(1)
      expect(await page.locator('.ww-career [data-primary]').innerText()).toBe('Do next step')
    })
  })
}

for (const t of THEMES) {
  test(`${t.name}: every view fits one canvas at 1366x768`, async ({ page }) => {
    await openCareer(page, SIZES[0], t.attr)
    for (const view of VIEWS) {
      await goto(page, view)
      expectNoScroll(await fit(page), `${t.name} ${view}`)
    }
    // the theme really changed the page, or this test would prove nothing about the other two
    const surface = await page.evaluate(() => getComputedStyle(document.querySelector('.ww-centre')!).backgroundColor)
    test.info().annotations.push({ type: 'surface', description: `${t.name}: ${surface}` })
    console.log(`[theme] ${t.name} centre background ${surface}`)
  })
}

test('the three themes paint three different centres', async ({ page }) => {
  const seen = new Set<string>()
  for (const t of THEMES) {
    await openCareer(page, SIZES[0], t.attr)
    seen.add(await page.evaluate(() => getComputedStyle(document.querySelector('.ww-centre')!).backgroundColor))
  }
  expect(seen.size).toBe(3)
})

test('paging reaches every certificate and every application in the real layout', async ({ page }) => {
  await openCareer(page, SIZES[0])
  const walk = async (listLabel: string, attr: string) => {
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      for (const id of await page.locator(`[aria-label="${listLabel}"] [${attr}]`).evaluateAll((els, a) => els.map((e) => e.getAttribute(a as string) ?? e.textContent ?? ''), attr)) seen.add(id)
      const next = page.getByRole('button', { name: `Next ${listLabel}` })
      if ((await next.count()) === 0 || (await next.getAttribute('aria-disabled')) === 'true') break
      await next.click()
    }
    return seen
  }
  // applications: the row has no data attribute of its own, so count the stage selects (one per application)
  const apps = new Set<string>()
  for (let i = 0; i < 40; i++) {
    for (const l of await page.locator('[aria-label="applications"] select').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))) apps.add(l)
    const next = page.getByRole('button', { name: 'Next applications' })
    if ((await next.count()) === 0 || (await next.getAttribute('aria-disabled')) === 'true') break
    await next.click()
  }
  expect(apps.size).toBe(12)
  await goto(page, 'Certificates')
  expect((await walk('certificates', 'data-cert')).size).toBe(29) // 30 in the bank, 1 earned
  await goto(page, 'Money')
  expect((await walk('costs', 'data-chest')).size).toBeGreaterThanOrEqual(10) // 9 fixed costs + 1 of his own
})

test('Mark earned stays aria-disabled until a link is typed, in the browser too', async ({ page }) => {
  await openCareer(page, SIZES[0])
  await goto(page, 'Certificates')
  const row = page.locator('[data-cert]').first()
  const btn = row.getByRole('button', { name: /Mark earned/ })
  await expect(btn).toHaveAttribute('aria-disabled', 'true')
  await row.getByRole('textbox').fill('https://example.org/certificate')
  await expect(btn).not.toHaveAttribute('aria-disabled', 'true')
})

for (const size of SIZES) {
  test(`hit areas at ${size.w}x${size.h}: every Career control is at least 40 px each way`, async ({ page }) => {
    await openCareer(page, size)
    const small: string[] = []
    let checked = 0
    for (const view of VIEWS) {
      await goto(page, view)
      const sel = '.ww-career button, .ww-career select, .ww-career input'
      const n = await page.locator(sel).count()
      for (let i = 0; i < n; i++) {
        const vis = await page.locator(sel).nth(i).evaluate((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
        })
        if (!vis) continue
        const box = await effectiveBox(page, sel, i)
        checked++
        const label = await page.locator(sel).nth(i).evaluate((e) => (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName).trim().slice(0, 40))
        if (!box || box.w < 40 || box.h < 40) small.push(`${view}: "${label}" ${box ? `${box.w}x${box.h}` : 'unreachable'}`)
      }
    }
    console.log(`[hit] ${size.w}x${size.h}: ${checked} controls checked, ${small.length} under 40 px`)
    expect(checked).toBeGreaterThan(40)
    expect(small).toEqual([])
  })
}
