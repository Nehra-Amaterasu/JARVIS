// The tonight sheet (Study > Practice) and the counted ledger (Study > Plan), seen in a real browser under v3 with the engine's routes MOCKED in
// the page, to the shapes of the engine's own tests (app/tests/test_pyq_tonight.py, test_pyq_ledger.py). Every subject, topic and question is
// invented. At 1366x768 and 390x844.
//
//   WW_SANDBOX_PORT=8971 WW_PREVIEW_PORT=5371 WW_SANDBOX_DIR="$TEMP/jarvis-ui-tonight-e2e" node scripts/build-e2e.mjs
//   (the same variables) npx playwright test e2e/tonight-ledger.spec.ts --workers=1
//
// Pictures go to $TEMP/ui-tonight-shots (TONIGHT_SHOTS overrides). Every size asserts, for both screens: no key or field under 44 px, no text
// under 11 px, nothing wider than its tray, no document scroll; and the honest words: marks are "typed by you", nothing computes a grade.
import { deflateSync } from 'node:zlib'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page, Route } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'

const expect = baseExpect.configure({ timeout: 15_000 })
const SHOTS = resolve(process.env.TONIGHT_SHOTS ?? resolve(tmpdir(), 'ui-tonight-shots'))
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const B = '/api/mission/pyq'
const TODAY = '2026-11-27'
const EARLIER = '2026-11-25'
const SUBJECT = 'fixture-signals'

// ------------------------------------------------------------------------------------------------ invented fixtures
const WHY = (over: Record<string, unknown> = {}) => ({ days_left: 4, marks_weight: 8.5, share: 0.6, proficiency: 0.5, syllabus_weight: 3, ...over })
const ITEM = (n: number, q: string, marks: number, topic: string, over: Record<string, unknown> = {}) => ({
  n, question_id: q, marks, unit: n, topic, topic_key: `${n}|${topic}`, text: `Invented question ${n}: describe how ${topic.toLowerCase()} is handled in a sampled system and name one condition it needs.`,
  crop: null, why: WHY({ syllabus_weight: n === 2 ? 2 : 3 }), mark: null, ...over,
})
const sheetOf = (id: string, date: string, items: Record<string, unknown>[]) => ({ id, date, subject: SUBJECT, built_at: `${date}T19:00:00`, items, marks: [], unmarked: items.filter((i) => !i.mark).length })
const newToday = () => sheetOf(`${TODAY}-${SUBJECT}`, TODAY, [
  ITEM(1, 'q1', 5, 'Sampling'), ITEM(2, 'q2', 10, 'Aliasing'), ITEM(3, 'q3', 5, 'Filters', { text: '', crop: `${B}/crops/q3` }),
])
const earlier = () => sheetOf(`${EARLIER}-${SUBJECT}`, EARLIER, [ITEM(1, 'e1', 5, 'Basics', { unit: 1 }), ITEM(2, 'e2', 5, 'Sampling')])

const SUBJECTS = [
  { id: SUBJECT, name: 'Fixture Signals', kind: 'course', exam_date: '2026-12-01', days_left: 4, strategy: '', units: [] },
  { id: 'fixture-circuits', name: 'Fixture Circuits', kind: 'course', exam_date: '2026-12-09', days_left: 12, strategy: '', units: [] },
]

const LROW = (key: string, unit: number, topic: string, weight: number, over: Record<string, unknown> = {}) => ({
  key, unit, topic, syllabus_weight: weight, notes: 2, past_questions: 3, past_marks: 20, papers_seen: 2, families: 2, attempts: 0, got: 0, max: 0, minutes: null,
  last_practised: null, question_ids: ['qa', 'qb', 'qc'], note_files: ['fa', 'fb'], ...over,
})
const LEDGER: Record<string, Record<string, unknown>> = {
  [SUBJECT]: {
    items: [
      LROW('1|Basics', 1, 'Basics', 2, { attempts: 2, got: 7, max: 12, minutes: 30, last_practised: EARLIER }),
      LROW('2|Sampling', 2, 'Sampling', 3, { notes: 0, past_questions: 1, past_marks: 8, papers_seen: 1, families: 1, question_ids: ['qd'], note_files: [] }),
      LROW('3|Aliasing', 3, 'Aliasing', 3, { attempts: 3, got: 4, max: 15, last_practised: TODAY }),
      LROW('4|Filters', 4, 'Filters', 1, { past_questions: 0, past_marks: 0, papers_seen: 0, families: 0, question_ids: [] }),
    ],
    holes: [
      { key: '2|Sampling', kind: 'no_notes', sentence: 'No note of yours mentions Sampling.' },
      { key: '2|Sampling', kind: 'never_practised', sentence: 'No mark on file for Sampling.' },
      { key: '3|Aliasing', kind: 'under_half', sentence: 'Aliasing: 4 of 15 over 3 attempts, under half.' },
      { key: '4|Filters', kind: 'no_past_question', sentence: 'No accepted past question on file is tagged Filters.' },
      { key: '4|Filters', kind: 'never_practised', sentence: 'No mark on file for Filters.' },
    ],
    totals: { topics: 4, with_notes: 3, with_past_question: 3, practised: 2, past_questions: 7, past_marks: 48, attempts: 5, got: 11, max: 27, minutes: 30, holes: {} },
    skipped: [],
  },
  'fixture-circuits': {
    items: [LROW('1|Nodes', 1, 'Nodes', 3, { attempts: 1, got: 4, max: 5, last_practised: TODAY }), LROW('2|Meshes', 2, 'Meshes', 2)],
    holes: [{ key: '2|Meshes', kind: 'never_practised', sentence: 'No mark on file for Meshes.' }],
    totals: { topics: 2, with_notes: 2, with_past_question: 2, practised: 1, past_questions: 6, past_marks: 40, attempts: 1, got: 4, max: 5, minutes: null, holes: {} },
    skipped: [],
  },
}
const ATTEMPTS: Record<string, Record<string, unknown>[]> = {
  '1|Basics': [
    { at: `${EARLIER}T20:10:00`, source: 'sheet', source_id: `${EARLIER}-${SUBJECT}`, question_id: 'e1', topic_key: '1|Basics', got: 4, max: 5, minutes: 9 },
    { at: '2026-11-20T10:00:00', source: 'paper', source_id: 'g-0123456789ab', question_id: 'qb', topic_key: '1|Basics', got: 3, max: 7, minutes: null },
  ],
  '3|Aliasing': [{ at: `${TODAY}T21:00:00`, source: 'sheet', source_id: `${TODAY}-${SUBJECT}`, question_id: 'q2', topic_key: '3|Aliasing', got: 4, max: 10, minutes: null }],
}
const PACE_WAITING = {
  paper_date: '2026-12-01', days_left: 4, topics: 4, practised: 0, left: 4, days_counted: 0, practised_in_days: null, per_day: null, days_needed: null, from: null, to: null,
  sentence: 'No mark on file for this subject yet; the pace is counted from your marks. The paper is on 2026-12-01, 4 days from today.',
}
const PACE_LIVE = {
  paper_date: '2026-12-09', days_left: 12, topics: 2, practised: 1, left: 1, days_counted: 2, practised_in_days: 1, per_day: 0.5, days_needed: 2, from: '2026-11-26', to: TODAY,
  sentence: 'Counted over your last 2 days with a mark (2026-11-26 to 2026-11-27): 1 topic marked for the first time, 0.5 a day. At that rate the topics left (1) take 2 more days with a mark. The paper is on 2026-12-09, 12 days from today.',
}

function crc32(b: Buffer): number {
  let c = ~0
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}
/** An invented question picture: a 420 x 90 PNG of a pale sheet with grey bars where lines of print would be. Built here, so no picture file is stored. */
function makeCrop(): Buffer {
  const w = 420, h = 90
  const raw = Buffer.alloc((w * 3 + 1) * h, 244)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    const bar = y % 22 >= 6 && y % 22 < 12
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      const on = bar && x > 14 && x < 14 + 200 + ((y * 7) % 160)
      raw[o] = raw[o + 1] = raw[o + 2] = on ? 120 : 244
    }
  }
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length)
    const body = Buffer.concat([Buffer.from(t, 'latin1'), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const CROP = makeCrop()

interface Mock {
  sheet: Record<string, unknown> | null
  old: Record<string, unknown>
  settings: { on: boolean; hour: string; count: number; horizon_days: number }
  buildError: { status: number; detail: string } | null
  calls: string[]
  bodies: Record<string, unknown[]>
}
const newMock = (): Mock => ({ sheet: null, old: earlier(), settings: { on: false, hour: '19:00', count: 6, horizon_days: 21 }, buildError: null, calls: [], bodies: {} })

const NEXT_PAPERS = [{ subject: SUBJECT, title: 'Fixture Signals mid-semester', date: '2026-12-01', days_left: 4 }, { subject: 'fixture-circuits', title: 'Fixture Circuits', date: '2026-12-09', days_left: 12 }]

async function installMock(page: Page, m: Mock) {
  const answerSheet = (s: Record<string, unknown>) => ({ ...s, unmarked: (s.items as { mark: unknown }[]).filter((i) => !i.mark).length })
  const markOn = (s: Record<string, unknown>, q: string, got: number) => {
    const items = s.items as Record<string, unknown>[]
    const it = items.find((i) => i.question_id === q)!
    it.mark = { question_id: q, got, max: it.marks, minutes: null, at: `${TODAY}T21:30:00` }
  }
  await page.route('**/api/mission/pyq/tonight**', async (route: Route) => {
    const req = route.request()
    const u = new URL(req.url())
    const path = u.pathname.replace(`${B}/tonight`, '')
    const method = req.method()
    const body = req.postData() ?? ''
    m.calls.push(`${method} ${path || '/'} ${body}`)
    const json = (data: Record<string, unknown>, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const SRC = 'your papers on file and your date sheet'
    if (path === '' && method === 'GET') {
      const awaiting = [{ id: m.old.id, date: EARLIER, subject: SUBJECT, unmarked: (m.old.items as { mark: unknown }[]).filter((i) => !i.mark).length }].filter((a) => a.unmarked > 0)
      const base = { sheet: m.sheet ? answerSheet(m.sheet) : null, awaiting_marks: awaiting, settings: m.settings, next_papers: NEXT_PAPERS }
      if (!m.settings.on) return json({ state: 'planned', reason: `The evening sheet is off. Switch it on and one is built at ${m.settings.hour} each day.`, source: SRC, ...base })
      if (!m.sheet) return json({ state: 'live', reason: `Tonight's sheet is built at ${m.settings.hour}: Fixture Signals, paper in 4 days.`, source: SRC, ...base })
      return json({ state: 'live', reason: `Tonight's sheet: ${(m.sheet.items as unknown[]).length} questions, Fixture Signals, paper in 4 days. 1 earlier sheet is waiting for marks.`, source: SRC, ...base })
    }
    if (path === '/settings' && method === 'PUT') {
      const b = JSON.parse(body)
      Object.assign(m.settings, { ...(b.on !== undefined ? { on: b.on } : {}), ...(b.hour ? { hour: b.hour } : {}), ...(b.count ? { count: b.count } : {}), ...(b.horizon_days ? { horizon_days: b.horizon_days } : {}) })
      ;(m.bodies.settings ??= []).push(b)
      if (b.count > 12) return json({ detail: 'Questions are from 3 to 12.' }, 400)
      return json({ state: m.settings.on ? 'live' : 'planned', reason: m.settings.on ? `Each day at ${m.settings.hour}: ${m.settings.count} questions for the paper nearest in date within ${m.settings.horizon_days} days.` : 'The evening sheet is off: nothing is built and nothing reminds you.', source: 'your settings', settings: m.settings })
    }
    if (path === '/build' && method === 'POST') {
      const b = JSON.parse(body || '{}')
      if (b.date === EARLIER) return json({ state: 'live', reason: `The sheet of ${EARLIER}: 2 questions, Fixture Signals.`, source: SRC, sheet: answerSheet(m.old) })
      if (m.buildError) return json({ detail: m.buildError.detail }, m.buildError.status)
      m.sheet = newToday()
      return json({ state: 'live', reason: "Tonight's sheet: 3 questions, Fixture Signals, paper in 4 days.", source: SRC, sheet: answerSheet(m.sheet) })
    }
    const marks = path.match(/^\/([^/]+)\/marks$/)
    if (marks && method === 'POST') {
      const b = JSON.parse(body) as { items: { question_id: string; got: number }[] }
      ;(m.bodies.marks ??= []).push(b)
      const s = decodeURIComponent(marks[1]) === m.old.id ? m.old : m.sheet!
      const items = s.items as { question_id: string; marks: number }[]
      for (const r of b.items) {
        const it = items.find((i) => i.question_id === r.question_id)!
        if (r.got > it.marks) return json({ detail: `Marks for a ${it.marks}-mark question are from 0 to ${it.marks}.` }, 400)
      }
      for (const r of b.items) markOn(s, r.question_id, r.got)
      const sum = b.items.reduce((a, r) => a + r.got, 0)
      const mx = b.items.reduce((a, r) => a + items.find((i) => i.question_id === r.question_id)!.marks, 0)
      const left = items.filter((i) => !(i as { mark?: unknown }).mark).length
      return json({ state: 'live', reason: `Saved marks for ${b.items.length} ${b.items.length === 1 ? 'question' : 'questions'}: ${sum} of ${mx}.${left ? ` ${left} ${left === 1 ? 'question is' : 'questions are'} still unmarked.` : ' Every question is marked.'}`, source: 'the marks you typed', sheet: answerSheet(s), saved: b.items.length, total: { got: sum, max: mx }, marked_by: 'you', proficiency: {} })
    }
    if (/\/print$/.test(path) && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><title>Tonight, invented</title><style>@page{size:A4;margin:18mm}</style></head><body><h1>Tonight: Fixture Signals</h1><p>1. Invented question.</p></body></html>' })
    }
    return json({ detail: 'No such route in the mock.' }, 404)
  })
  await page.route('**/api/mission/pyq/crops/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: CROP }))
  await page.route('**/api/mission/pyq/ledger**', async (route: Route) => {
    const u = new URL(route.request().url())
    const path = u.pathname.replace(`${B}/ledger`, '')
    m.calls.push(`GET /ledger${path}${u.search}`)
    const json = (data: Record<string, unknown>, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const subject = u.searchParams.get('subject') ?? ''
    const led = LEDGER[subject]
    if (!led) return json({ detail: 'No such subject.' }, 404)
    if (path === '') {
      return json({ state: 'live', reason: `${(led.totals as { topics: number }).topics} topics: ${(led.totals as { with_notes: number }).with_notes} in your notes, ${(led.totals as { with_past_question: number }).with_past_question} with a past question, ${(led.totals as { practised: number }).practised} practised; ${(led.holes as unknown[]).length} ${(led.holes as unknown[]).length === 1 ? 'hole' : 'holes'}.`, source: 'your notes, papers and marks on file', ...led, count: (led.items as unknown[]).length })
    }
    if (path === '/attempts') {
      const rows = ATTEMPTS[u.searchParams.get('topic') ?? ''] ?? []
      if (!rows.length) return json({ state: 'waiting', reason: 'No mark on file for this choice.', source: 'the marks you typed', items: [], count: 0, skipped: [] })
      const got = rows.reduce((a, r) => a + Number(r.got), 0)
      const mx = rows.reduce((a, r) => a + Number(r.max), 0)
      return json({ state: 'live', reason: `${rows.length} ${rows.length === 1 ? 'mark' : 'marks'} on file: ${got} of ${mx}.`, source: 'the marks you typed', items: rows, count: rows.length, skipped: [] })
    }
    if (path === '/pace') {
      const live = subject === 'fixture-circuits'
      return json({ state: live ? 'live' : 'waiting', reason: (live ? PACE_LIVE : PACE_WAITING).sentence, source: 'the marks you typed', skipped: [], ...(live ? PACE_LIVE : PACE_WAITING) })
    }
    return json({ detail: 'No such route in the mock.' }, 404)
  })
  await page.route('**/api/mission/academics**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ semester: null, subjects: SUBJECTS }) }))
}

// ------------------------------------------------------------------------------------------------ driving the page
const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function openView(page: Page, baseURL: string | undefined, w: number, h: number, view: 'practice' | 'plan') {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `node scripts/build-e2e.mjs` first')
  await page.addInitScript(() => {
    // the browser's print dialog is not drawn in a test; the frame's own print() is counted instead, on the top window
    // Window is a global interface: print lives on each window itself, not on its prototype, so each frame's own window is patched
    window.print = function () { try { const t = window.top as unknown as { __printed?: number }; t.__printed = (t.__printed ?? 0) + 1 } catch { /* not reachable */ } }
  })
  await page.setViewportSize({ width: w, height: h })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  await blurText(page)
  if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', 'ww')
  await page.keyboard.press('Control+3')
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', 'study')
  for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
  for (let k = 0; k < ['papers', 'practice', 'plan'].indexOf(view); k++) { await blurText(page); await page.keyboard.press(']') }
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', view)
  await expect(page.locator('.tsh-faces')).toBeVisible({ timeout: 20_000 })
}

/** Under v3 on the phone the second and third trays are sheets that open from two pills. */
async function openTray(page: Page, name: RegExp) {
  const pill = page.locator('.s3-pill', { hasText: name }).first()
  if (page.viewportSize()!.width <= 700 && (await pill.isVisible().catch(() => false))) { await pill.click(); await page.waitForTimeout(450) }
}
async function closeSheet(page: Page) {
  const done = page.locator('.s3-done:visible')
  if ((await done.count()) === 0) return
  await done.first().click({ timeout: 4000 }).catch(() => page.keyboard.press('Escape'))
  await page.waitForTimeout(300)
}

const shot = async (page: Page, name: string, w: number) => {
  await page.waitForTimeout(700) // the trays rise in order when a place opens (0, 70, 140 ms) and a sheet slides in on the phone: wait for them to rest
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `${name}-${w}.png`) })
}

/** The geometry of the screen, judged on its own boxes: 44 px keys and fields, 11 px text, nothing wider than its tray, no page scroll. */
async function measure(page: Page, at: string, problems: string[]) {
  const r = await page.evaluate(() => {
    const out: string[] = []
    const roots = [...document.querySelectorAll('.s3-tray')].filter((e) => e.getBoundingClientRect().width > 1 && getComputedStyle(e).display !== 'none')
    const bar = document.querySelector('.tsh-faces-bar')
    for (const root of [...roots, ...(bar ? [bar] : [])]) {
      const rr = root.getBoundingClientRect()
      for (const el of root.querySelectorAll('button, input, select, textarea, summary')) {
        const b = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (b.width < 1 || b.height < 1 || cs.visibility === 'hidden' || el.closest('[hidden]')) continue
        if (b.height < 43.5 || b.width < 43.5) out.push(`target ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`)
      }
      for (const el of root.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (b.width < 1 || el.closest('[hidden]') || el.closest('svg')) continue
        if (el.children.length === 0 && (el.textContent || '').trim()) {
          const fs = parseFloat(getComputedStyle(el).fontSize)
          if (fs < 10.95) out.push(`small ${fs}px "${(el.textContent || '').trim().slice(0, 24)}"`)
        }
        if (b.right > rr.right + 1 || b.left < rr.left - 1) out.push(`wider than its tray: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} by ${Math.round(Math.max(b.right - rr.right, rr.left - b.left))}px`)
      }
      for (const col of root.querySelectorAll('.tsh-col')) if (col.scrollWidth > col.clientWidth + 1) out.push(`${(col as HTMLElement).dataset.tray ?? 'col'} scrolls sideways ${col.scrollWidth - col.clientWidth}px`)
    }
    const doc = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
    if (doc > 1) out.push(`document scrolls sideways ${doc}px`)
    return out
  })
  for (const p of r) problems.push(`${at}: ${p}`)
}

const noPromise = async (page: Page, at: string, problems: string[]) => {
  const t = await page.locator('.tsh-faces').evaluate((e) => (e as HTMLElement).innerText)
  if (/\b(will pass|chance of|predicted|likely to pass|grade:)/i.test(t)) problems.push(`${at}: a forecast or grade word appears`)
}

for (const { w, h } of SIZES) {
  test.describe(`tonight sheet and ledger at ${w}x${h} (v3)`, () => {
    test('the tonight sheet: no sheet and Build, a 409, a built sheet, marks refused then saved, print, settings, and the paper maker still one press away', async ({ page, baseURL }) => {
      test.setTimeout(180_000)
      const problems: string[] = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const m = newMock()
      await installMock(page, m)
      await openView(page, baseURL, w, h, 'practice')

      // 1. off: the engine's PLANNED sentence, the settings as on file, nothing built on its own
      await expect(page.locator('[data-said="state"]')).toContainText('The evening sheet is off. Switch it on and one is built at 19:00 each day.')
      await expect(page.locator('[data-key="build"]')).toHaveText("Build tonight's sheet")
      await expect(page.locator('.tsh-faces')).toHaveAttribute('data-face', 'tonight')
      expect(m.calls.filter((c) => c.startsWith('POST /build')), 'nothing is built before his press').toHaveLength(0)
      await measure(page, 'no sheet', problems)
      await shot(page, '01-no-sheet-build-key', w)

      // 2. Build with the engine refusing (409): its sentence, as sent
      m.buildError = { status: 409, detail: 'The paper desk is reading files; try again when it has finished.' }
      await page.locator('[data-key="build"]').click()
      await expect(page.locator('[data-said="action"]')).toContainText('The paper desk is reading files; try again when it has finished.')
      await measure(page, '409', problems)
      await shot(page, '02-build-409', w)
      m.buildError = null

      // 3. Build: the sheet, each question with its marks, its words, a picture, and the terms the engine printed
      await page.locator('[data-key="build"]').click()
      await expect(page.locator('.tsh-title')).toHaveText('Fixture Signals, 2026-11-27')
      await expect(page.locator('.tsh-item')).toHaveCount(3)
      await expect(page.locator('.tsh-item').first()).toContainText('5 marks')
      await expect(page.locator('.tsh-item').first()).toContainText('Why this one: paper in 4 days, syllabus weight 3 (high), marks weight 8.5, seen share 0.6, proficiency 0.5.')
      await expect(page.locator('img.tsh-crop')).toBeVisible()
      await expect(page.locator('[data-key="build"]')).toHaveCount(0)
      await measure(page, 'sheet', problems)
      await shot(page, '03-sheet-built', w)

      // 4. marks: a mark over the maximum is refused with the engine's sentence and stays typed
      await openTray(page, /^Marks/i)
      const first = page.locator('[data-tray="marks"] input.tsh-num').nth(0)
      const second = page.locator('[data-tray="marks"] input.tsh-num').nth(1)
      await expect(page.locator('[data-tray="marks"] input.tsh-num')).toHaveCount(3)
      await first.fill('9')
      await second.fill('7')
      await page.getByRole('button', { name: 'Save marks' }).click()
      await expect(page.locator('[data-said="marks"]')).toContainText('Marks for a 5-mark question are from 0 to 5.')
      await expect(first).toHaveValue('9')
      await expect(second).toHaveValue('7')
      await measure(page, 'marks refused', problems)
      await shot(page, '04-marks-refused-kept', w)

      // 5. the right marks: the engine's answer is shown, "typed by you", and the sheet shows them as his
      await first.fill('3')
      await page.getByRole('button', { name: 'Save marks' }).click()
      await expect(page.locator('[data-said="marks"]')).toContainText('Saved marks for 2 questions: 10 of 15. 1 question is still unmarked.')
      await expect(page.locator('[data-said="marks"]')).toContainText('Marked by you')
      expect(JSON.stringify(m.bodies.marks!.at(-1))).toBe(JSON.stringify({ items: [{ question_id: 'q1', got: 3 }, { question_id: 'q2', got: 7 }] }))
      await expect(page.locator('[data-got]').first()).toHaveText('Your mark, typed by you: 3 of 5.')
      await measure(page, 'marks saved', problems)
      await shot(page, '05-marks-saved', w)

      // 6. an earlier sheet waiting for marks opens and takes marks too
      await page.locator('.tsh-sheetkey', { hasText: EARLIER }).click()
      await expect(page.locator('[data-tray="marks"] input.tsh-num')).toHaveCount(2)
      await page.locator('[data-tray="marks"] input.tsh-num').nth(0).fill('4')
      await page.getByRole('button', { name: 'Save marks' }).click()
      await expect(page.locator('[data-said="marks"]')).toContainText('Saved marks for 1 question: 4 of 5. 1 question is still unmarked.')
      await shot(page, '06-earlier-sheet-marks', w)
      await closeSheet(page)

      // 7. print goes through the engine's A4 sheet
      await page.locator('[data-tray="tonight"] [data-key="print"]').click()
      await expect(page.locator('[data-said="action"]')).toContainText('Sent to the print dialog')
      expect(await page.evaluate(() => (window as unknown as { __printed?: number }).__printed ?? 0)).toBeGreaterThan(0)
      expect(m.calls.some((c) => c.includes(`/${TODAY}-${SUBJECT}/print`))).toBe(true)

      // 8. settings: changed and saved only on the press; the engine's sentence follows; a refusal keeps the typed number
      await openTray(page, /^Settings/i)
      await page.getByRole('radio', { name: 'On', exact: true }).click()
      await page.locator('#tsh-hour').fill('18:30')
      await page.locator('#tsh-count').fill('40')
      expect(m.bodies.settings ?? [], 'nothing is saved by typing').toHaveLength(0)
      await page.getByRole('button', { name: 'Save settings' }).click()
      await expect(page.locator('[data-said="settings"]')).toContainText('Questions are from 3 to 12.')
      await expect(page.locator('#tsh-count')).toHaveValue('40')
      await page.locator('#tsh-count').fill('8')
      await page.getByRole('button', { name: 'Save settings' }).click()
      await expect(page.locator('[data-said="settings"]')).toContainText('Each day at 18:30: 8 questions')
      expect(m.bodies.settings!.at(-1)).toEqual({ on: true, hour: '18:30', count: 8, horizon_days: 21 })
      await expect(page.locator('.tsh-list')).toContainText('Fixture Signals mid-semester, 2026-12-01, in 4 days')
      await measure(page, 'settings', problems)
      await shot(page, '07-settings-saved', w)
      await closeSheet(page)

      // 9. what Practice showed before is one press away
      await noPromise(page, 'tonight', problems)
      await page.getByRole('radio', { name: 'Practice paper' }).click()
      await expect(page.locator('[data-component="generator-desk"]')).toBeVisible({ timeout: 20_000 })
      await shot(page, '08-practice-paper-still-there', w)
      await page.getByRole('radio', { name: "Tonight's sheet" }).click()
      await expect(page.locator('.tsh-title')).toBeVisible()

      expect(problems, problems.join('\n')).toEqual([])
      expect(errors, errors.join('\n')).toEqual([])
    })

    test('the ledger: topics with holes, an opened topic with marks from two sources, the pace waiting and live', async ({ page, baseURL }) => {
      test.setTimeout(180_000)
      const problems: string[] = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const m = newMock()
      await installMock(page, m)
      await openView(page, baseURL, w, h, 'plan')

      await page.getByRole('radio', { name: 'Ledger' }).click()
      await expect(page.locator('.cld-row')).toHaveCount(4)

      // 1. rows in the engine's order, counts, the engine's words for holes, the weight in words
      const rows = page.locator('.cld-row')
      await expect(rows.nth(0)).toContainText('Unit 1, Basics')
      await expect(rows.nth(0)).toContainText('Syllabus weight 2 (middle)')
      await expect(rows.nth(0)).toContainText('7 of 12')
      await expect(rows.nth(1)).toContainText('Syllabus weight 3 (high)')
      await expect(rows.nth(1).locator('[data-holes]')).toHaveText('no notesnever practised')
      await expect(rows.nth(2).locator('[data-holes]')).toHaveText('under half')
      await expect(rows.nth(3).locator('[data-holes]')).toHaveText('no past questionnever practised')
      await expect(rows.nth(0).locator('[data-holes]')).toHaveCount(0)
      await expect(page.locator('[data-said="ledger"]')).toContainText('4 topics: 3 in your notes, 3 with a past question, 2 practised; 5 holes.')
      await measure(page, 'ledger', problems)
      await shot(page, '09-ledger-topics', w)

      // 2. no colour judgement: a hole and a weak topic are drawn in the same ink as any other row
      const ink = await page.evaluate(() => [...document.querySelectorAll('.cld-row')].map((r) => getComputedStyle(r).color + '|' + getComputedStyle(r).backgroundColor))
      expect(new Set(ink).size, 'every unchosen row has the same colours').toBe(1)

      // 3. open a topic: every mark on file, from a tonight sheet and from a generated paper
      await rows.nth(0).click()
      await openTray(page, /^Marks/i)
      await expect(page.locator('[data-marks] .cld-mark')).toHaveCount(2)
      await expect(page.locator('[data-marks] .cld-mark').nth(0)).toContainText('2026-11-25')
      await expect(page.locator('[data-marks] .cld-mark').nth(0)).toContainText('a tonight sheet')
      await expect(page.locator('[data-marks] .cld-mark').nth(0)).toContainText('4 of 5, 9 min')
      await expect(page.locator('[data-marks] .cld-mark').nth(1)).toContainText('a generated paper')
      await expect(page.locator('[data-marks] .cld-mark').nth(1)).toContainText('3 of 7')
      await expect(page.locator('[data-said="attempts"]')).toContainText('2 marks on file: 7 of 12.')
      await page.locator('.cld-behind > summary').click()
      await expect(page.locator('[data-ids="questions"]')).toHaveText('qa, qb, qc')
      await measure(page, 'topic opened', problems)
      await shot(page, '10-topic-marks-two-sources', w)
      await closeSheet(page)

      // 4. a topic with a hole: the engine's sentence for it, and no mark
      await page.locator('.cld-row').nth(1).click()
      await openTray(page, /^Marks/i)
      await expect(page.locator('[data-said="attempts"]')).toContainText('No mark on file for this choice.')
      await expect(page.locator('[data-tray="topic-marks"]')).toContainText('No note of yours mentions Sampling.')
      await shot(page, '11-topic-hole-sentence', w)
      await closeSheet(page)

      // 5. the pace waiting: the engine's sentence and no number
      await openTray(page, /^Pace/i)
      await expect(page.locator('[data-said="pace"]')).toContainText('No mark on file for this subject yet; the pace is counted from your marks.')
      await expect(page.locator('[data-pace]')).toHaveCount(0)
      await measure(page, 'pace waiting', problems)
      await shot(page, '12-pace-waiting', w)
      await closeSheet(page)

      // 6. another subject: the pace live, the numbers the engine counted beside its sentence
      await page.locator('#cld-subject').selectOption('fixture-circuits')
      await expect(page.locator('.cld-row')).toHaveCount(2)
      await openTray(page, /^Pace/i)
      await expect(page.locator('[data-said="pace"]')).toContainText('Counted over your last 2 days with a mark (2026-11-26 to 2026-11-27): 1 topic marked for the first time, 0.5 a day.')
      await expect(page.locator('[data-pace]')).toContainText('0.5')
      await expect(page.locator('[data-pace]')).toContainText('2026-12-09, 12 days away')
      await measure(page, 'pace live', problems)
      await shot(page, '13-pace-live', w)
      await closeSheet(page)

      // 7. today's plan is still the first face
      await noPromise(page, 'ledger', problems)
      await page.getByRole('radio', { name: 'Today' }).click()
      await expect(page.locator('.tsh-faces')).toHaveAttribute('data-face', 'today')

      expect(problems, problems.join('\n')).toEqual([])
      expect(errors, errors.join('\n')).toEqual([])
    })
  })
}
