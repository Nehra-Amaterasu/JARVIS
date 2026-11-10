// Chunk 9: the Proof column in a real Chromium (plan 4.10, 8.4). The rail at 1366 (a 56 px rail that opens a
// 320 px sheet), the panel pinned at 1500 and again at 1920, no scroll in the workspace centre, and the ten cards
// in order. The REAL Frame is built in memory by Vite (nothing written to disk, nothing near app/ui/dist) with
// stub pages, and /api/mission/* is answered by page.route with invented data, so no server and no real data.
//
// WIRING: ProofRail.tsx belongs to chunk 4 (ww/frame/**) and still draws its stub line. This spec proves the
// exact 2-line patch the build note asks for: a build-time transform swaps the stub `body` for
// <ProofPanel mode={mode} />. Once the patch is in ProofRail.tsx the transform is a no-op and the spec is
// unchanged. If the stub is still on screen (no patch, no transform) the first test says so instead of passing.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from './fixtures'
import { effectiveBox } from './kitchen'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
const URL_ = 'http://ww-proof.test/'
const TODAY = '2026-11-10'

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Frame } from '${posix(resolve(ROOT, 'src/ww/frame/Frame.tsx'))}'
const h = React.createElement
const page = (id) => () => h('div', { 'data-page': id }, h('p', null, 'Stub ' + id))
const pages = Object.fromEntries(['study', 'tree', 'life', 'career', 'focus', 'setup'].map((id) => [id, page(id)]))
window.WWFrame = { mount(el, o) { createRoot(el).render(h(Frame, { loaded: true, pages, glass: 'blur', ...o })) } }
`

/** Swap chunk 4's stub body for the panel, only while ProofRail.tsx still has the stub. */
const wire = {
  name: 'ww-proof-wire',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!/frame[\\/]ProofRail\.tsx$/.test(id) || !code.includes('data-proof="stub"')) return null
    const patched = code.replace(/const body = \(\s*<p className="ww-stub" data-proof="stub">[\s\S]*?<\/p>\s*\)/, 'const body = <ProofPanel mode={mode} />')
    return { code: `import { ProofPanel } from '../proof'\n${patched}`, map: null }
  },
}

let bundle: Promise<{ js: string; css: string }> | null = null
function buildFrame() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'dist-e2e')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, '_proof-entry.jsx')
    writeFileSync(entry, ENTRY)
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      plugins: [wire],
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry, formats: ['iife'], name: 'WWProofBundle', fileName: 'proof' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the proof build produced no script')
    return { js, css }
  })()
  return bundle
}

const week = (start: string, end: string, n: number, mean: number | null) => ({ start, end, days_logged: n, mean })
const API: Record<string, unknown> = {
  '/api/mission/status': {
    date: TODAY, rank: { rank: 'E' }, level: { level: 3, into: 40, need: 100 }, xp: 340,
    stats: ['Knowledge', 'Focus', 'Consistency', 'Proof', 'Recall', 'Vitality'].map((n, i) => ({ id: n.toLowerCase(), name: n, value: i % 2 ? 4 : 0, explain: `${n} is counted from logged work.` })),
    not_counted: { xp_from_games: 20, xp_carried_over: 0, nodes_claimed: [], explain: 'XP from games has no logged action behind it.' },
    domains: [{ id: 'fitness', name: 'Fitness', status: 'off' }, { id: 'money', name: 'Money: skills for income', status: 'planned', why: 'Needs a source of real evidence first.' }],
  },
  '/api/mission/status/v2': {
    date: TODAY,
    series: [
      { id: 'water', name: 'Glasses of water', want: 'more', weeks: [week('a', 'b', 0, null), week('c', 'd', 3, 4), week('e', 'f', 0, null), week('g', 'h', 5, 6)], points: [4, 6], weeks_with_data: 2, enough_for_line: true },
      { id: 'read', name: 'Pages read', want: 'more', weeks: [week('a', 'b', 0, null), week('c', 'd', 0, null), week('e', 'f', 0, null), week('g', 'h', 0, null)], points: [], weeks_with_data: 0, enough_for_line: false },
    ],
    weeks_note: 'A line needs 2 weeks with logged days; a week with none is left out, never drawn as 0.',
    consistency: { window_days: 28, counters: [{ id: 'water', name: 'Glasses of water', logged: 8, asked: 8, hit: 6, ratio: 0.75, need: 0 }], hit: 6, asked: 8, ratio: 0.75, rule: 'A day counts when the counter was logged that day.' },
    rank: { rank: 'E', next: 'D', target: 'D', top: false, met: 1, of: 2, requirements: [{ req: 'hours', name: 'focus hours logged', have: 4, need: 10, met: false }, { req: 'nodes', name: 'skill-tree nodes mastered with a finished contract', have: 1, need: 1, met: true }] },
    suggestions: [{ id: 'unproven', text: 'Some nodes are marked mastered without a finished contract.', go: { ws: 'tree', view: null, label: 'Go to Tree' }, basis: 'a rule' }],
    recent: [{ date: TODAY, count: 2, xp: 40, minutes: 65, rows: [{ kind: 'contract', label: 'Unit 2 problems', xp: 30, minutes: 45, link: false }], more: 0, zero_xp: { count: 1, minutes: 5, kinds: ['quest'] } }],
    wins: [{ date: '2026-11-06', kind: 'node', what: 'Mastered', label: 'n.alpha', link: false, xp: 50 }],
    advice: [{ id: 'if-then-plan', text: 'Write the plan as a sentence with a trigger.', source: { author: 'A. Author', work: 'A paper about plans', year: 1999, kind: 'journal article' }, strength: 'theory', strength_note: 'an explanation put forward', limit: 'Short studies only.' }],
  },
  '/api/mission/weekly': { status: 'ok', week: { start: '2026-11-04', end: TODAY }, totals: '3/7 active days, 120 minutes', moved: [], stalled: [], change: { rule: 'keep', text: 'Next week: keep the plan.' }, say: '' },
  '/api/mission/engine/sessions': { status: 'ok', say: 'Building today: 40 minutes.', today_minutes: 40, week_minutes: 150, week_areas: { aankhen: 90 }, model: { explain: 'Commits less than 90 min apart are one session.' } },
  '/api/mission/engine/proof': { status: 'ok', configured: false, say: "I don't know your GitHub username yet." },
}

async function openFrame(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  const { js, css } = await buildFrame()
  const font = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace}`
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html data-motion="auto"><head><meta charset="utf-8"><style>${font}</style><style>${css}</style></head><body style="margin:0"><main class="main" style="position:fixed;inset:0"><div id="root" style="position:absolute;inset:0"></div></main><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => {
    const p = new URL(route.request().url()).pathname
    if (p.startsWith('/api/kv')) return route.fulfill({ contentType: 'application/json', body: '{"value":null}' })
    if (p in API) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(API[p]) })
    return route.fulfill({ contentType: 'text/html', body: doc })
  })
  await page.goto(URL_)
  await page.evaluate(() => (window as unknown as { WWFrame: { mount(el: HTMLElement, o: object): void } }).WWFrame.mount(document.getElementById('root')!, {}))
  await page.waitForSelector('.ww-frame [role="tab"]')
}

/** WW_SHOT_DIR=<folder> keeps a picture of each state for a human to look at; without it nothing is written. */
const shot = async (page: Page, name: string) => {
  if (process.env.WW_SHOT_DIR) await page.screenshot({ path: resolve(process.env.WW_SHOT_DIR, name + '.png') })
}

const IDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']
const cardIds = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card')))
/** The workspace centre must not scroll (the owner's 10 Nov rule), and neither may the page. */
const noPageScroll = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('.ww-centre') as HTMLElement
    const d = document.documentElement
    return { centreY: c.scrollHeight - c.clientHeight, centreX: c.scrollWidth - c.clientWidth, pageY: d.scrollHeight - d.clientHeight, pageX: d.scrollWidth - d.clientWidth }
  })

for (const [w, h, col] of [[1500, 800, 320], [1920, 1080, 360]] as const) {
  test(`${w}x${h}: the panel is pinned as a ${col} px column with all ten cards, no stub, and the centre does not scroll`, async ({ page }) => {
    await openFrame(page, w, h)
    await expect(page.locator('[data-proof="stub"]'), 'ProofRail still draws chunk 4\'s stub: the 2-line patch from the build note is missing').toHaveCount(0)
    const aside = page.locator('aside.ww-right')
    await expect(aside).toHaveAttribute('data-mode', 'pinned')
    await expect(page.locator('.ww-sheet')).toHaveCount(0) // pinned is a column, not a drawer
    await expect.poll(() => cardIds(page)).toEqual(IDS)
    const box = await aside.boundingBox()
    expect(Math.round(box!.width)).toBe(col)
    // inside the column: nothing wider than the column, and the column scrolls itself
    const inner = await aside.evaluate((el) => ({ over: el.scrollWidth - el.clientWidth, scrolls: el.scrollHeight > el.clientHeight }))
    expect(inner.over).toBe(0)
    expect(inner.scrolls).toBe(true)
    expect(await noPageScroll(page)).toEqual({ centreY: 0, centreX: 0, pageY: 0, pageX: 0 })
    // a pinned panel owns no primary: Open review is drawn quiet
    expect(await page.locator('aside.ww-right [data-primary]').count()).toBe(0)
    expect(await page.locator('aside.ww-right button', { hasText: 'Open review' }).count()).toBe(1)
    await shot(page, `pinned-${w}`)
  })
}

test('1366x768: the rail is 56 px, opens a 320 px sheet with all ten cards, and Esc closes it', async ({ page }) => {
  await openFrame(page, 1366, 768)
  const aside = page.locator('aside.ww-right')
  await expect(aside).toHaveAttribute('data-mode', 'rail')
  expect(Math.round((await aside.boundingBox())!.width)).toBe(56)
  expect(await cardIds(page)).toEqual([]) // nothing is drawn until the rail is opened
  const opener = page.locator('button[aria-label="Open Proof"]')
  await opener.click()
  await expect.poll(() => cardIds(page)).toEqual(IDS)
  await expect(page.locator('.ww-sheet')).toHaveAttribute('data-state', 'open')
  const sheet = await page.locator('.ww-sheet').boundingBox()
  expect(Math.round(sheet!.width), 'the sheet is the 320 px panel of plan 4.10, not the drawer default').toBe(320)
  const body = await page.locator('.ww-sheet-body').evaluate((el) => ({ over: el.scrollWidth - el.clientWidth, scrolls: el.scrollHeight > el.clientHeight }))
  expect(body).toEqual({ over: 0, scrolls: true })
  // the sheet takes the one fill: "Open review"
  await expect(page.locator('[data-primary]')).toHaveCount(1)
  await expect(page.locator('[data-primary]')).toHaveText('Open review')
  expect(await noPageScroll(page)).toEqual({ centreY: 0, centreX: 0, pageY: 0, pageX: 0 })
  await shot(page, 'rail-open-1366')
  await page.keyboard.press('Escape')
  await expect(page.locator('.ww-sheet')).toHaveAttribute('data-state', 'closed')
})

test('1366x768: a suggestion closes the sheet and lands on its workspace', async ({ page }) => {
  await openFrame(page, 1366, 768)
  await page.locator('button[aria-label="Open Proof"]').click()
  await page.locator('[data-card="P2"] button', { hasText: 'Go to Tree' }).click()
  await expect(page.locator('.ww-centre')).toHaveAttribute('data-ws', 'tree')
  await expect(page.locator('.ww-sheet')).toHaveAttribute('data-state', /closing|closed/)
})

test('every control in the panel has a 44 px hit area at 1500', async ({ page }) => {
  await openFrame(page, 1500, 800)
  await expect.poll(() => cardIds(page)).toEqual(IDS)
  const n = await page.locator('aside.ww-right button').count()
  expect(n).toBeGreaterThan(5)
  const small: string[] = []
  for (let i = 0; i < n; i++) {
    const label = await page.locator('aside.ww-right button').nth(i).evaluate((el) => `${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)} ${Math.round(el.getBoundingClientRect().height)}px`)
    await page.locator('aside.ww-right button').nth(i).scrollIntoViewIfNeeded()
    const b = await effectiveBox(page, 'aside.ww-right button', i)
    // a 2 px probe grid reads up to 2 px short; 44 real shows as 42 or more
    if (!b || b.h < 42) small.push(`${i}: ${label} -> ${b?.h ?? 'unreachable'}`)
  }
  expect(small, 'controls whose effective hit area is under 44 px').toEqual([])
})

test('the 4-week slot in the browser: a line for the counter with 2 weeks, words for the one with none', async ({ page }) => {
  await openFrame(page, 1500, 800)
  await expect.poll(() => cardIds(page)).toEqual(IDS)
  await expect(page.locator('[data-counter="water"] .ww-spark svg')).toHaveCount(1)
  await expect(page.locator('[data-counter="read"] .ww-spark')).toHaveCount(0)
  await expect(page.locator('[data-counter="read"]')).toContainText('No days logged yet')
})
