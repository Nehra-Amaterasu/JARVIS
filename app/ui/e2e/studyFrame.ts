// Chunk 7: the real Frame with the real Study page, the Reader and Add questions in a real Chromium.
// Built in memory by Vite from a virtual entry (nothing near app/ui/dist), served from a fake origin, with the
// server's routes answered from fictional fixtures by page.route. The numbers on screen are the fixtures'.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
export const STUDY_URL = 'http://ww-study.test/'
const src = (p: string) => posix(resolve(ROOT, 'src', p))

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Frame } from '${src('ww/frame/Frame.tsx')}'
import { useFrame } from '${src('ww/frame/frameStore.ts')}'
import { openOverlay } from '${src('ww/frame/overlayRegistry.ts')}'
import { StudyPage } from '${src('ww/study/StudyPage.tsx')}'
import { usePlan } from '${src('germoney/game/plan.ts')}'
const h = React.createElement
const stub = (id) => () => h('div', { 'data-page': id }, h('p', null, 'Stub ' + id))
const pages = Object.fromEntries(['tree', 'life', 'career', 'focus', 'setup'].map((id) => [id, stub(id)]))
pages.study = StudyPage
window.WWStudy = {
  mount(el, o) { createRoot(el).render(h(Frame, { loaded: true, pages, glass: 'blur', ...o })) },
  view(v) { useFrame.getState().select('study', v) },
  openOverlay,
  plan(today) { usePlan.setState({ today }) },
}
`
let bundle: Promise<{ js: string; css: string }> | null = null
function buildStudy() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'dist-e2e')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, '_study-entry.jsx')
    writeFileSync(entry, ENTRY)
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry, formats: ['iife'], name: 'WWStudyBundle', fileName: 'study' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the study build produced no script')
    return { js, css }
  })()
  return bundle
}

// ---- fixtures: fictional subjects, the server's shapes ----
const topic = (unit: number, name: string, state = 'none', weight = 'high') => ({ key: `${unit}|${name}`, unit, unit_title: `Unit ${unit}`, topic: name, weight, state })
const paperRow = (over: Record<string, unknown>) => {
  const topics = [topic(1, 'Alpha'), topic(1, 'Beta', 'learned'), topic(2, 'Gamma', 'none', 'low')]
  return { id: 'cie-c', subject: 'subj-c', title: 'Subject C CIE', code: 'SC1', date: '2026-12-02', start: '10:00', end: null, units: [1, 2], may_miss: false, days_left: 22,
    coverage: 0.25, kind: 'cie', approx: true, duration_min: 45, work_minutes: 0, planned_minutes: 0, logged_minutes: 0, target: null, max: 20, paper_score: null,
    forecast: { half_plan: 0.4, full_plan: 0.6, assumption: '' }, files: [], topics, counts: { none: 2, learned: 1, solid: 0 }, ...over }
}
const q = (id: string, n: number, text: string, marks: number, extra: Record<string, unknown> = {}) => ({ id, n, text, marks, unit: 1, topic: 'Alpha', key: '1|Alpha', p: 0.1, source: 'SEE Jun 2026', bank_marks: marks, ...extra })
const PAPER = {
  exam: 'cie-c', subject: 'subj-c', title: 'Subject C CIE', seed: 7, tier: 'exam', tier_requested: 'exam', tier_note: null, total_marks: 20, pattern_missing: true,
  pattern_note: 'No pattern typed: the SEE default shape scaled to 20 marks.', pattern_scaled: true, max: 20, empty: false, pattern_source: 'scaled', bank_size: 9, shortfall: [], rule: '', markdown: '',
  harvest: { enabled: false, short: false, queued: 0, note: null },
  sections: [
    { name: 'A', marks: 2, attempt: 4, set: 5, questions: Array.from({ length: 5 }, (_, i) => q(`subj-c:typed:${i}`, i + 1, i === 1 ? 'Find $\\int_0^1 x^2\\,dx$.' : `State the rule number ${i + 1} for $y = x^${i + 2}$.`, 2)) },
    { name: 'B', marks: 6, attempt: 2, set: 3, questions: Array.from({ length: 3 }, (_, i) => q(`subj-c:typed:${i + 5}`, i + 1, `Derive result ${i + 1}: $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$.`, 6)) },
  ],
}
const FIXTURE: Record<string, unknown> = {
  '/api/mission/exams': { status: 'ok', date: '2026-11-10', say: '', risks: [], papers: [paperRow({}), paperRow({ id: 'end-d', subject: 'subj-d', title: 'Subject D End', kind: 'end_sem', approx: false, max: 60, days_left: 30, date: '2026-12-10' })], days: [{ date: '2026-11-10', slots: [] }] },
  '/api/mission/harvest/queue': { enabled: false, paused: false, state: 'off', queued: 0, fetching: 0, refused: 0, on_disk: 0, last_request_at: null, items: [{ subject: 'subj-c', topic: 'Alpha', status: 'waiting', tier: 'gate' }] },
  '/api/phone/ww/harvest': { on_disk: 0, queued: 1 },
  '/api/mission/paper/cie-c': PAPER,
  '/api/mission/learn': { status: 'ok', say: '', new: { id: 'k1', title: 'Compound growth', body: 'Growth is $e^{rt}$.', quiz: [] }, due: [], progress: { seen: 2, total: 9 }, source: 'private' },
  '/api/mission/findings': { nodes: [] },
  '/api/mission/dmat/history': { results: [], empty: true },
}
const BANK = { subject: 'subj-c', name: 'Subject C', units: [{ n: 1, title: 'Basics', topics: ['Alpha', 'Beta'] }, { n: 2, title: 'More', topics: ['Gamma'] }], sizes: { total: 9, tiers: { exam: 9, gate: 0 }, by_unit: {}, by_section: {}, typed: 9 } }
export const TODAY = {
  blocks: [{ id: 'b1', kind: 'library', label: 'Library', start: '10:00', minutes: 75 }, { id: 'b2', kind: 'protected', label: 'Social', start: '17:00', minutes: 60 }],
  contracts: [{ key: 'c1', source: 'tree', slot: 'library', title: 'Solve ten questions', minutes: 45, done: false, node_name: 'Node A', hint: '' }],
  alternatives: [{ key: 'alt1', title: 'Another way', minutes: 25, node_name: 'Node C' }], exam: { advice: 'Exam week: library blocks first.', phase: null, subject: null, milestone: null },
}

export interface OpenOpts {
  html?: Record<string, string>
  /** 'empty' serves an empty bank for the chosen subject. */
  bank?: 'full' | 'empty'
  view?: string
}

/** Mount the frame on the Study workspace and wait for the first paper to be preselected. */
export async function openStudy(page: Page, o: OpenOpts = {}): Promise<void> {
  const { js, css } = await buildStudy()
  const attrs = Object.entries({ 'data-motion': 'auto', ...(o.html ?? {}) }).map(([k, v]) => `${k}="${v}"`).join(' ')
  const font = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace}`
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html ${attrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${font}</style><style>${css}</style></head><body style="margin:0"><main class="main" style="position:fixed;inset:0"><div id="root" style="position:absolute;inset:0"></div></main><script>${safe}</script></body></html>`
  await page.route(`${STUDY_URL}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.route(`${STUDY_URL}api/**`, (route) => {
    const u = new URL(route.request().url())
    const method = route.request().method()
    if (method === 'GET' && /^\/api\/mission\/bank\//.test(u.pathname)) {
      const full = o.bank !== 'empty'
      return route.fulfill({ json: full ? BANK : { ...BANK, sizes: { ...BANK.sizes, total: 0, typed: 0, tiers: { exam: 0, gate: 0 } } } })
    }
    if (method === 'POST') return route.fulfill({ json: { saved: 1, score: 1, max: 2, say: 'Marked.', proficiency: {} } })
    const hit = FIXTURE[u.pathname]
    return hit === undefined ? route.fulfill({ status: 404, json: { detail: 'not found' } }) : route.fulfill({ json: hit })
  })
  await page.goto(STUDY_URL)
  await page.evaluate(() => (window as unknown as { WWStudy: { mount(el: HTMLElement, o: object): void } }).WWStudy.mount(document.getElementById('root')!, {}))
  await page.waitForSelector('.ww-frame [role="tab"]')
  await page.evaluate(([v]) => {
    const w = (window as unknown as { WWStudy: { view(v: string | null): void; plan(t: unknown): void } }).WWStudy
    w.view(v)
  }, [o.view ?? null] as const)
  await page.evaluate((t) => (window as unknown as { WWStudy: { plan(t: unknown): void } }).WWStudy.plan(t), TODAY)
  await page.waitForSelector('[data-ws-page="study"]')
}
