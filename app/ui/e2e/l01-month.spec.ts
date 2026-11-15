// L01 in a real Chromium: the Life month calendar measured on the gallery's L01 entry (the jury harness builds the gallery in memory,
// so no server and no dist build are needed). At the desk the entry draws the 1302 x 664 canvas the shell leaves at 1366 x 768 under
// a 0.72 zoom; every measured box is divided by that zoom, so the sizes below are real CSS px. At 390 px the entry draws the phone
// canvas (358 px wide) at its own size.
//
//   (a) one canvas: no inner scroll at 1366 x 768, 42 cells of a size to read, the side panel whole, 44 px targets, one tab stop
//   (b) keyboard: arrow roving, Enter opens the drawer, Esc closes it and focus returns to the day; the focus ring is 2 px at 3:1
//   (c) the drawer, the Marks popover and the sheet have an OPAQUE surface of their own and 4.5:1 text, in both clay themes
//   (d) honest states: SIMULATED stamped once per place, the waiting page draws no number and no strip
//   (e) the clay: a cell rises on hover and sinks on press, and a still page does not move under reduced motion
//   (f) forced colours: every tile has an edge, the drawer is Canvas, and the focus ring is the system highlight
//   (g) the phone: no sideways scroll, 44 px cells, the bottom sheet sits on the bottom edge
//
// L01_SHOTS=<folder> also writes PNGs of every state (an environment variable, never Playwright's own output folder).
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openGallery, pickEntry, showState, type Theme } from './jury/lib'

const SHOTS = process.env.L01_SHOTS ? resolve(process.env.L01_SHOTS) : ''
const S = { month: 0, drawer: 1, marks: 2, year: 3, waiting: 4, empty: 5, phone: 6, sheet: 7 } as const

async function open(page: Page, state: number, theme: Theme = 'light') {
  await openGallery(page, theme)
  const { states } = await pickEntry(page, 'L01')
  await showState(page, state, states.length)
  await page.locator('.mo').first().waitFor()
  await page.waitForTimeout(300) // the port answers and the first measurement lands
}

async function shoot(page: Page, name: string, overlay = false) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  const path = resolve(SHOTS, `${name}.png`)
  if (overlay) {
    await page.screenshot({ path })
    return
  }
  await page.addStyleTag({ content: '.mo-gallery-box { zoom: 1 !important; }' })
  const bb = await page.locator('.mo-gallery-box').boundingBox()
  if (bb) await page.screenshot({ path, fullPage: true, clip: { x: bb.x, y: bb.y, width: bb.width, height: bb.height } })
}

const zoom = (page: Page) => page.evaluate(() => Number(getComputedStyle(document.querySelector('.mo-gallery-box')!).zoom) || 1)

/** Text contrast measured in the page: each leaf text over the first opaque layers under it (WCAG 2 ratio), with its font size. */
async function contrast(page: Page, root: string) {
  return page.evaluate((sel) => {
    type C = { r: number; g: number; b: number; a: number }
    const parse = (v: string): C | null => {
      let m = /rgba?\(([^)]+)\)/.exec(v)
      if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
      }
      m = /color\(srgb ([^)]+)\)/.exec(v)
      if (m) {
        const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number)
        return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }
      }
      return null
    }
    const over = (f: C, b: C): C => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 })
    const lum = (c: C) => {
      const f = (x: number) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
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
    const rows: { text: string; cls: string; ratio: number; size: number; bold: boolean }[] = []
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('*')) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? '').trim()).join(' ').trim()
        if (!own || !(el as HTMLElement).getClientRects().length) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') continue
        const fg = parse(cs.color)
        if (!fg) continue
        const bg = backdrop(el)
        rows.push({ text: own.slice(0, 40), cls: (el as HTMLElement).className?.toString().slice(0, 40) ?? el.tagName, ratio: ratio(over(fg, bg), bg), size: parseFloat(cs.fontSize), bold: Number(cs.fontWeight) >= 700 })
      }
    }
    return rows
  }, root)
}

const worst = (rows: Awaited<ReturnType<typeof contrast>>) => rows.filter((r) => r.ratio < (r.size >= 24 || (r.size >= 18.66 && r.bold) ? 3 : 4.5)).map((r) => `${r.text} [${r.cls}] ${r.ratio.toFixed(2)}:1 at ${r.size}px`)
const tiny = (rows: Awaited<ReturnType<typeof contrast>>) => rows.filter((r) => r.size < 11).map((r) => `${r.text} ${r.size}px`)

/** The opaque surface of an element: its background is a solid colour (alpha 1) and its opacity is 1, all the way up to the body. */
const opaque = (page: Page, sel: string) => page.evaluate((s) => {
  const el = document.querySelector(s)!
  const cs = getComputedStyle(el)
  const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor) ?? /color\(srgb ([^)]+)\)/.exec(cs.backgroundColor)
  const p = m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number) : []
  const a = p.length > 3 ? p[3] : m ? 1 : 0
  let op = 1
  for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
  return { alpha: a, opacity: op, bg: cs.backgroundColor, blur: cs.backdropFilter }
}, sel)

const geometry = (page: Page) => page.evaluate(() => {
  const mo = document.querySelector<HTMLElement>('.mo')!
  const box = mo.closest<HTMLElement>('.mo-gallery-box')!
  const z = Number(getComputedStyle(box).zoom) || 1
  const side = document.querySelector<HTMLElement>('.mo-side')!
  const inside = (outer: HTMLElement, sel: string) => {
    const o = outer.getBoundingClientRect()
    return [...outer.querySelectorAll<HTMLElement>(sel)].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && (r.top < o.top - 1 || r.bottom > o.bottom + 1 || r.left < o.left - 1 || r.right > o.right + 1)
    }).map((e) => e.className?.toString() || e.tagName)
  }
  const focusable = [...mo.querySelectorAll<HTMLElement>('button, input, [role="switch"], [tabindex="0"], a[href]')].filter((e) => e.getClientRects().length > 0 && !e.closest('[aria-hidden="true"]'))
  const small = focusable.map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width / z < 43.5 || r.height / z < 43.5)
    .map(({ e, r }) => `${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 30)} ${Math.round(r.width / z)}x${Math.round(r.height / z)}`)
  const cells = [...mo.querySelectorAll<HTMLElement>('.alm-cell')].map((e) => e.getBoundingClientRect())
  const grid = mo.querySelector<HTMLElement>('.alm-grid')?.getBoundingClientRect()
  return {
    form: mo.dataset.form,
    width: Math.round(mo.offsetWidth),
    moScrollY: mo.scrollHeight - mo.clientHeight,
    moScrollX: mo.scrollWidth - mo.clientWidth,
    sideScroll: side.scrollHeight - side.clientHeight,
    sideOut: inside(side, '.mo-kinds li, .mo-pvd div, .mo-intent, .mo-hollow, .mo-side-head'),
    cells: cells.length,
    minCellW: Math.min(...cells.map((r) => r.width / z)),
    minCellH: Math.min(...cells.map((r) => r.height / z)),
    cellsInGrid: !grid || cells.every((r) => r.left >= grid.left - 1 && r.right <= grid.right + 1 && r.top >= grid.top - 1 && r.bottom <= grid.bottom + 1),
    small,
    stops: mo.querySelectorAll('.alm-cell[tabindex="0"]').length,
    primaries: mo.querySelectorAll('[data-primary="true"]').length,
    lamps: [...mo.querySelectorAll('.k-lamp')].map((l) => `${l.getAttribute('data-state')}:${l.textContent?.trim()}`),
    text: mo.innerText,
    z,
  }
})

test.describe('L01 Life month calendar', () => {
  test('desk 1366 x 768, the month: one canvas, no scroll, 44 px targets, one tab stop, lamps with words', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, S.month)
    const g = await geometry(page)
    expect(g.form).toBe('desk')
    expect(g.width).toBe(1302)
    expect(g.moScrollY, 'the page box scrolls').toBeLessThanOrEqual(0)
    expect(g.moScrollX, 'the page box scrolls sideways').toBeLessThanOrEqual(0)
    expect(g.sideScroll, 'the side panel scrolls').toBeLessThanOrEqual(0)
    expect(g.sideOut, 'parts outside the side panel').toEqual([])
    expect(g.cells).toBe(42)
    expect(g.minCellW, 'a cell is narrower than 100 px').toBeGreaterThanOrEqual(100)
    expect(g.minCellH, 'a cell is shorter than 64 px').toBeGreaterThanOrEqual(64)
    expect(g.cellsInGrid).toBe(true)
    expect(g.small, 'targets under 44 px').toEqual([])
    expect(g.stops, 'tab stops in the grid').toBe(1)
    expect(g.primaries, 'accent keys').toBeLessThanOrEqual(1)
    expect(g.lamps.length).toBeGreaterThanOrEqual(3)
    for (const l of g.lamps) expect(l.split(':')[1].length, `a lamp with no word: ${l}`).toBeGreaterThan(2)
    expect((g.text.match(/SIMULATED/g) ?? []).length, 'SIMULATED stamped in the head, the Google lamp and the reading').toBeGreaterThanOrEqual(2)
    const rows = await contrast(page, '.mo')
    expect(tiny(rows), 'text under 11 px').toEqual([])
    expect(worst(rows), 'text under its contrast').toEqual([])
    await shoot(page, 'desk-1366-month-light')
  })

  test('keyboard: arrows rove, Enter opens the day, Esc closes it and focus returns; the focus ring is 2 px at 3:1', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, S.month)
    // the gallery draws the desk at 0.72, which scales a computed outline too; measure the ring at the real size
    await page.addStyleTag({ content: '.mo-gallery-box { zoom: 1 !important; }' })
    const stop = page.locator('.alm-cell[tabindex="0"]')
    expect(await stop.getAttribute('data-date')).toBe('2026-11-18')
    await stop.focus()
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.date)).toBe('2026-11-19')
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.date)).toBe('2026-11-26')
    expect(await page.locator('.alm-cell[tabindex="0"]').count()).toBe(1)
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const cs = getComputedStyle(el)
      const parse = (v: string) => (/rgba?\(([^)]+)\)/.exec(v)?.[1] ?? '').split(/[\s,/]+/).filter(Boolean).map(Number)
      const lum = (c: number[]) => { const f = (x: number) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
      const a = parse(cs.outlineColor)
      const b = parse(getComputedStyle(document.querySelector('.mo')!).backgroundColor)
      const [x, y] = [lum(a), lum(b)]
      return { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    })
    expect(ring.style).toBe('solid')
    expect(ring.width).toBe('2px')
    expect(ring.offset).toBe('2px')
    expect(ring.ratio).toBeGreaterThanOrEqual(3)
    await page.keyboard.press('Enter')
    await page.locator('.dd-sheet[data-state="open"]').waitFor()
    expect(await page.locator('.dd-sheet h2').textContent()).toBe('Thursday 26 November 2026')
    await page.keyboard.press('Escape')
    await page.locator('.dd-sheet[data-state="closed"]').waitFor({ state: 'attached' })
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.date)).toBe('2026-11-26')
    await page.keyboard.press('PageDown')
    expect(await page.locator('.mo-month').textContent()).toContain('December')
    await page.keyboard.press('t')
    expect(await page.locator('.mo-month').textContent()).toContain('November')
    await page.keyboard.press('y')
    expect(await page.locator('.alm').getAttribute('data-mode')).toBe('year')
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: the drawer and the Marks popover have an opaque surface of their own and readable text`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await open(page, S.drawer, theme)
      await page.locator('.dd-sheet[data-state="open"]').waitFor()
      await page.waitForTimeout(350)
      const d = await opaque(page, '.dd-sheet')
      expect(d.alpha, 'drawer background').toBe(1)
      expect(d.opacity, 'drawer opacity').toBe(1)
      expect(d.blur === 'none' || d.blur === '', 'drawer blur').toBe(true)
      const geo = await page.evaluate(() => {
        const r = document.querySelector('.dd-sheet')!.getBoundingClientRect()
        const body = document.querySelector<HTMLElement>('.ww-sheet-body')!
        const small = [...document.querySelectorAll<HTMLElement>('.dd-sheet button')].filter((b) => b.getClientRects().length).map((b) => ({ n: b.textContent?.trim().slice(0, 24) ?? '', w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })).filter((b) => b.h < 43.5 || b.w < 43.5).map((b) => `${b.n} ${Math.round(b.w)}x${Math.round(b.h)}`)
        return { w: Math.round(r.width), right: Math.round(r.right), vw: innerWidth, scroll: body.scrollHeight - body.clientHeight, small }
      })
      expect(geo.w).toBe(560)
      expect(geo.right).toBe(geo.vw)
      expect(geo.scroll, 'the drawer body scrolls').toBeLessThanOrEqual(0)
      expect(geo.small, 'drawer targets under 44 px').toEqual([])
      const rows = await contrast(page, '.dd-sheet')
      expect(rows.length).toBeGreaterThan(10)
      expect(worst(rows), 'drawer text under its contrast').toEqual([])
      expect(tiny(rows), 'drawer text under 11 px').toEqual([])
      await shoot(page, `desk-1366-drawer-${theme}`, true)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      await open(page, S.marks, theme)
      await page.locator('.mo-pop[data-state="open"]').waitFor()
      const p = await opaque(page, '.mo-pop')
      expect(p.alpha, 'popover background').toBe(1)
      expect(p.opacity, 'popover opacity').toBe(1)
      const switches = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.mo-pop [role="switch"]')].map((s) => Math.round(s.getBoundingClientRect().height)))
      expect(switches.length).toBe(9)
      expect(Math.min(...switches)).toBeGreaterThanOrEqual(44)
      expect(worst(await contrast(page, '.mo-pop')), 'popover text under its contrast').toEqual([])
      await shoot(page, `desk-1366-marks-${theme}`, true)
    })
  }

  test('desk, the dark theme month reads as well as the light one', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, S.month, 'dark')
    const rows = await contrast(page, '.mo')
    expect(worst(rows), 'text under its contrast').toEqual([])
    expect((await geometry(page)).moScrollY).toBeLessThanOrEqual(0)
    await shoot(page, 'desk-1366-month-dark')
  })

  test('desk, the year form: one focusable grid, 371 days, twelve 44 px month keys, no scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, S.year)
    const y = await page.evaluate(() => ({
      cells: document.querySelectorAll('.alm-yc').length,
      stops: [...document.querySelectorAll('.alm [tabindex="0"]')].length,
      keys: [...document.querySelectorAll<HTMLElement>('.alm-ykey')].map((k) => Math.round(k.getBoundingClientRect().height / (Number(getComputedStyle(document.querySelector('.mo-gallery-box')!).zoom) || 1))),
      levels: [...new Set([...document.querySelectorAll('.alm-yc')].map((c) => c.getAttribute('data-level')))].sort(),
    }))
    expect(y.cells).toBe(371)
    expect(y.stops).toBe(1)
    expect(y.keys.length).toBe(12)
    expect(Math.min(...y.keys)).toBeGreaterThanOrEqual(44)
    expect(y.levels.length).toBeGreaterThanOrEqual(3)
    const g = await geometry(page)
    expect(g.moScrollY).toBeLessThanOrEqual(0)
    expect(g.small, 'year targets under 44 px').toEqual([])
    await shoot(page, 'desk-1366-year-light')
  })

  test('the waiting page draws no number and no strip, and says why', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, S.waiting)
    const w = await page.evaluate(() => ({
      strips: document.querySelectorAll('.alm-strip').length,
      skeleton: document.querySelectorAll('.alm-skel').length,
      marks: document.querySelectorAll('.alm-cell .alm-mark').length,
      text: (document.querySelector('.mo') as HTMLElement).innerText,
      lamps: [...document.querySelectorAll('.mo .k-lamp')].map((l) => l.getAttribute('data-state')),
    }))
    expect(w.strips).toBe(0)
    expect(w.skeleton).toBe(42)
    expect(w.marks).toBe(0)
    expect(w.text).toContain('--')
    expect(w.text).toMatch(/not connected/)
    expect(w.lamps).toContain('waiting')
    expect(w.lamps).toContain('planned')
    expect(w.text).not.toMatch(/SIMULATED/)
    await shoot(page, 'desk-1366-waiting-light')
    await open(page, S.empty)
    await shoot(page, 'desk-1366-empty-light')
  })

  test('the clay: a cell rises on hover and sinks on press; a still page does not move under reduced motion', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, S.month)
    const cell = page.locator('button[data-date="2026-11-12"]')
    const at = (name: string) => cell.evaluate((e, n) => (getComputedStyle(e) as unknown as Record<string, string>)[n], name)
    const rest = { shadow: await at('boxShadow'), transform: await at('transform') }
    await cell.hover()
    await page.waitForTimeout(250)
    const ty = (t: string) => (t === 'none' ? 0 : Number(t.replace(/^matrix\(|\)$/g, '').split(',')[5]))
    expect(ty(await at('transform')), 'hover lifts the tile').toBeLessThan(ty(rest.transform))
    expect(await cell.evaluate((e) => getComputedStyle(e, '::before').opacity)).toBe('1')
    await page.mouse.down()
    await page.waitForTimeout(200)
    expect(await at('boxShadow'), 'a press sinks it').toContain('inset')
    expect(rest.shadow).not.toContain('inset 3px')
    await page.mouse.move(5, 5) // released away from the cell: no click, no drawer
    await page.mouse.up()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.mouse.move(5, 5)
    await page.waitForTimeout(150)
    await cell.hover()
    await page.waitForTimeout(150)
    expect(await at('transform'), 'a still page does not move').toBe('none')
    expect(await at('transitionDuration')).toMatch(/^0s/)
  })

  test('forced colours: every tile has an edge, the drawer is Canvas and the ring is the highlight', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, S.month)
    await page.addStyleTag({ content: '.mo-gallery-box { zoom: 1 !important; }' })
    const edge = await page.evaluate(() => {
      const c = document.querySelector<HTMLElement>('.alm-cell[data-inmonth="true"]:not([data-rest])')!
      const o = document.querySelector<HTMLElement>('.alm-cell[data-inmonth="false"]')!
      return { inW: getComputedStyle(c).borderTopWidth, inS: getComputedStyle(c).borderTopStyle, outS: getComputedStyle(o).borderTopStyle, mark: getComputedStyle(document.querySelector('.alm-mark .alm-f, .alm-mark .alm-l')!).stroke }
    })
    expect(edge.inW).not.toBe('0px')
    expect(edge.inS).toBe('solid')
    expect(edge.outS).toBe('dashed')
    await page.locator('.alm-cell[tabindex="0"]').focus()
    await page.keyboard.press('ArrowLeft')
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return { style: cs.outlineStyle, width: cs.outlineWidth } })
    expect(ring.style).toBe('solid')
    expect(ring.width).toBe('2px')
    await page.keyboard.press('Enter')
    await page.locator('.dd-sheet[data-state="open"]').waitFor()
    await page.waitForTimeout(300)
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.dd-sheet')!).backgroundColor)
    expect(bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    expect(worst(await contrast(page, '.dd-sheet'))).toEqual([])
    await shoot(page, 'desk-1366-forced-drawer', true)
  })

  test('phone 390 x 844: one column in its own box, no sideways scroll, 44 px cells, text at 11 px or more', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, S.phone)
    const g = await geometry(page)
    expect(g.form).toBe('phone')
    expect(g.width).toBe(358)
    expect(g.moScrollX, 'the page box scrolls sideways').toBeLessThanOrEqual(0)
    expect(g.minCellW, 'a cell is narrower than 44 px').toBeGreaterThanOrEqual(44)
    expect(g.minCellH, 'a cell is shorter than 44 px').toBeGreaterThanOrEqual(44)
    expect(g.small, 'targets under 44 px').toEqual([])
    expect(g.stops).toBe(1)
    const rows = await contrast(page, '.mo')
    expect(tiny(rows), 'text under 11 px').toEqual([])
    expect(worst(rows), 'text under its contrast').toEqual([])
    const cellMarks = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.alm-cell')].map((c) => c.querySelectorAll('.alm-mark').length)))
    expect(cellMarks, 'a phone cell shows its strongest mark only').toBeLessThanOrEqual(1)
    await shoot(page, 'phone-390-month-light')
  })

  test('phone 390 x 844: a day opens as a bottom sheet on the bottom edge, opaque, with 44 px keys', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, S.sheet)
    await page.locator('.dd-sheet[data-state="open"]').waitFor()
    await page.waitForTimeout(350)
    const s = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.dd-sheet')!
      const r = el.getBoundingClientRect()
      const small = [...el.querySelectorAll<HTMLElement>('button')].filter((b) => b.getClientRects().length).map((b) => ({ n: b.textContent?.trim().slice(0, 20) ?? '', w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })).filter((b) => b.h < 43.5 || b.w < 43.5).map((b) => `${b.n} ${Math.round(b.w)}x${Math.round(b.h)}`)
      return { place: el.dataset.place, bottom: Math.round(r.bottom), vh: innerHeight, w: Math.round(r.width), vw: innerWidth, h: Math.round(r.height), small, sideways: el.scrollWidth - el.clientWidth }
    })
    expect(s.place).toBe('bottom')
    expect(s.bottom).toBe(s.vh)
    expect(s.w).toBe(s.vw)
    expect(s.h).toBeLessThanOrEqual(Math.round(s.vh * 0.88) + 1)
    expect(s.sideways).toBeLessThanOrEqual(0)
    expect(s.small, 'sheet targets under 44 px').toEqual([])
    expect((await opaque(page, '.dd-sheet')).alpha).toBe(1)
    expect(worst(await contrast(page, '.dd-sheet'))).toEqual([])
    await shoot(page, 'phone-390-sheet-light', true)
  })
})
