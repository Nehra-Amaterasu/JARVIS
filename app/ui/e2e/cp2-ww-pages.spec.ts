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
  // the views are lazy and read the app: wait for the page's own content, not the shell around it
  await page.locator(READY[`${sec}.${view}`]).first().waitFor({ state: 'attached', timeout: 20_000 })
  await page.waitForTimeout(500)
}

interface Probe { small: string[]; targets: string[]; sideways: string[]; docOverflow: number; wraps: string[]; ellipsis: string[]; innerY: string[] }

/** The in-page measurement (geometry only; it changes nothing). Controls are judged on their own box, text on its computed size. */
const PROBE = `(() => {
  const root = document.querySelector('.s2-page') || document.body
  const vis = (el) => {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.01) return false
    if (/sr-only|vh-sr|visually-hidden/.test(typeof el.className === 'string' ? el.className : '')) return false
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (a.matches('.s2-canvas, .s2-page, .ww-frame, .ww-centre, .page')) continue
      const c = getComputedStyle(a)
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const ar = a.getBoundingClientRect(); if (r.right < ar.left || r.left > ar.right || r.bottom < ar.top || r.top > ar.bottom) return false }
    }
    return true
  }
  const nm = (el) => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
    const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 26)
    return el.tagName.toLowerCase() + (c ? '.' + c : '') + (t ? ' "' + t + '"' : '')
  }
  const out = { small: [], targets: [], sideways: [], docOverflow: 0, wraps: [], ellipsis: [], innerY: [] }
  out.docOverflow = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
  for (const el of root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], [role="slider"], [tabindex="0"]')) {
    if (!vis(el) || el.closest('[aria-hidden="true"]')) continue
    if (el.matches('svg *, [data-tree-node], .ww-tree-node')) continue
    const r = el.getBoundingClientRect()
    const lab = el.closest('label'); const lr = lab ? lab.getBoundingClientRect() : null
    const via = lr && lr.width >= 43.5 && lr.height >= 43.5 && el.tagName === 'INPUT'
    if ((r.width < 43.5 || r.height < 43.5) && !via) out.targets.push(nm(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.children.length === 0 && (el.textContent || '').trim().length > 0 && vis(el)) {
      const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize)
      if (fs < 10.95) out.small.push(nm(el) + ' ' + fs + 'px')
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow === 'ellipsis') out.ellipsis.push(nm(el))
      const b = el.closest('button, [role="tab"], [role="radio"]')
      if (b && cs.whiteSpace !== 'pre-line') {
        const lh = parseFloat(cs.lineHeight) || fs * 1.3
        const rg = document.createRange(); rg.selectNodeContents(el)
        const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top / (lh * 0.6))))
        if (tops.size > 2) out.wraps.push(nm(b) + ' ' + tops.size + ' lines')
      }
    }
    const cs = getComputedStyle(el)
    if (el.matches('.s2-canvas, textarea, select, [role="listbox"], [data-scroll-ok]')) continue
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2 && vis(el)) out.sideways.push(nm(el) + ' ' + (el.scrollWidth - el.clientWidth) + 'px')
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2 && vis(el)) out.innerY.push(nm(el) + ' ' + (el.scrollHeight - el.clientHeight) + 'px')
  }
  const cv = document.querySelector('.s2-canvas')
  if (cv && cv.scrollHeight > cv.clientHeight + 2) out.innerY.push('.s2-canvas ' + (cv.scrollHeight - cv.clientHeight) + 'px')
  return out
})()`



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
})
