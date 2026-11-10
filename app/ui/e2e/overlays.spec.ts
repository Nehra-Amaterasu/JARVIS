// Chunk 12 in a real Chromium (plan 8.4, 8.6): Setup and the four overlays, at 1366x768.
//   - the owner's no-scroll rule: every Setup view and every overlay fits the window with nothing scrolling,
//     neither the document nor the centre pane nor the sheet (a pager or one more view instead of a long page);
//   - the doorway: Setup > Phone opens the Phone sheet in place with /phone/ww and the existing server QR;
//   - focus trap, Esc order and focus return for each overlay.
// The Frame, the Setup page and the overlays are built in memory by Vite (nothing written near app/ui/dist) and
// served from a fake origin; every /api call is answered by page.route from the fictional data below, so no
// server, no real subject and no token is involved. The default layout is the real design CSS the Frame ships.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, Route } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from './fixtures'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
const URL_ = 'http://ww-setup.test/'
const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Frame } from '${posix(resolve(ROOT, 'src/ww/frame/Frame.tsx'))}'
import { openOverlay, closeOverlay } from '${posix(resolve(ROOT, 'src/ww/frame/overlayRegistry.ts'))}'
import { switchWorkspace } from '${posix(resolve(ROOT, 'src/ww/frame/navigate.ts'))}'
import { SetupPage } from '${posix(resolve(ROOT, 'src/ww/setup/SetupPage.tsx'))}'
import { usePlan } from '${posix(resolve(ROOT, 'src/germoney/game/plan.ts'))}'
import '${posix(resolve(ROOT, 'src/ww/overlays/setupOverlays.ts'))}'
import '${posix(resolve(ROOT, 'src/styles/shell.css'))}'
const h = React.createElement
const stub = (id) => () => h('div', { 'data-page': id }, h('p', null, 'Stub ' + id))
const pages = Object.fromEntries(['study', 'tree', 'life', 'career', 'focus'].map((id) => [id, stub(id)]))
pages.setup = SetupPage
window.WWLab = {
  mount(el, o) {
    usePlan.setState(o.plan)
    createRoot(el).render(h(Frame, { loaded: true, pages, glass: 'blur' }))
  },
  openOverlay, closeOverlay, switchWorkspace,
}
`
let bundle: Promise<{ js: string; css: string }> | null = null
function buildLab() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'dist-e2e')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, '_setup-entry.jsx')
    writeFileSync(entry, ENTRY)
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry, formats: ['iife'], name: 'WWSetupBundle', fileName: 'setup' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the setup build produced no script')
    return { js, css }
  })()
  return bundle
}

// ---- fictional data, sized like a real semester (the worst case the page has to fit, not the happy one) ----
const SUBJECTS = ['subject-a', 'subject-b', 'subject-c', 'subject-d', 'subject-e']
const NAMES: Record<string, string> = Object.fromEntries(SUBJECTS.map((s, i) => [s, `Subject ${'ABCDE'[i]}`]))
const subjectRows = SUBJECTS.map((id) => ({
  id, name: NAMES[id],
  units: [1, 2, 3, 4, 5].map((n) => ({ n, title: `Unit ${n}`, exam_weight: 'med', topics: ['topic a', 'topic b', 'topic c', 'topic d', 'topic e', 'topic f'] })),
  question_bank: [1, 2, 3].map((n) => ({ unit: n, topic: 'topic a', question: `State $x^${n}$.`, marks: 5, section: 'A' })),
}))
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const slots = DAYS.flatMap((day, d) => [0, 1, 2, 3].map((k) => ({ day, start: `${9 + k}:00`.padStart(5, '0'), end: `${10 + k}:00`.padStart(5, '0'), subject: SUBJECTS[(d + k) % 5], kind: k === 3 ? 'lab' : 'lecture' })))
const exams = SUBJECTS.flatMap((id, i) => [
  { subject: id, title: NAMES[id], kind: 'end_sem', date: `2026-12-${String(10 + i).padStart(2, '0')}`, units: [1, 2, 3], approx: i % 2 === 0, max: 60, target: 40, difficulty: 'normal' },
  { subject: id, title: NAMES[id], kind: 'cie', date: `2026-11-${String(20 + i).padStart(2, '0')}`, units: [], approx: false, max: 20, target: 14, difficulty: 'hard', may_miss: i === 1 },
])
const INPUTS = {
  raw: {
    exams,
    deadlines: [0, 1, 2, 3].map((i) => ({ title: `Form ${i + 1}`, date: `2027-0${i + 1}-15`, kind: 'application' })),
    profile: { traits: ['curious', 'stubborn', 'night owl'], weak_points: ['maths', 'starting'], prefers: ['short blocks'], github: null },
    study: { weekday_minutes: 240 },
    subjects: subjectRows,
    goals: [0, 1, 2, 3, 4, 5].map((i) => ({ id: `g${i}`, horizon: 'quarter', metric: `metric ${i}`, target: 100, deadline: '2027-02-01' })),
    timetable: { section: 'S1', room: 'R1', slots },
    attendance_rule: { threshold: 0.75, scope: 'per_subject', confirmed: false },
  },
  inputs: { source: 'private', warnings: [] },
}
const PROFILE = { traits: ['curious'], rules: ['Puzzle first, theory after.'], style: { novelty_first: true, choices: 2, sprint_minutes: 25, wip_cap: 3, quiet_hours: ['22:30', '06:30'], nudge_after_idle_days: 3, welcome_back_after_days: 3, refresh_after_days: 14 } }
const PLAN = {
  state: {
    xp: 0, career: 'embedded', statuses: {}, nodes: {}, contracts: {}, events: [], parking: [], campaigns: {}, wip: [], wip_cap: 3, certs: {}, xp_migrated_from: null,
    budget: { cert_inr_month: 1000, cert_stretch_inr: 2000 }, exam: { focus: null, window_days: 14 }, bank: { files: [], warnings: [], errors: [], nodes: 0 },
    rotation: Object.fromEntries([1, 2, 3, 4, 5].map((d, i) => [String(d), { track: `t${i}`, label: `Track ${i + 1}`, match: ['one', 'two'] }])),
    schedule: Object.fromEntries([1, 2, 3, 4, 5].map((d) => [String(d), { start: '18:00', minutes: 120 }])),
  },
  academics: { subjects: SUBJECTS.map((id) => ({ id, name: NAMES[id], kind: 'current', exam_date: null, days_left: null, strategy: '', units: [] })) },
}
const PHONE_BASE = { enabled: true, forced: null, saved_enabled: true, running: true, listening_on: [], error: null, port: 8778, bind: '', https: false, cert: '', key: '', urls: [], addresses: [], open_at: ['http://192.0.2.7:8778/phone'], devices: [], pairing: { active: false, expires_in: 0 }, firewall_cmd: 'netsh advfirewall firewall add rule name="JARVIS phone" dir=in action=allow protocol=TCP localport=8778 profile=private', mic_ready: false }
const QR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" width="196" height="196"><rect width="29" height="29" fill="#fff"/>${Array.from({ length: 120 }, (_, i) => `<rect x="${(i * 7) % 27 + 1}" y="${(i * 11) % 27 + 1}" width="1" height="1"/>`).join('')}</svg>`

const HARVEST_SOURCES = {
  sources: [
    { id: 'ocw', name: 'Open course material', kind: 'open', status: 'on', license: 'CC BY-NC-SA 4.0', reason: '', terms_url: '', note: '', on_disk: 12 },
    { id: 'openstax', name: 'Open textbooks', kind: 'open', status: 'on', license: 'per book', reason: '', terms_url: '', note: '', on_disk: 4 },
    { id: 'qa', name: 'Q&A site API', kind: 'open', status: 'off', license: '', reason: 'Q&A site API: licence not recorded, so it stays off.', terms_url: '', note: '', on_disk: 0 },
    { id: 'gate', name: 'Official GATE papers', kind: 'pointer', status: 'pointer', license: 'reserved', reason: 'references only, never stored text', terms_url: '', note: '', on_disk: 0 },
    { id: 'books', name: 'Textbooks', kind: 'pointer', status: 'pointer', license: 'reserved', reason: 'references only, never stored text', terms_url: '', note: '', on_disk: 0 },
  ],
  not_used: [{ name: 'Coaching banks', reason: 'their terms do not allow copying' }, { name: 'Reddit', reason: 'not an allowed source' }],
  pdf_reader: { available: true, note: '' },
}
const HARVEST_QUEUE = {
  enabled: true, paused: false, state: 'idle', queued: 9, fetching: 1, refused: 2, on_disk: 16, last_run: '2026-11-09T10:00:00+00:00',
  items: Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, subject: SUBJECTS[i % 5], topic: `topic ${i}`, tier: 'gate', status: i === 0 ? 'fetching' : i % 5 === 4 ? 'refused' : 'waiting', reason: i % 5 === 4 ? 'robots.txt disallows it' : '' })),
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function openLab(page: Page, o: { phone?: object; gate?: boolean } = {}) {
  const { js, css } = await buildLab()
  const font = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace}`
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html data-motion="calm"><head><meta charset="utf-8"><style>${font}</style><style>${css}</style></head><body style="margin:0"><main class="main" style="position:fixed;inset:0"><div id="root" style="position:absolute;inset:0"></div></main><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => {
    const u = new URL(route.request().url())
    const m = route.request().method()
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: doc })
    if (u.pathname === '/api/mission/inputs') return json(route, INPUTS)
    if (u.pathname === '/api/mission/academics') return json(route, PLAN.academics)
    if (u.pathname === '/api/mission/profile') return json(route, PROFILE)
    if (u.pathname === '/api/remote' && m === 'GET') return json(route, { ...PHONE_BASE, ...o.phone })
    if (u.pathname === '/api/remote/pair' && m === 'POST') return json(route, { code: '482913', url: 'http://192.0.2.7:8778/phone', link: '', qr_svg: QR, expires_in: 300 })
    if (u.pathname === '/api/mission/harvest/queue' && m === 'GET') return json(route, HARVEST_QUEUE)
    if (u.pathname === '/api/mission/harvest/sources') return json(route, HARVEST_SOURCES)
    return json(route, { detail: 'not found' }, 404)
  })
  page.on('pageerror', (e) => console.log('PAGEERROR', (e.stack ?? '').slice(0, 700)))
  await page.goto(URL_)
  await page.evaluate((p) => (window as unknown as { WWLab: { mount(el: HTMLElement, o: object): void } }).WWLab.mount(document.getElementById('root')!, { plan: p }), PLAN)
  await page.waitForSelector('.ww-frame [role="tab"]')
}
const lab = (page: Page, fn: string, ...args: string[]) =>
  page.evaluate(([f, a]) => (window as unknown as { WWLab: Record<string, (...x: string[]) => unknown> }).WWLab[f](...a), [fn, args] as [string, string[]])
const openSetup = async (page: Page) => {
  await lab(page, 'switchWorkspace', 'setup')
  await page.waitForSelector('[data-page="setup"]', { timeout: 8000 })
  await page.waitForSelector('#su-rotation')
}

/** What would scroll: the document, the centre pane and (when given) one panel. 1 px of rounding slack. */
const overflow = (page: Page, panel?: string) =>
  page.evaluate((sel) => {
    const over = (e: Element | null) => (e ? e.scrollHeight - e.clientHeight : 0)
    const doc = document.scrollingElement!
    return {
      document: over(doc),
      centre: over(document.querySelector('.ww-scroll')),
      panel: sel ? over(document.querySelector(sel)) : 0,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  }, panel ?? null)

const INDEX = ['rotation', 'dates', 'subjects', 'goals', 'timetable', 'attendance', 'deadlines', 'study', 'about', 'budget', 'style', 'calibration', 'career', 'connections', 'phone', 'backup', 'appearance', 'harvester']

test.describe('Setup at 1366x768', () => {
  test('every Setup view fits the window: nothing scrolls, in the document or in the centre pane', async ({ page }) => {
    await openLab(page)
    await openSetup(page)
    const rows: string[] = []
    const over: string[] = []
    for (const a of INDEX) {
      await page.locator(`[data-index="${a}"]`).click()
      await expect(page.locator(`#su-${a}`)).toBeVisible()
      await expect(page.locator('.su-page')).toHaveAttribute('data-view', a)
      const o = await overflow(page)
      const g = await page.evaluate(() => { const r = (q: string) => { const b = document.querySelector(q)!.getBoundingClientRect(); return `${Math.round(b.top)}-${Math.round(b.bottom)}` }; return [r('.ww-frame'), r('.ww-centre'), r('.ww-scroll'), r('.su-main')].join(' ') })
      rows.push(`${a} [${g}]: document ${o.document}, centre ${o.centre}`)
      if (o.document > 1 || o.centre > 1 || o.sideways > 1) over.push(`${a} (document ${o.document}, centre ${o.centre}, sideways ${o.sideways})`)
    }
    test.info().annotations.push({ type: 'setup-overflow-px', description: rows.join(' | ') })
    console.log(rows.join(' | '))
    expect(over, 'views that scroll').toEqual([])
  })

  test('the worst open states fit too: units and question bank open, JSON open, a long queue, the calibration wizard', async ({ page }) => {
    await openLab(page)
    await openSetup(page)
    const over: string[] = []
    const check = async (what: string) => {
      const o = await overflow(page)
      if (o.centre > 1 || o.document > 1 || o.sideways > 1) over.push(`${what} (centre ${o.centre}, document ${o.document}, sideways ${o.sideways})`)
    }
    const open = async (anchor: string, name: RegExp) => {
      await page.locator(`[data-index="${anchor}"]`).click()
      const fold = page.locator(`#su-${anchor}`).getByRole('button', { name }).first()
      if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click()
    }
    const tab = async (name: RegExp) => {
      await page.locator('[data-index="subjects"]').click()
      await page.locator('#su-subjects').getByRole('radio', { name }).click()
    }
    await tab(/Units/)
    await check('subjects, units tab')
    await tab(/Question bank/)
    await check('subjects, question bank tab')
    await open('subjects', /Advanced: JSON/)
    await check('subjects, JSON open')
    await open('timetable', /Advanced: JSON/)
    await check('timetable, JSON open')
    await open('goals', /Advanced: JSON/)
    await check('goals, JSON open')
    await open('calibration', /Open the calibration wizard/)
    await check('calibration wizard open')
    await page.locator('[data-index="harvester"]').click()
    await check('harvester, sources')
    await page.locator('#su-harvester').getByRole('radio', { name: /Queue/ }).click()
    await check('harvester, 12-item queue')
    await page.locator('[data-index="connections"]').click()
    await check('connections')
    expect(over, 'open states that scroll').toEqual([])
  })

  test('the Phone row is one status line and a button; the button opens the Phone sheet in place and Esc comes back', async ({ page }) => {
    await openLab(page)
    await openSetup(page)
    await page.locator('[data-index="phone"]').click()
    const row = page.locator('#su-phone')
    await expect(row.locator('button')).toHaveCount(1)
    await expect(row).not.toContainText('/phone/ww')
    const open = row.locator('button')
    await open.click()
    await expect(page.locator('.ww-sheet[data-state="open"] [data-overlay="phone"]')).toBeVisible()
    await expect(page.locator('[data-page="setup"]')).toBeVisible() // still in Well Wisher, on Setup
    await page.keyboard.press('Escape')
    await expect(page.locator('.ww-sheet[data-state="open"]')).toHaveCount(0)
    await expect(open).toBeFocused()
  })
})

test.describe('overlays at 1366x768', () => {
  test('Phone sheet: the /phone/ww address and the server QR are on screen with the code showing, and nothing scrolls', async ({ page }) => {
    await openLab(page)
    await lab(page, 'openOverlay', 'phone')
    await expect(page.locator('[data-phone-address]')).toContainText('http://192.0.2.7:8778/phone/ww')
    await page.getByRole('button', { name: 'Pair a phone' }).click()
    const qr = page.locator('img.ov-qr-img')
    await expect(qr).toBeVisible()
    expect(await qr.evaluate((i: HTMLImageElement) => i.naturalWidth > 0)).toBe(true)
    const box = await qr.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(150)
    const o = await overflow(page, '.ww-sheet[data-state="open"] .ww-sheet-body')
    test.info().annotations.push({ type: 'phone-sheet-overflow-px', description: String(o.panel) })
    console.log('phone-sheet-overflow-px', o.panel)
    expect(o.panel, 'the Phone sheet scrolls').toBeLessThanOrEqual(1)
    await expect(page.locator('[data-phone-address]')).toBeInViewport()
  })

  test('Phone sheet with two paired phones and the firewall fold open still fits', async ({ page }) => {
    const devices = [1, 2].map((n) => ({ id: `d${n}`, name: `Test phone ${n}`, created: 1, last_seen: Date.now() / 1000 }))
    await openLab(page, { phone: { devices } })
    await lab(page, 'openOverlay', 'phone')
    await page.locator('summary, button[aria-expanded]', { hasText: 'Firewall' }).first().click()
    const o = await overflow(page, '.ww-sheet[data-state="open"] .ww-sheet-body')
    test.info().annotations.push({ type: 'phone-sheet-full-overflow-px', description: String(o.panel) })
    console.log('phone-sheet-full-overflow-px', o.panel)
    expect(o.panel).toBeLessThanOrEqual(1)
  })

  test('Date sheet with ten papers fits: it pages instead of scrolling, and every paper stays reachable', async ({ page }) => {
    await openLab(page)
    await lab(page, 'openOverlay', 'date')
    await expect(page.locator('[data-overlay="date"] [data-paper]').first()).toBeVisible()
    const o = await overflow(page, '.ww-sheet[data-state="open"] .ww-sheet-body')
    test.info().annotations.push({ type: 'date-sheet-overflow-px', description: String(o.panel) })
    console.log('date-sheet-overflow-px', o.panel)
    expect(o.panel, 'the Date sheet scrolls').toBeLessThanOrEqual(1)
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++) {
      for (const t of await page.locator('[data-overlay="date"] [data-paper]:visible .ov-paper-title').allTextContents()) seen.add(t.replace(/\s+/g, ' '))
      const next = page.getByRole('button', { name: 'Next papers' })
      if (!(await next.isVisible()) || (await next.getAttribute('aria-disabled')) === 'true') break
      await next.click()
    }
    expect(seen.size).toBe(10)
  })

  test('Log minutes and Confirm fit', async ({ page }) => {
    await openLab(page)
    await lab(page, 'openOverlay', 'log')
    await expect(page.locator('[data-overlay="log"]')).toBeVisible()
    expect((await overflow(page, '.ww-sheet[data-state="open"] .ww-sheet-body')).panel).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await lab(page, 'openOverlay', 'confirm')
    await expect(page.locator('[data-overlay="confirm"]')).toBeVisible()
    expect((await overflow(page, '.ww-sheet[data-state="open"] .ww-sheet-body')).panel).toBeLessThanOrEqual(1)
  })

  for (const id of ['date', 'phone', 'log', 'confirm']) {
    test(`${id}: focus moves in, Tab never leaves, Esc closes and focus returns to the opener`, async ({ page }) => {
      await openLab(page)
      await page.evaluate(() => { const b = document.createElement('button'); b.id = 'opener'; b.textContent = 'opener'; b.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:1'; document.body.appendChild(b); b.focus() })
      await lab(page, 'openOverlay', id)
      const sheet = page.locator('.ww-sheet[data-state="open"]')
      await expect(sheet).toBeVisible()
      await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.ww-sheet'))).toBe(true)
      for (let i = 0; i < 24; i++) {
        await page.keyboard.press('Tab')
        expect(await page.evaluate(() => !!document.activeElement?.closest('.ww-sheet')), `Tab ${i + 1}`).toBe(true)
      }
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Shift+Tab')
        expect(await page.evaluate(() => !!document.activeElement?.closest('.ww-sheet')), `Shift+Tab ${i + 1}`).toBe(true)
      }
      await page.keyboard.press('Escape')
      await expect(page.locator('.ww-sheet[data-state="open"]')).toHaveCount(0)
      await expect(page.locator('#opener')).toBeFocused()
    })
  }

  test('Esc order: Confirm opened from Setup closes first, the Setup page and its unsaved edit are untouched', async ({ page }) => {
    await openLab(page)
    await openSetup(page)
    await page.locator('[data-index="study"]').click()
    await page.getByLabel('Weekday').fill('200')
    await expect(page.getByRole('button', { name: 'Discard all' })).toBeVisible()
    await page.getByRole('button', { name: 'Discard all' }).click()
    await expect(page.locator('[data-overlay="confirm"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.ww-sheet[data-state="open"]')).toHaveCount(0)
    await expect(page.getByLabel('Weekday')).toHaveValue('200') // Esc cancelled; nothing was discarded
  })
})
