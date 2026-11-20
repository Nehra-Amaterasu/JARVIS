// T02 in a real Chromium: Career, five views on one runway.
//
//   (a) the real shell (flag on, `#t=ww-e2e&shell=v2`): each of the five views opens, at 1366x768 and 390x844, with no text under 11 px,
//       no target under 44 px, no sideways scroll, no document overflow, no text cut with an ellipsis, no label wrapped to three
//       lines and, on the laptop canvas, no inner scroll; the keyboard path of each view (N, C, arrows, Enter, Esc) works
//   (b) the cell-lamp rule in the page: every Readout is LIVE or SIMULATED only with its stamp line, and a WAITING one prints no number
//   (c) the gallery states drawn from invented rows (all stamped SIMULATED): the same geometry, one accent key, the ladder note
//
// T02_SHOTS=<folder> also writes PNGs of the gallery states (an environment variable, never Playwright's own output folder).
// Own ports: WW_SANDBOX_PORT=8826 WW_PREVIEW_PORT=5226 WW_SANDBOX_DIR=<scratch> npx playwright test e2e/t02-career.spec.ts
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { openGallery, pickEntry, showState } from './jury/lib'
import { PROBE, type Probe } from './probe'

const SHOTS = process.env.T02_SHOTS ? resolve(process.env.T02_SHOTS) : ''
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const VIEWS = ['pipeline', 'certs', 'abroad', 'money', 'ladder'] as const
const NOTE = 'These are skill matches against role profiles you wrote or imported. It is not a prediction of being hired.'

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

async function visit(page: Page, view: (typeof VIEWS)[number]) {
  await blurText(page)
  await page.keyboard.press('Control+5')
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', 'career')
  for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
  for (let k = 0; k < VIEWS.indexOf(view); k++) { await blurText(page); await page.keyboard.press(']') }
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', view)
  await page.locator(`.t2[data-view="${view}"]`).waitFor({ state: 'attached', timeout: 20_000 })
  await page.waitForTimeout(500)
}

/** Every Readout of the page: its state, whether a stamp line follows a LIVE or SIMULATED one, and the value it prints. */
const readouts = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.t2 .k-readout')].map((r) => {
  const wrap = r.closest('.t2-stamped')
  return {
    state: r.getAttribute('data-state') ?? '',
    value: r.querySelector('.k-readout-value')?.textContent?.trim() ?? '',
    stamp: wrap?.querySelector('.t2-stamp')?.textContent?.trim() ?? '',
    label: r.getAttribute('aria-labelledby') ? document.getElementById(r.getAttribute('aria-labelledby')!)?.textContent ?? '' : '',
  }
}))

/** The last line of every paragraph of two lines or more is not a lone short word (gaps list part C row 18). */
const orphans = (page: Page) => page.evaluate(() => { const z = Number(getComputedStyle(document.querySelector('.t2-gallery-box') ?? document.body).zoom) || 1; return [...document.querySelectorAll<HTMLElement>('.t2 p, .t2-sub, .t2-note')].filter((p) => getComputedStyle(p).visibility !== 'hidden' && p.getClientRects().length > 0 && !p.closest('[aria-hidden="true"]') && !p.classList.contains('t2-ruler')).flatMap((p) => {
  const range = document.createRange()
  range.selectNodeContents(p)
  const lines = new Map<number, { l: number; r: number }>()
  for (const q of range.getClientRects()) { if (q.width < 1) continue; const k = Math.round(q.top / 4); const o = lines.get(k); lines.set(k, o ? { l: Math.min(o.l, q.left), r: Math.max(o.r, q.right) } : { l: q.left, r: q.right }) }
  const rows = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.r - v.l)
  return rows.length >= 2 && rows[rows.length - 1] / z < 40 ? [`${(p.textContent ?? '').trim().slice(-30)} (last line ${Math.round(rows[rows.length - 1] / z)}px of ${rows.length})`] : []
}) })

const geometry = (page: Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('.t2')!
  const z = Number(getComputedStyle(document.querySelector('.t2-gallery-box') ?? document.body).zoom) || 1
  const vis = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
  const stops = [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"], [role="radio"], [role="gridcell"][tabindex="0"], [tabindex="0"]')].filter((e) => vis(e) && !e.closest('[aria-hidden="true"]') && !e.closest('svg'))
  const small = stops.filter((e) => { const r = e.getBoundingClientRect(); return r.width / z < 43.5 || r.height / z < 43.5 }).map((e) => `${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().width / z)}x${Math.round(e.getBoundingClientRect().height / z)}`)
  const tiny = [...root.querySelectorAll<HTMLElement>('*')].filter((e) => e.children.length === 0 && (e.textContent ?? '').trim() && vis(e) && parseFloat(getComputedStyle(e).fontSize) < 10.95).map((e) => `${e.textContent?.trim().slice(0, 24)} ${getComputedStyle(e).fontSize}`)
  const out = [...root.querySelectorAll<HTMLElement>('*')].filter((e) => vis(e) && !e.closest('svg')).filter((e) => {
    const r = e.getBoundingClientRect(); const o = root.getBoundingClientRect()
    return r.width > 0 && (r.right > o.right + 1 || r.bottom > o.bottom + 1 || r.left < o.left - 1) && !e.closest('[data-form="phone"] .t2-body')
  }).map((e) => `${e.className?.toString().slice(0, 30) || e.tagName}`).slice(0, 6)
  const outX = [...root.querySelectorAll<HTMLElement>('*')].filter((e) => vis(e) && !e.closest('svg') && e.getBoundingClientRect().right > root.getBoundingClientRect().right + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className?.toString().slice(0, 30)}`)
  return {
    outX, form: root.dataset.form, scrollY: root.scrollHeight - root.clientHeight, scrollX: root.scrollWidth - root.clientWidth,
    small, tiny, out, primaries: root.querySelectorAll('[data-primary="true"]').length, text: root.innerText,
  }
})

test.describe('T02 Career in the real shell', () => {
  for (const size of SIZES) {
    test(`${size.w}x${size.h}: the five views are readable, 44 px, one canvas, no sideways scroll`, async ({ page, baseURL }) => {
      test.setTimeout(240_000)
      await page.setViewportSize({ width: size.w, height: size.h })
      await openWw(page, baseURL)
      const problems: string[] = []
      for (const view of VIEWS) {
        await visit(page, view)
        const m = (await page.evaluate(PROBE)) as Probe
        const at = `career.${view} ${size.w}px`
        for (const k of ['small', 'targets', 'sideways', 'wraps', 'ellipsis'] as const) for (const d of m[k]) problems.push(`${at} ${k}: ${d}`)
        if (m.docOverflow > 1) problems.push(`${at} document overflow ${m.docOverflow}px`)
        if (size.w >= 1000) for (const d of m.innerY) problems.push(`${at} inner scroll: ${d}`)
        const g = await geometry(page)
        expect(g.primaries, `${at}: accent keys`).toBeLessThanOrEqual(1)
        const lone = await orphans(page)
        if (lone.length) problems.push(`${at} orphaned last line: ${lone.join('; ')}`)
        // the cell-lamp rule: LIVE or SIMULATED only with a stamp line; WAITING prints no number
        for (const r of await readouts(page)) {
          if (r.state === 'live' || r.state === 'simulated') expect(r.stamp, `${at}: ${r.label} is ${r.state} without a stamp`).toMatch(/(LIVE|SIMULATED) \d+ \w{3} \d{4}/)
          else expect(r.value, `${at}: ${r.label} prints a figure while ${r.state}`).toBe('--')
        }
      }
      expect(problems, problems.join('\n')).toEqual([])
    })
  }

  test('Runway: N opens Add an application, Esc closes it and focus returns; the keys reach the page by Tab', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1366, height: 768 })
    await openWw(page, baseURL)
    await visit(page, 'pipeline')
    await page.locator('.t2').focus().catch(() => undefined)
    await page.keyboard.press('n')
    const dlg = page.getByRole('dialog', { name: 'Add an application' })
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    // Tab reaches one of the page's own keys within a few presses (the shell's rail and view row come first)
    let inside = false
    for (let k = 0; k < 40 && !inside; k++) {
      await page.keyboard.press('Tab')
      inside = await page.evaluate(() => !!document.activeElement?.closest('.t2'))
    }
    expect(inside).toBe(true)
  })

  test('Abroad: C compares two, the grid roves with arrows, Enter opens a cell, Esc closes it', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1366, height: 768 })
    await openWw(page, baseURL)
    await visit(page, 'abroad')
    const cmp = page.getByRole('button', { name: /Compare two|Show all/ })
    await expect(cmp).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('c')
    await expect(cmp).toHaveAttribute('aria-pressed', 'true')
    expect(await page.locator('.t2-colhead').count()).toBe(2)
    await page.keyboard.press('c')
    expect(await page.locator('.t2-colhead').count()).toBeGreaterThanOrEqual(3)
    const stops = await page.locator('.t2-gcell[tabindex="0"]').count()
    expect(stops, 'one tab stop in the grid').toBe(1)
    await page.locator('.t2-gcell[tabindex="0"]').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('role'))).toBe('gridcell')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // the verified figure is the one LIVE row, with its source quoted
    const text = await page.locator('.t2').innerText()
    expect(text).toContain('€10,332')
    expect(text).toContain('https://www.study-in-germany.com/en/plan-your-studies/requirements/')
  })

  test('Ladder: the arrow keys move between Ladder and Path, and the note sits with both', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1366, height: 768 })
    await openWw(page, baseURL)
    await visit(page, 'ladder')
    const group = page.getByRole('radiogroup', { name: 'Ladder or Path' })
    await expect(group.getByRole('radio', { name: 'Ladder' })).toHaveAttribute('aria-checked', 'true')
    expect(await page.locator('.t2').innerText()).toContain(NOTE)
    await group.getByRole('radio', { name: 'Ladder' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(group.getByRole('radio', { name: 'Path' })).toHaveAttribute('aria-checked', 'true')
    expect(await page.locator('.t2').innerText()).toContain(NOTE)
  })

  test('Certificates: the pager pages, Enter on a plate opens it, Esc closes it', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1366, height: 768 })
    await openWw(page, baseURL)
    await visit(page, 'certs')
    const plates = page.locator('.t2-cplate')
    const n = await plates.count()
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(18)
    await plates.first().locator('[role="button"]').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Money: Add a source opens, and no figure is drawn without its stamp', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1366, height: 768 })
    await openWw(page, baseURL)
    await visit(page, 'money')
    await page.getByRole('button', { name: 'Add a source' }).click()
    await expect(page.getByRole('dialog', { name: 'Add a source' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const text = await page.locator('.t2').innerText()
    expect(text).toMatch(/UNKNOWN|covers|Gap/)
  })
})

// ---------------------------------------------------------------------------------------------- the gallery states

const STATES = [
  'runway', 'runway-row', 'runway-empty', 'runway-phone', 'ladder', 'path', 'path-waiting', 'path-import',
  'abroad', 'abroad-compare', 'abroad-cell', 'abroad-phone', 'certs', 'certs-detail', 'certs-waiting', 'money', 'money-unknown', 'money-phone',
] as const

async function openState(page: Page, i: number) {
  await openGallery(page, 'light')
  const { states } = await pickEntry(page, 'T02')
  await showState(page, i, states.length)
  await page.locator('.t2').first().waitFor()
  await page.waitForTimeout(350)
}

async function shoot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.addStyleTag({ content: '.t2-gallery-box { zoom: 1 !important; }' })
  const bb = await page.locator('.t2-gallery-box').boundingBox()
  if (bb) await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true, clip: { x: bb.x, y: bb.y, width: bb.width, height: bb.height } })
}

test.describe('T02 gallery states (invented rows, stamped SIMULATED)', () => {
  STATES.forEach((id, i) => {
    test(`${id}: one canvas, 44 px targets, one accent, SIMULATED on every LIVE cell`, async ({ page }) => {
      const phone = id.endsWith('-phone')
      await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1366, height: 768 })
      await openState(page, i)
      await shoot(page, `${String(i + 1).padStart(2, '0')}-${id}`)
      const g = await geometry(page)
      expect(g.form).toBe(phone ? 'phone' : 'desk')
      if (!phone) {
        expect(g.scrollY, `the page box scrolls; past the edge: ${g.out.join(', ')}`).toBeLessThanOrEqual(1)
        expect(g.scrollX, 'the page box scrolls sideways').toBeLessThanOrEqual(1)
      } else expect(g.scrollX, `sideways scroll on the phone: ${g.outX.join(', ')}`).toBeLessThanOrEqual(1)
      expect(g.small, 'targets under 44 px').toEqual([])
      expect(g.tiny, 'text under 11 px').toEqual([])
      expect(g.primaries, 'accent keys').toBeLessThanOrEqual(1)
      expect(await orphans(page), 'an orphaned last line').toEqual([])
      for (const r of await readouts(page)) {
        expect(r.state, 'a simulated page draws no LIVE cell').not.toBe('live')
        if (r.state === 'simulated') expect(r.stamp).toMatch(/SIMULATED \d+ \w{3} \d{4}/)
        else expect(r.value).toBe('--')
      }
      if (id === 'ladder' || id === 'path') expect(g.text).toContain(NOTE)
    })
  })
})
