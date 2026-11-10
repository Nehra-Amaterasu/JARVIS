// Chunk 8, the Life workspace in a real Chromium (plan 8.6): the no-scroll rule at 1366x768 and 1920x1080,
// hit areas, and the three themes. The real Frame and the real LifeWorkspace are built in memory by Vite from a
// virtual entry (nothing near app/ui/dist); the server is a fake behind page.route on a made-up origin, so no
// request leaves the machine and no data of the owner is read. Every row below is fictional.
//
// The data is the WORST case on purpose: 40 logged items, 12 subjects, reels waiting, three quest sets, a failure
// notice on screen. A workspace that fits then fits with the real day.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, Route } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from './fixtures'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
const ORIGIN = 'http://ww-life.test'
const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Frame } from '${posix(resolve(ROOT, 'src/ww/frame/Frame.tsx'))}'
import { LifeWorkspace } from '${posix(resolve(ROOT, 'src/ww/life/LifeWorkspace.tsx'))}'
import { usePlan } from '${posix(resolve(ROOT, 'src/germoney/game/plan.ts'))}'
import { useWorkoutStore } from '${posix(resolve(ROOT, 'src/germoney/stores/workout-store.ts'))}'
const h = React.createElement
const stub = (id) => () => h('div', { 'data-page': id }, 'Stub ' + id)
const pages = { study: stub('study'), tree: stub('tree'), life: LifeWorkspace, career: stub('career'), focus: stub('focus'), setup: stub('setup') }
window.WWLife = {
  mount(el, o) {
    usePlan.setState({ today: { contracts: o.contracts }, refresh: async () => {} })
    useWorkoutStore.setState({ sessions: o.sessions, isLoaded: true })
    createRoot(el).render(h(Frame, { loaded: true, pages, glass: 'blur' }))
  },
}
`
let bundle: Promise<{ js: string; css: string }> | null = null
function buildLife() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'dist-e2e')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, '_life-entry.jsx')
    writeFileSync(entry, ENTRY)
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry, formats: ['iife'], name: 'WWLifeBundle', fileName: 'life' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the life build produced no script')
    return { js, css }
  })()
  return bundle
}

// ---------------------------------------------------------------------------------------------- the fake server
interface Fixture {
  items: { kind: string; text: string; minutes?: number; explained?: string }[]
  due: { date: string; index: number; text: string; kind: string }[]
  subjects: number
  habits: number
  classes: { status: string | null }[]
}
const LONG = 'a long line about what was eaten or watched, long enough to need the ellipsis on one line and not wrap'
const worst = (): Fixture => ({
  items: Array.from({ length: 40 }, (_, i) => ({ kind: ['meal', 'anime', 'movie', 'series', 'reel'][i % 5], text: i < 3 ? LONG : `item ${i + 1}`, minutes: i % 2 ? 20 : undefined })),
  due: [{ date: '2026-11-08', index: 0, text: 'an older idea', kind: 'reel' }, { date: '2026-11-07', index: 1, text: 'another one', kind: 'reel' }],
  subjects: 12,
  habits: 6,
  classes: [{ status: 'present' }, { status: null }, { status: 'absent' }],
})
const light = (): Fixture => ({ items: [], due: [], subjects: 3, habits: 3, classes: [{ status: null }] })

function answers(f: Fixture) {
  const queued = f.items.filter((i) => i.kind === 'reel' && !i.explained).length
  const subject = (n: number) => {
    const held = [12, 3, 20, 9][n % 4]
    const need = n % 4 === 0 ? 3 : 0
    return { subject: `s${n}`, name: `Subject ${String.fromCharCode(65 + n)}`, held, attended: held - 2, weekly: 3, pct: (held - 2) / held, can_miss: need ? 0 : n % 4 === 2 ? 2 : 0, need, last: null }
  }
  return {
    day: {
      status: 'ok', say: '', rule: 'A counter you want less of gets a line: the median of your last 7 logged days minus 10 %. On or under it earns a point. A day over it is information, never a reset.', date: '2026-11-10',
      counters: [], items: f.items, points_today: 2, weeks: [{ ends: '2026-11-10', points: 9, logged: 5 }], reels_to_explain: f.due, last_grade: null,
      item_rows: f.items.map((it, index) => ({ index, ...it })), reels_pending: { queued_today: queued, due: f.due.length, total: queued + f.due.length },
    },
    attendance: {
      status: 'ok', date: '2026-11-10', say: '', risks: [], note: 'Margin is a buffer for a sick day, not a budget.',
      rule: { threshold: 0.75, scope: 'per_subject', confirmed: false },
      today: f.classes.map((c, i) => ({ id: `c${i}`, start: '10:00', end: '11:00', subject: `s${i}`, name: `Subject ${String.fromCharCode(65 + i)}`, kind: 'lecture', room: '', status: c.status })),
      subjects: Array.from({ length: f.subjects }, (_, n) => subject(n)), overall: null,
    },
    body: {
      status: 'ok', say: '',
      habits: Array.from({ length: f.habits }, (_, i) => ({ id: `h${i}`, target: `Habit number ${i + 1}`, per_week: 4, done_this_week: i % 4, today_done: i % 2 === 0, on_track: i % 3 !== 0, met: i % 4 === 3 })),
      focus: { id: 'posture', name: 'Posture', text: 'Stand tall for the first hour of the day, then check once after lunch.' },
    },
  }
}

const quest = (extra: object = {}) => ({
  key: 'q1', source: 'quest', slot: 'quest', title: 'Push-up ladder', minutes: 20, xp: 10, done: false, steps: [], hint: '', why: '',
  quest: { line: 'push', track: 'body', track_name: 'Push', level: 2, max_level: 5, sets: 3, target: 10, unit: 'reps', hits: ['a', 'b'], need: 2, top: false, ...extra },
})
const SESSIONS = [{ id: 's1', date: '2026-11-09T08:00:00Z', muscles: ['back', 'shoulders'], entries: [] }]

/**
 * The Frame's tabpanel is `.page.mission`, and in the app its box comes from styles/shell.css and mission.css
 * (absolute, inset 0, overflow auto, padding 18 28 28 22, then padding-top 10). A harness without them would give
 * the workspace an unbounded height and "fits" would be true of anything. The two rules are read from the real
 * files, so a change to the shell changes this test with it.
 */
function shellPage(): string {
  const take = (file: string, start: string) => {
    const line = readFileSync(resolve(ROOT, 'src/styles', file), 'utf8').split(/\r?\n/).find((l) => l.startsWith(start))
    if (!line) throw new Error(`${file} no longer has a "${start}" rule; update the Life harness`)
    return line
  }
  return take('shell.css', '.page { position: absolute') + take('mission.css', '.page.mission { padding-top')
}

interface Opts {
  fixture?: Fixture
  failDelete?: boolean
  html?: Record<string, string>
}
async function openLife(page: Page, o: Opts = {}) {
  const f = o.fixture ?? worst()
  const calls: { method: string; path: string; body: any }[] = []
  const { js, css } = await buildLife()
  const attrs = Object.entries({ 'data-motion': 'calm', ...(o.html ?? {}) }).map(([k, v]) => `${k}="${v}"`).join(' ')
  const font = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace}`
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html ${attrs}><head><meta charset="utf-8"><style>${font}</style><style>${shellPage()}</style><style>${css}</style></head><body style="margin:0"><main class="main" style="position:fixed;inset:0"><div id="root" style="position:absolute;inset:0"></div></main><script>${safe}</script></body></html>`
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route((u) => u.origin === ORIGIN && !u.pathname.startsWith('/api/'), (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.route((u) => u.origin === ORIGIN && u.pathname.startsWith('/api/'), async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined
    calls.push({ method: req.method(), path, body })
    const a = answers(f)
    if (path === '/api/mission/life/day') return json(route, a.day)
    if (path === '/api/mission/attendance') return json(route, a.attendance)
    if (path === '/api/mission/body') return json(route, a.body)
    if (path === '/api/mission/life/item/delete') {
      if (o.failDelete) return json(route, { detail: 'the server refused' }, 500)
      const [removed] = f.items.splice(body.index, 1)
      return json(route, { removed, index: body.index, ...answers(f).day })
    }
    if (path === '/api/mission/life/item/restore') {
      f.items.splice(body.index, 0, body.item)
      return json(route, answers(f).day)
    }
    if (path === '/api/mission/life/item') {
      f.items.push({ kind: body.kind, text: body.text, minutes: body.minutes })
      return json(route, answers(f).day)
    }
    return json(route, { ok: true, say: 'ok' })
  })
  await page.goto(ORIGIN + '/')
  await page.evaluate((c) => (window as unknown as { WWLife: { mount(el: HTMLElement, o: object): void } }).WWLife.mount(document.getElementById('root')!, c), { contracts: [quest()], sessions: SESSIONS })
  await page.waitForSelector('.ww-frame [role="tab"]')
  await page.keyboard.press('Alt+3')
  await page.waitForSelector('.ww-life [data-card="LF1"] .ww-life-body')
  await page.waitForSelector('.ww-life [data-card="LF2"] .ww-life-attbody')
  await page.waitForTimeout(250)
  return calls
}

const VIEWPORTS = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]
const THEMES: Record<string, string | null> = { ash: null, paper: 'paper', indigo: 'indigo' }
const setTheme = (page: Page, theme: string | null) =>
  page.evaluate((t) => (t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme')), theme)
const setView = async (page: Page, label: string) => {
  await page.getByRole('radio', { name: label }).click()
  await page.waitForTimeout(80)
}

/** What the centre looks like: does anything scroll, and does any visible card leave the workspace box. */
async function fit(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[role="tabpanel"]') as HTMLElement
    const life = document.querySelector('.ww-life') as HTMLElement
    const box = life.getBoundingClientRect()
    const cards = [...life.querySelectorAll<HTMLElement>('[data-card]')].filter((c) => c.getBoundingClientRect().height > 0)
    const outside = cards
      .map((c) => ({ id: c.dataset.card, r: c.getBoundingClientRect() }))
      .filter((c) => c.r.bottom > box.bottom + 0.5 || c.r.right > box.right + 0.5)
      .map((c) => `${c.id}: bottom ${Math.round(c.r.bottom)} / ${Math.round(box.bottom)}`)
    // anything inside a visible card that is wider than the card (a long unbroken line)
    const wide = [...life.querySelectorAll<HTMLElement>('[data-card] *')]
      .filter((e) => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible')
      .map((e) => `${e.className || e.tagName}`)
      .slice(0, 5)
    // which element reaches past the workspace's right edge (names the culprit when sideways scroll appears)
    const beyond = [...life.querySelectorAll<HTMLElement>('*')]
      .filter((e) => !e.closest('[hidden]') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > box.right + 0.5)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} right ${Math.round(e.getBoundingClientRect().right)} / ${Math.round(box.right)}`)
      .slice(0, 6)
    const diag = ['.ww-life-bar', '[data-card]']
      .flatMap((s) => [...life.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().height > 0).map((e) => `${(e as HTMLElement).dataset.card ?? s}: h ${Math.round(e.getBoundingClientRect().height)}`))
      .concat([`life box ${Math.round(box.height)}`])
      .join(' | ')
    return {
      diag,
      beyond,
      panel: { sh: panel.scrollHeight, ch: panel.clientHeight },
      life: { sh: life.scrollHeight, ch: life.clientHeight, sw: life.scrollWidth, cw: life.clientWidth },
      cards: cards.map((c) => c.dataset.card),
      gap: Math.round(box.bottom - Math.max(...cards.map((c) => c.getBoundingClientRect().bottom))),
      outside,
      wide,
    }
  })
}

// ---------------------------------------------------------------------------------------------- the no-scroll rule
for (const vp of VIEWPORTS) {
  test(`no scroll at ${vp.width}x${vp.height}: both views, three themes, worst-case data, nothing clipped`, async ({ page }, info) => {
    await page.setViewportSize(vp)
    await openLife(page)
    const log: string[] = []
    for (const [name, theme] of Object.entries(THEMES)) {
      await setTheme(page, theme)
      for (const [view, label, expect_] of [['today', 'Today', ['LF1', 'LF4', 'LF2']], ['week', 'Week and gym', ['LF3', 'LF5']]] as const) {
        await setView(page, label)
        const r = await fit(page)
        log.push(`${name}/${view}: cards ${r.cards.join(',')}, free ${r.gap}px below`)
        expect(r.cards, `${name}/${view}`).toEqual(expect_)
        expect(r.panel.sh, `${name}/${view}: the centre must not scroll`).toBeLessThanOrEqual(r.panel.ch)
        expect(r.life.sh, `${name}/${view}: nothing clipped by the workspace (${r.diag})`).toBeLessThanOrEqual(r.life.ch)
        expect(r.beyond, `${name}/${view}: nothing reaches past the right edge (${r.diag})`).toEqual([])
        expect(r.life.sw, `${name}/${view}: no sideways scroll`).toBeLessThanOrEqual(r.life.cw)
        expect(r.outside, `${name}/${view}`).toEqual([])
        expect(r.wide, `${name}/${view}: no line wider than its box`).toEqual([])
      }
      await setView(page, 'Today')
    }
    await info.attach('free-space.txt', { body: log.join('\n') })
    console.log(`[life] ${vp.width}x${vp.height} (worst-case data)\n  ${log.join('\n  ')}`)
    // the tabpanel the wheel would scroll really has nothing to scroll
    await page.mouse.move(vp.width / 2, vp.height / 2)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => (document.querySelector('[role="tabpanel"]') as HTMLElement).scrollTop)).toBe(0)
  })
}

test('the tallest Add-to-day state still fits at 1366x768: Reel selected, a field error and a failure notice at once', async ({ page }) => {
  await openLife(page, { failDelete: true })
  await page.getByRole('radio', { name: 'Reel' }).click()
  await page.locator('.ww-life-add button').click() // empty add: the field error
  await page.getByRole('button', { name: /Delete (meal|anime|movie|series|reel)/ }).first().click() // the failing delete: the notice
  await expect(page.locator('.ww-life-notice[role="alert"]')).toBeVisible()
  await expect(page.locator('.ww-life-what')).toContainText('Error: Say what it was.')
  const r = await fit(page)
  console.log(`[life] tallest LF1 state: ${r.diag}, free ${r.gap}px below`)
  expect(r.life.sh, r.diag).toBeLessThanOrEqual(r.life.ch)
  expect(r.outside).toEqual([])
  expect(r.panel.sh).toBeLessThanOrEqual(r.panel.ch)
})

test('what does not fit is one tap away: Show all and All subjects open drawers, the explain-back is a drawer', async ({ page }) => {
  await openLife(page)
  await page.getByRole('button', { name: 'Show all 40' }).click()
  const dialog = page.getByRole('dialog', { name: /Logged today, 40 items/ })
  await expect(dialog).toBeVisible()
  expect(await dialog.locator('.ww-life-item').count()).toBe(40)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'All 12 subjects' }).click()
  await expect(page.getByRole('dialog', { name: 'Attendance, all subjects' }).locator('.ww-life-attrow')).toHaveCount(12)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /reels? pending/ }).click()
  await expect(page.getByRole('dialog', { name: 'Explain it back' })).toContainText('an older idea')
})

test('the light day fits too, and a failed delete keeps the row and the layout', async ({ page }) => {
  await openLife(page, { fixture: light(), failDelete: true })
  const before = await fit(page)
  expect(before.life.sh).toBeLessThanOrEqual(before.life.ch)
  await page.getByRole('radio', { name: 'Meal' }).click()
  await page.locator('.ww-life-what input').fill('khichdi')
  await page.locator('.ww-life-add button').click()
  await expect(page.locator('.ww-life-item')).toHaveCount(1)
  await page.getByRole('button', { name: /Delete meal: khichdi/ }).click()
  await expect(page.locator('.ww-life-notice[role="alert"]')).toContainText('Could not remove that, it is still in the list')
  await expect(page.locator('.ww-life-item')).toHaveCount(1)
  const after = await fit(page)
  expect(after.life.sh).toBeLessThanOrEqual(after.life.ch)
  expect(after.outside).toEqual([])
})

// ---------------------------------------------------------------------------------------------- hit areas (P3)
interface Hit { label: string; grouped: boolean; x: number; y: number; w: number; h: number }
async function measure(page: Page): Promise<Hit[]> {
  return page.evaluate(() => {
    const out: { label: string; grouped: boolean; x: number; y: number; w: number; h: number }[] = []
    const els = [...document.querySelectorAll<HTMLElement>('.ww-life button, .ww-life input, .ww-life textarea, .ww-life select, .ww-life [role="radio"], .ww-life a[href]')].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]')
    })
    for (const el of els) {
      const r = el.getBoundingClientRect()
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let x = Math.max(0, r.left - 12); x <= Math.min(innerWidth - 1, r.right + 12); x += 2) {
        for (let y = Math.max(0, r.top - 12); y <= Math.min(innerHeight - 1, r.bottom + 12); y += 2) {
          const hit = document.elementFromPoint(x, y)
          if (hit && (hit === el || el.contains(hit))) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
        }
      }
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.id ?? '').trim().slice(0, 28)
      const inGroup = !!el.closest('.ww-seg, .ww-taps') || el.dataset.grouped === 'true'
      out.push({ label: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} "${name}" at y ${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight}`, grouped: inGroup, x: minX, y: minY, w: maxX - minX + 2, h: maxY - minY + 2 })
    }
    return out
  })
}
for (const vp of VIEWPORTS) {
  for (const [view, label] of [['today', 'Today'], ['week', 'Week and gym']] as const) {
    test(`hit areas at ${vp.width}x${vp.height}, ${view} view: every control is 40 px (44 in a group) and none overlaps another`, async ({ page }, info) => {
      await page.setViewportSize(vp)
      await openLife(page)
      await setView(page, label)
      const hits = await measure(page)
      expect(hits.length).toBeGreaterThan(8)
      const small = hits.filter((h) => h.w < (h.grouped ? 43.5 : 39.5) || h.h < (h.grouped ? 43.5 : 39.5))
      expect(small.map((h) => `${h.label} ${h.w}x${h.h}`), 'controls under the minimum').toEqual([])
      const overlaps: string[] = []
      for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i], b = hits[j]
        // each w/h carries +2 for the 2 px probe step, so two touching controls overlap by 2 in this arithmetic only
        const s = 2.5
        if (a.x < b.x + b.w - s && b.x < a.x + a.w - s && a.y < b.y + b.h - s && b.y < a.y + a.h - s) overlaps.push(`${a.label} x ${b.label}`)
      }
      expect(overlaps, 'overlapping hit areas').toEqual([])
      await info.attach('hit-areas.txt', { body: hits.map((h) => `${h.w}x${h.h}${h.grouped ? ' (group)' : ''}  ${h.label}`).join('\n') })
    })
  }
}

// ---------------------------------------------------------------------------------------------- the three themes
const lum = (c: number[]) => {
  const f = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
}
for (const [name, theme] of Object.entries(THEMES)) {
  test(`${name}: text in the Life cards clears 4.5:1, "behind" is not the fault colour, and one saffron fill at most`, async ({ page }, info) => {
    await openLife(page, { html: theme ? { 'data-theme': theme } : {} })
    for (const label of ['Today', 'Week and gym']) {
      await setView(page, label)
      const r = await page.evaluate(() => {
        const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
        const rgba = (css: string) => {
          canvas.clearRect(0, 0, 1, 1)
          canvas.fillStyle = '#000'
          canvas.fillStyle = css
          canvas.fillRect(0, 0, 1, 1)
          const d = canvas.getImageData(0, 0, 1, 1).data
          return [d[0], d[1], d[2], d[3] / 255]
        }
        const backdrop = (el: Element) => {
          let n: Element | null = el
          while (n) {
            const c = rgba(getComputedStyle(n).backgroundColor)
            if (c[3] > 0.99) return c.slice(0, 3)
            n = n.parentElement
          }
          return rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3)
        }
        const sel = '.ww-life-attname, .ww-life-attmargin, .ww-life-attfig, .ww-life-rule, .ww-life-points, .ww-row-title, .ww-row-meta, .ww-life-quest-meta, .ww-life-quest-note, .ww-life-focus span, .ww-card-title, .ww-field-label, .ww-life-sub, .ww-life-gym'
        const rows: { what: string; fg: number[]; bg: number[] }[] = []
        for (const el of document.querySelectorAll<HTMLElement>('.ww-life ' + sel.split(', ').join(', .ww-life '))) {
          if (el.closest('[hidden]') || !el.textContent?.trim() || el.getBoundingClientRect().width === 0) continue
          rows.push({ what: `${el.className || el.tagName}: ${el.textContent!.trim().slice(0, 24)}`, fg: rgba(getComputedStyle(el).color).slice(0, 3), bg: backdrop(el) })
        }
        const fault = rgba(getComputedStyle(document.documentElement).getPropertyValue('--fault') || '#f00').slice(0, 3)
        const icons = [...document.querySelectorAll<SVGElement>('.ww-life-attrow[data-tone="behind"] .ww-life-atticon')].map((i) => rgba(getComputedStyle(i).color).slice(0, 3))
        return { rows, fault, icons, primaries: document.querySelectorAll('.ww-life [data-primary]').length }
      })
      expect(r.rows.length, `${label}: text nodes measured`).toBeGreaterThan(5)
      const low = r.rows.map((x) => ({ what: x.what, cr: (Math.max(lum(x.fg), lum(x.bg)) + 0.05) / (Math.min(lum(x.fg), lum(x.bg)) + 0.05) })).filter((x) => x.cr < 4.5)
      expect(low.map((x) => `${x.what} ${x.cr.toFixed(2)}`), `${name}/${label}: text under 4.5:1`).toEqual([])
      for (const i of r.icons) expect(i, 'the behind icon is not the fault colour').not.toEqual(r.fault)
      expect(r.primaries).toBeLessThanOrEqual(1)
      await info.attach(`${name}-${label.replace(/\W+/g, '-')}.png`, { body: await page.screenshot(), contentType: 'image/png' })
    }
  })
}
