// The view sweep: every view of the new shell (flag on), at 1366x768 and 390x844, looked at once by a machine.
// SKIPPED unless SWEEP_SHOTS names a folder (outside the repository).
//
//   SWEEP_SHOTS=<folder> npx playwright test e2e/sweep-views.spec.ts
//   SWEEP_SECTIONS=room,senses SWEEP_SHOTS=<folder> ...                 (only those sections)
//
// Why it exists: six packages were merged on 15 and 16 Nov without a reviewer (build first, verify after). Their own specs
// drive gallery specimens; none walks the real shell view by view. This does, and writes what it finds instead of failing:
//   <section>-<view>-<width>.png      the view as the shell shows it
//   report.json, index.md             per view and size: page errors, console errors, failed requests, and the geometry
//                                     probe shared with cp2 (text under 11 px, targets under 44 px, sideways scroll, document
//                                     overflow, wrapped labels, text cut with an ellipsis, inner scroll on the laptop canvas)
// It fails only when a view cannot be reached or throws a page error: a geometry fault is data for the gaps list, because
// a red test for every known shortfall would stop the build the owner asked to come first (docs/design/budget-rules.md 4b).
//
// It runs against the sandbox like every spec here, never the owner's app. A view that needs the board, the voice core or
// stored memories therefore shows its WAITING or empty state; that state is what gets measured.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { PROBE, type Probe } from './probe'

const OUT = process.env.SWEEP_SHOTS ? resolve(process.env.SWEEP_SHOTS) : ''
const ONLY = (process.env.SWEEP_SECTIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]

// The section table of shell/ids.ts, in rail order per product (Ctrl+1..5 follows this order inside a product).
const TABLE: Array<{ product: 'jarvis' | 'ww'; id: string; views: string[] }> = [
  { product: 'jarvis', id: 'core', views: ['talk', 'sound'] },
  { product: 'jarvis', id: 'room', views: ['switches', 'rules'] },
  { product: 'jarvis', id: 'senses', views: ['presence', 'signal', 'teach'] },
  { product: 'jarvis', id: 'memory', views: ['recall', 'beliefs', 'people', 'keep'] },
  { product: 'jarvis', id: 'console', views: ['health', 'events', 'connections', 'hardware', 'crew'] },
  { product: 'ww', id: 'day', views: ['today', 'week', 'month', 'body', 'close'] },
  { product: 'ww', id: 'focus', views: ['start', 'session', 'rest', 'drill'] },
  { product: 'ww', id: 'study', views: ['papers', 'practice', 'plan', 'library', 'dmat'] },
  { product: 'ww', id: 'tree', views: ['tree'] },
  { product: 'ww', id: 'career', views: ['pipeline', 'certs', 'abroad', 'money', 'ladder'] },
]

interface Row { view: string; width: number; file: string; pageErrors: string[]; consoleErrors: string[]; failed: string[]; probe: Probe; textLength: number; controls: number }

const rows: Row[] = []

const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function toProduct(page: Page, product: 'jarvis' | 'ww') {
  const shell = page.locator('[data-shell="v2"]')
  await blurText(page)
  if ((await shell.getAttribute('data-product')) !== product) await page.keyboard.press('Alt+0')
  await expect(shell).toHaveAttribute('data-product', product)
}

async function visit(page: Page, product: 'jarvis' | 'ww', sec: string, views: string[], view: string) {
  await toProduct(page, product)
  const index = TABLE.filter((s) => s.product === product).findIndex((s) => s.id === sec)
  await blurText(page)
  await page.keyboard.press(`Control+${index + 1}`)
  const root = page.locator('.s2-page')
  await expect(root).toHaveAttribute('data-section', sec)
  for (let k = 0; k < views.length + 1; k++) { await blurText(page); await page.keyboard.press('[') }
  for (let k = 0; k < views.indexOf(view); k++) { await blurText(page); await page.keyboard.press(']') }
  await expect(root).toHaveAttribute('data-view', view)
  // views are lazy and read the app: let the chunk load and the first reads settle (a slow route shows WAITING, which is a state)
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
  await page.waitForTimeout(700)
}

test.describe.configure({ mode: 'serial' })
test.skip(!OUT, 'SWEEP_SHOTS is not set: the sweep writes screenshots and a report only when it names a folder')

test.afterAll(() => {
  if (!OUT || !rows.length) return
  mkdirSync(OUT, { recursive: true })
  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(rows, null, 1))
  const count = (r: Row) => r.pageErrors.length + r.consoleErrors.length + r.failed.length + r.probe.small.length + r.probe.targets.length + r.probe.sideways.length + r.probe.wraps.length + r.probe.ellipsis.length + (r.probe.docOverflow > 1 ? 1 : 0) + (r.width >= 1000 ? r.probe.innerY.length : 0)
  const lines = ['# View sweep', '', `${rows.length} views and sizes; ${rows.filter((r) => count(r) === 0).length} with nothing found.`, '']
  for (const r of rows) {
    const found: string[] = []
    for (const e of r.pageErrors) found.push(`page error: ${e}`)
    for (const e of r.consoleErrors) found.push(`console error: ${e}`)
    for (const e of r.failed) found.push(`request: ${e}`)
    for (const k of ['small', 'targets', 'sideways', 'wraps', 'ellipsis'] as const) for (const d of r.probe[k]) found.push(`${k}: ${d}`)
    if (r.probe.docOverflow > 1) found.push(`document overflow ${r.probe.docOverflow}px`)
    if (r.width >= 1000) for (const d of r.probe.innerY) found.push(`inner scroll: ${d}`)
    if (r.textLength < 40) found.push(`nearly blank: ${r.textLength} characters of text`)
    lines.push(`## ${r.view} at ${r.width}px (${r.controls} controls, ${r.file})`, '', ...(found.length ? found.map((f) => `- ${f}`) : ['- nothing found']), '')
  }
  writeFileSync(resolve(OUT, 'index.md'), lines.join('\n'))
})

for (const size of SIZES) {
  test(`sweep at ${size.w}x${size.h}`, async ({ page, baseURL }) => {
    test.setTimeout(600_000)
    const res = await fetch(baseURL!).catch(() => null)
    test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
    mkdirSync(OUT, { recursive: true })
    await page.setViewportSize({ width: size.w, height: size.h })

    let pageErrors: string[] = []
    let consoleErrors: string[] = []
    let failed: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)))
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) failed.push(`${r.status()} ${new URL(r.url()).pathname}`) })

    await page.goto('/#t=ww-e2e&shell=v2')
    await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })

    const thrown: string[] = []
    for (const sec of TABLE) {
      if (ONLY.length && !ONLY.includes(sec.id)) continue
      for (const view of sec.views) {
        pageErrors = []; consoleErrors = []; failed = []
        await visit(page, sec.product, sec.id, sec.views, view)
        const probe = (await page.evaluate(PROBE)) as Probe
        const stats = await page.evaluate(() => {
          const root = document.querySelector('.s2-page') || document.body
          return { text: (root.textContent || '').replace(/\s+/g, ' ').trim().length, controls: root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="tab"], [role="radio"]').length }
        })
        const file = `${sec.id}-${view}-${size.w}.png`
        await page.screenshot({ path: resolve(OUT, file) })
        rows.push({ view: `${sec.id}.${view}`, width: size.w, file, pageErrors: [...pageErrors], consoleErrors: [...new Set(consoleErrors)], failed: [...new Set(failed)], probe, textLength: stats.text, controls: stats.controls })
        for (const e of pageErrors) thrown.push(`${sec.id}.${view} ${size.w}px: ${e}`)
      }
    }
    expect(thrown, thrown.join('\n')).toEqual([])
  })
}
