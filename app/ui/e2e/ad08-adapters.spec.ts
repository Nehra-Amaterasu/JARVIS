// Package AD08 in a real Chromium: the Paper Desk, with its default Study port (the registered exam adapter), against the REAL exam
// routes of the sandbox on a scratch data directory (WW_SANDBOX_DIR), with no mock of the engine. Proves:
//   empty      a desk over an engine with no papers is WAITING, and the words are the engine's own ("No papers on file yet."), not the
//              null adapter's "the paper engine is not connected yet"
//   leaves     after three invented papers and 21 accepted, tagged questions the desk leaves WAITING for LIVE and draws the papers
//   drop       a PDF dropped on the desk is read by the engine; its questions arrive PENDING and nothing is accepted by the adapter
//   decide     the student's own accept is what puts a question in the bank, and the engine's refusal (no marks) comes back as FAULT
//   absent     with the routes not found the desk is WAITING "engine routes not found"
//   abort      the unmount hook stops a poll
// The page is served from the sandbox's own origin at /ad08.html (intercepted, the sandbox never sees that path), so every /api call
// is a real same-origin call with the sandbox token in the fragment, which lib/api.ts reads. Run:
//   WW_SANDBOX_PORT=8827 WW_PREVIEW_PORT=5227 WW_SANDBOX_DIR=$TEMP/jarvis-e2e-ad08-27 npx playwright test e2e/ad08-adapters.spec.ts
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.WW_SANDBOX_PORT ?? 8790)
const ORIGIN = `http://127.0.0.1:${PORT}`
const TOKEN = 'ww-e2e'
const PYQ = '/api/mission/pyq'
const FONTS = "html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}"

const ENTRY_ID = resolve(ROOT, 'e2e', '.ad08-entry.tsx')
const entrySource = (root: string) => `
import '${root}/src/styles/design/clay/index.css'
import '${root}/src/ww/design/base.css'
import '${root}/src/ww/kit/kit.css'
import { createRoot } from 'react-dom/client'
import { PaperDesk } from '${root}/src/ww/study/papers/PaperDesk'
import { STUDY_PORT } from '${root}/src/ww/study/ports'
import { abortPyq } from '${root}/src/ww/study/adapters/pyq.register'
document.documentElement.setAttribute('data-theme', 'clay-light')
document.documentElement.setAttribute('data-legacy-styles', '')
document.body.setAttribute('data-ww-theme', 'paper')
document.body.style.margin = '0'
document.body.style.background = 'var(--surface-ground)'
window.AD08 = { port: STUDY_PORT, abortPyq }
createRoot(document.getElementById('root')).render(<div style={{ position: 'absolute', left: 64, top: 48, width: 1302, height: 720 }} data-stage><PaperDesk classic={false} /></div>)
`

let bundle: Promise<{ js: string; css: string }> | null = null
function buildPage() {
  bundle ??= (async () => {
    const root = ROOT.split(String.fromCharCode(92)).join('/')
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      plugins: [{ name: 'ad08-entry', resolveId: (id: string) => (id === ENTRY_ID ? id : null), load: (id: string) => (id === ENTRY_ID ? entrySource(root) : null) }],
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: ENTRY_ID, formats: ['iife'], name: 'Ad08Page', fileName: 'ad08' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    return { js, css }
  })()
  return bundle
}

// ------------------------------------------------------------------------------------------------ the real engine, over HTTP
async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ORIGIN}${path}`, { method, headers: { 'x-jarvis-token': TOKEN, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`)
  return JSON.parse(text) as T
}
type Items = { items: { id: string; counts?: Record<string, number>; status?: string }[] }

async function clearPapers() {
  for (const p of (await call<Items>('GET', `${PYQ}/papers`)).items) await call('DELETE', `${PYQ}/papers/${p.id}`)
}

/** Three invented papers, seven questions each, every one accepted with a unit and a topic: the floors of R-16 are met. */
async function seedBank() {
  await call('PUT', '/api/mission/inputs/subjects', { value: [{ id: 'signals', name: 'Signals (invented)', code: 'SIG', units: [
    { n: 1, title: 'Sampling', exam_weight: 'high', topics: ['Nyquist rate', 'Aliasing'] }, { n: 2, title: 'Transforms', exam_weight: 'med', topics: ['Laplace pairs'] }] }] })
  const ids: string[] = []
  for (const year of [2021, 2022, 2023]) {
    const r = await call<{ question_ids: string[] }>('POST', `${PYQ}/papers`, {
      title: `Invented paper ${year}`, subject: 'signals', year,
      questions: Array.from({ length: 7 }, (_, i) => ({ text: `Invented question ${i + 1} of ${year}: state the sampling rate for case ${i + 1}.`, marks: 5 + i, type: 'short' })),
    })
    ids.push(...r.question_ids)
  }
  await call('PATCH', `${PYQ}/questions`, { ids, set: { status: 'accepted', unit: 1, topic: 'Nyquist rate' } })
  return ids
}

/** A one-page PDF with a real text layer: numbered questions at the left margin, marks printed in brackets. */
function tinyPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&')
  const stream = `BT /F1 12 Tf 72 740 Td 28 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const at: number[] = []
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// ------------------------------------------------------------------------------------------------ the page
declare global { interface Window { AD08: { port: import('../src/ww/study/ports').StudyPort; abortPyq: () => void } } }

async function openDesk(page: Page) {
  const { js, css } = await buildPage()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AD08</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${ORIGIN}/ad08.html`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${ORIGIN}/ad08.html#t=${TOKEN}`)
  await page.locator('.pp-desk').waitFor()
  // the desk starts with its empty data and swaps in what the port answers; wait for the first real answer
  await page.waitForFunction(() => !!document.querySelector('.pp-desk') && document.querySelector('.pp-desk')!.getAttribute('data-state') !== null)
}

const deskState = (page: Page) => page.locator('.pp-desk').getAttribute('data-state')

test.describe('AD08 the exam adapter against the real routes', () => {
  test.use({ viewport: { width: 1366, height: 768 } })
  test.describe.configure({ mode: 'serial' })

  test('an engine with no papers: the desk is WAITING in the engine\'s own words', async ({ page }) => {
    await clearPapers()
    await openDesk(page)
    await expect(page.locator('.pp-list-empty')).toContainText('No papers on file yet.')
    expect(await deskState(page)).toBe('waiting')
    await expect(page.locator('.pp-desk')).not.toContainText('the paper engine is not connected yet')
    // the port itself: WAITING with a reason and no data, from the real route
    const r = await page.evaluate(() => window.AD08.port.papers())
    expect(r).toMatchObject({ state: 'waiting', reason: 'No papers on file yet.', data: null })
  })

  test('with three papers and 21 accepted, tagged questions the desk leaves WAITING for LIVE and draws the papers', async ({ page }) => {
    await clearPapers()
    await seedBank()
    await openDesk(page)
    await expect.poll(() => deskState(page)).toBe('live')
    await expect(page.locator('.pp-paper')).toHaveCount(3)
    await expect(page.locator('.pp-list')).toContainText('Invented paper 2023')
    await expect(page.locator('.pp-list')).toContainText('7 questions, reviewed')
    // every member the desk reads answers with a real state, and the numbers are the engine's
    const got = await page.evaluate(async () => {
      const p = window.AD08.port
      const [papers, questions, patterns, next] = await Promise.all([p.papers(), p.questions(), p.patterns(), p.practiseNext()])
      return { papers: [papers.state, papers.data?.length], questions: [questions.state, questions.data?.length, questions.data?.every((q) => q.status === 'accepted')], patterns: [patterns.state, patterns.data?.papers, patterns.data?.topics.length], next: [next.state] }
    })
    expect(got.papers).toEqual(['live', 3])
    expect(got.questions).toEqual(['live', 21, true])
    expect(got.patterns[0]).toBe('live')
    expect(got.patterns[1]).toBe(3)
    expect(['live', 'waiting']).toContain(got.next[0])
  })

  test('a dropped PDF is read by the engine, its questions arrive pending, and the adapter accepts nothing', async ({ page }) => {
    await clearPapers()
    await seedBank()
    await openDesk(page)
    const before = await page.evaluate(async () => (await window.AD08.port.questions({ status: 'accepted' })).data?.length)
    const pdf = tinyPdf(['1. Define the sampling rate for an invented signal. [5 marks]', '2. State the aliasing condition for an invented tone. [6 marks]', '3. Name one use of a hold circuit. [4 marks]'])
    await page.locator('.pp-desk input[type=file]').first().setInputFiles({ name: 'invented-drop.pdf', mimeType: 'application/pdf', buffer: pdf })
    await expect(page.locator('.pp-notice')).toBeVisible({ timeout: 30_000 })
    const after = await page.evaluate(async () => {
      const p = window.AD08.port
      return { accepted: (await p.questions({ status: 'accepted' })).data?.length, pending: await p.questions({ status: 'pending' }), papers: (await p.papers()).data?.length }
    })
    expect(after.papers).toBe(4)
    expect(after.accepted, 'a drop never adds to the bank').toBe(before)
    expect(after.pending.state).toBe('live')
    expect(after.pending.data!.length).toBeGreaterThan(0)
    expect(after.pending.data!.every((q) => q.status === 'pending')).toBe(true)
    // the notice carries the engine's real outcome, not the null adapter's
    await expect(page.locator('.pp-notice')).not.toContainText('not connected')
  })

  test('only the student\'s accept enters the bank, and a refusal comes back as FAULT in the engine\'s words', async ({ page }) => {
    await clearPapers()
    await openDesk(page)
    const made = await call<{ question_ids: string[] }>('POST', `${PYQ}/papers`, { title: 'Invented hand paper', subject: 'signals', year: 2024, questions: [{ text: 'Invented question without marks.' }, { text: 'Invented question with marks.', marks: 8 }] })
    const [noMarks, withMarks] = made.question_ids
    const out = await page.evaluate(async ([a, b]) => {
      const p = window.AD08.port
      const refused = await p.decide({ kind: 'accept', qid: a })
      const edited = await p.decide({ kind: 'edit', qid: a, patch: { marks: 6 } })
      const accepted = await p.decide({ kind: 'accept', qid: a })
      const second = await p.decide({ kind: 'accept', qid: b })
      const undone = await p.decide({ kind: 'undo', qid: b })
      const rows = await p.questions()
      return { refused, edited, accepted, second, undone, rows: rows.data?.map((q) => [q.id, q.status, q.marks]) }
    }, [noMarks, withMarks])
    expect(out.refused.state).toBe('fault')
    expect(out.refused.reason).toContain('HTTP 400')
    expect(out.refused.reason).toContain('Give its marks first.')
    expect(out.edited).toMatchObject({ state: 'live', data: { qid: noMarks, status: 'pending' } })
    expect(out.accepted).toMatchObject({ state: 'live', data: { qid: noMarks, status: 'accepted' } })
    expect(out.undone).toMatchObject({ state: 'live', data: { qid: withMarks, status: 'pending' } })
    expect(out.rows).toContainEqual([noMarks, 'accepted', 6])
    expect(out.rows).toContainEqual([withMarks, 'pending', 8])
  })

  test('with the routes not found the desk is WAITING "engine routes not found"', async ({ page }) => {
    await page.route(`${ORIGIN}${PYQ}/**`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not Found"}' }))
    await openDesk(page)
    await expect(page.locator('.pp-desk')).toContainText('engine routes not found')
    expect(await deskState(page)).toBe('waiting')
    const calls = await page.evaluate(async () => [(await window.AD08.port.patterns()).state, (await window.AD08.port.check({ qid: 'q-1', answer: '1' })).reason])
    expect(calls).toEqual(['waiting', 'engine routes not found'])
  })

  test('the unmount hook stops a poll and the adapter answers WAITING "Stopped"', async ({ page }) => {
    await clearPapers()
    await openDesk(page)
    // slow the status route so the poll is still running when the hook fires
    let polls = 0
    await page.route(`${ORIGIN}${PYQ}/ingest/**`, async (route) => {
      polls++
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'live', reason: 'Reading.', source: 'x', job: { id: 'j-slow', status: 'running', done: 0, total: 1, files: [], trace: [] } }) })
    })
    await page.route(`${ORIGIN}${PYQ}/upload**`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'live', reason: 'Reading 1 file.', source: 'x', job: { id: 'j-slow', status: 'running', done: 0, total: 1 } }) }))
    const result = await page.evaluate(async () => {
      const pending = window.AD08.port.ingest({ route: 'drop', files: [new File([new Uint8Array(4)], 'slow.pdf')] })
      await new Promise((r) => setTimeout(r, 900))
      window.AD08.abortPyq()
      return pending
    })
    expect(result.state).toBe('waiting')
    expect(result.reason).toContain('Stopped')
    const seen = polls
    await page.waitForTimeout(1500)
    expect(polls, 'a poll after the hook').toBe(seen)
  })
})
