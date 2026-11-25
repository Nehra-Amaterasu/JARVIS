// The Classroom plate (Intake face) and the Classroom shelf (third face of study.library), seen in a real browser with the
// thirteen /api/mission/gcr routes MOCKED by invented fixtures: the sandbox engine has the Google link switched off, and nothing
// of the owner's may reach a screenshot or a file. At 1366x768, 1120x720 and 390x844, under the current look and under v3.
//
//   npx vite build --outDir dist-e2e        (rebuild after a change the browser should see)
//   WW_SANDBOX_PORT=8851 WW_PREVIEW_PORT=5251 WW_SANDBOX_DIR="$TEMP/jarvis-ui-cr-e2e" npx playwright test e2e/classroom-shelf.spec.ts
//
// Pictures go to $TEMP/ui-cr-shots (CR_SHOTS overrides). Every size and look asserts, through the probe shared with cp2 and the
// sweep: no page error, no document scroll in either direction, no overlap among the visible panes, no text cut with an ellipsis,
// every key and input 44 by 44 px or more, no text under 11 px, and a visible focus on the keys it tabs through.
import { deflateSync } from 'node:zlib'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page, Route } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'
import { PROBE, type Probe } from './probe'

// the v3 phone layout animates sheets while the page reads the mock, so a poll can be slow: 15 s, not the default 5 s
const expect = baseExpect.configure({ timeout: 15_000 })
const SHOTS = resolve(process.env.CR_SHOTS ?? resolve(tmpdir(), 'ui-cr-shots'))
const SIZES = [{ w: 1366, h: 768 }, { w: 1120, h: 720 }, { w: 390, h: 844 }]
const LOOKS = [{ id: 'current', frag: 'look=off' }, { id: 'v3', frag: 'look=v3' }]

// ------------------------------------------------------------------------------------------------ invented fixtures
const LIVE_REASON = 'Signed in and reading your Classroom.'
const NOTE = [
  '---', 'title: "Week 3 slides"', 'course: Signals Studio', 'pages: 12', '---',
  '# Sampling and aliasing', '',
  'A signal is sampled when its value is read at evenly spaced instants. Read too slowly and two different signals give the same samples, which is the whole trouble of aliasing, and the reason a filter comes before the sampler and never after it.', '',
  '> A sampler cannot tell a fast wave from a slow one that fits the same points.', '',
  '## The rate that is enough', '',
  'Twice the highest frequency in the signal is the least rate that keeps it. The slide works one example through with a tone of 3 kHz and a sampler at 8 kHz, then shows the same tone at 5 kHz folding back to 3 kHz in the samples.', '',
  '### Worked line', '',
  'unbrokenwordthatisverylongindeedtotestwhetheranoverlongwordwrapsinsidethepaneinsteadofpushingthepaneoutsidethewindowanditshouldwrapwithoutascrollbar',
].join('\n')

interface F { id: string; course: string; course_name: string; title: string; ext: string; kind: 'notes' | 'paper' | 'other'; state: string; reason: string; note_state: string; note_reason: string; has_note: boolean; has_original: boolean; paper_id: string | null; stale?: boolean; also_in?: { course: string; post_title: string }[]; topic: string }
const COURSES = [
  { id: 'c1', name: 'Signals Studio', section: 'Section Q', subject: 'signals', subject_source: 'your plan', include: true },
  { id: 'c2', name: 'Applied Maths', section: '', subject: '', subject_source: '', include: true },
  { id: 'c3', name: 'Introduction to the Design and Analysis of Distributed Embedded Control Systems for a Very Long Course Name', section: 'Evening cohort, block B', subject: '', subject_source: '', include: false },
  { id: 'c4', name: 'Lab', section: '', subject: 'lab', subject_source: 'by hand', include: true },
]
const file = (id: string, course: string, title: string, ext: string, over: Partial<F> = {}): F => ({
  id, course, course_name: COURSES.find((c) => c.id === course)!.name, title, ext, kind: 'notes', state: 'live', reason: '', note_state: 'live', note_reason: 'note written from 12 pages',
  has_note: true, has_original: true, paper_id: null, topic: 'Sampling', ...over,
})
const FILES0: F[] = [
  file('f1', 'c1', 'Week 3 slides', 'pdf'),
  file('f2', 'c1', 'Mock paper A', 'pdf', { kind: 'paper', note_reason: 'a paper: no note is written', has_note: false, topic: 'Mock' }),
  file('f3', 'c1', 'Lab handout', 'pptx', { note_reason: 'slides: text only', topic: 'Lab' }),
  file('f4', 'c1', 'Sampling and aliasing: a lecture title that is long enough to wrap onto several lines of the list so we can see how it behaves in a narrow tray', 'pdf'),
  file('f5', 'c1', 'Unit 2 notes', 'pdf', { topic: 'Unit 2' }),
  file('f6', 'c1', 'Whiteboard photo', 'png', { kind: 'other', has_note: false, note_reason: 'a picture: no note is written', topic: 'Board' }),
  file('f7', 'c2', 'Scanned worksheet', 'pdf', { note_state: 'waiting', note_reason: 'The scan has no readable text yet: the reader needs the text tool, which is not installed.', has_note: false }),
  file('f8', 'c2', 'Old syllabus', 'pdf', { stale: true, also_in: [{ course: 'Signals Studio', post_title: 'Syllabus' }], topic: 'Syllabus' }),
  file('f9', 'c2', 'Quiz answers', 'docx', { topic: 'Quiz' }),
  file('f10', 'c2', 'Broken download', 'pdf', { state: 'fault', reason: 'The download stopped at 40 percent.', note_state: 'fault', note_reason: 'No note: the file did not arrive.', has_note: false, has_original: false }),
  file('f11', 'c4', 'Bench rules', 'txt', { kind: 'other', topic: 'Rules' }),
  file('f12', 'c4', 'Past paper 2024', 'pdf', { kind: 'paper', topic: 'Past paper', note_reason: 'a paper: no note is written', has_note: false }),
]

/** One real one-page PDF: the xref offsets are counted, so a viewer accepts it. */
function makePdf(): Buffer {
  const stream = 'BT /F1 24 Tf 40 100 Td (Signals Studio sample page) Tj ET'
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'; const at: number[] = []
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
function crc32(b: Buffer): number {
  let c = ~0
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}
/** A 64x40 PNG with a gradient, built here so no picture file is stored. */
function makePng(): Buffer {
  const w = 64, h = 40
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x * 4; raw[o + 1] = y * 6; raw[o + 2] = 160 } }
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length)
    const body = Buffer.concat([Buffer.from(t, 'latin1'), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PDF = makePdf()
const PNG = makePng()

// ------------------------------------------------------------------------------------------------ the mock engine
type Link = 'planned' | 'waiting' | 'connecting' | 'live' | 'fault'
interface Mock { link: Link; files: F[]; jobPolls: number; job: Record<string, unknown> | null; calls: string[]; accounts: { name: string; state: string; reason: string }[] }
const newMock = (): Mock => ({ link: 'planned', files: FILES0.map((f) => ({ ...f })), jobPolls: 0, job: null, calls: [], accounts: [] })

const COUNTS = { courses: 4, files: 12, notes: 7, papers: 2, faults: 7 }
const FAULT_LINES = ['Week 1 handout: the download stopped at 40 percent.', 'Week 2 handout: the download stopped at 60 percent.', 'Lab sheet: the file is larger than the limit.', 'Quiz: the file type is not one the reader knows.', 'Old notes: the post was deleted.', 'Slides B: the download stopped.', 'Slides C: the download stopped.']

function statusBody(m: Mock) {
  const base = { source: 'your Google Classroom', scopes: [{ name: 's', label: 'Read your courses', granted: true }, { name: 't', label: 'Read the files you may see', granted: true }], connecting: false, synced_at: '', counts: null as unknown, job: m.job, accounts: m.accounts }
  switch (m.link) {
    case 'planned': return { ...base, state: 'planned', reason: 'The Google link is switched off in this instance.', scopes: [], accounts: [] }
    case 'waiting': return { ...base, state: 'waiting', reason: 'Not signed in yet: press Connect to sign in with Google.' }
    case 'connecting': return { ...base, state: 'waiting', reason: 'Waiting for you to approve in the browser.', connecting: true }
    case 'fault': return { ...base, state: 'fault', reason: 'Google refused the sign-in: the approval window was closed too early. Press Connect to try again.' }
    default: return { ...base, state: 'live', reason: LIVE_REASON, synced_at: '2026-11-24 18:05', counts: COUNTS }
  }
}

async function installMock(page: Page, m: Mock) {
  await page.route('**/api/mission/gcr/**', async (route: Route) => {
    const req = route.request()
    const u = new URL(req.url())
    const path = u.pathname.replace('/api/mission/gcr', '')
    const method = req.method()
    const body = req.postData() ?? ''
    m.calls.push(`${method} ${path}${u.search} ${body}`)
    const json = (data: Record<string, unknown>, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ source: 'your Google Classroom', ...data }) })
    if (path === '/status') return json(statusBody(m))
    if (path === '/connect' && method === 'POST') {
      m.link = 'connecting'
      return json(statusBody(m))
    }
    if (path === '/disconnect' && method === 'POST') { m.link = 'waiting'; return json(statusBody(m)) }
    if (path === '/sync' && method === 'POST') {
      m.job = { status: 'running', started: '2026-11-25 09:00', finished: null, text: 'Reading course 1 of 4', counts: null, fault_lines: [] }
      m.jobPolls = 0
      return json({ state: 'live', reason: 'A sync started.', job: m.job })
    }
    if (path === '/sync') {
      m.jobPolls++
      if (m.jobPolls >= 2) m.job = { status: 'stopped', started: '2026-11-25 09:00', finished: '2026-11-25 09:01', text: 'Stopped after 3 of 4 courses: Google asked the app to slow down. Press Sync now to read the rest.', counts: COUNTS, fault_lines: FAULT_LINES }
      return json({ state: 'live', reason: 'ok', job: m.job })
    }
    if (path === '/courses') return json({ state: 'live', reason: 'ok', items: COURSES.map((c) => ({ ...c, state: c.id === 'c3' ? 'waiting' : 'live', files: m.files.filter((f) => f.course === c.id).length, notes: 1, papers: 0, read_at: '2026-11-24', link: '' })) })
    if (path.startsWith('/courses/') && method === 'PATCH') {
      const c = COURSES.find((x) => path.endsWith(x.id))!
      return json({ state: 'live', reason: 'Saved.', course: { ...c, ...JSON.parse(body || '{}'), state: 'live', files: 1, notes: 1, papers: 0, read_at: '2026-11-24', link: '' } })
    }
    if (path === '/files') {
      const course = u.searchParams.get('course'), kind = u.searchParams.get('kind'), q = (u.searchParams.get('q') ?? '').toLowerCase()
      const items = m.files.filter((f) => (!course || f.course === course) && (!kind || f.kind === kind) && (!q || f.title.toLowerCase().includes(q)))
        .map((f) => ({ ...f, subject: 'signals', kind_source: 'engine', pages: 12, words: 900, scanned_pages: 0, size: 2000, modified: '2026-11-20', post: { kind: 'material', title: f.title, topic: f.topic } }))
      return json({ state: 'live', reason: 'ok', items })
    }
    const fid = /^\/files\/([^/]+)/.exec(path)?.[1]
    const f = m.files.find((x) => x.id === fid)
    if (f && path.endsWith('/note')) return json({ state: 'live', reason: 'ok', markdown: NOTE, title: f.title, words: 900, pages: 12, scanned_pages: 0 })
    if (f && path.endsWith('/original')) return route.fulfill({ status: 200, contentType: f.ext === 'png' ? 'image/png' : 'application/pdf', body: f.ext === 'png' ? PNG : PDF })
    if (f && path.endsWith('/open')) return json({ state: 'live', reason: `Opened in the PC program for ${f.ext.toUpperCase()}.` })
    if (f && path.endsWith('/to-papers')) { f.paper_id = 'p-1'; return json({ state: 'live', reason: 'Sent to the paper desk: its questions wait for your review.', paper_id: 'p-1' }) }
    if (f && method === 'PATCH') {
      f.kind = JSON.parse(body).kind
      return json({ state: 'live', reason: `Marked as ${f.kind === 'paper' ? 'a paper' : 'notes'}.`, file: { ...f, subject: 'signals', kind_source: 'you', pages: 12, words: 900, scanned_pages: 0, size: 2000, modified: '2026-11-20', post: { kind: 'material', title: f.title, topic: f.topic } } })
    }
    return json({ state: 'waiting', reason: 'No such route in the mock.' }, 404)
  })
}

// ------------------------------------------------------------------------------------------------ driving the page
const WW = ['day', 'focus', 'study', 'tree', 'career']
const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})
const face = (page: Page, name: 'Intake' | 'Library' | 'Classroom') => page.getByRole('radiogroup', { name: 'Library face' }).getByRole('radio', { name })

async function openLibrary(page: Page, baseURL: string | undefined, frag: string) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto(`/#t=ww-e2e&shell=v2&${frag}`)
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  await blurText(page)
  if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', 'ww')
  await page.keyboard.press(`Control+${WW.indexOf('study') + 1}`)
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', 'study')
  for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
  for (let k = 0; k < 3; k++) { await blurText(page); await page.keyboard.press(']') }
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', 'library')
  await expect(face(page, 'Classroom')).toBeVisible({ timeout: 20_000 })
  if (process.env.CR_TRACE) console.log('library open')
}

/** Leaves the face and comes back, so the plate reads the mock again. */
async function remount(page: Page) {
  const t = (m: string) => { if (process.env.CR_TRACE) console.log('remount', m) }
  t('start')
  await closeSheet(page)
  await face(page, 'Classroom').click()
  t('classroom clicked')
  await face(page, 'Intake').click()
  t('intake clicked')
  // under v3 on the phone the plate sits in the DOORS tray, a sheet that opens from a pill
  if (!(await page.locator('[data-door="classroom"]').isVisible().catch(() => false))) await page.getByRole('button', { name: /Doors/i }).first().click()
  await expect(page.locator('[data-door="classroom"]')).toBeVisible()
}

/** What closeSheet found that a person could not do: the sheet's Done key lay under another layer. */
let sheetProblems: string[] = []

/** Closes the bottom sheet the v3 phone layout opens from a pill, if one is open. It presses the Done key a person would press; if that
 *  cannot be pressed in 4 s that is a finding, and Escape (the shell's other way out) closes the sheet so the walk goes on. */
async function closeSheet(page: Page) {
  const done = page.locator('.s3-done:visible')
  if ((await done.count()) === 0) return
  try { await done.first().click({ timeout: 4000 }) } catch (e) {
    sheetProblems.push(`the sheet's Done key cannot be pressed: ${String(e).split(/\r?\n/).find((l) => /intercepts/.test(l))?.trim() ?? 'not reachable'}`)
    await page.keyboard.press('Escape')
  }
  await page.waitForTimeout(300)
}

async function measure(page: Page, at: string, problems: string[]) {
  const m = (await page.evaluate(PROBE)) as Probe
  for (const k of ['small', 'targets', 'sideways', 'ellipsis'] as const) for (const d of m[k]) problems.push(`${at} ${k}: ${d}`)
  if (m.docOverflow > 1) problems.push(`${at} sideways document overflow ${m.docOverflow}px`)
  const doc = await page.evaluate(() => ({ over: document.documentElement.scrollHeight - document.documentElement.clientHeight, body: document.body.scrollHeight - document.body.clientHeight }))
  if (doc.over > 1 || doc.body > 1) problems.push(`${at} document scrolls vertically ${Math.max(doc.over, doc.body)}px`)
  // no text cut by a box that clips: a pane or card whose content is wider than it is, with overflow hidden or clipped
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.cr-why, .cr-fine, .cr-note, .cr-name, .cr-say, .cr-pose-title, .cr-card-title')].filter((el) => {
    const r = el.getBoundingClientRect(); if (r.width < 1) return false
    for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a); const ar = a.getBoundingClientRect()
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && (r.right > ar.right + 1 || r.left < ar.left - 1)) return true
    }
    return false
  }).map((el) => `${el.className} "${(el.textContent ?? '').slice(0, 30)}"`))
  for (const c of clipped) problems.push(`${at} text cut by a clipping box: ${c}`)
}

/** The visible panes of the shelf must not overlap one another. */
async function noOverlap(page: Page, at: string, problems: string[]) {
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.cr-tray, .s3-tray')].filter((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && el.getAttribute('aria-hidden') !== 'true'
  }).map((el) => { const r = el.getBoundingClientRect(); return { n: el.getAttribute('aria-label') ?? el.querySelector('.s3-job')?.textContent ?? '?', x: r.left, y: r.top, r: r.right, b: r.bottom, sheet: el.getAttribute('data-sheet') } }))
  const inFlow = boxes.filter((b) => !b.sheet)
  for (let i = 0; i < inFlow.length; i++) for (let j = i + 1; j < inFlow.length; j++) {
    const a = inFlow[i], b = inFlow[j]
    const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x), oy = Math.min(a.b, b.b) - Math.max(a.y, b.y)
    if (ox > 1 && oy > 1) problems.push(`${at} panes overlap: ${a.n} and ${b.n} by ${Math.round(ox)}x${Math.round(oy)}px`)
  }
}

/** Tab through the keys inside a root and report any that show no focus ring. */
async function focusRing(page: Page, root: string, at: string, problems: string[], max = 12) {
  const first = page.locator(`${root} button:visible, ${root} input:visible, ${root} select:visible`).first()
  // a script's focus() after a mouse press is not focus-visible by the browser's rule; one keyboard step away and back is
  await first.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const seen = new Set<string>()
  for (let i = 0; i < max; i++) {
    const r = await page.evaluate((sel) => {
      const el = document.activeElement as HTMLElement | null
      if (!el || !el.closest(sel)) return null
      const cs = getComputedStyle(el)
      const label = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}"`
      // a ring is an outline, or a shadow, on the control or on the box that wraps it (the kit draws it on the wrapper for a field)
      const ring = (e: HTMLElement) => { const c = getComputedStyle(e); return (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || (c.boxShadow !== 'none' && /\d/.test(c.boxShadow)) }
      const wrap = el.closest('.ww-field, .ww-seg, label') as HTMLElement | null
      return { label, vis: el.matches(':focus-visible'), ring: ring(el) || (wrap ? ring(wrap) : false), outline: cs.outlineStyle }
    }, root)
    if (!r) break
    if (seen.has(r.label)) { await page.keyboard.press('Tab'); continue }
    seen.add(r.label)
    if (!r.vis || !r.ring) problems.push(`${at} focus not visible on ${r.label} (focus-visible ${r.vis}, ring ${r.ring})`)
    await page.keyboard.press('Tab')
  }
}

const shot = async (page: Page, look: string, size: { w: number }, name: string) => { if (process.env.CR_TRACE) console.log('shot', look, size.w, name); mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: resolve(SHOTS, `${look}-${size.w}-${name}.png`) }) }

/** A course key lies in the first tray; with a sheet open on the phone it is behind the scrim, so the sheet is closed first. */
async function pickCourse(page: Page, id: string) {
  await closeSheet(page)
  await page.locator(`[data-course="${id}"] .cr-pick`).click()
}

/** On the phone under v3 the second and third trays are sheets opened from pills; this opens one by its job name, or does nothing where the tray is already in view. */
async function reveal(page: Page, job: 'Files' | 'Reader') {
  await closeSheet(page)
  const tray = page.locator(job === 'Files' ? '[data-component="classroom-filter"], .cr-tray[aria-label="Files"]' : '[data-component="classroom-reader"], .cr-tray[aria-label="Reader"]').first()
  if (await tray.isVisible().catch(() => false)) return
  // the pill's own class: a course key that says "6 files" would match a name search for Files
  const pill = page.locator('.s3-pill', { hasText: new RegExp(`^${job}`) }).first()
  if (await pill.isVisible().catch(() => false)) await pill.click()
}

// a press that cannot land (a key under another layer) fails in 20 s with the name of the layer, instead of waiting out the test
test.use({ actionTimeout: 20_000 })

for (const look of LOOKS) {
  for (const size of SIZES) {
    test(`${look.id} ${size.w}x${size.h}: the plate through its states and the shelf, measured`, async ({ page, baseURL }) => {
      test.setTimeout(150_000)
      const m = newMock()
      const problems: string[] = []
      sheetProblems = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)))
      await page.setViewportSize({ width: size.w, height: size.h })
      await installMock(page, m)
      await openLibrary(page, baseURL, look.frag)
      const plate = page.locator('[data-door="classroom"]')
      const tag = (s: string) => `${look.id} ${size.w}px ${s}`

      // ---- the plate: planned
      m.link = 'planned'; await remount(page)
      await expect(plate).toContainText('PLANNED'); await expect(plate).toContainText('switched off in this instance')
      expect(await plate.locator('button').count(), 'planned has no key').toBe(0)
      await measure(page, tag('plate planned'), problems); await shot(page, look.id, size, 'plate-1-planned')

      // ---- waiting: the keys fit it (Connect per account, Add account), and pressing one says what to do
      m.link = 'waiting'; m.accounts = [{ name: 'main', state: 'waiting', reason: 'Not signed in yet.' }, { name: 'college', state: 'waiting', reason: 'Not signed in yet.' }]
      await remount(page)
      await expect(plate).toContainText('WAITING'); await expect(plate).toContainText('Not signed in yet: press Connect')
      await expect(plate.getByRole('button', { name: 'Connect main' })).toBeVisible()
      await expect(plate.getByRole('button', { name: 'Add account' })).toBeVisible()
      await measure(page, tag('plate waiting'), problems); await shot(page, look.id, size, 'plate-2-waiting')
      await plate.getByRole('button', { name: 'Add account' }).click()
      await plate.getByLabel('Short name for the account').fill('Bad Name!')
      await expect(plate).toContainText('Use 1 to 20 lower-case letters, digits or - only.')
      await measure(page, tag('plate add-account error'), problems)
      await plate.getByLabel('Short name for the account').fill('')
      await expect(plate).toContainText('Type a short name first.')
      await plate.getByLabel('Short name for the account').fill('lab-2')
      await plate.getByRole('button', { name: 'Connect this account' }).click()
      await expect(plate).toContainText('Approve in the browser window that opened.')
      expect(m.calls.some((c) => c.startsWith('POST /connect') && c.includes('"account":"lab-2"')), 'G-02 carried the account').toBe(true)
      await measure(page, tag('plate connecting'), problems); await shot(page, look.id, size, 'plate-3-connecting')

      // ---- fault
      m.link = 'fault'; await remount(page)
      await expect(plate).toContainText('FAULT'); await expect(plate).toContainText('Google refused the sign-in: the approval window was closed too early. Press Connect to try again.')
      await measure(page, tag('plate fault'), problems); await shot(page, look.id, size, 'plate-4-fault')

      // ---- live: counts, Sync now, a job that ends 'stopped' with its sentence, the faults list
      m.link = 'live'; m.job = null; m.accounts = [{ name: 'main', state: 'live', reason: LIVE_REASON }, { name: 'college', state: 'waiting', reason: 'Not signed in yet.' }]
      await remount(page)
      await expect(plate).toContainText('LIVE'); await expect(plate).toContainText('4 courses, 12 files, 7 notes, 2 papers, 7 faults')
      await expect(plate.getByRole('button', { name: 'Disconnect main' })).toBeVisible()
      await measure(page, tag('plate live'), problems); await shot(page, look.id, size, 'plate-5-live')
      await plate.getByRole('button', { name: 'Sync now' }).click()
      await expect(plate).toContainText('Reading course 1 of 4')
      await expect(plate.locator('[data-component="classroom-job"][data-status="stopped"]')).toContainText('Stopped. Stopped after 3 of 4 courses: Google asked the app to slow down.', { timeout: 12_000 })
      await expect(plate.locator('[data-component="classroom-faults"] li')).toHaveCount(6)
      await expect(plate).toContainText('and 2 more')
      await measure(page, tag('plate live after sync'), problems); await shot(page, look.id, size, 'plate-6-synced')
      await focusRing(page, '[data-door="classroom"]', tag('plate'), problems)

      // ---- the shelf
      await plate.getByRole('button', { name: 'Open the shelf' }).click()
      const shelf = page.locator('[data-component="classroom-shelf"]')
      await expect(shelf).toBeVisible()
      await expect(page.locator('[data-component="classroom-courses"]')).toBeVisible({ timeout: 10_000 })
      await expect(shelf.locator('[data-component="classroom-accounts"]')).toContainText('college')
      await measure(page, tag('shelf'), problems); await noOverlap(page, tag('shelf'), problems); await shot(page, look.id, size, 'shelf-1-courses')

      // pick a course; the long name wraps in full
      await page.locator('[data-course="c3"] .cr-pick').scrollIntoViewIfNeeded()
      await expect(page.locator('[data-course="c3"]')).toContainText('Very Long Course Name')
      await pickCourse(page, 'c1')
      await reveal(page, 'Files')
      await expect(page.locator('[data-component="classroom-files"] li')).toHaveCount(6)
      await expect(page.locator('[data-file="f4"]')).toContainText('how it behaves in a narrow tray')
      await expect(page.locator('[data-file="f7"]')).toHaveCount(0)
      // search and the kind filter go to the engine
      await page.getByLabel('Search files').fill('mock')
      await expect(page.locator('[data-component="classroom-files"] li')).toHaveCount(1)
      await page.getByLabel('Search files').fill('')
      await page.getByRole('radiogroup', { name: 'Kind of file' }).getByRole('radio', { name: 'Papers' }).click()
      await expect(page.locator('[data-component="classroom-files"] li')).toHaveCount(1)
      await page.getByRole('radiogroup', { name: 'Kind of file' }).getByRole('radio', { name: 'All' }).click()
      await expect(page.locator('[data-component="classroom-files"] li')).toHaveCount(6)
      // every course again for the honest states of a file: waiting note reason, stale, also_in, fault
      await pickCourse(page, 'c1')
      await reveal(page, 'Files')
      await measure(page, tag('shelf files'), problems); await noOverlap(page, tag('shelf files'), problems); await shot(page, look.id, size, 'shelf-2-files')
      await focusRing(page, '[data-component="classroom-shelf"]', tag('shelf'), problems, 14)

      // the second course: the waiting note, the stale copy with Also in, the fault with its reason
      await pickCourse(page, 'c2')
      await reveal(page, 'Files')
      await expect(page.locator('[data-file="f7"]')).toContainText('The scan has no readable text yet: the reader needs the text tool, which is not installed.')
      await expect(page.locator('[data-file="f8"]')).toContainText('An older copy: the newer version could not be fetched')
      await expect(page.locator('[data-file="f8"]')).toContainText('Also in: Signals Studio')
      await measure(page, tag('shelf course 2'), problems); await shot(page, look.id, size, 'shelf-3-states')

      // a note in the reader
      await pickCourse(page, 'c1')
      await reveal(page, 'Files')
      await page.locator('[data-file="f1"] .cr-pick').click()
      await reveal(page, 'Reader')
      await expect(page.locator('[data-component="classroom-reader"]')).toBeVisible()
      await page.getByRole('button', { name: 'Read note' }).click()
      await expect(page.locator('[data-component="note-view"]')).toContainText('Sampling and aliasing')
      await expect(page.locator('[data-component="note-view"] blockquote')).toContainText('cannot tell a fast wave')
      await measure(page, tag('reader note'), problems); await noOverlap(page, tag('reader note'), problems); await shot(page, look.id, size, 'reader-1-note')

      // the PDF original
      await page.getByRole('button', { name: 'Open original' }).click()
      await expect(page.locator('iframe.cr-frame')).toBeVisible()
      await expect(page.locator('iframe.cr-frame')).toHaveAttribute('src', /^blob:/)
      await measure(page, tag('reader pdf'), problems); await shot(page, look.id, size, 'reader-2-pdf')
      await page.getByRole('button', { name: 'Close' }).first().click()

      // the image original
      await reveal(page, 'Files')
      await page.locator('[data-file="f6"] .cr-pick').click()
      await reveal(page, 'Reader')
      await page.getByRole('button', { name: 'Open original' }).click()
      const img = page.locator('img.cr-img')
      await expect(img).toBeVisible()
      await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await measure(page, tag('reader image'), problems); await shot(page, look.id, size, 'reader-3-image')

      // mark a file as a paper, then send the PDF to the paper desk; each time the engine's own sentence shows
      await reveal(page, 'Files')
      await page.locator('[data-file="f5"] .cr-pick').click()
      await reveal(page, 'Reader')
      await page.getByRole('button', { name: 'Mark as paper' }).click()
      await expect(page.locator('[data-component="classroom-notice"]')).toContainText('Marked as a paper.')
      await page.getByRole('button', { name: 'Send to paper desk' }).click()
      await expect(page.locator('[data-component="classroom-notice"]')).toContainText('Sent to the paper desk: its questions wait for your review.')
      await measure(page, tag('reader sent'), problems); await shot(page, look.id, size, 'reader-4-sent')
      await page.getByRole('button', { name: 'Open in its own program' }).click()
      await expect(page.locator('[data-component="classroom-notice"]')).toContainText('Opened in the PC program for PDF.')

      expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
      problems.push(...new Set(sheetProblems))
      expect(problems, problems.join('\n')).toEqual([])
    })
  }
}
