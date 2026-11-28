// The Prepare face of Study > Papers and the honest marks and roles of wave EW11 (board requests 21 and 23; queue rows R34 and V8), seen in
// a real browser under v3 with the engine's routes MOCKED in the page, to the shapes of app/tests/test_pyq_prep.py, test_pyq_prep_run.py and
// test_pyq_tonight.py. Every subject, paper and question is invented. At 1366x768 and 390x844.
//
//   export WW_SANDBOX_PORT=9011 WW_PREVIEW_PORT=5411 WW_SANDBOX_DIR="$TEMP/jarvis-ui-prep-e2e"
//   node scripts/build-e2e.mjs && npx playwright test e2e/prep-store.spec.ts --workers=1
//
// Pictures go to $TEMP/ui-prep-shots (PREP_SHOTS overrides). Every step asserts: no key or field under 44 px, no text under 11 px, nothing
// wider than its tray, no page scroll sideways, and a tray whose content is longer than the tray can scroll.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page, Route } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'

const expect = baseExpect.configure({ timeout: 15_000 })
const SHOTS = resolve(process.env.PREP_SHOTS ?? resolve(tmpdir(), 'ui-prep-shots'))
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const B = '/api/mission/pyq'
const SUBJECTS = [{ id: 'fixture-signals', name: 'Fixture Signals', kind: 'course', exam_date: '2026-12-08', days_left: 10, strategy: '', units: [] }, { id: 'fixture-maths', name: 'Fixture Maths', kind: 'course', exam_date: null, days_left: null, strategy: '', units: [] }]
const CLAUDE_SENTENCE = (m: string) => `Claude (${m}) is asked through the Claude tool on this PC: the text of your questions and notes leaves this PC and counts against your Claude usage.`

// ------------------------------------------------------------------------------------------------ invented engine state
const sub = (id: string, name: string, over: Record<string, number> = {}) => ({ subject: id, name, papers: 3, questions: 40, pending: 40, accepted: 0, with_marks: 12, tagged: 0, sheet_ready_topics: 0, ...over })
function counts(accepted = 0, tagged = 0, without = 2) {
  const a = sub('fixture-signals', 'Fixture Signals', { accepted, pending: 40 - accepted, tagged })
  const b = sub('fixture-maths', 'Fixture Maths', { papers: 2, questions: 12, pending: 12, with_marks: 4 })
  return {
    papers: 7, questions: 58, pending: 58 - accepted, accepted, with_marks: 16, tagged, sheet_ready_topics: 0, without_subject: without, by_subject: [a, b],
    courses: { mapped: 2, unmapped: 1, state: 'live', reason: '' }, solutions: { papers: 1, items: 6, paired: 0 }, question_banks: 1, not_questions: 3, marks_not_printed: 9, accepted_unmarked: 0,
  }
}
const countsReason = (c: ReturnType<typeof counts>) => `${c.questions} questions on ${c.papers} papers: ${c.accepted} accepted, ${c.with_marks} with marks, ${c.tagged} with a topic, ${c.without_subject} papers without a subject; 0 topics are ready for an evening sheet. 1 solution sheet with 6 items is counted apart. 3 items are not a question.`

interface Mock {
  calls: string[]
  provider: 'off' | 'local' | 'claude'; claudeModel: string; claudeFound: boolean
  autoAccept: boolean
  accepted: number; tagged: number; without: number
  run: Record<string, unknown> | null; polls: number; stopping: boolean; outcome: 'done' | 'stopped'; run409: boolean
  papers: Record<string, unknown>[]; questions: Record<string, unknown>[]
  marks: Record<string, unknown>[]
}
const newMock = (): Mock => ({
  calls: [], provider: 'off', claudeModel: 'sonnet', claudeFound: true, autoAccept: false, accepted: 0, tagged: 0, without: 2,
  run: null, polls: 0, stopping: false, outcome: 'stopped', run409: false, papers: [], questions: [], marks: [],
})

const paper = (id: string, title: string, year: number, over: Record<string, unknown> = {}) => ({
  id, title, filename: `${title}.pdf`, year, subject: 'fixture-signals', pages: 3, total_marks: 60, faults: [], method: 'text-layer', role: 'paper', role_source: 'rule',
  counts: { questions: 2, pending: 2, accepted: 0, rejected: 0, marks_missing: 0 }, ...over,
})
const question = (id: string, paperId: string, label: string, over: Record<string, unknown> = {}) => ({
  id, paper_id: paperId, label, text: `Invented question ${label}: explain the pretend circuit of the fixture kit in a few lines.`, text_status: 'verified', marks: 5, type: 'descriptive',
  status: 'pending', unit: 2, topic: 'Sampling', tag_source: 'rule', tag_margin: 0.6, has_crop: false, updated: '2026-11-28T10:00:00', crop: null, origin: 'paper', ...over,
})
function stockPapers(m: Mock) {
  m.papers = [
    paper('p-a', 'Fixture Signals mid term 2025', 2025),
    paper('p-qb', 'Fixture Signals question bank unit 2', 2025, { role: 'question_bank', counts: { questions: 2, pending: 1, accepted: 1, rejected: 0, marks_missing: 2 } }),
    paper('p-sol', 'Fixture Signals mid term 2025 solution', 2025, { role: 'solution', role_source: 'hand', faults: ['p. 2: no text layer; run OCR on this paper'], counts: { questions: 3, pending: 3, accepted: 0, rejected: 0, marks_missing: 3 } }),
  ]
  m.questions = [
    question('q-a1', 'p-a', '1'), question('q-a2', 'p-a', '2', { status: 'accepted', accepted_by: 'rule', status_by: 'rule' }),
    question('q-qb1', 'p-qb', '1', { marks: null, marks_source: 'not printed', tag_source: 'model', tag_model: 'claude sonnet', tag_margin: null, status: 'accepted', accepted_by: 'rule', status_by: 'rule', topic: 'Aliasing' }),
    question('q-qb2', 'p-qb', '2', { marks: null, marks_source: 'not printed', text: 'Section B', not_question: true, not_question_source: 'rule', tag_source: 'rule', topic: '', unit: null }),
    question('q-s1', 'p-sol', '1', { marks: null, text: 'Invented worked answer of question one.' }),
  ]
}

function job(m: Mock, over: Record<string, unknown> = {}) {
  return { id: 'r-000000000001', status: 'running', steps: ['subjects', 'reread', 'tags', 'accept'], step: 'tags', unit: 'subjects', done: 0, total: 2, counts_before: counts(0, 0, 2), counts_now: counts(m.accepted, m.tagged, m.without), started: '2026-11-28T10:00:00', finished: null, seconds: 0.4, failures: 0, notes: [], results: {}, subjects: ['fixture-signals', 'fixture-maths'], model: '', error: null, ...over }
}
function runAnswer(m: Mock) {
  const j = m.run
  if (!j) return { state: 'waiting', reason: 'No preparation run yet.', source: 'the preparation run on this PC', run: null }
  const fields = { status: j.status, step: j.step, done: j.done, total: j.total, counts_before: j.counts_before, counts_now: j.counts_now, seconds: j.seconds, failures: j.failures }
  if (j.status === 'running') {
    if (m.stopping) return { state: 'waiting', reason: 'Stopping after the batch or paper in hand.', source: 'the preparation run on this PC', run: j, ...fields }
    return { state: 'live', reason: `Step ${j.step}: ${j.done} of ${j.total} ${j.unit} done, ${j.seconds} s so far.`, source: 'the preparation run on this PC', run: j, ...fields }
  }
  const b = j.counts_before as ReturnType<typeof counts>; const n = j.counts_now as ReturnType<typeof counts>
  const text = `${j.status === 'stopped' ? 'Stopped during' : 'Finished'} ${(j.steps as string[]).join(', ')} in ${j.seconds} s: accepted ${b.accepted} to ${n.accepted}, with a topic ${b.tagged} to ${n.tagged}, papers without a subject ${b.without_subject} to ${n.without_subject}; ${j.failures} ${j.failures === 1 ? 'failure' : 'failures'}.${(j.notes as string[]).length ? ' ' + (j.notes as string[]).slice(0, 3).join(' ') : ''}`
  return { state: 'live', reason: text, source: 'the preparation run on this PC', run: j, ...fields }
}
function modelAnswer(m: Mock) {
  const reason = m.provider === 'off' ? 'Rules only: no model is asked, and nothing leaves this PC.'
    : m.provider === 'local' ? 'The local model on this PC is chosen but not running now, so a request answers that no model is reachable.' : CLAUDE_SENTENCE(m.claudeModel)
  return { state: m.provider === 'local' ? 'waiting' : 'live', reason, source: 'your settings', provider: m.provider, claude_model: m.claudeModel, available: { local: false, claude: m.claudeFound }, sends_out: m.provider === 'claude', name: m.provider === 'claude' ? `claude ${m.claudeModel}` : '' }
}

const NOT_PRINTED_400 = "This question's marks are not printed: give out_of, your own number from 1 to 100."
const SHEET = (marks: Record<string, unknown>[]) => {
  const mark = (q: string) => marks.find((x) => x.question_id === q) ?? null
  return {
    id: '2026-11-28-fixture-signals', date: '2026-11-28', subject: 'fixture-signals', built_at: '2026-11-28T19:00:00', unmarked: 2 - marks.length, marks,
    items: [
      { n: 1, question_id: 'q-qb1', marks: null, marks_note: 'marks not printed', unit: 2, topic: 'Aliasing', topic_key: '2|Aliasing', text: 'Invented question one: say what a folded tone looks like.', crop: null, why: { days_left: 10, marks_weight: 0.3, share: 0.5, proficiency: 0.5, syllabus_weight: 3 }, mark: mark('q-qb1') },
      { n: 2, question_id: 'q-a1', marks: 5, marks_note: '', unit: 2, topic: 'Sampling', topic_key: '2|Sampling', text: 'Invented question two: state the sampling rule.', crop: null, why: { days_left: 10, marks_weight: 0.4, share: 0.6, proficiency: 0.5, syllabus_weight: 3 }, mark: mark('q-a1') },
    ],
  }
}

async function installMock(page: Page, m: Mock) {
  await page.route('**/api/mission/pyq/**', async (route: Route) => {
    const req = route.request()
    const u = new URL(req.url())
    const path = u.pathname.replace(B, '')
    const method = req.method()
    const raw = req.postData() ?? ''
    const body = raw ? JSON.parse(raw) : {}
    m.calls.push(`${method} ${path} ${raw}`)
    const json = (data: Record<string, unknown>, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const refuse = (status: number, detail: string) => json({ detail }, status)
    const S = 'your papers on file'
    if (path === '/model' && method === 'GET') return json(modelAnswer(m))
    if (path === '/model' && method === 'PUT') {
      if (body.provider === 'claude' && !m.claudeFound) return refuse(400, 'The Claude tool is not found on this PC, so Claude cannot be chosen.')
      m.provider = body.provider; if (body.claude_model) m.claudeModel = body.claude_model
      return json(modelAnswer(m))
    }
    if (path === '/prep' && method === 'GET') { const c = counts(m.accepted, m.tagged, m.without); return json({ state: 'live', reason: countsReason(c), source: S, counts: c }) }
    if (path === '/prep/policy') {
      if (method === 'PUT') m.autoAccept = body.auto_accept === true
      return json({ state: 'live', reason: m.autoAccept ? 'Questions safe to trust may be accepted by rule; each says so.' : 'Off: nothing enters the bank without your review.', source: 'your settings', policy: { auto_accept: m.autoAccept } })
    }
    if (path === '/prep/subjects') {
      if (body.apply) return refuse(400, 'the look must not write')
      return json({ state: 'live', reason: 'Would set a subject on 1 paper by rule (0 by course, 1 by code, 0 by name); 1 still without one. By its title, 1 paper is a question bank and 1 paper is a solution sheet.', source: 'rule on titles, codes and your Classroom courses',
        items: [{ paper: 'p-x', title: 'Invented loose paper', subject: 'fixture-signals', rule: 'code', written: '', reason: "The subject's course code is on it." }, { paper: 'p-y', title: 'Invented scan', subject: '', rule: '', written: '', reason: 'No rule found a subject.' }],
        count: 2, counts: { course: 0, code: 1, name: 0, model: 0, none: 1, has_subject: 5, model_failed: 0, model_dropped: 0 }, courses: [], model: '', asked: 0, roles: [], role_counts: { question_bank: 1, solution: 1 }, pairs: [] })
    }
    if (path === '/prep/reread') {
      if (body.apply) return refuse(400, 'the look must not write')
      return json({ state: 'live', reason: 'Reading again would change 1 paper of 7; nothing was written.', source: "today's reader on your originals", changed: 1, count: 2,
        items: [{ paper: 'p-a', title: 'Fixture Signals mid term 2025', questions_before: 2, questions_after: 3, marks_before: 1, marks_after: 3, changed: true, failed: false, reason: 'Reading again would give 3 questions, 3 with marks; nothing was written.', backup: '' },
          { paper: 'p-sc', title: 'Invented scan', questions_before: 0, questions_after: null, marks_before: 0, marks_after: null, changed: false, failed: false, reason: 'Some pages were read by OCR; read it again with OCR instead.', backup: '' }] })
    }
    if (path === '/prep/tags') {
      if (body.apply) return refuse(400, 'the look must not write')
      const s = body.subject === 'fixture-maths'
      return json({ state: s ? 'waiting' : 'live', reason: s ? 'This subject has no syllabus topics yet.' : 'Would tag 14 by rule and 0 by the model; 0 fit none of the topics, 26 are still without a topic. 2 items are not a question and are kept out.', source: 'rule on the syllabus words', subject: body.subject, rule: s ? 0 : 14, model: 0, none: 0, left: s ? 0 : 26, not_question: s ? 0 : 2 })
    }
    if (path === '/prep/accept') {
      if (!m.autoAccept) return json({ state: 'planned', reason: 'Acceptance by rule is off; only you can turn it on.', source: 'your settings', accepted: 0, held: {}, unmarked: 0, counts: counts(m.accepted, m.tagged, m.without), before: counts(m.accepted, m.tagged, m.without) })
      const before = counts(m.accepted, m.tagged, m.without); m.accepted += 6
      const after = counts(m.accepted, m.tagged, m.without)
      return json({ state: 'live', reason: `Accepted 6 questions by rule; 34 left for your review. 2 of them are from a question bank: marks not printed. ${countsReason(after)}`, source: 'rule', accepted: 6, held: { 'no marks': 20, 'no unit and topic': 14 }, unmarked: 2, counts: after, before })
    }
    if (path === '/prep/unaccept') {
      const before = counts(m.accepted, m.tagged, m.without); const n = m.accepted; m.accepted = 0
      const after = counts(0, m.tagged, m.without)
      return json({ state: 'live', reason: `Returned ${n} questions accepted by rule to pending. ${countsReason(after)}`, source: 'rule', returned: n, counts: after, before })
    }
    if (path === '/prep/run' && method === 'POST') {
      if (m.run409) return refuse(409, 'The paper desk or OCR is reading; start the run when it has finished.')
      m.polls = 0; m.stopping = false
      m.run = job(m, { steps: body.steps, step: body.steps[0], unit: 'papers', total: 2 })
      return json(runAnswer(m))
    }
    if (path === '/prep/run' && method === 'GET') {
      if (m.run && m.run.status === 'running') {
        m.polls++
        const r = m.run
        r.seconds = Number((m.polls * 2.6).toFixed(1))
        r.done = Math.min(Number(r.total), m.polls)
        if (m.polls >= 2) { r.step = (r.steps as string[])[(r.steps as string[]).length - 1]; r.unit = 'subjects' }
        if (m.stopping && m.polls >= 2) {
          r.status = 'stopped'; r.finished = '2026-11-28T10:00:06'; m.tagged = 14; m.without = 1
          r.counts_now = counts(m.accepted, m.tagged, m.without)
        } else if (!m.stopping && m.outcome === 'done' && m.polls >= 3) {
          r.status = 'done'; r.finished = '2026-11-28T10:00:09'; m.tagged = 30; m.without = 0; r.failures = 2
          r.notes = ['Fixture Signals: 2 batches of the model failed; their questions are as they were.', 'Acceptance by rule is off; only you can turn it on, so nothing was accepted.']
          r.counts_now = counts(m.accepted, m.tagged, m.without)
        } else r.counts_now = counts(m.accepted, Math.min(14, m.polls * 7), m.without)
      }
      return json(runAnswer(m))
    }
    if (path === '/prep/run' && method === 'DELETE') {
      if (!m.run || m.run.status !== 'running') return refuse(400, 'No preparation run is going.')
      m.stopping = true
      return json(runAnswer(m))
    }
    if (path === '/papers' && method === 'GET') return json({ state: 'live', reason: `${m.papers.length} papers on file.`, source: S, items: m.papers, count: m.papers.length, total: m.papers.length })
    if (/^\/papers\/[^/]+$/.test(path) && method === 'PATCH') {
      const p = m.papers.find((x) => x.id === path.split('/').pop())
      if (!p) return refuse(404, 'No such paper.')
      Object.assign(p, { role: body.role, role_source: 'hand' })
      return json({ state: 'live', reason: 'Paper updated.', source: S, paper: p })
    }
    if (path === '/questions' && method === 'GET') return json({ state: 'live', reason: `${m.questions.length} questions.`, source: S, items: m.questions, count: m.questions.length, total: m.questions.length })
    if (path === '/patterns') return json({ state: 'waiting', reason: 'Too few papers to show a pattern: 2 more papers, 18 more reviewed questions.', source: S, provisional: true, patterns: { n_papers: 1, n_questions: 2, topics: [] } })
    if (path === '/practise-next') return json({ state: 'waiting', reason: 'Too few papers to show a pattern.', source: S, provisional: true, items: [], count: 0 })
    if (path === '/ocr') return json({ state: 'waiting', reason: 'No page is waiting for OCR.', source: 'OCR on this PC', engine: null, gate: 0.85, job: null, waiting: { papers: 0, pages: 0 } })
    if (path === '/drafts') return json({ state: 'waiting', reason: 'No draft on file.', source: 'the local model, from your notes', items: [], count: 0 })
    if (path === '/tonight' && method === 'GET') return json({ state: 'live', reason: "Tonight's sheet: 2 questions, Fixture Signals, paper in 10 days.", source: 'your accepted papers', sheet: SHEET(m.marks), awaiting_marks: [], settings: { on: true, hour: '19:00', count: 6, horizon_days: 21 }, next_papers: [] })
    if (/^\/tonight\/[^/]+\/marks$/.test(path)) {
      for (const it of body.items) if (it.question_id === 'q-qb1' && it.out_of === undefined) return refuse(400, NOT_PRINTED_400)
      m.marks = body.items.map((it: Record<string, unknown>) => ({ question_id: it.question_id, got: it.got, max: it.out_of ?? 5, minutes: null, at: '2026-11-28T21:00:00' }))
      const kept = body.items.filter((it: Record<string, unknown>) => it.keep === true).map((it: Record<string, unknown>) => it.question_id)
      return json({ state: 'live', reason: `Saved marks for ${body.items.length} questions.${kept.length ? ` Out of ${body.items[0].out_of} is kept as the marks of 1 question.` : ''}`, source: 'the marks you typed', saved: body.items.length, total: { got: 9, max: 15 }, marked_by: 'you', kept_marks: kept, sheet: SHEET(m.marks) })
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
async function openStudy(page: Page, baseURL: string | undefined, w: number, h: number, view: 'papers' | 'practice') {
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
  if (view === 'practice') { await blurText(page); await page.keyboard.press(']') }
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', view)
}
const phone = (page: Page) => page.viewportSize()!.width <= 700
async function openTray(page: Page, name: RegExp) {
  const pill = page.locator('.s3-pill', { hasText: name }).first()
  if (phone(page) && (await pill.isVisible().catch(() => false))) { await pill.click(); await page.waitForTimeout(450) }
}
async function closeSheet(page: Page) {
  const done = page.locator('.s3-done:visible')
  if ((await done.count()) === 0) return
  await done.first().click({ timeout: 4000 }).catch(() => page.keyboard.press('Escape'))
  await page.waitForTimeout(300)
}
const shot = async (page: Page, name: string, w: number) => {
  await page.waitForTimeout(600) // the trays rise in order when a place opens and a sheet slides in on the phone: wait for them to rest
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `${name}-${w}.png`) })
}

/** 44 px keys and fields, 11 px text, nothing wider than its tray, no page scroll sideways, and a tray longer than its box can scroll. */
async function measure(page: Page, at: string, problems: string[]) {
  const r = await page.evaluate(() => {
    const out: string[] = []
    const roots = [...document.querySelectorAll('.s3-tray')].filter((e) => e.getBoundingClientRect().width > 1 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden')
    for (const root of roots) {
      const rr = root.getBoundingClientRect()
      for (const el of root.querySelectorAll('button, input, select, textarea, summary')) {
        const b = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (b.width < 1 || b.height < 1 || cs.visibility === 'hidden' || el.closest('[hidden]')) continue
        if (b.height < 43.5 || b.width < 43.5) out.push(`target ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`)
      }
      for (const el of root.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (b.width <= 1 || el.closest('[hidden]') || el.closest('svg')) continue
        if (el.children.length === 0 && (el.textContent || '').trim()) {
          const fs = parseFloat(getComputedStyle(el).fontSize)
          if (fs < 10.95) out.push(`small ${fs}px "${(el.textContent || '').trim().slice(0, 24)}"`)
        }
        if (b.right > rr.right + 1 || b.left < rr.left - 1) out.push(`wider than its tray: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} by ${Math.round(Math.max(b.right - rr.right, rr.left - b.left))}px`)
      }
      for (const col of root.querySelectorAll<HTMLElement>('.prp-col, .tsh-col, .pp3-col')) {
        if (col.scrollWidth > col.clientWidth + 1) out.push(`${col.dataset.tray ?? col.className.slice(0, 16)} scrolls sideways ${col.scrollWidth - col.clientWidth}px`)
        // a column taller than its box must be one that scrolls, or what is under its fold cannot be reached
        if (col.scrollHeight > col.clientHeight + 2 && !/auto|scroll/.test(getComputedStyle(col).overflowY) && !/auto|scroll/.test(getComputedStyle(col.parentElement!).overflowY)) out.push(`${col.dataset.tray ?? 'col'} is cut off: ${col.scrollHeight - col.clientHeight}px under its fold and it does not scroll`)
      }
    }
    const doc = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
    if (doc > 1) out.push(`document scrolls sideways ${doc}px`)
    return out
  })
  for (const p of r) problems.push(`${at}: ${p}`)
}
const writes = (m: Mock) => m.calls.filter((c) => !c.startsWith('GET '))

async function openPrepare(page: Page) {
  // the face switch heads the first tray on every face of the desk
  await page.getByRole('radio', { name: 'Prepare' }).click()
  await expect(page.locator('[data-component="prep-face"]')).toBeVisible()
}

for (const { w, h } of SIZES) {
  test.describe(`the Prepare face at ${w}x${h} (v3)`, () => {
    test('counts, the model and the policy, a look, a 409, a run with Stop, a stopped run, a finished run with failures, accept and take back', async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      const problems: string[] = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const m = newMock()
      stockPapers(m)
      m.questions = m.questions.map((q) => ({ ...q, status: q.status === 'accepted' ? 'pending' : q.status }))
      await installMock(page, m)
      await openStudy(page, baseURL, w, h, 'papers')
      await expect(page.locator('[data-component="paper-desk"]')).toBeVisible({ timeout: 20_000 })

      // 1. papers on file and none accepted: the desk says so, with one key
      await expect(page.locator('[data-pose="unready"]')).toContainText('Nothing is ready for the study screens yet. Open Prepare.')
      await measure(page, 'unready pose', problems)
      await shot(page, '01-papers-unready-pose', w)
      await page.locator('[data-key="pose-prepare"]').click()
      await expect(page.locator('[data-component="prep-face"]')).toBeVisible()
      expect(writes(m), 'opening the face writes nothing').toEqual([])

      // 2. WHERE IT STANDS: the sentence from the counts, every count beside its state word
      await expect(page.locator('[data-lead]')).toHaveText('58 questions, 0 accepted: nothing can be ranked or put on a sheet yet. 2 papers have no subject, so their questions are in no subject\'s count.')
      await expect(page.locator('[data-said="counts"]')).toContainText('58 questions on 7 papers: 0 accepted')
      await expect(page.locator('[data-count="marks_not_printed"]')).toContainText('9')
      await expect(page.locator('[data-count="marks_not_printed"] .prp-word')).toHaveText('LIVE')
      await measure(page, 'where it stands', problems)
      await shot(page, '02-where-it-stands', w)

      // 3. WHO DECIDES: the Claude sentence before any press, a confirm, then the switch; the policy sentence before its switch
      await openTray(page, /^Who decides/i)
      const deciders = page.locator('[data-tray="deciders"]')
      await expect(deciders.locator('[data-choice="claude"]')).toContainText('leaves this PC and counts against your Claude usage')
      await expect(deciders.locator('[data-count="sends_out"]')).toContainText('no')
      await deciders.getByRole('radio', { name: 'Claude' }).click()
      await expect(deciders.locator('[data-claude-sentence]')).toHaveText(CLAUDE_SENTENCE('sonnet'))
      expect(writes(m), 'choosing Claude only asks again').toEqual([])
      await measure(page, 'claude confirm', problems)
      await shot(page, '03-model-claude-confirm', w)
      await deciders.locator('[data-key="switch-claude"]').click()
      await expect(deciders.locator('[data-count="sends_out"]')).toContainText('yes')
      await expect(deciders.locator('[data-said="model"]')).toContainText(CLAUDE_SENTENCE('sonnet'))
      expect(m.calls.some((c) => c.startsWith('PUT /model {"provider":"claude","claude_model":"sonnet"}'))).toBe(true)
      await expect(deciders.locator('[data-policy-sentence]')).toContainText('Turning it on: Questions safe to trust may be accepted by rule; each says so.')
      await deciders.getByRole('switch', { name: 'Accept safe questions by rule' }).click()
      await expect(deciders.locator('[data-said="policy"]')).toContainText('Questions safe to trust may be accepted by rule; each says so.')
      await measure(page, 'who decides', problems)
      await shot(page, '04-who-decides-claude-and-policy-on', w)
      await closeSheet(page)

      // 4. PREPARE: the four steps ticked, a look with apply false through the single-step routes, each answer printed
      await openTray(page, /^Prepare/i)
      const prep = page.locator('[data-tray="prepare"]')
      for (const name of ["Find each paper's subject", 'Read the papers again', 'Tag topics', 'Accept safe questions']) await prep.getByRole('switch', { name, exact: true }).click()
      await expect(prep.locator('[data-measured]')).toContainText('240 to 510 s')
      await prep.locator('[data-key="look"]').click()
      await expect(prep.locator('.prp-look')).toHaveCount(5)
      await expect(prep.locator('[data-look="subjects"]')).toContainText("Invented loose paper: The subject's course code is on it.")
      await expect(prep.locator('[data-look="reread"]').first()).toContainText('Reading again would change 1 paper of 7; nothing was written.')
      await expect(prep.locator('[data-look="tags"]').nth(1)).toContainText('This subject has no syllabus topics yet.')
      await expect(prep.locator('[data-look="accept"]')).toContainText('Accept has no look of its own')
      expect(m.calls.filter((c) => /^POST \/prep\/(subjects|reread|tags)/.test(c)).every((c) => c.includes('"apply":false')), 'every look sent apply false').toBe(true)
      expect(m.calls.some((c) => c.startsWith('POST /prep/run')), 'a look starts no run').toBe(false)
      await expect(prep.locator('[data-run-words]')).toContainText('Run writes to your question store')
      await measure(page, 'look', problems)
      await shot(page, '05-see-what-it-would-do', w)

      // 5. a 409 is the engine's sentence
      m.run409 = true
      await prep.locator('[data-key="run"]').click()
      await expect(prep.locator('[data-said="run-said"]')).toContainText('The paper desk or OCR is reading; start the run when it has finished.')
      await shot(page, '06-run-409', w)
      m.run409 = false

      // 6. a run: the step in hand, done of total, counts before and now, seconds, Stop; polled only while it runs
      m.outcome = 'stopped'
      await prep.locator('[data-key="run"]').click()
      await expect(prep.locator('.prp-run')).toHaveAttribute('data-run', 'running')
      await expect(prep.locator('[data-progress]')).toContainText(/of 2/)
      await expect(prep.locator('[data-bn="accepted"]')).toBeVisible()
      await expect(prep.locator('[data-key="stop"]')).toBeVisible()
      await expect(prep).toContainText('Stops after the batch in hand')
      await measure(page, 'running', problems)
      await shot(page, '07-run-in-progress', w)
      await prep.locator('[data-key="stop"]').click()
      await expect(prep.locator('[data-said="run"]')).toContainText('Stopping after the batch or paper in hand.')
      await expect(prep.locator('.prp-run')).toHaveAttribute('data-run', 'stopped', { timeout: 20_000 })
      await expect(prep.locator('.prp-runhead')).toHaveText('Stopped')
      await expect(prep.locator('[data-bn="tagged"]')).toContainText('014')
      await measure(page, 'stopped', problems)
      await shot(page, '08-run-stopped', w)
      const polls = m.calls.filter((c) => c.startsWith('GET /prep/run')).length
      await page.waitForTimeout(6000)
      expect(m.calls.filter((c) => c.startsWith('GET /prep/run')).length, 'no polling once the run ended').toBe(polls)

      // 7. a run to the end, with the engine's failure lines; tray 1 reads the counts again
      m.outcome = 'done'
      const countsBefore = m.calls.filter((c) => c.startsWith('GET /prep ')).length
      await prep.locator('[data-key="run"]').click()
      await expect(prep.locator('.prp-run')).toHaveAttribute('data-run', 'done', { timeout: 20_000 })
      await expect(prep.locator('.prp-runhead')).toHaveText('Done')
      await expect(prep.locator('[data-failures]')).toContainText('2')
      await expect(prep.locator('.prp-run')).toContainText('2 batches of the model failed; their questions are as they were.')
      await expect.poll(() => m.calls.filter((c) => c.startsWith('GET /prep ')).length, { message: 'tray 1 reads the counts again' }).toBeGreaterThan(countsBefore)
      await measure(page, 'done', problems)
      await shot(page, '09-run-done-with-failures', w)

      // 8. accept and take back for one subject, each with the engine's answer
      const row = prep.locator('[data-accept="fixture-signals"]')
      await row.scrollIntoViewIfNeeded()
      await row.locator('[data-key="accept"]').click()
      await expect(row.locator('[data-said="accept-fixture-signals"]')).toContainText('Accepted 6 questions by rule; 34 left for your review.')
      await row.locator('[data-key="take-back"]').click()
      await expect(row.locator('[data-said="accept-fixture-signals"]')).toContainText('Returned 6 questions accepted by rule to pending.')
      await measure(page, 'accept and take back', problems)
      await shot(page, '10-accept-and-take-back', w)
      await closeSheet(page)

      expect(errors, 'page errors').toEqual([])
      expect(problems).toEqual([])
    })

    test('the empty desk, a solution sheet, a question bank and a not-a-question item, and marks not printed on the tonight sheet', async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      const problems: string[] = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const m = newMock()
      await installMock(page, m)

      // 1. no paper at all: one line and one key
      await openStudy(page, baseURL, w, h, 'papers')
      await expect(page.locator('[data-pose="none"]')).toContainText('No paper on file. Drop one here, or pull them from Classroom in Library.')
      await measure(page, 'empty desk', problems)
      await shot(page, '11-papers-empty-pose', w)

      // 2. papers with roles: a solution sheet offers no OCR and no review; a question bank says who set its role
      stockPapers(m)
      await page.reload()
      await openStudy(page, baseURL, w, h, 'papers')
      await expect(page.locator('[data-component="paper-desk"]')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('[data-pose]')).toHaveCount(0)
      await openTray(page, /^Papers/i)
      const sol = page.locator('.pp-paper', { hasText: 'solution' }).first()
      await expect(sol).toContainText('solution sheet, set by you')
      await expect(sol).not.toContainText('to review')
      await sol.click()
      await expect(page.locator('[data-solution]')).toBeVisible()
      await expect(page.getByRole('button', { name: /Read with OCR/ })).toHaveCount(0)
      await measure(page, 'solution', problems)
      await shot(page, '12-solution-paper', w)
      await page.locator('.pp-paper', { hasText: 'question bank' }).first().click()
      await expect(page.locator('[data-fact="role"]')).toContainText('question bank, set by the rule')
      await shot(page, '13-question-bank-role', w)
      await closeSheet(page)

      // 3. the review desk: marks not printed, a model's tag named, an item that is not a question has no Accept
      const review = page.getByRole('button', { name: /Review \d+ waiting/ })
      await expect(review).toBeVisible()
      await review.click()
      const desk = page.locator('.rv-desk')
      await expect(desk).toBeVisible()
      let sawNotPrinted = false, sawNotQuestion = false
      for (let i = 0; i < 6 && !(sawNotPrinted && sawNotQuestion); i++) {
        const t = await desk.innerText()
        if (process.env.PREP_DEBUG) console.log('DESK', i, t.replace(/\s+/g, ' ').slice(0, 900))
        // the question bank's accepted question: marks not printed, a model's topic named, and the rule's acceptance never his
        if (!sawNotPrinted && /Topic set by the model claude sonnet/.test(t)) {
          sawNotPrinted = true
          await expect(desk.locator('[data-marks="not-printed"]')).toHaveText('marks not printed')
          await expect(desk.locator('[data-prov]')).toContainText('Topic set by the model claude sonnet, not checked by you; accepted by the rule, not by you')
          await shot(page, '14-review-marks-not-printed', w)
        }
        if (!sawNotQuestion && /Not a question, judged by the rule/.test(t)) {
          sawNotQuestion = true
          await expect(desk.locator('.rv-actions').getByRole('button', { name: /Accept/ })).toHaveAttribute('aria-disabled', 'true')
          await shot(page, '15-review-not-a-question', w)
        }
        // the cursor opens on the first pending item, which may be the last: step back first, then forward
        await page.keyboard.press(i < 3 ? 'k' : 'j')
        await page.waitForTimeout(150)
      }
      expect(sawNotPrinted, 'a question whose marks are not printed was shown').toBe(true)
      expect(sawNotQuestion, 'a not-a-question item was shown').toBe(true)
      expect(await desk.innerText()).not.toMatch(/\bNone\b/)
      await page.keyboard.press('Escape')

      // 4. the tonight sheet: "marks not printed", an "out of" field for that question only; without it the engine's 400 sentence
      await openStudy(page, baseURL, w, h, 'practice')
      await expect(page.locator('.tsh-faces')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('[data-tray="tonight"] [data-marks="not-printed"]')).toHaveText('marks not printed')
      await openTray(page, /^Marks/i)
      const marks = page.locator('[data-tray="marks"]')
      await expect(marks.locator('[data-out-of]')).toHaveCount(1)
      await marks.locator('input[data-q="q-qb1"]').fill('6')
      await marks.locator('[data-key="save-marks"]').click()
      await expect(marks.locator('[data-said="marks"]')).toContainText(NOT_PRINTED_400)
      await marks.locator('[data-out-of="q-qb1"]').fill('10')
      await marks.locator('[data-notprinted="q-qb1"]').getByRole('switch').click()
      await marks.locator('[data-key="save-marks"]').click()
      await expect(marks.locator('[data-said="marks"]')).toContainText('Out of 10 is kept as the marks of 1 question.')
      expect(m.calls.some((c) => c.includes('"out_of":10') && c.includes('"keep":true'))).toBe(true)
      await measure(page, 'tonight out of', problems)
      await shot(page, '16-tonight-marks-not-printed-out-of', w)

      expect(errors, 'page errors').toEqual([])
      expect(problems).toEqual([])
    })
  })
}
