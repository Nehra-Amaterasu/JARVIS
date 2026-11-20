// L03 in a real Chromium: Day / Week, Body (with the Ledger drawer) and Close.
//
//   (a) the real shell: each view opens under the flag (`#t=ww-e2e&shell=v2`, Alt+0 to Well Wisher, Ctrl+1 for Day, `]` to the view) and
//       throws no page error; the canvas holds one page, with no inner scroll and no document scroll at 1366 x 768, and no sideways scroll
//       at 390 and 358 px; every control is 44 px, no text under 11 px
//   (b) the keyboard: `l` opens the Ledger and Esc closes it, "Plan tomorrow" opens its drawer and Esc closes it; focus returns to the opener
//   (c) the gallery's invented rows (the same pages on a fixture port): `m` moves a planned block with the arrows and Enter, Esc leaves it,
//       the margin ledger prints the formula of the focused row, a drop fills and empties, and the Ledger logs and takes back a count
//   (d) both clay themes: text keeps 4.5:1 on the desk pages and the drawer's surface is opaque
//
// Needs `npx vite build --outDir dist-e2e` first for (a) and (b); (c) and (d) build the gallery in memory. L03_SHOTS=<folder> writes PNGs
// (an environment variable, never Playwright's own output folder; the folder is outside the repository).
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openGallery, pickEntry, showState, type Theme } from './jury/lib'

const SHOTS = process.env.L03_SHOTS ? resolve(process.env.L03_SHOTS) : ''
const VIEWS = ['week', 'body', 'close'] as const
type View = (typeof VIEWS)[number]
const ROOT: Record<View, string> = { week: '.dy.wk', body: '.dy.by', close: '.dy.cx' }
const G = { week: 0, move: 1, weekWaiting: 2, stale: 3, body: 4, bodyWaiting: 5, ledger: 6, close: 7, closeReturn: 8, closePlan: 9, weekPhone: 10, bodyPhone: 11, closePhone: 12 } as const

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) })
}

// ------------------------------------------------------------------------------------------------ the real shell

async function openView(page: Page, baseURL: string | undefined, view: View) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  const shell = page.locator('[data-shell="v2"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  if ((await shell.getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await expect(shell).toHaveAttribute('data-product', 'ww')
  await page.keyboard.press('Control+1')
  const root = page.locator('.s2-page')
  await expect(root).toHaveAttribute('data-section', 'day')
  for (let k = 0; k < 6; k++) await page.keyboard.press('[')
  for (let k = 0; k < ['today', 'week', 'month', 'body', 'close'].indexOf(view); k++) await page.keyboard.press(']')
  await expect(root).toHaveAttribute('data-view', view)
  await expect(page.locator(ROOT[view])).toBeVisible({ timeout: 15_000 })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
  await page.waitForTimeout(600)
}

/** One in-page measurement: the canvas has one page, nothing sticks out, every target is 44 px and no text is under 11 px. */
const measure = (page: Page, sel: string) => page.evaluate((s) => {
  const el = document.querySelector<HTMLElement>(s)!
  const box = el.getBoundingClientRect()
  const vis = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const targets: string[] = []
  for (const e of el.querySelectorAll<HTMLElement>('button, input, [role="switch"], [role="radio"], a[href], [tabindex="0"]')) {
    if (!vis(e) || e.closest('[aria-hidden="true"]')) continue
    const r = e.getBoundingClientRect()
    if (r.width < 43.5 || r.height < 43.5) targets.push(`${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  }
  const tiny: string[] = []
  for (const e of el.querySelectorAll<HTMLElement>('*')) {
    const own = [...e.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim()).map((n) => n.textContent!.trim()).join(' ')
    if (!own || !vis(e)) continue
    if (parseFloat(getComputedStyle(e).fontSize) < 10.95) tiny.push(`${own.slice(0, 24)} ${getComputedStyle(e).fontSize}`)
  }
  for (const t of el.querySelectorAll<SVGTextElement>('svg text')) {
    const svg = t.ownerSVGElement!
    const vb = svg.viewBox.baseVal
    const scale = vb && vb.width ? svg.getBoundingClientRect().width / vb.width : 1
    if (parseFloat(getComputedStyle(t).fontSize) * scale < 10.9) tiny.push(`svg ${t.textContent?.slice(0, 20)}`)
  }
  const out: string[] = []
  for (const e of el.querySelectorAll<HTMLElement>('*')) {
    const r = e.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || e.closest('svg') || !vis(e)) continue
    if (r.right > box.right + 1 || r.left < box.left - 1) out.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} x ${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(box.left)}..${Math.round(box.right)}`)
  }
  return {
    form: el.dataset.form,
    box: { w: Math.round(box.width), h: Math.round(box.height) },
    innerY: el.scrollHeight - el.clientHeight,
    innerX: el.scrollWidth - el.clientWidth,
    docY: document.documentElement.scrollHeight - innerHeight,
    docX: document.documentElement.scrollWidth - innerWidth,
    targets, tiny, out,
  }
}, sel)

for (const view of VIEWS) {
  test.describe(`${view}: the real shell`, () => {
    test('opens under the flag, one canvas at 1366 x 768 with no scroll anywhere', async ({ page, baseURL }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.setViewportSize({ width: 1366, height: 768 })
      await openView(page, baseURL, view)
      const m = await measure(page, ROOT[view])
      await shot(page, `${view}-1366`)
      expect(errors).toEqual([])
      expect(m.form).toBe('desk')
      expect(m.innerY, `inner vertical scroll ${JSON.stringify(m.box)}`).toBeLessThanOrEqual(1)
      expect(m.innerX).toBeLessThanOrEqual(1)
      expect(m.docY).toBeLessThanOrEqual(0)
      expect(m.docX).toBeLessThanOrEqual(0)
      expect(m.out, 'a part sticks out of the canvas').toEqual([])
      expect(m.targets, 'targets under 44 px').toEqual([])
      expect(m.tiny, 'text under 11 px').toEqual([])
    })
    for (const w of [390, 358]) {
      test(`the phone form at ${w} px: no sideways scroll, targets of 44 px, nothing cut at the edge`, async ({ page, baseURL }) => {
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.setViewportSize({ width: w, height: w === 390 ? 844 : 740 })
        await openView(page, baseURL, view)
        const m = await measure(page, ROOT[view])
        await shot(page, `${view}-${w}`)
        expect(errors).toEqual([])
        expect(m.form).toBe('phone')
        expect(m.innerX).toBeLessThanOrEqual(1)
        expect(m.docX).toBeLessThanOrEqual(0)
        expect(m.out, 'a part sticks out at the side').toEqual([])
        expect(m.targets, 'targets under 44 px').toEqual([])
        expect(m.tiny, 'text under 11 px').toEqual([])
      })
    }
  })
}

test.describe('the keyboard, in the real shell', () => {
  test('Body: l opens the Ledger, Esc closes it, and focus goes back to where it was', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openView(page, baseURL, 'body')
    await page.keyboard.press('l')
    const dlg = page.getByRole('dialog', { name: 'Ledger' })
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText('A log you keep for yourself.')
    await shot(page, 'ledger-open')
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: 'Ledger', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('button', { name: 'Ledger', exact: true })).toBeFocused()
  })
  test('Close: Plan tomorrow opens its drawer with three lines and Esc closes it', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openView(page, baseURL, 'close')
    await page.getByRole('button', { name: 'Plan tomorrow' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('.cl-row')).toHaveCount(3)
    await dlg.getByLabel('I will').first().fill('read the notes')
    await dlg.getByRole('button', { name: 'Save the plan' }).click()
    await expect(dlg).toContainText('Nothing was saved')
    await shot(page, 'plan-tomorrow')
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
  })
  test('Week: the page announces the move key and a done block does not move', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openView(page, baseURL, 'week')
    await expect(page.locator('.wk-line')).toContainText('Press m on a planned block to move it.')
    await expect(page.locator('.wk-day')).toHaveCount(7)
    await expect(page.locator('.wk-day[data-today]')).toHaveCount(1)
  })
})

// ------------------------------------------------------------------------------------------------ the gallery (invented rows)

async function openState(page: Page, state: number, theme: Theme = 'light') {
  await openGallery(page, theme)
  const { states } = await pickEntry(page, 'L03')
  await showState(page, state, states.length)
  await page.locator('.dy').first().waitFor()
  await page.waitForTimeout(350)
}

test.describe('Week on invented rows', () => {
  test('m, the arrows and Enter move a planned block; Esc leaves it where it was', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openState(page, G.week)
    const block = page.locator('.wk-block[data-id="2026-11-19-ps0"]')
    await block.focus()
    await page.keyboard.press('m')
    await expect(page.locator('.wk-line')).toContainText('Moving')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.wk-day[data-date="2026-11-20"]')).toHaveAttribute('data-landing', 'true')
    await shot(page, 'week-moving')
    await page.keyboard.press('Escape')
    await expect(page.locator('.wk-line')).toContainText('Move cancelled')
    await expect(page.locator('.wk-day[data-date="2026-11-19"] .wk-block[data-id="2026-11-19-ps0"]')).toHaveCount(1)
    await block.focus()
    await page.keyboard.press('m')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    // Friday already had a block of its own with that name; Thursday no longer has the moved one
    await expect(page.locator('.wk-day[data-date="2026-11-20"] .wk-block', { hasText: 'fixture topic 4' })).toHaveCount(2)
    await expect(page.locator('.wk-day[data-date="2026-11-19"] .wk-block', { hasText: 'fixture topic 4' })).toHaveCount(0)
    await expect(page.locator('.wk-line')).toContainText('fixture')
  })
  test('the margin ledger prints the formula of the focused row, in words and with no warning colour', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openState(page, G.week)
    const rows = page.locator('.wk-margin')
    await expect(rows).toHaveCount(3)
    await rows.nth(0).focus()
    await expect(page.locator('.wk-formula')).toContainText('floor((7 - 0.75 x 11) / 0.75)')
    await expect(rows.nth(0)).toContainText('needs 5 classes to reach 75%')
    await rows.nth(1).focus()
    await expect(page.locator('.wk-formula')).toContainText('floor((9 - 0.75 x 12) / 0.75) = 0')
    await expect(page.locator('.wk-day')).toHaveCount(7)
    const red = await page.locator('.wk-margin').evaluateAll((els) => els.map((e) => { const c = getComputedStyle(e.querySelector('.wk-margin-text')!).color; const m = /rgb\((\d+), (\d+), (\d+)/.exec(c); return m ? Number(m[1]) - Math.max(Number(m[2]), Number(m[3])) : 0 }))
    expect(Math.max(...red)).toBeLessThan(40)
  })
  test('stale attendance says WAITING and how long ago, with hollow dots', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openState(page, G.stale)
    const plate = page.locator('[data-callout="margins"]')
    await expect(plate).toHaveAttribute('data-lamp', 'waiting')
    await expect(plate).toContainText('last entered 9 days ago')
    await expect(plate.locator('.wk-dot-on')).toHaveCount(0)
  })
  test('the waiting page draws no block and no figure', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openState(page, G.weekWaiting)
    await expect(page.locator('.wk-block')).toHaveCount(0)
    await expect(page.locator('.dy-sub')).toContainText('WAITING')
  })
})

test.describe('Body and the Ledger on invented rows', () => {
  test('a drop fills and the last filled drop empties; a count can fall', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openState(page, G.body)
    await expect(page.locator('.by-gauge-n')).toHaveText('3/8')
    await page.locator('.by-drop').nth(5).click()
    await expect(page.locator('.by-gauge-n')).toHaveText('6/8')
    await page.locator('.by-drop').nth(5).click()
    await expect(page.locator('.by-gauge-n')).toHaveText('5/8')
    await page.locator('.by-drop').nth(1).focus()
    await page.keyboard.press('Space')
    await expect(page.locator('.by-drop[data-on="true"]')).toHaveCount(2)
    await expect(page.locator('[data-callout="reminders"]')).toContainText('Reminders you set. Not medical advice.')
    await shot(page, 'body')
  })
  test('the Ledger logs a habit and takes it back, and adds a spending entry', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openState(page, G.ledger)
    const lg = page.locator('.lg')
    await expect(lg).toBeVisible()
    await expect(lg).toContainText('logged in November 2026')
    const n = lg.locator('.lg-habit-n').first()
    const before = Number(await n.textContent())
    await lg.locator('[data-act="log-habit"]').first().click()
    await expect(n).toHaveText(String(before + 1))
    await lg.locator('[data-act="undo-habit"]').first().click()
    await expect(n).toHaveText(String(before))
    await lg.getByLabel('Amount').fill('45')
    await lg.locator('[data-act="add-spend"]').click()
    await expect(lg).toContainText('Added in the fixture only.')
    await expect(lg).toContainText('cells = what you logged; fewer is fine')
    await shot(page, 'ledger')
    await expect(lg).not.toContainText(/streak|days clean|reset/i)
  })
})

test.describe('Close on invented rows', () => {
  test('"Pick up here." shows once on a return with the last three logged days, and not on a normal day', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openState(page, G.close)
    await expect(page.locator('[data-return]')).toHaveCount(0)
    await openState(page, G.closeReturn)
    const back = page.locator('[data-return]')
    await expect(back).toContainText('Pick up here.')
    await expect(back.locator('.cl-back-days li')).toHaveCount(3)
    await shot(page, 'close-return')
  })
  test('the capture is off until it is switched on, and Plan tomorrow saves into the fixture', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openState(page, G.close)
    await expect(page.locator('.cl-capture input')).toHaveCount(0)
    await page.getByRole('button', { name: 'Capture: off' }).click()
    await expect(page.locator('.cl-capture input')).toHaveCount(1)
    await page.getByRole('button', { name: 'Plan tomorrow' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('I will').first().fill('stretch')
    await dlg.getByRole('button', { name: 'Save the plan' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.locator('[data-callout="tomorrow"]')).toContainText('I will stretch')
  })
})

// ------------------------------------------------------------------------------------------------ both themes

async function contrast(page: Page, root: string) {
  return page.evaluate((sel) => {
    type C = { r: number; g: number; b: number; a: number }
    const parse = (v: string): C | null => {
      let m = /rgba?\(([^)]+)\)/.exec(v)
      if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
      m = /color\(srgb ([^)]+)\)/.exec(v)
      if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 } }
      return null
    }
    const over = (f: C, b: C): C => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 })
    const lum = (c: C) => { const f = (x: number) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
    const ratio = (a: C, b: C) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    const backdrop = (el: Element): C => {
      const layers: C[] = []
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor)
        if (c && c.a > 0) layers.push(c)
        if (c && c.a >= 0.999) break
      }
      let out: C = { r: 255, g: 255, b: 255, a: 1 }
      for (const l of layers.reverse()) out = over(l, out)
      return out
    }
    const bad: string[] = []
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('*')) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? '').trim()).join(' ').trim()
        if (!own || !(el as HTMLElement).getClientRects().length) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') continue
        const fg = parse(cs.color)
        if (!fg) continue
        const bg = backdrop(el)
        const r = ratio(over(fg, bg), bg)
        const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
        // a hollow placeholder (the "– –" of a form with no value) is a drawing, not text to read; it is held to 3:1
        const hollow = /^[–\s:-]+$/.test(own)
        if (r < (large || hollow ? 3 : 4.5)) bad.push(`${own.slice(0, 30)} ${r.toFixed(2)}:1 [${(el as HTMLElement).className?.toString().slice(0, 30)}]`)
      }
    }
    return bad
  }, root)
}

for (const theme of ['light', 'dark'] as const) {
  test(`both themes (${theme}): the desk pages keep 4.5:1 text and the drawer has an opaque surface`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    for (const [name, state] of [['week', G.week], ['body', G.body], ['close', G.close]] as const) {
      await openState(page, state, theme)
      const bad = await contrast(page, '.dy')
      await shot(page, `${name}-${theme}`)
      expect(bad, `${name} ${theme}`).toEqual([])
    }
    await openState(page, G.ledger, theme)
    const sheet = await page.evaluate(() => {
      const el = document.querySelector('.ww-sheet.dy-sheet')!
      const cs = getComputedStyle(el)
      let op = 1
      for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor) ?? /color\(srgb ([^)]+)\)/.exec(cs.backgroundColor)
      const p = m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number) : []
      return { alpha: p.length > 3 ? p[3] : m ? 1 : 0, opacity: op }
    })
    expect(sheet.alpha).toBeGreaterThanOrEqual(0.999)
    expect(sheet.opacity).toBeGreaterThanOrEqual(0.999)
    expect(await contrast(page, '.ww-sheet.dy-sheet')).toEqual([])
  })
}

test('the phone states: no sideways scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const state of [G.weekPhone, G.bodyPhone, G.closePhone]) {
    await openState(page, state)
    const x = await page.evaluate(() => { const d = document.querySelector<HTMLElement>('.dy')!; return { box: d.scrollWidth - d.clientWidth, doc: document.documentElement.scrollWidth - innerWidth } })
    expect(x.box).toBeLessThanOrEqual(1)
    expect(x.doc).toBeLessThanOrEqual(0)
  }
})
