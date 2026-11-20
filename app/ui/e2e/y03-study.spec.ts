// Package Y03 in the real shell (flag on): Study > Plan, Study > dMAT and the classic Library face of Study > Library.
// For each view at 1366x768 and 390x844 it proves the geometry (no text under 11 px, no target under 44 px, nothing cut with an ellipsis, no label
// wrapped past two lines, no inner scroll on the laptop canvas, no sideways scroll at 390) and the keyboard path of the view.
// The sandbox shows whatever is stored there, so nothing on screen is copied into this file or into an assertion.
//
//   npx vite build --outDir dist-e2e
//   WW_SANDBOX_PORT=8824 WW_PREVIEW_PORT=5224 WW_SANDBOX_DIR="$TEMP/jarvis-y03-e2e" npx playwright test e2e/y03-study.spec.ts
// Y03_SHOTS=<folder outside the repository> also writes one picture per view and size.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from './fixtures'
import { PROBE, type Probe } from './probe'

const SHOTS = process.env.Y03_SHOTS ? resolve(process.env.Y03_SHOTS) : ''
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const STUDY = ['papers', 'practice', 'plan', 'library', 'dmat']

const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function openStudy(page: Page, baseURL: string | undefined, view: string) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  await blurText(page)
  if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', 'ww')
  await page.keyboard.press('Control+3')
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', 'study')
  for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
  for (let k = 0; k < STUDY.indexOf(view); k++) { await blurText(page); await page.keyboard.press(']') }
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', view)
}

async function measure(page: Page, at: string, w: number) {
  const m = (await page.evaluate(PROBE)) as Probe
  const out: string[] = []
  for (const k of ['small', 'targets', 'sideways', 'wraps', 'ellipsis'] as const) for (const d of m[k]) out.push(`${at} ${k}: ${d}`)
  if (m.docOverflow > 1) out.push(`${at} document overflow ${m.docOverflow}px`)
  if (w >= 1000) for (const d of m.innerY) out.push(`${at} inner scroll: ${d}`)
  return out
}

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, name) })
}

test.describe('Y03 geometry', () => {
  for (const size of SIZES) {
    test(`${size.w}x${size.h}: the plan view is readable, 44 px, on one canvas`, async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width: size.w, height: size.h })
      await openStudy(page, baseURL, 'plan')
      await page.locator('.ww-plan [data-card="study-plan"]').first().waitFor({ state: 'attached', timeout: 20_000 })
      await page.waitForTimeout(500)
      const problems = await measure(page, `plan ${size.w}`, size.w)
      if (size.w >= 1000) {
        const m = await page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('.y3-plan')!
          const box = root.getBoundingClientRect()
          const out = [...root.querySelectorAll<HTMLElement>('.y3-card')].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > box.bottom + 1 || r.right > box.right + 1 }).map((c) => c.dataset.card ?? c.className)
          // text that spills out of its plate is cut or overlaps the next one
          const spill = [...root.querySelectorAll<HTMLElement>('.y3-card')].filter((c) => c.scrollHeight > c.clientHeight + 1).map((c) => c.dataset.card ?? c.querySelector('.y3-title')?.textContent ?? '')
          return { out, spill, cards: root.querySelectorAll('.y3-card').length }
        })
        expect(m.cards).toBe(6)
        expect(m.out, 'a plate runs past the canvas').toEqual([])
        expect(m.spill, 'a plate holds more than it can show').toEqual([])
      } else {
        const cols = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.y3-card')].map((c) => Math.round(c.getBoundingClientRect().left)))
        expect(new Set(cols).size, 'one column at 390').toBe(1)
      }
      // text inside a drawing is scaled with the drawing, so measure the size it is painted at, not the size in its style
      const svgSmall = await page.evaluate(() => [...document.querySelectorAll<SVGTextElement>('.y3-plan svg text')].map((t) => ({ c: t.getAttribute('class') ?? 'text', px: parseFloat(getComputedStyle(t).fontSize) * (t.getScreenCTM()?.a ?? 1) })).filter((x) => x.px < 10.9).map((x) => `${x.c} ${x.px.toFixed(1)}px`))
      problems.push(...svgSmall.map((d) => `plan ${size.w} small drawn text: ${d}`))
      await shot(page, `plan-${size.w}.png`)
      expect(problems, problems.join('\n')).toEqual([])
    })

    test(`${size.w}x${size.h}: the dMAT view is readable, 44 px, on one canvas`, async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width: size.w, height: size.h })
      await openStudy(page, baseURL, 'dmat')
      await page.locator('.ww-dmat [data-card="study-dmat"]').first().waitFor({ state: 'attached', timeout: 20_000 })
      await page.waitForTimeout(500)
      const problems = await measure(page, `dmat ${size.w} setup`, size.w)
      await shot(page, `dmat-${size.w}.png`)
      // a running set and its score are on the same canvas
      const start = page.getByRole('button', { name: 'Start set' })
      if (await start.count()) {
        await start.click()
        await page.locator('[data-dmat-run]').waitFor({ timeout: 15_000 })
        await page.waitForTimeout(300)
        problems.push(...await measure(page, `dmat ${size.w} run`, size.w))
        await shot(page, `dmat-run-${size.w}.png`)
        await page.locator('.dm-run .ww-dmat-opt').first().click()
        await page.getByRole('button', { name: 'Finish and score' }).click()
        await page.locator('[data-dmat-result]').waitFor({ timeout: 15_000 })
        problems.push(...await measure(page, `dmat ${size.w} result`, size.w))
        await shot(page, `dmat-result-${size.w}.png`)
      }
      expect(problems, problems.join('\n')).toEqual([])
    })

    test(`${size.w}x${size.h}: the Library face is readable, 44 px, on one canvas`, async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width: size.w, height: size.h })
      await openStudy(page, baseURL, 'library')
      await page.getByRole('radiogroup', { name: 'Library face' }).getByRole('radio', { name: 'Library' }).click()
      await expect(page.locator('.ik-classic[data-face="library"]')).toBeVisible()
      await page.locator('.ww-library [data-card="study-findings"], .ww-library [data-findings-hidden]').first().waitFor({ state: 'attached', timeout: 20_000 })
      await page.waitForTimeout(600)
      const problems = await measure(page, `library ${size.w}`, size.w)
      await shot(page, `library-${size.w}.png`)
      expect(problems, problems.join('\n')).toEqual([])
    })
  }
})

test.describe('Y03 keyboard path', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('plan: blocks, wheel spokes, the rebuild question and the sheet by keys alone', async ({ page, baseURL }) => {
    await openStudy(page, baseURL, 'plan')
    await page.locator('.ww-plan [data-card="study-plan"]').first().waitFor({ state: 'attached', timeout: 20_000 })
    // the block rail is a group of buttons that say which one is chosen
    const blocks = page.locator('.y3-blk')
    if (await blocks.count()) {
      await blocks.first().focus()
      await page.keyboard.press('Enter')
      await expect(blocks.first()).toHaveAttribute('aria-pressed', 'true')
    }
    // the wheel is one tab stop; arrows step between papers and Enter chooses one
    const stops = await page.locator('.y3-spoke[tabindex="0"]').count()
    expect(stops === 0 || stops === 1, 'the wheel is one tab stop').toBe(true)
    if (stops === 1) {
      const n = await page.locator('.y3-spoke').count()
      await page.locator('.y3-spoke[tabindex="0"]').focus()
      if (n > 1) {
        await page.keyboard.press('ArrowRight')
        const second = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.paper)
        await page.keyboard.press('Enter')
        await expect(page.locator(`.y3-spoke[data-paper="${second}"]`)).toHaveAttribute('data-selected', 'true')
      }
    }
    // the gauges and the landscape plateaus are focusable and say they are pressed
    const plate = page.locator('.y3-pl').first()
    if (await plate.count()) {
      await page.locator('.y3-pl[tabindex="0"]').focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.y3-pl[aria-pressed="true"]')).toHaveCount(1)
    }
    // Rebuild asks first, and "Keep the plan" puts the footer back with nothing changed
    await page.getByRole('button', { name: "Rebuild today's plan" }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('group', { name: 'Confirm rebuild' })).toBeVisible()
    await page.getByRole('button', { name: 'Keep the plan' }).click()
    await expect(page.getByRole('group', { name: 'Confirm rebuild' })).toHaveCount(0)
    // the Why sheet opens over its plate, holds focus, and Escape gives the focus back
    const why = page.getByRole('button', { name: 'Why this order' })
    if (await why.count()) {
      await why.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog', { name: 'Why this order' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Why this order' })).toHaveCount(0)
      await expect(why).toBeFocused()
    }
  })

  test('dMAT: choose a kind, start, answer with the keys and finish', async ({ page, baseURL }) => {
    await openStudy(page, baseURL, 'dmat')
    await page.locator('.ww-dmat [data-card="study-dmat"]').first().waitFor({ state: 'attached', timeout: 20_000 })
    const kinds = page.getByRole('radiogroup', { name: 'Task kind' })
    if (!(await kinds.count())) return   // the dMAT routes are absent: the view shows its one-line placeholder
    await kinds.getByRole('radio').first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(kinds.getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Start set' }).focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-dmat-run]').waitFor({ timeout: 15_000 })
    const first = page.locator('.dm-run .ww-dmat-opt').first()
    await first.focus()
    await page.keyboard.press('Enter')
    await expect(first).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Finish and score' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-dmat-result]')).toBeVisible({ timeout: 15_000 })
  })
})


// ---------------------------------------------------------------------------------------------------------------------------------
// The gallery states of Y03 (invented data, SIMULATED) drawn bare in the shell canvas box. Built in memory by Vite from a virtual entry,
// the way y01-papers.spec.ts does it: nothing is written near dist and no port is used. This is where the populated board is measured,
// because the sandbox of the real shell holds no date sheet.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const URL_ = 'http://y03.test/'
const FONTS = "html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}"
const ENTRY_ID = resolve(ROOT, 'e2e', '.y03-entry.tsx')
const entrySource = (root: string) => `
import '${root}/src/styles/design/clay/index.css'
import '${root}/src/ww/design/base.css'
import '${root}/src/ww/kit/kit.css'
import { createRoot } from 'react-dom/client'
import list from '${root}/src/gallery/entries/Y03'
const q = new URLSearchParams(location.search)
document.documentElement.setAttribute('data-theme', 'clay-' + (q.get('theme') === 'dark' ? 'dark' : 'light'))
document.documentElement.setAttribute('data-legacy-styles', '')
if (q.get('theme') !== 'dark') document.body.setAttribute('data-ww-theme', 'paper')
document.body.style.margin = '0'
document.body.style.background = 'var(--surface-ground)'
const w = Number(q.get('w')) || 0
const node = list[0].states[Number(q.get('state') || 0)].node
const style = w ? { position: 'relative', width: w, padding: 12, boxSizing: 'border-box' } : { position: 'absolute', left: 64, top: 48, width: 1302, height: 720, padding: 36, boxSizing: 'border-box' }
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
      plugins: [{ name: 'y03-entry', resolveId: (id: string) => (id === ENTRY_ID ? id : null), load: (id: string) => (id === ENTRY_ID ? entrySource(root) : null) }],
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: ENTRY_ID, formats: ['iife'], name: 'Y03Page', fileName: 'y03' } },
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

async function specimen(page: Page, i: number, theme: 'light' | 'dark' = 'light', w = 0) {
  const { js, css } = await buildPage()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Y03</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}&state=${i}${w ? `&w=${w}` : ''}`)
  await page.locator('.y3, .y3-small').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
}

const BOARDS = [0, 1, 2, 3, 13, 10, 11, 12]
const NAMES: Record<number, string> = { 0: 'plan-simulated', 1: 'plan-waiting', 2: 'plan-why', 3: 'plan-swap', 13: 'plan-unmeasured', 10: 'dmat-setup', 11: 'dmat-run', 12: 'dmat-result' }

test.describe('Y03 specimens at the canvas size', () => {
  test.use({ viewport: { width: 1366, height: 768 } })
  for (const theme of ['light', 'dark'] as const) {
    for (const i of BOARDS) {
      test(`state ${i} (${NAMES[i]}, ${theme}) fits one canvas and is readable`, async ({ page }) => {
        await specimen(page, i, theme)
        const problems = await measure(page, `${NAMES[i]} ${theme}`, 1366)
        const m = await page.evaluate(() => {
          const box = document.querySelector<HTMLElement>('.y3-box')!.getBoundingClientRect()
          const cards = [...document.querySelectorAll<HTMLElement>('.y3-card')]
          return {
            w: Math.round(box.width),
            out: cards.filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > box.bottom + 1 || r.right > box.right + 1 || r.left < box.left - 1 }).map((c) => c.dataset.card ?? c.querySelector('.y3-title')?.textContent ?? ''),
            spill: cards.filter((c) => c.scrollHeight > c.clientHeight + 1).map((c) => c.dataset.card ?? c.querySelector('.y3-title')?.textContent ?? ''),
            sheet: (() => { const s = document.querySelector<HTMLElement>('.y3-sheet'); return s ? s.scrollHeight - s.clientHeight : 0 })(),
          }
        })
        expect(m.w).toBe(1230)
        expect(m.out, 'a plate runs past the box').toEqual([])
        expect(m.spill, 'a plate holds more than it can show').toEqual([])
        expect(m.sheet, 'the sheet is cut').toBeLessThanOrEqual(1)
        if (theme === 'light' || i === 0) await shot(page, `specimen-${NAMES[i]}-${theme}.png`)
        expect(problems, problems.join('\n')).toEqual([])
      })
    }
  }
})

test.describe('Y03 specimens at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  for (const i of [0, 1, 10, 11]) {
    test(`state ${i} (${NAMES[i]}) has no sideways scroll`, async ({ page }) => {
      await specimen(page, i, 'light', 390)
      const problems = await measure(page, `${NAMES[i]} 390`, 390)
      await shot(page, `specimen-${NAMES[i]}-390.png`)
      expect(problems, problems.join('\n')).toEqual([])
    })
  }
  test('the drawings (gauges, landscape, wheel, orbit) keep their parts inside 390 px', async ({ page }) => {
    for (const i of [4, 5, 6, 7, 8, 9]) {
      await specimen(page, i, 'light', 390)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      expect(over, `state ${i}`).toBeLessThanOrEqual(1)
      await shot(page, `specimen-drawing-${i}-390.png`)
    }
  })
})
