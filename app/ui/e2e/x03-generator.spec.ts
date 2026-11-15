// Package X03 in a real Chromium: the practice-paper maker of the gallery entry "X03" (invented blueprints and questions, SIMULATED).
// Built in memory by Vite from a virtual entry that draws one state of the entry bare in the shell canvas (nothing is written near dist, no
// port is used by the page). Proves:
//   geometry   the desk at the shell canvas size (1230 x 664) has no inner scrollbar and no clipped part in any of its three steps, with
//              seven sections too; every stepper and tab of the desk is 44 px or more; at 390 px it is one column with no sideways scroll
//   lamps      an unbalanced blueprint shows FAULT with its reason and drawing is refused with that reason; the null adapter shows WAITING
//   slots      a hollow slot is drawn hollow with its reason and is never padded; a reseed draws another paper from a printed seed
//   print      the preview's section count equals the print frame's; the frame holds the paper and nothing else (no shell); a question
//              whose text is not checked prints as its crop; the header sentence, the SIMULATED stamp and the seed are on the sheet;
//              Chromium turns the frame's document into an A4 PDF; the print button asks the frame to print
//   shell      with the flag on, study.practice opens this desk (skips when dist-e2e is not built)
// Screenshots go to X03_SHOTS when it is set (outside the repository), else nowhere.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.X03_SHOTS ? resolve(process.env.X03_SHOTS) : ''
const URL_ = 'http://x03.test/'
const FONTS = "html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}"

// states of the gallery entry (the order of gallery/entries/X03.tsx)
const S = { balanced: 0, unbalanced: 1, waiting: 2, inferred: 3, seven: 4, slots: 5, model: 6, printPaper: 7, printKey: 8, printMarking: 9, table: 10, tableFault: 11, strip: 12, skeleton: 13, sheet: 14, sheets: 15 } as const

const ENTRY_ID = resolve(ROOT, 'e2e', '.x03-entry.tsx')
const entrySource = (root: string) => `
import '${root}/src/styles/design/clay/index.css'
import '${root}/src/ww/design/base.css'
import '${root}/src/ww/kit/kit.css'
import { createRoot } from 'react-dom/client'
import list from '${root}/src/gallery/entries/X03'
const q = new URLSearchParams(location.search)
const THEME = q.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', 'clay-' + THEME)
document.documentElement.setAttribute('data-legacy-styles', '')
if (THEME === 'light') document.body.setAttribute('data-ww-theme', 'paper')
document.body.style.margin = '0'
document.body.style.background = 'var(--surface-ground)'
const w = Number(q.get('w')) || 0
const node = list[0].states[Number(q.get('state') || 0)].node
const style = w ? { position: 'relative', width: w, padding: 12, boxSizing: 'border-box' } : { position: 'absolute', left: 64, top: 48, width: 1302, height: 720 }
createRoot(document.getElementById('root')).render(<div style={style} data-stage>{node}</div>)
`

let bundle: Promise<{ js: string; css: string }> | null = null
function buildPage() {
  bundle ??= (async () => {
    const root = ROOT.split(String.fromCharCode(92)).join('/')
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      plugins: [{ name: 'x03-entry', resolveId: (id: string) => (id === ENTRY_ID ? id : null), load: (id: string) => (id === ENTRY_ID ? entrySource(root) : null) }],
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: ENTRY_ID, formats: ['iife'], name: 'X03Page', fileName: 'x03' } },
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

const shot = async (page: Page, sel: string, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.locator(sel).first().screenshot({ path: resolve(SHOTS, name) })
}

/** Open state i of the entry. `w` draws it at that width (the phone); without it the shell canvas box is used. */
async function state(page: Page, i: number, theme: 'light' | 'dark' = 'light', w = 0) {
  const { js, css } = await buildPage()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>X03</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.unroute(`${URL_}**`).catch(() => undefined)
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}&state=${i}${w ? `&w=${w}` : ''}`)
  await page.locator('.gx-desk, .x03-part, .x03-sheet').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}

/** Boxes of the desk that fall outside it, and inner scroll: the "one canvas" check. */
const fit = (page: Page) => page.evaluate(() => {
  const box = document.querySelector<HTMLElement>('.x03-box')!
  const inner = document.querySelector<HTMLElement>('.gx-desk-in')!
  const b = box.getBoundingClientRect()
  const outside = [...box.querySelectorAll<HTMLElement>('*')].filter((e) => {
    const r = e.getBoundingClientRect()
    if (e.closest('.gx-prev, .gx-frame, .gx-page, svg') && e !== box) return false
    return r.width > 0 && r.height > 0 && (r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.top < b.top - 1) && getComputedStyle(e).position !== 'fixed'
  }).map((e) => `${e.tagName.toLowerCase()}.${e.className.toString().slice(0, 40)}`)
  const cols = [...document.querySelectorAll<HTMLElement>('.gx-left, .gx-right, .gx-bt, .gx-ss-panel, .gx-ss-rail, .gx-prev-card')].map((c) => `${c.className.toString().slice(0, 18)} ${c.scrollHeight - c.clientHeight}`)
  const dbg = ['.gx-top', '.gx-main', '.gx-left', '.gx-right', '.gx-foot', '.gx-ss', '.gx-bar'].map((q) => { const e = document.querySelector(q); if (!e) return q + ' -'; const r = e.getBoundingClientRect(); return q + ' ' + Math.round(r.top - b.top) + '..' + Math.round(r.bottom - b.top) }).join(' | ')
  return { dbg, boxW: Math.round(b.width), boxH: Math.round(b.height), innerY: inner.scrollHeight - inner.clientHeight, innerX: inner.scrollWidth - inner.clientWidth, docY: document.documentElement.scrollHeight - innerHeight, outside, cols }
})

const small = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll<HTMLElement>(s)]
  .map((e) => ({ c: e.className.toString().slice(0, 30), r: e.getBoundingClientRect() }))
  .filter((x) => x.r.width > 0 && (x.r.width < 43.5 || x.r.height < 43.5))
  .map((x) => `${x.c} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`), sel)

test.describe('X03 geometry', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  for (const theme of ['light', 'dark'] as const) {
    test(`each step fits the canvas with no inner scroll (${theme})`, async ({ page }) => {
      const steps: [number, string][] = [[S.balanced, 'blueprint'], [S.seven, 'blueprint-seven'], [S.slots, 'slots'], [S.printPaper, 'print'], [S.waiting, 'waiting'], [S.unbalanced, 'unbalanced']]
      for (const [i, name] of steps) {
        await state(page, i, theme)
        const m = await fit(page)
        await shot(page, '.x03-box', `${name}-${theme}.png`)
        expect(m.boxW).toBe(1230)
        expect(m.boxH).toBe(664)
        expect(m.docY, `${name}: the document scrolls`).toBeLessThanOrEqual(0)
        expect(m.innerY, `${name}: the desk scrolls inside; ${m.dbg}`).toBeLessThanOrEqual(1)
        expect(m.innerX).toBeLessThanOrEqual(1)
        expect(m.outside, `${name}: parts outside the canvas`).toEqual([])
        for (const c of m.cols) expect(Number(c.split(' ').pop()), `${name}: ${c}`).toBeLessThanOrEqual(1)
      }
    })
  }

  test('steppers, tabs and the name fields are 44 px or more', async ({ page }) => {
    await state(page, S.balanced)
    expect(await small(page, '.gx-step-btn, .gx-step-val, .gx-name, .gx-ss-tab')).toEqual([])
    await state(page, S.slots)
    expect(await small(page, '.gx-ss-tab, .gx-slot, .gx-step-btn')).toEqual([])
  })

  test('the blueprint step is the lamp, the table and the preview, with one warm button', async ({ page }) => {
    await state(page, S.balanced)
    await expect(page.locator('.gx-inv')).toContainText('balanced: 60 marks')
    await expect(page.locator('.gx-inv .k-lamp-word')).toHaveText('SIMULATED')
    await expect(page.locator('.gx-bt-lamp .k-lamp-word')).toHaveText('SIMULATED')
    expect(await page.locator('.gx-row').count()).toBe(3)
    expect(await page.locator('[data-primary]').count()).toBe(1)
    await expect(page.locator('.gx-fact-mpm .gx-fact-v')).toHaveText('2.0')
  })
})

test.describe('X03 lamps and refusals', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('an unbalanced blueprint shows FAULT with its reason and drawing is refused with that reason', async ({ page }) => {
    await state(page, S.unbalanced)
    await expect(page.locator('.gx-inv .k-lamp-word')).toHaveText('FAULT')
    await expect(page.locator('.gx-issues')).toContainText('55 marks')
    const cta = page.getByRole('button', { name: /Confirm and draw a paper/ })
    await expect(cta).toHaveAttribute('aria-disabled', 'true')
    await cta.click({ force: true })
    await expect(page.locator('[data-step="blueprint"]')).toBeVisible()
    await expect(page.locator('.gx-main-bp')).toContainText('does not balance')
    // the second step cannot be reached either
    await expect(page.getByRole('radio', { name: /2 Slots/ })).toHaveAttribute('aria-disabled', 'true')
  })

  test('the null adapter shows WAITING and an empty step with its reason, nothing invented', async ({ page }) => {
    await state(page, S.waiting)
    await expect(page.locator('.gx-empty .k-lamp-word').first()).toHaveText('WAITING')
    await expect(page.locator('.gx-empty')).toContainText('No blueprint yet')
    await expect(page.locator('.gx-empty')).toContainText('Waiting: a blueprint is inferred from a paper on file')
    expect(await page.locator('.gx-row').count()).toBe(0)
    await page.getByRole('button', { name: 'Start by hand' }).click()
    await expect(page.locator('.gx-row')).toHaveCount(1)
    // a hand-built draft cannot be saved yet, and says so
    await expect(page.getByRole('button', { name: /Confirm and draw a paper/ })).toHaveAttribute('aria-disabled', 'true')
  })

  test('a rule can propose a blueprint, which stays RULE and unsaved until confirmed', async ({ page }) => {
    await state(page, S.inferred)
    await expect(page.locator('.gx-chip-rule')).toContainText('RULE, not saved')
    expect(await page.locator('.gx-row').count()).toBe(3)
  })
})

test.describe('X03 slots', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('a hollow slot is hollow with its reason, and a reseed draws another paper from a printed seed', async ({ page }) => {
    await state(page, S.slots)
    await expect(page.locator('.gx-ss-status')).toContainText('slots filled')
    await expect(page.locator('.gx-ss-status .k-lamp-word')).toHaveText('SIMULATED')
    await page.getByRole('tab', { name: /Section C/ }).click()
    const hollow = page.locator('.gx-slot[data-hollow="true"]')
    await expect(hollow).toHaveCount(1)
    await expect(hollow).toContainText('too few reviewed questions')
    await expect(hollow.locator('.gx-src')).toContainText('HOLLOW')
    expect(await hollow.locator('.gx-slot-main b').innerText()).toBe('Left hollow')
    await shot(page, '.x03-box', 'slots-hollow.png')
    await page.getByRole('tab', { name: /Section A/ }).click()
    const before = await page.locator('.gx-slot-main b').allInnerTexts()
    const seedBefore = await page.getByRole('textbox', { name: 'Seed', exact: true }).inputValue()
    expect(seedBefore).toBe('48271')
    await page.getByRole('button', { name: /^Reseed/ }).click()
    await expect(page.getByRole('textbox', { name: 'Seed', exact: true })).not.toHaveValue(seedBefore)
    await expect.poll(async () => (await page.locator('.gx-slot-main b').allInnerTexts()).join('|')).not.toBe(before.join('|'))
    // the same seed again draws the same paper
    const seed = await page.getByRole('textbox', { name: 'Seed', exact: true }).inputValue()
    const after = (await page.locator('.gx-slot-main b').allInnerTexts()).join('|')
    await page.getByRole('button', { name: 'Draw with this seed' }).click()
    await expect.poll(async () => page.getByRole('textbox', { name: 'Seed', exact: true }).inputValue()).toBe(seed)
    expect((await page.locator('.gx-slot-main b').allInnerTexts()).join('|')).toBe(after)
  })

  test('a model draft is dashed and says it is not the student\'s decision yet', async ({ page }) => {
    await state(page, S.model)
    await page.getByRole('tab', { name: /Section B/ }).click()
    const m = page.locator('.gx-slot[data-src="model"]')
    await expect(m).toHaveCount(1)
    await expect(m).toContainText('not yet your decision')
    expect(await m.evaluate((e) => getComputedStyle(e).borderStyle)).toBe('dashed')
    await shot(page, '.x03-box', 'slots-model.png')
  })
})

test.describe('X03 keyboard', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('a stepper is one tab stop; arrows change it; the lamp follows; Alt+Down moves the section; Confirm draws', async ({ page }) => {
    await state(page, S.balanced)
    const set = page.getByRole('spinbutton', { name: 'Questions set, Section A' })
    await set.focus()
    await page.keyboard.press('ArrowUp')
    await expect(set).toHaveAttribute('aria-valuenow', '11')
    await expect(page.locator('.gx-inv .k-lamp-word')).toHaveText('FAULT')
    await expect(page.locator('.gx-issues')).toContainText('62 marks')
    await expect(page.getByRole('button', { name: /Confirm and draw a paper/ })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.gx-inv .k-lamp-word')).toHaveText('SIMULATED')
    await page.keyboard.press('Alt+ArrowDown')
    await expect(page.locator('.gx-name').nth(1)).toHaveValue('Section A')
    await page.getByRole('button', { name: /Confirm and draw a paper/ }).click()
    await expect(page.locator('[data-step="slots"]')).toBeVisible()
    await expect(page.locator('.gx-slot').first()).toBeVisible()
    await page.getByRole('radio', { name: /3 Print/ }).click()
    await expect(page.locator('[data-step="print"]')).toBeVisible()
  })

  test('the sections rail is one tab stop with arrows', async ({ page }) => {
    await state(page, S.slots)
    const tabs = page.getByRole('tab')
    expect(await tabs.count()).toBe(3)
    await tabs.first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(tabs.nth(1)).toBeFocused()
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.first()).toHaveAttribute('tabindex', '-1')
  })
})

test.describe('X03 print', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  const inFrame = <T,>(page: Page, fn: (d: Document) => T) => page.evaluate(`(() => { const f = document.querySelector('iframe[data-print-frame]'); const d = f && f.contentDocument; return d ? (${fn.toString()})(d) : null })()`) as Promise<T | null>

  test('the preview and the print frame are the same sheet: same sections, header, seed and stamp; the frame holds the paper only', async ({ page }) => {
    await state(page, S.printPaper)
    expect(await page.locator('.gx-prev [data-print-section]').count()).toBe(3)
    await expect.poll(() => inFrame(page, (d) => d.querySelectorAll('[data-print-section]').length)).toBe(3)
    const html = (await inFrame(page, (d) => d.documentElement.outerHTML)) ?? ''
    expect(html).toContain('Practice paper from your bank. Not an official paper.')
    expect(html).toContain('SIMULATED')
    expect(html).toContain('Seed 48271')
    expect(html).toContain('@page{size:A4;margin:18mm}')
    expect(html, 'the sheet stylesheet reached the frame').toContain('.gx-sheet')
    expect(await inFrame(page, (d) => [...d.body.children].map((c) => c.className))).toEqual(['gx-doc'])
    // the frame is not drawn by the app
    const box = await page.locator('iframe[data-print-frame]').boundingBox()
    expect(box!.width * box!.height).toBe(0)
    // every section name of the blueprint is on the sheet, hollow slots are gaps, and nothing is padded
    for (const n of ['Section A', 'Section B', 'Section C']) expect(html).toContain(n)
    expect(await inFrame(page, (d) => d.querySelectorAll('.gx-q').length)).toBe(18)
    expect(await inFrame(page, (d) => d.querySelectorAll('.gx-q[data-hollow] .gx-gap').length)).toBe(1)
    await shot(page, '.x03-box', 'print-step.png')
  })

  test('a question whose text is not checked prints as its crop and never as text', async ({ page }) => {
    await state(page, S.printPaper)
    const note = await page.locator('.gx-pnote').filter({ hasText: 'as the page crop' }).innerText()
    const n = Number(/^(\d+) question/.exec(note)![1])
    expect(n).toBeGreaterThan(0)
    await expect.poll(() => inFrame(page, (d) => d.querySelectorAll('.gx-q[data-crop]').length)).toBe(n)
    expect(await inFrame(page, (d) => d.querySelectorAll('img.gx-crop').length)).toBe(n)
    expect(await inFrame(page, (d) => d.querySelectorAll('.gx-q[data-crop] .gx-text').length)).toBe(0)
  })

  test('Chromium turns the frame\'s document into an A4 PDF with the same sections; the print button asks the frame to print', async ({ page, context }) => {
    await state(page, S.printPaper)
    await expect.poll(() => inFrame(page, (d) => d.querySelectorAll('[data-print-section]').length)).toBe(3)
    const html = (await inFrame(page, (d) => '<!doctype html>' + d.documentElement.outerHTML)) ?? ''
    const pdfPage = await context.newPage()
    await pdfPage.setContent(html)
    await pdfPage.emulateMedia({ media: 'print' })
    expect(await pdfPage.locator('[data-print-section]').count()).toBe(3)
    const pdf = await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true })
    const text = pdf.toString('latin1')
    expect(text.startsWith('%PDF-')).toBe(true)
    const mb = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text)!
    expect(Math.round(Number(mb[1]))).toBe(595)
    expect(Math.round(Number(mb[2]))).toBe(842)
    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1)
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await pdfPage.setViewportSize({ width: 794, height: 1123 })
      await pdfPage.screenshot({ path: resolve(SHOTS, 'printed-page.png') })
    }
    await pdfPage.close()
    // the button asks the frame's window to print
    await page.evaluate(() => {
      const w = (document.querySelector('iframe[data-print-frame]') as HTMLIFrameElement).contentWindow as Window & { __n?: number }
      w.print = () => { w.parent.document.title = 'printed' }
    })
    await page.getByRole('button', { name: 'Print or save as PDF' }).click()
    await expect(page).toHaveTitle('printed')
  })

  test('the key and the marking sheet list every slot of the paper; the night sheet is planned', async ({ page }) => {
    await state(page, S.printKey)
    await expect.poll(() => inFrame(page, (d) => d.querySelectorAll('.gx-grid tbody tr').length)).toBe(18)
    expect(await inFrame(page, (d) => d.body.innerText)).toContain('answer key')
    await expect(page.locator('.gx-night .k-lamp-word')).toHaveText('PLANNED')
    await state(page, S.printMarking)
    await expect.poll(() => inFrame(page, (d) => d.querySelectorAll('.gx-grid tbody tr').length)).toBe(18)
    expect(await inFrame(page, (d) => d.body.innerText)).toContain('marking sheet')
    await shot(page, '.x03-box', 'print-marking.png')
  })
})

test.describe('X03 on a phone and under the media branches', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const [i, name] of [[S.balanced, 'blueprint'], [S.slots, 'slots'], [S.printPaper, 'print'], [S.table, 'table']] as const) {
    test(`${name} is one column at 390 px with no sideways scroll`, async ({ page }) => {
      await state(page, i, 'light', 390)
      const m = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>('.gx-main')
        return { x: document.documentElement.scrollWidth - innerWidth, cols: main ? getComputedStyle(main).gridTemplateColumns.split(' ').length : 1, over: [...document.querySelectorAll<HTMLElement>('.gx-desk *, .x03-part *')].filter((e) => !e.closest('.gx-prev, svg, .gx-frame') && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className.toString().slice(0, 30)) }
      })
      expect(m.over).toEqual([])
      expect(m.x).toBeLessThanOrEqual(0)
      expect(m.cols).toBe(1)
      await shot(page, '[data-stage]', `phone-${name}.png`)
    })
  }

  test('reduced motion removes the slot rise; forced colours keep every card outlined and every hollow slot dashed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await state(page, S.slots, 'light', 390)
    expect(await page.locator('.gx-slot').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none')
    await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' })
    await state(page, S.slots, 'light', 390)
    expect(await page.locator('.gx-ss-panel').evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth))).toBeGreaterThanOrEqual(1)
    await page.getByRole('tab', { name: /Section C/ }).click()
    expect(await page.locator('.gx-slot[data-hollow="true"]').evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe('dashed')
  })
})

// ------------------------------------------------------------------------------------------------ the new shell
// The flag is set the way a person sets it (shell/flag.ts): the URL fragment `shell=v2` next to the sandbox token. Needs
// `vite build --outDir dist-e2e` first; skips otherwise.
test.describe('X03 under shell v2', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('study.practice opens the practice-paper maker; its null adapter says WAITING; no document scroll', async ({ page, baseURL }) => {
    const res = await fetch(baseURL!).catch(() => null)
    test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running')
    await page.goto('/#t=ww-e2e&shell=v2')
    await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
    if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
    await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', 'ww')
    await page.keyboard.press('Control+3')
    await page.waitForTimeout(200)
    await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur() })
    await page.keyboard.press(']')
    await expect(page.locator('.gx-desk')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.gx-desk-in')).toBeVisible()
    await expect(page.locator('.gx-empty .k-lamp-word').first()).toHaveText('WAITING')
    const s = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }))
    expect(s.sh).toBeLessThanOrEqual(s.ih)
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: resolve(SHOTS, 'shell-v2-practice.png') }) }
  })
})
