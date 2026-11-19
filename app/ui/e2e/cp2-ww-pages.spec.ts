// CP2: the Well Wisher classic pages (Tree, Career, Study plan and library) under the new shell, flag on.
//
// For each page, at 1366x768 and 390x844, in the light Well Wisher clay ground, it measures and asserts:
//   no text under 11 px, no control under 44 px, no scroll container that moves sideways, no document overflow,
//   no button whose label wraps to more than two lines, no text cut with an ellipsis, no inner vertical scroll
//   on the laptop canvas (the page may use the canvas scroll at 390 px, where it is one column).
// CP2_SHOTS=<folder> also writes one PNG per page and size (outside the repository, never Playwright's own folder).
//
// Own ports: WW_SANDBOX_PORT=8815 WW_PREVIEW_PORT=5215 WW_SANDBOX_DIR=<scratch> npx playwright test e2e/cp2-ww-pages.spec.ts
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { PROBE, type Probe } from './probe'

const SHOTS = process.env.CP2_SHOTS ? resolve(process.env.CP2_SHOTS) : ''
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const WW = ['day', 'focus', 'study', 'tree', 'career']
const VIEWS: Record<string, string[]> = {
  study: ['papers', 'practice', 'plan', 'library', 'dmat'],
  tree: ['tree'],
  career: ['pipeline', 'certs', 'abroad', 'money', 'ladder'],
}
const PAGES: Array<[string, string]> = [
  ['study', 'plan'], ['study', 'library'], ['tree', 'tree'],
  ['career', 'pipeline'], ['career', 'certs'], ['career', 'abroad'], ['career', 'money'], ['career', 'ladder'],
]

/** What shows that a page has drawn its content (the left rail and the Proof rail carry text of their own). */
const READY: Record<string, string> = {
  'study.plan': '.ww-plan [data-card="study-plan"]',
  'study.library': '.ww-library [data-card="study-findings"], .ww-library [data-findings-hidden]',
  'tree.tree': '.ww-tree-stage .tree-node',
  'career.pipeline': '.cr-body .ww-card', 'career.certs': '.cr-body .ww-card', 'career.abroad': '.cr-body .ww-card',
  'career.money': '.cr-body .ww-card', 'career.ladder': '.cr-body .ww-card',
}

const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function openWw(page: Page, baseURL: string | undefined) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  await blurText(page)
  if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', 'ww')
}

async function visit(page: Page, sec: string, view: string) {
  await blurText(page)
  await page.keyboard.press(`Control+${WW.indexOf(sec) + 1}`)
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', sec)
  for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
  for (let k = 0; k < VIEWS[sec].indexOf(view); k++) { await blurText(page); await page.keyboard.press(']') }
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', view)
  // C03 (16 Nov) made the Manual Intake desk the first face of study.library and kept the classic Library as its second
  // face, one press away. This spec measures the classic page, so it goes to that face; the desk has its own spec.
  if (sec === 'study' && view === 'library') {
    await page.getByRole('radiogroup', { name: 'Library face' }).getByRole('radio', { name: 'Library' }).click()
    await expect(page.locator('.ik-classic[data-face="library"]')).toBeVisible()
  }
  // the views are lazy and read the app: wait for the page's own content, not the shell around it
  await page.locator(READY[`${sec}.${view}`]).first().waitFor({ state: 'attached', timeout: 20_000 })
  await page.waitForTimeout(500)
}





test.describe('CP2: Well Wisher classic pages under the new shell', () => {
  for (const size of SIZES) {
    test(`${size.w}x${size.h}: readable, 44 px, no sideways scroll, no wrapped labels`, async ({ page, baseURL }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: size.w, height: size.h })
      await openWw(page, baseURL)
      const problems: string[] = []
      for (const [sec, view] of PAGES) {
        await visit(page, sec, view)
        const m = (await page.evaluate(PROBE)) as Probe
        const at = `${sec}.${view} ${size.w}px`
        for (const k of ['small', 'targets', 'sideways', 'wraps', 'ellipsis'] as const) for (const d of m[k]) problems.push(`${at} ${k}: ${d}`)
        if (m.docOverflow > 1) problems.push(`${at} document overflow ${m.docOverflow}px`)
        // one canvas on the laptop: the page does not scroll inside the canvas or a card at 1366x768
        if (size.w >= 1000) for (const d of m.innerY) problems.push(`${at} inner scroll: ${d}`)
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true })
          await page.screenshot({ path: resolve(SHOTS, `${sec}-${view}-${size.w}.png`) })
        }
      }
      expect(problems, problems.join('\n')).toEqual([])
    })
  }

  for (const size of SIZES) {
    test(`${size.w}x${size.h}: the Tree with a node open (inspector) and with its two lists open`, async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width: size.w, height: size.h })
      await openWw(page, baseURL)
      await visit(page, 'tree', 'tree')
      const problems: string[] = []
      const measure = async (at: string) => {
        const m = (await page.evaluate(PROBE)) as Probe
        for (const k of ['small', 'targets', 'sideways', 'wraps'] as const) for (const d of m[k]) problems.push(`${at} ${k}: ${d}`)
        if (m.docOverflow > 1) problems.push(`${at} document overflow ${m.docOverflow}px`)
      }
      // the two lists: opaque, readable (ink against the face of the panel), 44 px rows, inside the window
      for (const key of ['Tree', 'Branches']) {
        await page.locator('.ww-tree-key', { hasText: key }).first().click()
        const panel = page.locator('.ww-tree-panel')
        await expect(panel).toBeVisible()
        const r = await panel.evaluate((el) => {
          const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number)
          const lum = (c: number[]) => { const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
          const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
          const cs = getComputedStyle(el)
          const bg = rgb(cs.backgroundColor)
          const rows = [...el.querySelectorAll<HTMLElement>('.ww-tree-opt')]
          const unselected = rows.find((o) => o.getAttribute('aria-checked') !== 'true')
          const sel = rows.find((o) => o.getAttribute('aria-checked') === 'true')
          const box = el.getBoundingClientRect()
          return {
            alpha: bg.length > 3 ? bg[3] : 1,
            ink: unselected ? ratio(rgb(getComputedStyle(unselected).color), bg) : 99,
            selected: sel ? ratio(rgb(getComputedStyle(sel).color), rgb(getComputedStyle(sel).backgroundColor)) : 99,
            minRow: Math.min(...rows.map((o) => o.getBoundingClientRect().height)),
            inside: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
          }
        })
        expect(r.alpha, `${key} panel is opaque`).toBe(1)
        expect(r.ink, `${key} panel ink on its face`).toBeGreaterThanOrEqual(4.5)
        expect(r.selected, `${key} panel selected row`).toBeGreaterThanOrEqual(4.5)
        expect(r.minRow, `${key} panel rows`).toBeGreaterThanOrEqual(43.5)
        expect(r.inside, `${key} panel stays in the window`).toBe(true)
        await page.keyboard.press('Escape')
        await expect(panel).toHaveCount(0)
      }
      // a node open: the Next key jumps to what is next and opens it
      await page.locator('.ww-tree-bar').getByRole('button', { name: /^Next/ }).click()
      await expect(page.locator('.ww-insp').first()).toBeVisible({ timeout: 10_000 })
      await page.waitForTimeout(400)
      await measure(`tree+node ${size.w}px`)
      expect(problems, problems.join(String.fromCharCode(10))).toEqual([])
    })
  }
})
