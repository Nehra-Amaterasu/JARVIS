// Package D03 in a real Chromium: the ledger table, the slot list and the detent rack on the page of e2e/d03/entry.tsx, built in
// memory by Vite and served from a fake origin (nothing is written near app/ui/dist; the sandbox the shared config starts is
// not used). Proved: the full keyboard paths (grid arrows, F2 edit, sort, expand and Esc; Alt+Up/Down and the lift; the
// rack's arrows, typeahead, Enter and Esc with aria-activedescendant), 44 px targets, the cards and the bottom sheet at 390 px,
// no horizontal overflow, no running animation and no animation frame at idle, forced colours keep edges and the selection.
// Screenshots for the jury go to D03_SHOTS (default test-results/d03); the jury run passes a folder outside the repository.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.D03_SHOTS ? resolve(process.env.D03_SHOTS) : resolve(ROOT, 'test-results', 'd03')
const URL_ = 'http://d03.test/'
const FONTS = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }

let bundle: Promise<{ js: string; css: string }> | null = null
function buildPage() {
  bundle ??= (async () => {
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'e2e/d03/entry.tsx'), formats: ['iife'], name: 'D03Page', fileName: 'd03' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the D03 page build produced no script')
    return { js, css }
  })()
  return bundle
}

async function open(page: Page, theme: 'light' | 'dark' = 'light', only?: string) {
  const { js, css } = await buildPage()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D03</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number }
    w.__raf = 0
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => { w.__raf++; return raf(cb) }
  })
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}${only ? `&only=${encodeURIComponent(only)}` : ''}`)
  await page.locator('#d3-root').waitFor()
  await page.waitForTimeout(450) // the seat-in animation of the slot list settles before anything is measured
}

const shot = async (page: Page, name: string, loc?: ReturnType<Page['locator']>) => {
  mkdirSync(SHOTS, { recursive: true })
  const path = resolve(SHOTS, name)
  if (loc) await loc.screenshot({ path })
  else await page.screenshot({ path, fullPage: true })
}
const form = (page: Page, entry: string, label: string) => page.locator(`[data-bench="data/${entry}"] [data-form^="${label}"]`)

test.describe('LedgerTable', () => {
  test.use({ viewport: DESKTOP })

  test('grid keys: arrows, sort, F2 edit, commit, cancel, expand and Esc', async ({ page }) => {
    await open(page)
    const f = form(page, 'LedgerTable', 'SIMULATED, sorted')
    const grid = f.locator('table[role="grid"]')
    // one tab stop: exactly one body or header cell carries tabindex 0
    expect(await grid.locator('[data-pos][tabindex="0"]').count()).toBe(1)
    await grid.locator('[data-pos="0:1"]').focus()
    await page.keyboard.press('ArrowDown')
    await expect(grid.locator('[data-pos="1:1"]')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(grid.locator('[data-pos="1:2"]')).toBeFocused()
    await page.keyboard.press('Control+Home')
    await expect(grid.locator('[data-pos="-1:1"]')).toBeFocused()
    // sort: Enter on a header sorts ascending, again descending, again clears
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(grid.locator('th[aria-sort="ascending"]')).toHaveCount(1)
    await expect(grid.locator('th[aria-sort="ascending"] .d3-glyph')).toHaveText('▲')
    await page.keyboard.press('Enter')
    await expect(grid.locator('th[aria-sort="descending"] .d3-glyph')).toHaveText('▼')
    // F2 edits an editable cell (the topic column), Enter commits
    await grid.locator('[data-pos="0:1"]').focus()
    await page.keyboard.press('F2')
    const input = grid.locator('.d3-input')
    await expect(input).toBeFocused()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Unit 9 · chai')
    await page.keyboard.press('Enter')
    await expect(grid.locator('td', { hasText: 'Unit 9 · chai' })).toHaveCount(1)
    await expect(grid.locator('.d3-input')).toHaveCount(0)
    // Esc cancels an edit
    await page.keyboard.press('F2')
    await page.keyboard.type('zzz')
    await page.keyboard.press('Escape')
    await expect(grid.locator('td', { hasText: 'zzz' })).toHaveCount(0)
    // a number cell refuses text
    await grid.locator('[data-pos="0:3"]').focus()
    await page.keyboard.press('F2')
    await page.keyboard.press('Control+A')
    await page.keyboard.type('abc')
    await page.keyboard.press('Enter')
    await expect(grid.locator('.d3-err')).toHaveText(/numbers only/)
    await page.keyboard.press('Escape')
    // the row button opens the drawer; Esc closes it and focus returns to the button
    await grid.locator('[data-pos="0:0"]').focus()
    await page.keyboard.press('Enter')
    const drawer = f.locator('.d3-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('button')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(grid.locator('[data-pos="0:0"]')).toBeFocused()
  })

  test('WAITING, FAULT and PLANNED draw no number and say why', async ({ page }) => {
    await open(page)
    for (const [label, word] of [['WAITING', 'WAITING'], ['FAULT', 'FAULT'], ['PLANNED', 'PLANNED']] as const) {
      const f = form(page, 'LedgerTable', label)
      await expect(f.locator('.d3-num')).toHaveCount(0)
      await expect(f.locator('.d3-spark')).toHaveCount(0)
      await expect(f.locator('.d3-meter')).toHaveCount(0)
      await expect(f.locator('.d3-hollow').first()).toBeVisible()
      await expect(f.locator('.d3-bar')).toContainText(word)
      await expect(f.locator('.d3-bar')).toContainText('Numbers are not drawn')
    }
    expect(await form(page, 'LedgerTable', 'SIMULATED, sorted').locator('.d3-num').count()).toBeGreaterThan(5)
  })

  test('the column chooser hides a column and keeps the pinned one', async ({ page }) => {
    await open(page)
    const f = form(page, 'LedgerTable', 'column chooser open')
    await expect(f.locator('th')).toHaveCount(1 + 5) // gutter + 6 columns minus the hidden trend
    const spark = f.locator('.d3-choice', { hasText: 'Last 12' }).locator('input')
    await spark.check()
    await expect(f.locator('th')).toHaveCount(1 + 6)
    await expect(f.locator('.d3-choice', { hasText: 'Topic' }).locator('input')).toBeDisabled()
    await f.locator('.d3-chooser').press('Escape')
    await expect(f.locator('.d3-chooser')).toHaveCount(0)
  })

  test('hit areas are 44 px and the row is 32 px with no zebra', async ({ page }) => {
    await open(page)
    const f = form(page, 'LedgerTable', 'SIMULATED, sorted')
    const small: string[] = []
    for (const sel of ['.d3-key', '.d3-rowbtn', '.d3-sort']) {
      for (const el of await f.locator(sel).all()) {
        const b = await el.boundingBox()
        if (b && (b.height < 43.5 || b.width < 43.5) && sel !== '.d3-sort') small.push(`${sel} ${b.width}x${b.height}`)
        if (b && b.height < 43.5) small.push(`${sel} ${b.width}x${b.height}`)
      }
    }
    expect(small).toEqual([])
    const td = await f.locator('tbody tr').first().locator('td').nth(1).boundingBox()
    expect(Math.round(td!.height)).toBeLessThanOrEqual(33)
    const bgs = await f.locator('tbody tr td:nth-child(2)').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
    expect(new Set(bgs).size).toBe(1)
  })

  test('under 900 px the table becomes cards with three fields and a 44 px button', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await open(page, 'light', 'data/LedgerTable')
    // the still form "drawer open on a row" keeps a drawer open, and its fixed scrim covers every other form on a phone
    await page.addStyleTag({ content: '[data-form^="drawer open"] { display: none }' })
    const f = form(page, 'LedgerTable', 'SIMULATED, sorted')
    await expect(f.locator('.d3-ledger')).toHaveAttribute('data-layout', 'cards')
    const card = f.locator('.d3-card').first()
    await expect(card.locator('.d3-kv-row')).toHaveCount(3)
    const b = await card.locator('.d3-card-more').boundingBox()
    expect(b!.height).toBeGreaterThanOrEqual(43.5)
    await card.locator('.d3-card-more').click()
    await expect(f.locator('.d3-drawer[data-place="sheet"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(f.locator('.d3-drawer')).toHaveCount(0)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    expect(over).toBeLessThanOrEqual(0)
  })
})

test.describe('SlotList', () => {
  test.use({ viewport: DESKTOP })

  test('Alt+Up and Alt+Down reorder, Space lifts with a dashed plate, Esc puts back', async ({ page }) => {
    await open(page)
    const f = form(page, 'SlotList', 'idle')
    const labels = () => f.locator('.d3s-label').allTextContents()
    expect((await labels())[0]).toBe('Read the unit notes')
    await f.locator('.d3s-row').first().focus()
    await page.keyboard.press('Alt+ArrowDown')
    expect((await labels()).slice(0, 2)).toEqual(['Solve ten questions', 'Read the unit notes'])
    await expect(f.locator('.d3s-row').nth(1)).toBeFocused() // the moved row keeps focus
    await expect(f.locator('[role="status"]')).toContainText('moved to position 2 of 5')
    await page.keyboard.press('Alt+ArrowUp')
    expect((await labels())[0]).toBe('Read the unit notes')
    // lift: Space picks up, the plate shows, ArrowDown carries, Esc puts it back
    await page.keyboard.press('Space')
    await expect(f.locator('.d3s-plate')).toHaveCount(1)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    expect((await labels())[2]).toBe('Read the unit notes')
    await page.keyboard.press('Escape')
    await expect(f.locator('.d3s-plate')).toHaveCount(0)
    expect((await labels())[0]).toBe('Read the unit notes')
    // lift again and drop at the new place
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    expect((await labels()).slice(0, 2)).toEqual(['Solve ten questions', 'Read the unit notes'])
    // arrows alone move focus between rows: one tab stop
    expect(await f.locator('.d3s-row[tabindex="0"]').count()).toBe(1)
  })

  test('a pointer drag on the grip reorders', async ({ page }) => {
    await open(page)
    const f = form(page, 'SlotList', 'idle')
    const grip = f.locator('.d3s-grip').first()
    await grip.scrollIntoViewIfNeeded()
    const b = (await grip.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 6 })
    await expect(f.locator('.d3s-plate')).toHaveCount(1)
    await page.mouse.up()
    const labels = await f.locator('.d3s-label').allTextContents()
    expect(labels[0]).not.toBe('Read the unit notes')
    expect(labels.indexOf('Read the unit notes')).toBeGreaterThanOrEqual(1)
  })
})

test.describe('DetentRack', () => {
  test.use({ viewport: DESKTOP })

  test('trigger, listbox keys, typeahead, Enter and Esc with aria-activedescendant', async ({ page }) => {
    await open(page)
    const f = form(page, 'DetentRack', 'closed')
    const trigger = f.locator('.d3r-trigger')
    await expect(trigger).toContainText('This week')
    await trigger.focus()
    await page.keyboard.press('Enter')
    const list = f.locator('[role="listbox"]')
    await expect(list).toBeFocused()
    const active = async () => list.evaluate((el) => document.getElementById(el.getAttribute('aria-activedescendant')!)?.textContent ?? '')
    expect(await active()).toContain('This week')
    await page.keyboard.press('ArrowDown')
    expect(await active()).toContain('This month')
    await page.keyboard.press('End')
    expect(await active()).toContain('This term') // 'Everything' is disabled and skipped
    await page.keyboard.press('Home')
    expect(await active()).toContain('Today')
    await page.keyboard.type('this m')
    expect(await active()).toContain('This month')
    await page.keyboard.press('Enter')
    await expect(list).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toContainText('This month')
    // Esc closes without changing
    await page.keyboard.press('ArrowDown')
    await expect(list).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await expect(trigger).toContainText('This month')
    // there is no native select anywhere on the page
    expect(await page.locator('select').count()).toBe(0)
  })

  test('rows are 44 px, the rack is at most 320 px, and a click picks', async ({ page }) => {
    await open(page)
    const f = form(page, 'DetentRack', 'open')
    const rows = await f.locator('[role="option"]').all()
    expect(rows.length).toBe(5)
    for (const r of rows) expect(Math.round((await r.boundingBox())!.height)).toBeGreaterThanOrEqual(44)
    expect((await f.locator('[role="listbox"]').boundingBox())!.width).toBeLessThanOrEqual(320.5)
    await f.locator('[role="option"]', { hasText: 'This term' }).click()
    await expect(f.locator('.d3r-trigger')).toContainText('This term')
  })

  test('grouped: the gutter draws ├─ and └─', async ({ page }) => {
    await open(page)
    const g = await form(page, 'DetentRack', 'grouped').locator('.d3r-gut').allTextContents()
    expect(g.filter((x) => x === '├─').length).toBe(3)
    expect(g.filter((x) => x === '└─').length).toBe(3)
  })

  test('under 900 px the rack is a bottom sheet with a cancel key', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await open(page, 'light', 'data/DetentRack')
    const trigger = page.locator('[data-form="closed"] .d3r-trigger')
    await trigger.click()
    const sheet = page.locator('.d3r-sheet[role="dialog"]')
    await expect(sheet).toBeVisible()
    // the sheet slides up: poll until it has settled on the bottom edge instead of reading it mid-motion
    await expect.poll(async () => { const b = (await sheet.boundingBox())!; return Math.round(b.y + b.height) }).toBe(PHONE.height)
    await shot(page, 'detent-sheet-390-light.png')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(sheet).toHaveCount(0)
    await expect(trigger).toContainText('This month')
  })
})

test.describe('idle, forced colours and the jury pictures', () => {
  test('no animation frame and no running animation at idle', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await open(page)
    await page.waitForTimeout(600)
    const before = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    await page.waitForTimeout(800)
    const after = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    expect(after - before).toBe(0)
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0)
  })

  test('forced colours keep an edge on the plate, the keys and the rack, and a visible selection', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await page.emulateMedia({ forcedColors: 'active' })
    await open(page)
    const f = form(page, 'LedgerTable', 'SIMULATED, sorted')
    const w = await f.locator('.d3-ledger').evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth))
    expect(w).toBeGreaterThan(0)
    const k = await f.locator('.d3-key').first().evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth))
    expect(k).toBeGreaterThan(0)
    const r = await form(page, 'DetentRack', 'open').locator('[role="listbox"]').evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth))
    expect(r).toBeGreaterThan(0)
    await f.locator('td[data-pos="0:1"]').focus()
    await page.keyboard.press('Space')
    await expect(f.locator('tr[aria-selected="true"]')).toHaveCount(1)
    await shot(page, 'forced-colors-1366.png')
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`jury pictures, ${theme}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP)
      await page.emulateMedia({ colorScheme: theme })
      await open(page, theme)
      await shot(page, `d03-1366-${theme}-all.png`)
      await shot(page, `ledger-simulated-1366-${theme}.png`, form(page, 'LedgerTable', 'SIMULATED, sorted'))
      await shot(page, `ledger-drawer-1366-${theme}.png`, form(page, 'LedgerTable', 'drawer open'))
      await shot(page, `ledger-waiting-1366-${theme}.png`, form(page, 'LedgerTable', 'WAITING'))
      await shot(page, `slots-1366-${theme}.png`, page.locator('[data-bench="data/SlotList"]'))
      await shot(page, `rack-1366-${theme}.png`, page.locator('[data-bench="data/DetentRack"]'))
      await page.setViewportSize(PHONE)
      await page.waitForTimeout(250)
      await shot(page, `d03-390-${theme}-all.png`)
      await shot(page, `ledger-cards-390-${theme}.png`, form(page, 'LedgerTable', 'SIMULATED, sorted'))
    })
  }
})
