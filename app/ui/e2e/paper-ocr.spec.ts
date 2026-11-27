// OCR on demand, Word papers and drafts from notes on the paper desk (package O), seen in a real browser with the pyq routes MOCKED by
// invented fixtures: the sandbox engine has no OCR engine, no scan and no local model, and nothing of the owner's may reach a picture.
// At 1366x768 and 390x844 under v3.
//
//   WW_SANDBOX_PORT=8871 WW_PREVIEW_PORT=5271 WW_SANDBOX_DIR="$TEMP/jarvis-ui-ocr-e2e" node scripts/build-e2e.mjs
//   (the same variables) npx playwright test e2e/paper-ocr.spec.ts --workers=1
//
// Pictures go to $TEMP/ui-ocr-shots (OCR_SHOTS overrides). Every size asserts, for the OCR panel and the drafts panel: no key or field under
// 44 px, no text under 11 px, nothing wider than its tray, no document scroll; and the honest words: OCR text is "unverified", a draft
// is "written by the local model, not checked", and neither is ever called verified.
import { deflateSync } from 'node:zlib'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page, Route } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'

const expect = baseExpect.configure({ timeout: 15_000 })
const SHOTS = resolve(process.env.OCR_SHOTS ?? resolve(tmpdir(), 'ui-ocr-shots'))
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const B = '/api/mission/pyq'

// ------------------------------------------------------------------------------------------------ invented fixtures
const SCAN_FAULTS = [
  'p. 2: no text layer; run OCR on this paper', 'p. 3: no text layer; run OCR on this paper', 'p. 4: no text layer; run OCR on this paper',
  'p. 5: no text layer; run OCR on this paper', 'p. 6: no text layer; run OCR on this paper', 'p. 7: no text layer; run OCR on this paper',
]
const paper = (id: string, title: string, year: number, faults: string[], counts: Record<string, number>) => ({
  id, title, filename: `${title}.pdf`, year, subject: 'signals', pages: 7, total_marks: 60, faults, method: faults.length ? 'text-layer' : 'ocr', counts,
})
const ENGINE = { name: 'invented-ocr', version: '1.0', device: 'cpu', installed: true }
const WORD_SENTENCE = 'Word is not installed on this PC, so a Word file cannot be read. Save it as PDF and drop that.'

type Outcome = 'done' | 'stopped'
interface Mock {
  scanFaults: string[]; scanQuestions: Record<string, unknown>[]
  job: Record<string, unknown> | null; polls: number; outcome: Outcome; startError: { status: number; detail: string } | null; stopping: boolean
  patterns: 'live' | 'provisional'; draftMode: 'waiting' | 'planned' | 'live'; drafts: Record<string, unknown>[]; calls: string[]; uploadName: string
}
const DRAFT = (id: string, over: Record<string, unknown> = {}) => ({
  id, subject: 'signals', unit: 2, topic: 'Sampling', text: 'State the sampling theorem and name one condition it needs to hold.', marks: null, status: 'pending', origin: 'model-draft',
  sources: [{ file_id: 'f1', title: 'Signals Studio notes: week 3' }, { file_id: 'f5', title: 'Unit 2 notes' }], checks: { copied: false, similarity: 0.31 }, made: '2026-11-27T10:05:00', ...over,
})
const newMock = (): Mock => ({
  scanFaults: [...SCAN_FAULTS], scanQuestions: [], job: null, polls: 0, outcome: 'done', startError: null, stopping: false,
  patterns: 'live', draftMode: 'waiting', drafts: [], calls: [], uploadName: '',
})

function crc32(b: Buffer): number {
  let c = ~0
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}
/** An invented page crop: a 420 x 110 PNG of a pale sheet with grey bars where lines of print would be. Built here, so no picture file is stored. */
function makeCrop(): Buffer {
  const w = 420, h = 110
  const raw = Buffer.alloc((w * 3 + 1) * h, 244)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    const bar = y % 22 >= 6 && y % 22 < 12 && y < 100
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      const on = bar && x > 14 && x < 14 + 220 + ((y * 7) % 150)
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
const FAKE_CROP = makeCrop()

function questions(m: Mock) {
  const q = (id: string, paperId: string, label: string, text: string, status: string, over: Record<string, unknown> = {}) => ({
    id, paper_id: paperId, label, text, text_status: text ? 'unverified' : 'none', marks: null, type: 'short', status, unit: null, topic: '', tag_source: 'rule', tag_margin: 0,
    has_crop: true, updated: '2026-11-27T10:00:00', crop: { page: 2, bbox: [30, 40, 500, 200], png: 'x.png' }, origin: 'paper', ...over,
  })
  return [
    q('qa', 'p-b', '1', 'Invented text-layer question one about a sampled tone.', 'accepted', { text_status: 'verified', marks: 5 }),
    ...m.scanQuestions,
    q('qz', 'p-c', '2', 'Invented text-layer question two.', 'pending', { marks: 5 }),
  ]
}

function ocrAnswer(m: Mock) {
  const waiting = { papers: m.scanFaults.some((f) => /no text layer/.test(f)) ? 1 : 0, pages: m.scanFaults.filter((f) => /no text layer/.test(f)).length }
  const job = m.job
  const base = { source: 'OCR on this PC', engine: ENGINE, gate: 0.85, job, waiting }
  if (job && job.status === 'running') return { ...base, state: m.stopping ? 'waiting' : 'live', reason: m.stopping ? 'Stopping after the page being read.' : `Reading page ${Number(job.pages_done) + 1} of ${job.pages_total}.` }
  if (job) {
    const below = Number(job.pages_below_gate)
    return { ...base, state: 'live', reason: `Read ${job.pages_read} of ${job.pages_total} pages: ${job.questions} drafts to review${below ? `; ${below} page was below 0.85 and is left as a picture` : ''}${job.status === 'stopped' ? '; stopped before the end.' : '.'}` }
  }
  return { ...base, state: 'waiting', reason: waiting.pages ? `${waiting.papers} paper has ${waiting.pages} pages with no text layer.` : 'No page is waiting for OCR.' }
}

function finish(m: Mock) {
  const stopped = m.outcome === 'stopped'
  const read = stopped ? 3 : 5
  m.job = { ...(m.job as object), status: stopped ? 'stopped' : 'done', pages_done: stopped ? 3 : 6, pages_read: read, pages_below_gate: 1, page_now: null, questions: stopped ? 2 : 4, finished: '2026-11-27T10:02:00', seconds_per_page: 13.8 }
  // what the reading left on the paper: the engine's new fault lines, and the drafts, pending and unverified
  m.scanFaults = ['p. 6: read at confidence 0.71, below 0.85; left as a picture', 'p. 3: read at confidence 0.95; no question start was found, so the whole page is one draft to split by hand']
  const q = (id: string, label: string, text: string, conf: number | null, over: Record<string, unknown> = {}) => ({
    id, paper_id: 'p-a', label, text, text_status: text ? 'unverified' : 'none', marks: null, type: 'short', status: 'pending', unit: null, topic: '', tag_source: 'rule', tag_margin: 0,
    has_crop: true, updated: '2026-11-27T10:02:00', crop: { page: 2, bbox: [30, 40, 500, 200], png: 'x.png' }, origin: 'paper', ocr_confidence: conf, ...over,
  })
  m.scanQuestions = [
    q('o1', '1', 'Invented recognised words: A tone of 3 kHz is sampled at 8 kHz. State what the samples show.', 0.91),
    q('o2', 'p3', 'Invented recognised words of a whole ruled page: question one, question two, a table of marks and a note on the diagram.', 0.95),
    q('o3', '4', '', null),
  ]
}

async function installMock(page: Page, m: Mock) {
  await page.route('**/api/mission/pyq/**', async (route: Route) => {
    const req = route.request()
    const u = new URL(req.url())
    const path = u.pathname.replace(B, '')
    const method = req.method()
    const body = req.postData() ?? ''
    m.calls.push(`${method} ${path}${u.search} ${body}`)
    const json = (data: Record<string, unknown>, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const refuse = (status: number, detail: string) => json({ detail }, status)
    if (path === '/papers' && method === 'GET') {
      const items = [
        paper('p-a', 'Mock paper A', 2024, m.scanFaults, { questions: m.scanQuestions.length, pending: m.scanQuestions.length, accepted: 0, rejected: 0, marks_missing: m.scanQuestions.length }),
        paper('p-b', 'Mock paper B', 2023, [], { questions: 1, pending: 0, accepted: 1, rejected: 0, marks_missing: 0 }),
        paper('p-c', 'Signals Studio sample', 2022, [], { questions: 1, pending: 1, accepted: 0, rejected: 0, marks_missing: 0 }),
      ]
      return json({ state: 'live', reason: '3 papers on file.', source: 'your papers', items, count: 3, total: 3 })
    }
    if (path === '/questions' && method === 'GET') {
      const items = questions(m)
      return json({ state: 'live', reason: `${items.length} questions.`, source: 'your papers', items, count: items.length, total: items.length })
    }
    if (path.startsWith('/crops/')) return route.fulfill({ status: 200, contentType: 'image/png', body: FAKE_CROP })
    if (path === '/patterns') {
      // R-16 under its floor: WAITING with the counts still present and provisional true
      if (m.patterns === 'provisional') return json({ state: 'waiting', reason: 'Too few papers to show a pattern: 1 more paper, 17 more reviewed questions.', source: 'your papers', provisional: true, floor: { papers: 3, questions: 20, papers_needed: 1, questions_needed: 17 }, patterns: { n_papers: 2, n_questions: 3, topics: [{ key: '2|Sampling', unit: 2, topic: 'Sampling', k: 2, n: 2 }] } })
      return json({ state: 'live', reason: 'ok', source: 'your papers', provisional: false, patterns: { n_papers: 3, n_questions: 24, topics: [{ key: '2|Sampling', unit: 2, topic: 'Sampling', k: 2 }, { key: '2|Aliasing', unit: 2, topic: 'Aliasing', k: 1 }] } })
    }
    if (path === '/practise-next') {
      if (m.patterns === 'provisional') return json({ state: 'waiting', reason: 'Too few papers to show a pattern.', source: 'your papers', provisional: true, items: [], count: 0 })
      return json({ state: 'live', reason: '1 topic fits the gap.', source: 'your papers', provisional: false, items: [{ key: '2|Sampling', unit: 2, topic: 'Sampling', gain: 0.21, terms: { marks_weight: 0.31, seen_share: 0.8, proficiency: 0.5, measured: false, minutes: 12, syllabus_weight: 3 }, question_ids: ['qa'], reason: 'set in 2 of 3 papers on file; no marked attempts' }], count: 1 })
    }
    if (path === '/ocr' && method === 'GET') {
      if (m.job && m.job.status === 'running') {
        m.polls++
        const total = Number(m.job.pages_total)
        const stopAt = m.outcome === 'stopped' || m.stopping ? 3 : total
        const done = Math.min(m.polls, stopAt)
        m.job = { ...m.job, pages_done: done, pages_read: Math.max(0, done - 1), pages_below_gate: done >= 3 ? 1 : 0, page_now: done + 2, seconds_per_page: 13.8, questions: Math.max(0, done - 1) }
        if (m.polls >= 2 && m.outcome === 'done' && !process.env.OCR_HOLD) { /* the test decides when the job ends */ }
      }
      return json(ocrAnswer(m))
    }
    if (/^\/papers\/[^/]+\/ocr$/.test(path) && method === 'POST') {
      if (m.startError) return refuse(m.startError.status, m.startError.detail)
      m.polls = 0
      m.stopping = false
      m.job = { id: 'o-1', status: 'running', paper_id: 'p-a', pages_total: 6, pages_done: 0, page_now: 2, pages_read: 0, pages_below_gate: 0, questions: 0, started: '2026-11-27T10:00:00', finished: null, seconds_per_page: null }
      return json(ocrAnswer(m))
    }
    if (path === '/ocr' && method === 'DELETE') { m.stopping = true; m.outcome = 'stopped'; return json(ocrAnswer(m)) }
    if (path === '/drafts/from-notes') {
      if (m.draftMode === 'waiting') return json({ state: 'waiting', reason: 'The local model is not running.', source: 'the local model, from your notes', items: [], count: 0 })
      if (m.draftMode === 'planned') return json({ state: 'planned', reason: 'Drafting is off: rules only.', source: 'the local model, from your notes', items: [], count: 0 })
      m.drafts = [DRAFT('d-1'), DRAFT('d-2', { topic: 'Sampling', unit: 2, text: 'A tone sampled below its Nyquist rate is folded. Say what the samples then look like.', checks: { copied: false, similarity: 0.18 } }),
        DRAFT('d-0', { status: 'rejected', reason: 'It copies its passage: 5-word similarity 0.82.', checks: { copied: true, similarity: 0.82 }, text: 'Invented copy of a passage.' }), ...m.drafts]
      return json({ state: 'live', reason: '2 drafts to review, written from 2 of your notes.', source: 'the local model, from your notes', items: m.drafts, count: m.drafts.length })
    }
    if (path === '/drafts' && method === 'GET') return json({ state: m.drafts.length ? 'live' : 'waiting', reason: m.drafts.length ? 'drafts are waiting for your review.' : 'No draft on file.', source: 'the local model, from your notes', items: m.drafts, count: m.drafts.length })
    if (/^\/drafts\/[^/]+$/.test(path) && method === 'PATCH') {
      const id = path.split('/').pop()!
      const patch = JSON.parse(body)
      const d = m.drafts.find((x) => x.id === id)!
      Object.assign(d, { status: patch.status, ...(patch.marks ? { marks: patch.marks } : {}), ...(patch.text ? { text: patch.text, edited: true } : {}), ...(patch.status === 'accepted' ? { question_id: 'q-new' } : {}) })
      return json({ state: 'live', reason: 'ok', source: 'the local model, from your notes', draft: d, question: patch.status === 'accepted' ? { id: 'q-new' } : null })
    }
    if (path === '/upload' && method === 'POST') {
      m.uploadName = u.searchParams.get('name') ?? ''
      return json({ state: 'live', reason: 'Reading 1 file.', source: 'x', job: { id: 'j-9', status: 'running', done: 0, total: 1, files: [], trace: [] } })
    }
    if (path === '/ingest/j-9') return json({ state: 'fault', reason: WORD_SENTENCE, source: 'x', job: { id: 'j-9', status: 'failed', done: 1, total: 1, files: [{ file: m.uploadName, status: 'failed', note: WORD_SENTENCE }], trace: [] } })
    return json({ state: 'waiting', reason: 'No such route in the mock.' }, 404)
  })
  await page.route('**/api/mission/academics**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [{ id: 'signals' }] }) }))
}

// ------------------------------------------------------------------------------------------------ driving the page
const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function openDesk(page: Page, baseURL: string | undefined, w: number, h: number) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: w, height: h })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  await blurText(page)
  if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', 'ww')
  await page.keyboard.press('Control+3')
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', 'study')
  for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', 'papers')
  await expect(page.locator('[data-component="paper-desk"]')).toBeVisible({ timeout: 20_000 })
}

/** Under v3 on the phone the second and third trays are sheets that open from two pills (.s3-pill); the view switch is not one of them. */
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
const choosePaper = async (page: Page, name: string) => {
  await openTray(page, /^Papers/i)
  // no pointer workaround: on a touch-width screen the import tray no longer opens under a resting pointer
  await page.locator('.pp-paper', { hasText: name }).first().click()
}

const shot = async (page: Page, name: string, w: number) => {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `${name}-${w}.png`) })
}

/** The geometry of the two panels, judged on their own boxes: 44 px keys, 11 px text, nothing wider than its tray, no page scroll. */
async function measure(page: Page, at: string, problems: string[]) {
  const r = await page.evaluate(() => {
    const out: string[] = []
    const roots = [...document.querySelectorAll('.pp-ocr, .pp-drafts')].filter((e) => e.getBoundingClientRect().width > 1)
    for (const root of roots) {
      const rr = root.getBoundingClientRect()
      for (const el of root.querySelectorAll('button, input, select, textarea')) {
        const b = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (b.width < 1 || b.height < 1 || cs.visibility === 'hidden' || (el as HTMLElement).hidden) continue
        if (el.closest('[hidden]')) continue
        if (b.height < 43.5 || b.width < 43.5) out.push(`target ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`)
      }
      for (const el of root.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (b.width < 1 || el.closest('[hidden]')) continue
        if (el.children.length === 0 && (el.textContent || '').trim()) {
          const fs = parseFloat(getComputedStyle(el).fontSize)
          if (fs < 10.95) out.push(`small ${fs}px "${(el.textContent || '').trim().slice(0, 24)}"`)
        }
        if (b.right > rr.right + 1 || b.left < rr.left - 1) out.push(`wider than its panel: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 20)} by ${Math.round(Math.max(b.right - rr.right, rr.left - b.left))}px`)
      }
    }
    const doc = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
    if (doc > 1) out.push(`document scrolls sideways ${doc}px`)
    return out
  })
  for (const p of r) problems.push(`${at}: ${p}`)
}

const noVerifiedClaim = async (page: Page, sel: string, at: string, problems: string[]) => {
  const t = await page.locator(sel).evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText).join(' \n '))
  if (/(?<!un)verified/i.test(t.replace(/I checked the text/g, ''))) problems.push(`${at}: the word "verified" appears in ${sel}`)
}

for (const { w, h } of SIZES) {
  test.describe(`paper desk OCR, Word and drafts at ${w}x${h} (v3)`, () => {
    test('a scanned paper: the key, a running job with Stop, a stopped job, then a done job and its unverified drafts', async ({ page, baseURL }) => {
      const problems: string[] = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const m = newMock()
      await installMock(page, m)
      await openDesk(page, baseURL, w, h)

      // 1. a scanned paper: fault lines and the Read with OCR key
      await choosePaper(page, 'Mock paper A')
      const key = page.getByRole('button', { name: /Read with OCR/ })
      await expect(key).toBeVisible()
      await expect(page.locator('.pp-ocr-hint')).toContainText('6 pages have no text layer: 2, 3, 4, 5, 6, 7.')
      // the key is inside the visible part of its own tray: no scrolling to reach it (the third tray used to push it under the fold)
      const where = await key.evaluate((el) => {
        const tray = el.closest('.s3-tray, [data-sheet]') as HTMLElement
        const k = el.getBoundingClientRect(); const t = tray.getBoundingClientRect()
        return { top: k.top - t.top, bottom: t.bottom - k.bottom, vh: window.innerHeight - k.bottom }
      })
      expect(where.top, 'key below the tray top').toBeGreaterThanOrEqual(0)
      expect(where.bottom, 'key above the tray bottom').toBeGreaterThanOrEqual(0)
      expect(where.vh, 'key inside the window').toBeGreaterThanOrEqual(0)
      await measure(page, 'scanned paper', problems)
      await shot(page, '01-scanned-paper-ocr-key', w)

      // 2. a 409 shows the engine's sentence
      m.startError = { status: 409, detail: 'The paper desk is reading files; start OCR when it has finished.' }
      await key.click()
      await expect(page.locator('.pp-ocr-state[data-said]')).toContainText('The paper desk is reading files; start OCR when it has finished.')
      await measure(page, '409', problems)
      await shot(page, '02-409-sentence', w)
      m.startError = null

      // 3. a running job: page N of M, pages read, pages under the gate, seconds per page, Stop; polled only while it runs
      m.outcome = 'stopped'
      await key.click()
      await expect(page.locator('.pp-ocr-head')).toContainText(/Reading page \d of 6/)
      await expect(page.getByRole('button', { name: /Stop/ })).toBeVisible()
      await expect(page.locator('.pp-ocr-facts')).toContainText('Time per page')
      await expect(page.locator('.pp-ocr-facts')).toContainText('13.8 s', { timeout: 20_000 })
      await measure(page, 'running', problems)
      await shot(page, '03-running-job-with-stop', w)

      // 4. Stop: the engine says it stops after the page being read; the job ends Stopped, with the counts
      await page.getByRole('button', { name: /Stop/ }).click()
      await expect(page.locator('.pp-ocr-state')).toContainText('Stopping after the page being read.')
      // the mock ends the job on its own once the page is read
      finishStopped(m)
      await expect(page.locator('.pp-ocr-head')).toHaveText('Stopped', { timeout: 20_000 })
      await expect(page.locator('.pp-ocr-facts')).toContainText('Drafts to review')
      await measure(page, 'stopped', problems)
      await shot(page, '04-stopped-job', w)
      const pollsAfter = m.calls.filter((c) => c.startsWith('GET /ocr')).length
      await page.waitForTimeout(6000)
      expect(m.calls.filter((c) => c.startsWith('GET /ocr')).length, 'no polling once the job ended').toBe(pollsAfter)

      // 5. the same paper read to the end: Done, the under-gate line, the whole-page line, and the questions are read again
      m.scanFaults = [...SCAN_FAULTS.slice(2)]
      m.outcome = 'done'
      await page.reload()
      await openDesk(page, baseURL, w, h)
      await choosePaper(page, 'Mock paper A')
      await page.getByRole('button', { name: /Read with OCR/ }).click()
      await expect(page.locator('.pp-ocr-head')).toContainText(/Reading page/)
      finishDone(m)
      await expect(page.locator('.pp-ocr-head')).toHaveText('Done', { timeout: 20_000 })
      await expect(page.locator('.pp-faults')).toContainText('read at confidence 0.71, below 0.85; left as a picture')
      await expect(page.locator('.pp-faults')).toContainText('the whole page is one draft to split by hand')
      await expect(page.locator('.pp-ocr-note').first()).toBeVisible()
      await measure(page, 'done', problems)
      await noVerifiedClaim(page, '.pp-ocr', 'done panel', problems)
      await shot(page, '05-done-with-under-gate-and-whole-page', w)

      // 6. the Review Desk: each OCR question is "read by OCR, check it" with the engine's confidence; a whole page is to split by hand;
      //    a picture-only question shows its crop, not an empty text box
      await closeSheet(page)
      const review = page.getByRole('button', { name: /Review \d+ waiting/ })
      await expect(review).toBeVisible({ timeout: 15_000 })
      await review.click()
      const desk = page.locator('.rv-desk')
      await expect(desk).toBeVisible()
      await expect(desk).toContainText('Read by OCR, check it.')
      await expect(desk).toContainText(/OCR confidence 0\.\d\d, text unverified\./)
      await noVerifiedClaim(page, '.rv-desk', 'review desk', problems)
      await shot(page, '06-review-ocr-question', w)
      let sawWhole = false
      let sawPicture = false
      for (let i = 0; i < 6 && !(sawWhole && sawPicture); i++) {
        const t = await desk.innerText()
        if (/split it by hand/.test(t) && !sawWhole) { sawWhole = true; await shot(page, '07-review-whole-page-draft', w) }
        if (/No text was read\. The crop is all there is\./.test(t) && !sawPicture) {
          sawPicture = true
          await expect(desk.locator('.rv-crop[data-state="crop-only"] .rv-crop-img img')).toBeVisible()
          await shot(page, '08-review-picture-only-question', w)
        }
        await page.keyboard.press('j')
        await page.waitForTimeout(150)
      }
      expect(sawWhole, 'a whole-page draft was reviewed').toBe(true)
      expect(sawPicture, 'a picture-only question was reviewed').toBe(true)
      await page.keyboard.press('Escape')

      expect(errors, 'page errors').toEqual([])
      expect(problems).toEqual([])
    })

    test('the drafts panel: required fields, waiting and planned sentences, live drafts, accept, edit then accept, reject', async ({ page, baseURL }) => {
      const problems: string[] = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const m = newMock()
      await installMock(page, m)
      await openDesk(page, baseURL, w, h)
      await choosePaper(page, 'Mock paper B')
      await closeSheet(page)
      await openTray(page, /^Drafts/i)
      await expect(page.getByRole('button', { name: 'Draft questions from my notes' })).toHaveAttribute('aria-expanded', 'true')
      const draftKey = page.getByRole('button', { name: 'Draft', exact: true })
      await expect(draftKey).toBeVisible()
      await expect(page.locator('.pp-drafts')).toContainText('Say which topic first.')
      await expect(page.locator('.pp-drafts').getByLabel('Subject')).toHaveValue('signals')
      await measure(page, 'drafts closed form', problems)

      // waiting: the engine's sentence, no draft
      await page.locator('.pp-drafts').getByLabel('Topic', { exact: true }).fill('Sampling')
      await draftKey.click()
      await expect(page.locator('.pp-drafts-say').first()).toContainText('The local model is not running.')
      await measure(page, 'drafts waiting', problems)
      await shot(page, '09-drafts-waiting', w)

      // planned: rules only
      m.draftMode = 'planned'
      await draftKey.click()
      await expect(page.locator('.pp-drafts-say').first()).toContainText('Drafting is off: rules only.')

      // live: two drafts to review, one the engine rejected for copying; each is labelled and never called verified
      m.draftMode = 'live'
      await page.locator('.pp-drafts').getByLabel('How many').selectOption('2')
      await draftKey.click()
      await expect(page.locator('.pp-draft')).toHaveCount(3)
      const first = page.locator('.pp-draft[data-draft="d-1"]')
      await expect(first).toContainText('written by the local model, not checked')
      await expect(first).toContainText('Copied from the notes: no; similarity 0.31')
      await expect(first).toContainText('Signals Studio notes: week 3; Unit 2 notes')
      await expect(page.locator('.pp-draft[data-draft="d-0"]')).toContainText('Rejected: It copies its passage')
      expect(JSON.parse(m.calls.filter((c) => c.startsWith('POST /drafts/from-notes')).pop()!.split(' ').slice(2).join(' '))).toEqual({ subject: 'signals', topic: 'Sampling', count: 2 })
      await measure(page, 'drafts live', problems)
      await noVerifiedClaim(page, '.pp-drafts', 'drafts live', problems)
      await first.scrollIntoViewIfNeeded()
      await shot(page, '10-drafts-live', w)

      // Accept needs marks; then the card says so and still says the model wrote it
      // the key is disabled WITH its reason printed beside it (the kit's rule), so there is nothing to press until the marks are set
      await expect(first.getByRole('button', { name: 'Accept', exact: true })).toHaveAttribute('aria-disabled', 'true')
      await expect(first).toContainText('Set the marks first.')
      await first.getByLabel('Marks').fill('5')
      await first.getByRole('button', { name: 'Accept', exact: true }).click()
      await expect(first).toContainText('Accepted by you')
      await expect(first).toContainText('still says the local model wrote it')
      expect(m.calls.some((c) => c.startsWith('PATCH /drafts/d-1') && c.includes('"status":"accepted"') && c.includes('"marks":5'))).toBe(true)

      // Edit then accept, and Reject
      const second = page.locator('.pp-draft[data-draft="d-2"]')
      await second.getByRole('button', { name: 'Edit then accept' }).click()
      await second.locator('textarea').fill('A tone sampled below its Nyquist rate is folded. Say what the samples then show.')
      await second.getByLabel('Marks').fill('4')
      // the unit and the topic can be corrected before accepting
      await second.locator('.pp-draft-where input').nth(0).fill('3')
      await second.locator('.pp-draft-where input').nth(1).fill('Aliasing')
      await second.scrollIntoViewIfNeeded()
      await shot(page, '11-draft-editing', w)
      await second.getByRole('button', { name: 'Accept edited' }).click()
      await expect(second).toContainText('Accepted by you after an edit')
      expect(m.calls.some((c) => c.startsWith('PATCH /drafts/d-2') && c.includes('"text":"A tone sampled') && c.includes('"unit":3') && c.includes('"topic":"Aliasing"'))).toBe(true)
      await measure(page, 'drafts decided', problems)
      await noVerifiedClaim(page, '.pp-drafts', 'drafts decided', problems)

      m.drafts.push(DRAFT('d-3', { text: 'Invented third draft about a filter before the sampler.' }))
      await page.getByRole('button', { name: 'Draft', exact: true }).click()
      expect(errors, 'page errors').toEqual([])
      expect(problems).toEqual([])
    })

    test('the first tray: provisional counts are a note and draw no pattern; a live pattern shows the engine order with its terms', async ({ page, baseURL }) => {
      const problems: string[] = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const m = newMock()
      m.patterns = 'provisional'
      await installMock(page, m)
      await openDesk(page, baseURL, w, h)
      await expect(page.locator('.pp-prov')).toContainText('3 questions in 2 papers so far: too few to call a pattern.')
      await expect(page.locator('.pp-prov')).toContainText('1 more paper, 17 more reviewed questions')
      // no topic row, no suggestion and no weight is drawn from the provisional counts
      await expect(page.locator('.pp-strata')).not.toContainText('Sampling')
      await expect(page.locator('.pp-next')).toHaveCount(0)
      await expect(page.locator('[data-component="paper-desk"]')).toHaveAttribute('data-state', 'live')
      await shot(page, '13-provisional-counts-note', w)
      // the mock reads m.patterns on every call, so a fresh load of the desk sees the live pattern
      m.patterns = 'live'
      await page.goto('about:blank')
      await openDesk(page, baseURL, w, h)
      await expect(page.locator('.pp-prov')).toHaveCount(0)
      await expect(page.locator('.pp-strata')).toContainText('Sampling')
      await expect(page.locator('.pp-next')).toContainText('Practise next, in the engine')
      await expect(page.locator('.pp-next')).toContainText('syllabus weight 3 of 3 (high)')
      await expect(page.locator('.pp-next')).toContainText('proficiency 0.50, not measured yet')
      await shot(page, '14-practise-next-terms', w)
      expect(errors, 'page errors').toEqual([])
      expect(problems).toEqual([])
    })

    test('the import takes Word: the file chooser lists .docx and .doc, and a file Word cannot print fails with the engine\'s sentence', async ({ page, baseURL }) => {
      const m = newMock()
      await installMock(page, m)
      await openDesk(page, baseURL, w, h)
      await openTray(page, /^Papers/i)
      const accept = await page.locator('input[type="file"][aria-label="Choose paper files"]').getAttribute('accept')
      expect(accept).toContain('.docx')
      expect(accept).toContain('.doc')
      expect(accept).toContain('.pdf')
      await page.locator('input[type="file"][aria-label="Choose paper files"]').setInputFiles({ name: 'mock-paper-a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK invented') })
      await expect(page.locator('.pp-notice').first()).toContainText(WORD_SENTENCE, { timeout: 20_000 })
      expect(m.uploadName).toBe('mock-paper-a.docx')
      await expect(page.locator('.pp-notice').first()).toContainText('Word is not installed')
      await shot(page, '12-word-paper-failed-sentence', w)
      await page.locator('input[type="file"][aria-label="Choose paper files"]').setInputFiles({ name: 'notes.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') })
      await expect(page.locator('.pp-drop-sub').first()).toContainText('Only PDF, Word and image files can be read')
    })
  })
}

// the mock ends a job when the test says the page being read is done
function finishStopped(m: Mock) {
  m.outcome = 'stopped'
  if (m.job) m.job = { ...m.job, status: 'stopped', pages_done: 3, pages_read: 2, pages_below_gate: 1, page_now: null, questions: 2, finished: '2026-11-27T10:01:00', seconds_per_page: 13.8 }
}
function finishDone(m: Mock) {
  m.outcome = 'done'
  finish(m)
}
