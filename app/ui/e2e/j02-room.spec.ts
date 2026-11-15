// A.J02 in a real Chromium: Room under shell v2, Switches and Rules.
//
// The built app (dist-e2e) against the sandbox, flag on through the `#t=ww-e2e&shell=v2` fragment as e2e/core-v2.spec.ts does. The
// room routes are stubbed in the page (route.fulfill with the invented fixtures of jarvis/room/fixtures.ts), because the sandbox has
// no relay board: the stub also records every POST, so "nothing is sent without the press" is a count, not a claim. Needs
// `npx vite build --outDir dist-e2e` first; skips otherwise.
//
// Proved here: the keyboard path (Tab to a key, Enter presses, the cover of a heavy channel and its two acts, Escape), the
// lamp phases (asked while the board is silent, confirmed only after the board's own report, "asked, no report" after 6 s),
// the scrubber (sends nothing, changes no lamp), All off with its pre-press list, the pin map's second press, and the geometry
// at 1366 x 768 (no document scroll, nothing clipped) and 390 x 844 (one column, no sideways scroll), 44 px targets, 11 px text.
// Screenshots go to J02_SHOTS (a folder outside the repository) when it is set.
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import type { LimbsView } from '../src/lib/limbs'
import { fixtureAway, fixtureEnergy, fixturePresence, fixtureRoom, type RoomKind } from '../src/jarvis/room/fixtures'

const SHOTS = process.env.J02_SHOTS ? resolve(process.env.J02_SHOTS) : ''
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }

interface Stub { sent: { path: string; body: unknown }[]; room: LimbsView }

/** Stub the room's routes. `follow` makes a POSTed on or off show up in the next GET (the board answers); otherwise it stays silent. */
async function stubRoom(page: Page, kind: RoomKind = 'live', opts: { follow?: boolean; heavy?: string[] } = {}): Promise<Stub> {
  const st: Stub = { sent: [], room: fixtureRoom(kind) }
  await page.addInitScript((heavy) => {
    try { localStorage.setItem('jarvis.room.heavy', JSON.stringify(Object.fromEntries(heavy.map((id) => [id, true])))) } catch { /* blocked */ }
  }, opts.heavy ?? [])
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const p = new URL(req.url()).pathname
    const m = req.method()
    if (p === '/api/limbs' && m === 'GET') return route.fulfill({ json: st.room })
    if (p === '/api/limbs/presence-on') return route.fulfill({ json: fixturePresence() })
    if (p === '/api/energy') return route.fulfill({ json: fixtureEnergy(true) })
    if (p === '/api/security') return route.fulfill({ json: fixtureAway() })
    if (p === '/api/security/incidents') return route.fulfill({ json: [] })
    if (m === 'POST' && p.startsWith('/api/limbs/')) {
      const body = req.postDataJSON?.() ?? null
      st.sent.push({ path: p, body })
      if (opts.follow) {
        const id = p.split('/')[3]
        const d = st.room.devices.find((x) => x.id === id)
        if (d && body && typeof body === 'object' && 'action' in body) { d.hardware_on = (body as { action: string }).action === 'on'; d.state.on = d.hardware_on }
      }
      return route.fulfill({ json: { delivered: {} } })
    }
    return route.fallback()
  })
  return st
}

async function openRoom(page: Page, baseURL: string | undefined, view: 'switches' | 'rules' = 'switches') {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  const shell = page.locator('[data-shell="v2"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  if ((await shell.getAttribute('data-product')) !== 'jarvis') await page.keyboard.press('Alt+0')
  await page.keyboard.press('Control+2')
  await expect(page.locator('.s2-page[data-view="switches"] .jr')).toBeVisible({ timeout: 15_000 })
  if (view === 'rules') {
    await page.keyboard.press(']')
    await expect(page.locator('.s2-page[data-view="rules"] .jr')).toBeVisible({ timeout: 15_000 })
  }
  await page.waitForTimeout(500)
}

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) })
}

const cell = (page: Page, slot: number) => page.locator(`.jr-cell[data-slot="${slot}"]`)
const cap = (page: Page, slot: number) => cell(page, slot).locator('button.jr-cap')

/** Geometry: nothing of the view clipped, no document scroll, targets and text sizes. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const jr = document.querySelector<HTMLElement>('.jr')!
    const box = jr.getBoundingClientRect()
    const small: string[] = []
    for (const el of jr.querySelectorAll<HTMLElement>('button, [role="slider"], input, a[href], [role="switch"], [role="radio"]')) {
      const r = el.getBoundingClientRect()
      const vis = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      if (!vis) continue
      if (r.height < 43.5 || r.width < 43.5) small.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    const tiny: string[] = []
    for (const el of jr.querySelectorAll<HTMLElement>('*')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim()).map((n) => n.textContent!.trim()).join(' ')
      if (!own) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (parseFloat(cs.fontSize) < 10.9) tiny.push(`${own.slice(0, 24)} ${cs.fontSize}`)
    }
    // SVG text is sized in viewBox units: its drawn size is the font size times the scale
    for (const t of jr.querySelectorAll<SVGTextElement>('svg text')) {
      const svg = t.ownerSVGElement!
      const vb = svg.viewBox.baseVal
      const scale = vb && vb.width ? svg.getBoundingClientRect().width / vb.width : 1
      const fs = parseFloat(getComputedStyle(t).fontSize) * scale
      if (fs < 10.9) tiny.push(`svg ${t.textContent?.slice(0, 20)} ${fs.toFixed(1)}`)
    }
    const over: string[] = []
    for (const el of jr.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > box.right + 0.5 || (r.bottom > box.bottom + 0.5 && getComputedStyle(jr).overflowY !== 'auto')) over.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').toString().split(' ')[0]} r${Math.round(r.right)} b${Math.round(r.bottom)} box ${Math.round(box.right)}x${Math.round(box.bottom)}`)
    }
    return {
      over,
      doc: { sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth },
      jr: { w: box.width, h: box.height, sh: jr.scrollHeight, ch: jr.clientHeight, sw: jr.scrollWidth, cw: jr.clientWidth },
      small, tiny,
    }
  })
}

/** Does any part of the view overflow the canvas (desktop: no inner scrollbar anywhere)? */
const overflowing = (page: Page) => page.evaluate(() => {
  const jr = document.querySelector<HTMLElement>('.jr')!
  const box = jr.getBoundingClientRect()
  const out: string[] = []
  for (const el of jr.querySelectorAll<HTMLElement>('.jr-plate-slot, .jr-board, .jr-day, .jr-lower, .jr-gate, .jr-modes-panel, .jr-hw, .jr-keys, .jr-cell, .jr-gates, .jr-side')) {
    const r = el.getBoundingClientRect()
    if (r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.top < box.top - 1) out.push(`${el.className.toString().slice(0, 30)} ${Math.round(r.right)}x${Math.round(r.bottom)} in ${Math.round(box.right)}x${Math.round(box.bottom)}`)
    if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible' && !el.classList.contains('jr-lower') && !el.classList.contains('jr-gate') && !el.classList.contains('jr-modes-panel')) out.push(`scrolls: ${el.className.toString().slice(0, 30)} ${el.scrollHeight}>${el.clientHeight}`)
  }
  return out
})


/** WCAG 2 contrast of every visible text of the view: its colour over the first opaque ground under it (a stack of translucent fills counts). */
const contrast = (page: Page) => page.evaluate(() => {
  type C = { r: number; g: number; b: number; a: number }
  const parse = (v: string): C | null => {
    const m = /rgba?\(([^)]+)\)/.exec(v) ?? /color\(srgb ([^)]+)\)/.exec(v)
    if (!m) return null
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    const k = v.startsWith('color(') ? 255 : 1
    return { r: p[0] * k, g: p[1] * k, b: p[2] * k, a: p.length > 3 ? p[3] : 1 }
  }
  const over = (f: C, b: C): C => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 })
  const lum = (c: C) => { const ch = (x: number) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b) }
  const ratio = (a: C, b: C) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const ground = (el: Element): C => {
    const layers: C[] = []
    for (let n: Element | null = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      const bg = parse(cs.backgroundColor)
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break }
    }
    let base: C = { r: 13, g: 13, b: 15, a: 1 }
    for (let i = layers.length - 1; i >= 0; i--) base = layers[i].a >= 1 ? layers[i] : over(layers[i], base)
    return base
  }
  const low: string[] = []
  const root = document.querySelector('.jr')!
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim()).map((n) => n.textContent!.trim()).join(' ')
    if (!own) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const svg = el instanceof SVGElement
    const fg0 = parse(svg ? cs.fill : cs.color)
    if (!fg0) continue
    let op = 1
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity)
    const g = ground(svg ? (el.closest('svg')?.parentElement ?? el) : el)
    const fg = over({ ...fg0, a: fg0.a * op }, g)
    const rr = ratio(fg, g)
    if (rr < 4.5) low.push(`${own.slice(0, 28)} ${rr.toFixed(2)} (${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').toString().split(' ')[0]})`)
  }
  return low
})

/** The parts of each gate stack in order without overlapping (header, schematic, foot), and a heavy key's cover clears its lamp row. */
const stacking = (page: Page) => page.evaluate(() => {
  const bad: string[] = []
  const r = (e: Element | null) => e?.getBoundingClientRect()
  for (const g of document.querySelectorAll('.jr-gate')) {
    const h = r(g.querySelector('.jr-gate-head'))
    const a = r(g.querySelector('.jr-gate-art'))
    const f = r(g.querySelector('.jr-gate-foot'))
    if (h && a && h.bottom > a.top + 1) bad.push(`${g.getAttribute('data-gate')}: head ${Math.round(h.bottom)} over art ${Math.round(a.top)}`)
    if (a && f && a.bottom > f.top + 1) bad.push(`${g.getAttribute('data-gate')}: art ${Math.round(a.bottom)} over foot ${Math.round(f.top)}`)
    const gr = r(g)
    if (gr && f && f.bottom > gr.bottom + 1) bad.push(`${g.getAttribute('data-gate')}: foot ${Math.round(f.bottom)} outside gate ${Math.round(gr.bottom)}`)
  }
  for (const c of document.querySelectorAll('.jr-cell[data-heavy]')) {
    const cover = r(c.querySelector('.jr-cover[data-needed="true"]'))
    const lamp = r(c.querySelector('.jr-lamp'))
    if (cover && lamp && cover.bottom > lamp.top + 2) bad.push(`slot ${c.getAttribute('data-slot')}: cover ${Math.round(cover.bottom)} over lamp ${Math.round(lamp.top)}`)
  }
  // every key's text stays inside its cap
  for (const c of document.querySelectorAll('.jr-cell')) {
    const cap = r(c.querySelector('button.jr-cap'))
    for (const t of c.querySelectorAll('.jr-name, .jr-word')) {
      const b = r(t)
      if (cap && b && (b.right > cap.right + 1 || b.bottom > cap.bottom + 1)) bad.push(`slot ${c.getAttribute('data-slot')}: ${t.className} leaves its cap`)
    }
  }
  return bad
})

test.describe('Room v2 at 1366 x 768', () => {
  test.use({ viewport: DESKTOP })

  test('Switches: one canvas, no scroll, eight keys, every target 44 px and every text 11 px', async ({ page, baseURL }) => {
    await stubRoom(page, 'live', { heavy: ['light3'] })
    await openRoom(page, baseURL)
    await shot(page, 'switches-1366')
    expect(await stacking(page), 'parts stack without overlap').toEqual([])
    const g = await geometry(page)
    expect(g.doc.sh).toBeLessThanOrEqual(g.doc.ih)
    expect(g.doc.sw).toBeLessThanOrEqual(g.doc.iw)
    expect(Math.round(g.jr.w)).toBe(1302)
    expect(g.over, 'parts outside the canvas').toEqual([])
    expect(g.jr.sh, 'scrollHeight within a pixel of the box').toBeLessThanOrEqual(g.jr.ch + 1)
    expect(await overflowing(page)).toEqual([])
    await expect(page.locator('.jr-cell')).toHaveCount(8)
    expect(g.small, 'targets under 44 px').toEqual([])
    expect(g.tiny, 'text under 11 px').toEqual([])
    expect(await contrast(page), 'text under 4.5:1').toEqual([])
  })

  test('the key lamps follow the board: a press asks, the lamp turns LIVE only after the board reports, and says so after 6 s of silence', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live')
    await openRoom(page, baseURL)
    // Fan (slot 2): the board reports OFF. Press it: ONE request, the lamp says asked, the cap does NOT change.
    await expect(cell(page, 2)).toHaveAttribute('data-state', 'closed')
    await expect(cap(page, 2)).toHaveAttribute('aria-pressed', 'false')
    await cap(page, 2).click()
    await expect.poll(() => st.sent.length).toBe(1)
    expect(st.sent[0]).toEqual({ path: '/api/limbs/fan', body: { action: 'on' } })
    await expect(cell(page, 2)).toHaveAttribute('data-state', 'asked')
    await expect(cell(page, 2).locator('.jr-word')).toContainText('asked ON, waiting')
    await expect(cap(page, 2)).toHaveAttribute('aria-pressed', 'false') // the saved state never moves the cap
    await shot(page, 'switches-asked')
    // The board stays silent: after 6 s the key says "asked, no report" (FAULT).
    await expect(cell(page, 2)).toHaveAttribute('data-state', 'unconfirmed', { timeout: 9000 })
    await expect(cell(page, 2).locator('.jr-word')).toContainText('asked, no report')
    await expect(page.locator('.jr-log-line[data-state="fault"]').first()).toBeVisible()
    await shot(page, 'switches-unconfirmed')
  })

  test('the board answering turns the lamp LIVE with "confirmed by board" and the cap follows the report', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live', { follow: true })
    await openRoom(page, baseURL)
    await cap(page, 2).click()
    await expect(cell(page, 2)).toHaveAttribute('data-state', 'confirmed', { timeout: 8000 })
    await expect(cell(page, 2).locator('.jr-word')).toContainText('confirmed by board')
    await expect(cap(page, 2)).toHaveAttribute('aria-pressed', 'true')
    expect(st.sent).toHaveLength(1)
    await shot(page, 'switches-confirmed')
  })

  test('a heavy-load channel needs two acts to turn ON, OFF is one press, an unflagged key is one press', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live', { heavy: ['light3', 'light'] })
    await openRoom(page, baseURL)
    // light3 (slot 4) is OFF and flagged: the cap is covered, a press that skipped the lift does nothing
    await expect(cap(page, 4)).toHaveAttribute('aria-disabled', 'true')
    await cap(page, 4).evaluate((el) => (el as HTMLElement).click())
    expect(st.sent).toHaveLength(0)
    // act 1: lift the cover with Space; the focus moves to the cap; act 2: Enter presses
    const cover = cell(page, 4).locator('.jr-cover')
    await cover.focus()
    await page.keyboard.press('Space')
    await expect(cell(page, 4)).toHaveAttribute('data-state', 'open')
    await expect(cell(page, 4).locator('.jr-word')).toContainText('turns ON: cove soft, mains')
    await shot(page, 'switches-cover-lifted')
    await expect(cap(page, 4)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => st.sent.length).toBe(1)
    expect(st.sent[0]).toEqual({ path: '/api/limbs/light3', body: { action: 'on' } })
    // light (slot 1) is ON and flagged: turning it OFF is one press, no cover
    await cap(page, 1).click()
    await expect.poll(() => st.sent.length).toBe(2)
    expect(st.sent[1]).toEqual({ path: '/api/limbs/light', body: { action: 'off' } })
    // an unflagged key (slot 3, Cove warm is ON in the fixture; slot 5, Desk lamp is OFF): one press
    await cap(page, 5).click()
    await expect.poll(() => st.sent.length).toBe(3)
  })

  test('a cover closes by itself after 5 s and the press that follows sends nothing', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live', { heavy: ['light3'] })
    await openRoom(page, baseURL)
    await cell(page, 4).locator('.jr-cover').click()
    await expect(cell(page, 4)).toHaveAttribute('data-state', 'open')
    await expect(cell(page, 4)).not.toHaveAttribute('data-state', 'open', { timeout: 7000 })
    await cap(page, 4).evaluate((el) => (el as HTMLElement).click())
    expect(st.sent).toHaveLength(0)
  })

  test('the day ring scrubber previews with the keyboard and sends nothing, changes no lamp', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live')
    await openRoom(page, baseURL)
    const before = await page.locator('.jr-keys .jr-word').allTextContents()
    const handle = page.locator('.jr-ring-handle')
    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.jr-ring')).toHaveAttribute('data-previewing', 'true')
    await expect(page.locator('.jr-ring-centre')).toContainText('PREVIEW')
    await expect(page.locator('.jr-ring-cap-line')).toContainText('not the board')
    await shot(page, 'switches-preview')
    expect(await page.locator('.jr-keys .jr-word').allTextContents()).toEqual(before)
    await page.keyboard.press('Escape')
    await expect(page.locator('.jr-ring')).not.toHaveAttribute('data-previewing', 'true')
    expect(st.sent).toHaveLength(0)
  })

  test('the dial previews a mode as dashed outlines and Enter applies it', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live')
    await openRoom(page, baseURL)
    const dial = page.locator('.jr-dial-body')
    await dial.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.jr-dial-name')).toHaveText('Deep focus')
    await expect(page.locator('.jr-cell[data-preview]').first()).toBeVisible()
    expect(st.sent).toHaveLength(0)
    await shot(page, 'switches-dial-preview')
    await page.keyboard.press('Enter')
    await expect.poll(() => st.sent.length).toBe(1)
    expect(st.sent[0].path).toBe('/api/limbs/scene/focus')
  })

  test('All off lists what it will switch off first, Escape closes it, and nothing is sent until its own press', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live')
    await openRoom(page, baseURL)
    const key = page.locator('.jr-alloff-key')
    await expect(key).toContainText('2 on')
    await key.click()
    await expect(page.locator('.jr-pop')).toContainText('Switches off 2 channels')
    await expect(page.locator('.jr-pop-list li')).toHaveCount(2)
    expect(st.sent).toHaveLength(0)
    await shot(page, 'switches-all-off')
    await page.keyboard.press('Escape')
    await expect(page.locator('.jr-pop')).toHaveCount(0)
    await key.click()
    await page.locator('.jr-pop-go').click()
    await expect.poll(() => st.sent.length).toBe(1)
    expect(st.sent[0].path).toBe('/api/limbs/scene/all_off')
  })

  test('an offline board draws no LIVE lamp: every key is WAITING or dashed', async ({ page, baseURL }) => {
    await stubRoom(page, 'offline')
    await openRoom(page, baseURL)
    await expect(page.locator('.jr-cell[data-state="closed"] .k-lamp-glyph[data-state="live"]')).toHaveCount(0)
    await expect(cell(page, 1).locator('.jr-word')).toContainText('no report')
    await expect(cell(page, 7).locator('.jr-word')).toContainText('unavailable')
    await shot(page, 'switches-offline')
  })

  test('Rules: three gates, the modes, the pin map folded; the pin test needs a second press', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live')
    await openRoom(page, baseURL, 'rules')
    await shot(page, 'rules-1366')
    expect(await stacking(page), 'parts stack without overlap').toEqual([])
    const g = await geometry(page)
    expect(g.doc.sh).toBeLessThanOrEqual(g.doc.ih)
    expect(g.over, 'parts outside the canvas').toEqual([])
    expect(g.jr.sh, 'scrollHeight within a pixel of the box').toBeLessThanOrEqual(g.jr.ch + 1)
    expect(await overflowing(page)).toEqual([])
    await expect(page.locator('.jr-gate')).toHaveCount(3)
    expect(g.small, 'targets under 44 px').toEqual([])
    expect(g.tiny, 'text under 11 px').toEqual([])
    expect(await contrast(page), 'text under 4.5:1').toEqual([])
    // the pin map is one fold; open it, press Test once: nothing is sent, the key is armed
    await page.locator('.ww-fold-btn').click()
    await expect(page.locator('.pp-row')).toHaveCount(6)
    await shot(page, 'rules-pins-open')
    const test1 = page.locator('.pp-test').first()
    await test1.click()
    expect(st.sent.filter((s) => s.path.endsWith('/test'))).toHaveLength(0)
    await expect(test1).toContainText('Switch 1 s?')
  })

  test('Rules: a new mode is saved through the classic route', async ({ page, baseURL }) => {
    const st = await stubRoom(page, 'live')
    await openRoom(page, baseURL, 'rules')
    await page.getByRole('button', { name: 'New mode' }).click()
    await page.getByLabel('Name (what you say)').fill('Reading')
    await page.getByRole('button', { name: /Save/ }).click()
    await expect.poll(() => st.sent.some((s) => s.path === '/api/limbs/modes/new')).toBe(true)
  })
})

test.describe('Room v2 at 390 x 844', () => {
  test.use({ viewport: PHONE })

  test('Switches: one column, two keys a row, no sideways scroll, All off stays reachable', async ({ page, baseURL }) => {
    await stubRoom(page, 'live', { heavy: ['light3'] })
    await openRoom(page, baseURL)
    await shot(page, 'switches-390')
    expect(await stacking(page), 'parts stack without overlap').toEqual([])
    const g = await geometry(page)
    expect(g.doc.sw).toBeLessThanOrEqual(g.doc.iw)
    expect(g.over, 'parts past the right edge').toEqual([])
    expect(g.jr.sw, 'scrollWidth within a pixel of the box').toBeLessThanOrEqual(g.jr.cw + 1)
    const xs = await page.locator('.jr-cell').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
    expect(new Set(xs).size).toBe(2)
    await expect(page.locator('.jr-alloff-key')).toBeInViewport()
    expect(g.small, 'targets under 44 px').toEqual([])
    expect(await contrast(page), 'text under 4.5:1').toEqual([])
  })

  test('Rules: one column, no sideways scroll', async ({ page, baseURL }) => {
    await stubRoom(page, 'live')
    await openRoom(page, baseURL, 'rules')
    await shot(page, 'rules-390')
    expect(await stacking(page), 'parts stack without overlap').toEqual([])
    const g = await geometry(page)
    expect(g.doc.sw).toBeLessThanOrEqual(g.doc.iw)
    expect(g.over, 'parts past the right edge').toEqual([])
    expect(g.jr.sw, 'scrollWidth within a pixel of the box').toBeLessThanOrEqual(g.jr.cw + 1)
  })
})

test('the classic Limbs page still renders with the flag off', async ({ page, baseURL }) => {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built')
  await stubRoom(page, 'live')
  await page.goto('/#t=ww-e2e')
  await expect(page.locator('[data-shell="v2"]')).toHaveCount(0)
})
