// EL-ROOM (20 Nov 2026): the elevation of Room under shell v2, in a real Chromium, the shell opened with `#t=ww-e2e&shell=v2`.
//
// What the 19 Nov jury asked for, as measurements: the wall box is the hero with its modes beside the dial (44 px keys with
// their numbers), eight same-size tiles with the absent ones recessed and caption-named, no state or reason cut with an
// ellipsis, a three-line terminal that opens on focus, rules whose title and toggle share a row, a phone page with a 56 px
// sticky All off and one vertical line per rule. The room routes are stubbed in the page with the invented fixtures of
// jarvis/room/fixtures.ts (no board in the sandbox); every POST is recorded, so "nothing is sent without the press" is a count.
// Needs `npx vite build --outDir dist-e2e` first; skips otherwise. Screenshots go to EL_ROOM_SHOTS (outside the repository).
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import type { LimbsView } from '../src/lib/limbs'
import { fixtureAway, fixtureEnergy, fixturePresence, fixtureRoom } from '../src/jarvis/room/fixtures'

const SHOTS = process.env.EL_ROOM_SHOTS ? resolve(process.env.EL_ROOM_SHOTS) : ''
const DESKTOP = { width: 1366, height: 768 }
const SMALL = { width: 1120, height: 720 }
const PHONE = { width: 390, height: 844 }

interface Stub { sent: { path: string; body: unknown }[]; room: LimbsView }

async function stubRoom(page: Page): Promise<Stub> {
  const st: Stub = { sent: [], room: fixtureRoom('live') }
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
      st.sent.push({ path: p, body: req.postDataJSON?.() ?? null })
      return route.fulfill({ json: { delivered: {} } })
    }
    return route.fallback()
  })
  return st
}

async function openRoom(page: Page, baseURL: string | undefined, view: 'switches' | 'rules') {
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

/** Nodes that carry a state or a reason must show all of it: no ellipsis, no clipped width, no clipped height, at most two lines. */
const noCutState = (page: Page) => page.evaluate(() => {
  const bad: string[] = []
  const sel = '.jr-gate-lamp, .jr-gate-reason, .jr-gate-last, .jr-gate-title, .jr-note, .jr-word, .jr-dial-hint, .jr-dial-name, .jr-board-list dd, .jr-board-problems li, .jr-armed, .jr-mode-detail, .jr-ring-cap-line, .jr-pop-head'
  for (const el of document.querySelectorAll<HTMLElement>(`.jr ${sel.split(', ').join(', .jr ')}`)) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const cs = getComputedStyle(el)
    const what = `${el.className.toString().split(' ')[0]} "${(el.textContent ?? '').slice(0, 24)}"`
    if (cs.textOverflow === 'ellipsis') bad.push(`${what}: text-overflow ellipsis`)
    if (el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline') bad.push(`${what}: clipped width ${el.scrollWidth}>${el.clientWidth}`)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3
    if (cs.display !== 'inline' && cs.display !== 'inline-flex' && r.height > lh * 3.05) bad.push(`${what}: wraps past three lines (${Math.round(r.height / lh)})`)
    if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'visible' && cs.display !== 'inline') bad.push(`${what}: clipped height`)
  }
  return bad
})

/** Every part inside the view box; every key's engraving inside its cap and not over its neighbour; no inner scroll on a laptop canvas. */
const fits = (page: Page) => page.evaluate(() => {
  const bad: string[] = []
  const jr = document.querySelector<HTMLElement>('.jr')!
  const box = jr.getBoundingClientRect()
  const scrolls = getComputedStyle(jr).overflowY === 'auto'
  for (const el of jr.querySelectorAll<HTMLElement>('.jr-face-plate, .jr-board, .jr-day, .jr-lower, .jr-gate, .jr-modes-panel, .jr-heavy, .jr-hw, .jr-cell, .jr-gates, .jr-side')) {
    const r = el.getBoundingClientRect()
    if (r.right > box.right + 1 || r.left < box.left - 1 || (!scrolls && (r.bottom > box.bottom + 1 || r.top < box.top - 1))) bad.push(`${el.className.toString().split(' ')[0]} outside the box (${Math.round(r.right)}x${Math.round(r.bottom)} in ${Math.round(box.right)}x${Math.round(box.bottom)})`)
  }
  for (const c of jr.querySelectorAll<HTMLElement>('.jr-cell')) {
    const cap = c.querySelector('button.jr-cap')!.getBoundingClientRect()
    const parts = [...c.querySelectorAll<HTMLElement>('.jr-name, .jr-word, .jr-no, .jr-ico svg, .jr-led')].filter((t) => t.getBoundingClientRect().width > 0)
    for (const t of parts) {
      const b = t.getBoundingClientRect()
      if (b.right > cap.right + 1 || b.bottom > cap.bottom + 1 || b.left < cap.left - 1 || b.top < cap.top - 1) bad.push(`slot ${c.getAttribute('data-slot')}: ${t.className.toString().split(' ')[0]} leaves its cap`)
    }
    const word = c.querySelector<HTMLElement>('.jr-word')!
    if (word.scrollHeight > word.clientHeight + 1 || word.scrollWidth > word.clientWidth + 1) bad.push(`slot ${c.getAttribute('data-slot')}: its lamp word is cut`)
    const ico = c.querySelector('.jr-ico svg')?.getBoundingClientRect()
    const lamp = c.querySelector('.jr-lamp')?.getBoundingClientRect()
    if (ico && lamp && ico.width > 0 && ico.bottom > lamp.top + 1) bad.push(`slot ${c.getAttribute('data-slot')}: icon over its lamp row`)
  }
  return bad
})

const cell = (page: Page, slot: number) => page.locator(`.jr-cell[data-slot="${slot}"]`)

test.describe('EL-ROOM Switches at 1366 x 768', () => {
  test.use({ viewport: DESKTOP })

  test('the wall box is the hero: modes beside the dial at 44 px with their numbers, eight same-size tiles, three-line terminal', async ({ page, baseURL }) => {
    const st = await stubRoom(page)
    await openRoom(page, baseURL, 'switches')
    await shot(page, 'switches-1366')
    // one canvas
    const d = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }))
    expect(d.sh).toBeLessThanOrEqual(d.ih)
    expect(d.sw).toBeLessThanOrEqual(d.iw)
    expect(await fits(page)).toEqual([])
    expect(await noCutState(page), 'no state or reason cut').toEqual([])
    // the hero: the faceplate is the largest surface of the view
    const areas = await page.evaluate(() => [...document.querySelectorAll('.jr-face-plate, .jr-board, .jr-day, .jr-lower')].map((e) => { const r = e.getBoundingClientRect(); return [e.className.toString().split(' ')[0], r.width * r.height] as [string, number] }))
    const plate = areas.find((a) => a[0] === 'jr-face-plate')![1]
    expect(plate, 'the faceplate is the largest surface').toBe(Math.max(...areas.map((a) => a[1])))
    // eight tiles of one size
    const sizes = await page.locator('.jr-cell').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` }))
    expect(sizes).toHaveLength(8)
    expect(new Set(sizes).size, `tiles ${sizes.join(' ')}`).toBe(1)
    // absent tiles: recessed, dashed lamp glyph, the word unavailable, a caption, never a raw id
    const absent = page.locator('.jr-cell[data-absent="true"]')
    expect(await absent.count()).toBeGreaterThan(0)
    for (const t of await absent.locator('.jr-name').allTextContents()) expect(t).toBe('Free slot')
    for (const t of await absent.locator('.jr-word').allTextContents()) expect(t).toBe('unavailable')
    await expect(absent.first().locator('.k-lamp-glyph')).toHaveAttribute('data-state', 'planned')
    expect(await page.locator('.jr-keys').innerText()).not.toMatch(/\blight[2-5]\b/)
    // modes: 44 px keys beside the dial, numbered
    const chips = page.locator('.jr-plate-right .jr-chips button')
    expect(await chips.count()).toBeGreaterThanOrEqual(3)
    for (const h of await chips.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))) expect(h).toBeGreaterThanOrEqual(44)
    await expect(chips.first().locator('.jr-modeno')).toHaveText('1')
    const dialBox = (await page.locator('.jr-dial-body').boundingBox())!
    const chipBox = (await chips.first().boundingBox())!
    expect(chipBox.x, 'the modes sit beside the dial').toBeGreaterThan(dialBox.x + dialBox.width)
    // the All off chip is a mode, not the guarded key: pressing it asks the scene route, never the board key
    await chips.filter({ hasText: 'All off' }).click()
    await expect.poll(() => st.sent.length).toBe(1)
    expect(st.sent[0].path).toBe('/api/limbs/scene/all_off')
    // terminal: three lines at rest, the log when it has the focus
    const term = page.locator('.jr-term')
    await expect(term).toHaveAttribute('data-open', 'false')
    expect(await term.locator('.g-line').count()).toBe(3)
    await term.locator('.jr-term-toggle').focus()
    await expect(term, 'focus alone does not open it').toHaveAttribute('data-open', 'false')
    await page.keyboard.press('Enter')
    await expect(term).toHaveAttribute('data-open', 'true')
    expect(await term.locator('.g-line').count()).toBeGreaterThan(3)
    await shot(page, 'switches-term-open')
    expect(await fits(page)).toEqual([])
    // the bottom gutter equals the column gap
    const gap = await page.evaluate(() => { const jr = document.querySelector('.jr')!; const cs = getComputedStyle(jr); return { pb: parseFloat(cs.paddingBottom), cg: parseFloat(cs.columnGap) } })
    expect(gap.pb).toBe(gap.cg)
  })

  test('the day ring column is 264 px, its caption is one line with a lamp, and the ring leaves room below it', async ({ page, baseURL }) => {
    await stubRoom(page)
    await openRoom(page, baseURL, 'switches')
    const day = (await page.locator('.jr-day').boundingBox())!
    expect(day.width).toBeGreaterThanOrEqual(220)
    expect(day.width).toBeLessThanOrEqual(264)
    const cap = page.locator('.jr-ring-quiet')
    await expect(cap).toHaveText('Channel schedules: PLANNED')
    await expect(cap.locator('svg')).toBeVisible()
    const c = (await cap.boundingBox())!
    expect(c.height, 'one line').toBeLessThan(24)
    expect(day.y + day.height - (c.y + c.height), 'room below the caption').toBeGreaterThanOrEqual(8)
    // 11 px text at the drawn scale
    const small = await page.locator('.jr-ring svg text').evaluateAll((ts) => ts.map((t) => { const s = (t as SVGTextElement).ownerSVGElement!; return parseFloat(getComputedStyle(t).fontSize) * (s.getBoundingClientRect().width / 280) }).filter((f) => f < 10.9))
    expect(small).toEqual([])
  })

  test('the keyboard path: a number key applies a mode from inside the wall box, a heavy mode still asks twice, Tab reaches the dial, the keys and the terminal', async ({ page, baseURL }) => {
    const st = await stubRoom(page)
    await page.addInitScript(() => { try { localStorage.setItem('jarvis.room.heavy', JSON.stringify({ light3: true })) } catch { /* blocked */ } })
    await openRoom(page, baseURL, 'switches')
    await page.locator('.jr-dial-body').focus()
    await page.keyboard.press('3') // Sleep: touches no flagged channel
    await expect.poll(() => st.sent.length).toBe(1)
    expect(st.sent[0].path).toBe('/api/limbs/scene/sleep')
    await page.keyboard.press('2') // Relaxation turns ON the flagged light3: asks first
    await expect(page.locator('.jr-armed').first()).toContainText('Press the mode again')
    expect(st.sent).toHaveLength(1)
    await page.keyboard.press('2')
    await expect.poll(() => st.sent.length).toBe(2)
    expect(st.sent[1].path).toBe('/api/limbs/scene/relaxation')
    // the terminal button is reached by Tab and opens on Enter
    await page.locator('.jr-day [role="slider"]').focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('.jr-term-toggle')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.jr-term')).toHaveAttribute('data-open', 'true')
    await page.keyboard.press('Escape')
    await expect(page.locator('.jr-term')).toHaveAttribute('data-open', 'false')
  })

  test('Rules: title and toggle share a row, the lamp line wraps under them, nothing is cut, the legend is one line, Heavy loads takes the freed height', async ({ page, baseURL }) => {
    await stubRoom(page)
    await openRoom(page, baseURL, 'rules')
    await shot(page, 'rules-1366')
    expect(await fits(page)).toEqual([])
    expect(await noCutState(page), 'no state or reason cut').toEqual([])
    const rows = await page.locator('.jr-gate').evaluateAll((gs) => gs.map((g) => {
      const t = g.querySelector('.jr-gate-title')!.getBoundingClientRect()
      const l = g.querySelector('.jr-gate-lead')!.getBoundingClientRect()
      const lamp = g.querySelector('.jr-gate-lamp')!.getBoundingClientRect()
      return { sameRow: Math.abs((t.top + t.height / 2) - (l.top + l.height / 2)) < 12, below: lamp.top >= Math.max(t.bottom, l.bottom) - 6, h: Math.round(g.getBoundingClientRect().height) }
    }))
    for (const r of rows) { expect(r.sameRow).toBe(true); expect(r.below).toBe(true) }
    const legend = page.locator('.jr-legend')
    await expect(legend).toContainText('on')
    await expect(legend).toContainText('no report')
    expect(((await legend.boundingBox())!).height).toBeLessThan(22)
    const heights = await page.evaluate(() => ['.jr-modes-panel', '.jr-heavy', '.jr-hw'].map((s) => Math.round(document.querySelector(s)!.getBoundingClientRect().height)))
    expect(heights[1], 'Heavy loads is taller than Modes sized to their content would leave it').toBeGreaterThan(heights[0] * 0.4)
    // no 1 px outline on a card
    const edges = await page.evaluate(() => ['.jr-gate', '.jr-modes-panel', '.jr-heavy', '.jr-hw'].map((s) => getComputedStyle(document.querySelector(s)!).borderTopWidth))
    for (const w of edges) expect(w).toBe('0px')
  })

  test('the cards are lifted by elevation, not drawn by a 1 px border', async ({ page, baseURL }) => {
    await stubRoom(page)
    await openRoom(page, baseURL, 'switches')
    const w = await page.evaluate(() => ['.jr-face-plate', '.jr-board', '.jr-day'].map((s) => { const cs = getComputedStyle(document.querySelector(s)!); return [s, cs.borderTopWidth, cs.boxShadow !== 'none'] }))
    for (const [, border, shadow] of w) { expect(border).toBe('0px'); expect(shadow).toBe(true) }
    await page.locator('.jr-alloff-key').click()
    const pop = await page.evaluate(() => getComputedStyle(document.querySelector('.jr-pop')!).borderTopWidth)
    expect(pop).toBe('0px')
  })
})

test.describe('EL-ROOM at 1120 x 720, the smallest desktop window', () => {
  test.use({ viewport: SMALL })

  test('Switches: nothing overlaps, cut, or scrolls', async ({ page, baseURL }) => {
    await stubRoom(page)
    await openRoom(page, baseURL, 'switches')
    await shot(page, 'switches-1120')
    expect(await fits(page)).toEqual([])
    expect(await noCutState(page)).toEqual([])
    const d = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }))
    expect(d.sh).toBeLessThanOrEqual(d.ih)
  })

  test('Rules: the three gates fit the canvas', async ({ page, baseURL }) => {
    await stubRoom(page)
    await openRoom(page, baseURL, 'rules')
    await shot(page, 'rules-1120')
    expect(await fits(page)).toEqual([])
    expect(await noCutState(page)).toEqual([])
  })
})

test.describe('EL-ROOM at 390 x 844', () => {
  test.use({ viewport: PHONE })

  test('Switches: all eight tiles, absent ones 64 px, a 56 px sticky All off with a 16 px gap and a one-row mode strip', async ({ page, baseURL }) => {
    await stubRoom(page)
    await openRoom(page, baseURL, 'switches')
    await shot(page, 'switches-390')
    const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }))
    expect(d.sw).toBeLessThanOrEqual(d.iw)
    expect(await fits(page)).toEqual([])
    const absent = await page.locator('.jr-cell[data-absent="true"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    expect(absent.length).toBeGreaterThan(0)
    for (const h of absent) expect(h).toBe(64)
    // the key bar sticks: scroll the page area to its end and to its start, the bar stays 16 px above the area's end
    const bar = await page.evaluate(() => {
      const jr = document.querySelector<HTMLElement>('.jr')!
      const key = document.querySelector<HTMLElement>('.jr-alloff-key')!.getBoundingClientRect()
      const area = jr.getBoundingClientRect()
      const modes = [...document.querySelectorAll<HTMLElement>('.jr-modebar .ww-chip')].map((c) => { const r = c.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 8) })
      return { keyH: Math.round(key.height), gap: Math.round(area.bottom - key.bottom), modeRows: new Set(modes).size, modes: modes.length }
    })
    expect(bar.keyH).toBe(56)
    expect(bar.gap).toBeGreaterThanOrEqual(16)
    expect(bar.modeRows, 'one row of modes').toBe(1)
    expect(bar.modes).toBeGreaterThan(0)
    await page.locator('.jr').evaluate((el) => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(150)
    const end = await page.evaluate(() => {
      const keyEl = document.querySelector<HTMLElement>('.jr-alloff-key')!
      const area = document.querySelector<HTMLElement>('.jr')!.getBoundingClientRect()
      const key = keyEl.getBoundingClientRect()
      // the last card ends above the bar
      const lastCard = [...document.querySelectorAll<HTMLElement>('.jr-day, .jr-lower, .jr-dropup')].map((e) => e.getBoundingClientRect().bottom).reduce((a, b) => Math.max(a, b), 0)
      return { gap: Math.round(area.bottom - key.bottom), lastBottom: Math.round(lastCard), barTop: Math.round(key.top) }
    })
    expect(end.gap).toBeGreaterThanOrEqual(16)
    expect(end.lastBottom).toBeLessThanOrEqual(end.barTop)
  })

  test('Rules: the toggle stays on the title row, the inputs, the AND block and the outcome stack in one vertical line', async ({ page, baseURL }) => {
    await stubRoom(page)
    await openRoom(page, baseURL, 'rules')
    await shot(page, 'rules-390')
    const d = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }))
    expect(d.sw).toBeLessThanOrEqual(d.iw)
    expect(await fits(page)).toEqual([])
    expect(await noCutState(page)).toEqual([])
    const g = await page.locator('.jr-gate').evaluateAll((gs) => gs.map((x) => {
      const r = (s: string) => x.querySelector(s)!.getBoundingClientRect()
      const t = r('.jr-gate-title'); const l = r('.jr-gate-lead'); const ins = r('.jr-gate-in'); const sym = r('.jr-gate-sym'); const out = r('.jr-gate-out'); const lamp = r('.jr-gate-lamp')
      const head = r('.jr-gate-head')
      return {
        toggleOnTitleRow: l.top < t.bottom + 2 && l.bottom > t.top - 2,
        toggleRight: Math.abs(l.right - head.right) < 6,
        lampBelow: lamp.top >= l.bottom - 6,
        stacked: sym.top >= ins.bottom - 1 && out.top >= sym.bottom - 1,
        aligned: Math.abs(sym.left - ins.left) < 4 && Math.abs(out.left - ins.left) < 4,
        outDirectlyUnder: out.top - sym.bottom < 14,
      }
    }))
    for (const x of g) expect(x).toEqual({ toggleOnTitleRow: true, toggleRight: true, lampBelow: true, stacked: true, aligned: true, outDirectlyUnder: true })
  })
})
