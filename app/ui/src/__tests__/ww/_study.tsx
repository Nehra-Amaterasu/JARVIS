// Fixtures and a fetch router for the Study tests (chunk 7). Every subject, paper and question here is
// fictional; the shapes are the server's (ww_exams.py, ww_generator.py, ww_harvest.py, ww_dmat.py).
import { act } from 'react'
import { vi } from 'vitest'

export const topic = (unit: number, name: string, state: 'none' | 'learned' | 'solid' = 'none', weight: 'high' | 'med' | 'low' = 'high') =>
  ({ key: `${unit}|${name}`, unit, unit_title: `Unit ${unit}`, topic: name, weight, state })

export function paperRow(over: Record<string, unknown> = {}) {
  const topics = (over.topics as ReturnType<typeof topic>[] | undefined) ?? [topic(1, 'Alpha'), topic(1, 'Beta', 'learned'), topic(2, 'Gamma', 'none', 'low')]
  const counts = { none: 0, learned: 0, solid: 0 }
  topics.forEach((t) => { counts[t.state]++ })
  return {
    id: 'cie-c', subject: 'subj-c', title: 'Subject C CIE', code: 'SC1', date: '2026-12-02', start: '10:00', end: null, units: [1, 2], may_miss: false,
    days_left: 22, coverage: 0.25, kind: 'cie', approx: true, duration_min: 45, work_minutes: 0, planned_minutes: 0, logged_minutes: 0,
    target: null, max: 20, paper_score: null, forecast: { half_plan: 0.4, full_plan: 0.6, assumption: '' }, files: [],
    ...over, topics, counts,
  }
}

export const slot = (blocks: { paper: string; title: string; minutes: number; focus: { kind: string; title: string; unit: number | null; minutes: number }[] }[]) =>
  ({ label: 'Evening', minutes: blocks.reduce((a, b) => a + b.minutes, 0), light: false, reserved: false, blocks })

export function examsAnswer(papers: ReturnType<typeof paperRow>[], tomorrow: ReturnType<typeof slot>[] = []) {
  return { status: 'ok', date: '2026-11-10', say: '', risks: [], papers, days: [{ date: '2026-11-10', slots: [] }, { date: '2026-11-11', slots: tomorrow }] }
}

const q = (id: string, n: number, text: string, marks: number, extra: Record<string, unknown> = {}) =>
  ({ id, n, text, marks, unit: 1, topic: 'Alpha', key: '1|Alpha', p: 0.1, source: 'SEE Jun 2026', bank_marks: marks, ...extra })

export function paperResponse(over: Record<string, unknown> = {}) {
  return {
    exam: 'cie-c', subject: 'subj-c', title: 'Subject C CIE', seed: 7, tier: 'exam', tier_requested: 'exam', tier_note: null, total_marks: 20,
    pattern_missing: true, pattern_note: 'No pattern typed: the SEE default shape scaled to 20 marks.', pattern_scaled: true, max: 20, empty: false,
    pattern_source: 'JSS SEE shape scaled to 20 marks', bank_size: 9, shortfall: [], rule: 'Weak topics come up more.', markdown: '',
    harvest: { enabled: false, short: false, queued: 0, note: null },
    sections: [
      { name: 'A', marks: 2, attempt: 2, set: 3, questions: [
        q('subj-c:typed:0', 1, 'State the condition for $y = x^2$ to be convex.', 2),
        q('subj-c:typed:1', 2, 'Find $\\int_0^1 x\\,dx$.', 2, { p: 0.5 }),
        q('subj-c:typed:2', 3, 'Define a limit.', 2),
      ] },
      { name: 'B', marks: 8, attempt: 1, set: 2, questions: [
        q('h:subj-c:ab12', 1, 'Solve: reference book ch 3, problem 4', 8, { type: 'harvested', source: 'Open course notes, CC BY-SA' }),
        q('subj-c:typed:3', 2, 'Prove that $e^{i\\pi}+1=0$.', 8),
      ] },
    ],
    ...over,
  }
}

export const bankListing = (total: number, gate = 0) => ({
  subject: 'subj-c', name: 'Subject C', units: [{ n: 1, title: 'Basics', topics: ['Alpha', 'Beta'] }, { n: 2, title: 'More', topics: ['Gamma'] }],
  sizes: { total, tiers: { exam: total - gate, gate }, by_unit: {}, by_section: {}, typed: total },
})

export const harvestQueue = (over: Record<string, unknown> = {}) => ({
  enabled: false, paused: false, state: 'off', queued: 0, fetching: 0, refused: 0, on_disk: 0, last_request_at: null, items: [], ...over,
})

export interface Call { method: string; url: string; body: unknown }
type Handler = (url: string, body: unknown, call: Call) => unknown | { __status: number; body?: unknown }
export interface Router { calls: Call[]; on: (method: string, pattern: RegExp, h: Handler) => void }

/**
 * Replace fetch. Handlers are matched in the order they were added to the router, the LAST registered match wins, so a
 * test can override a default. An unmatched path answers 404, which is what an absent route does.
 */
export function stubApi(defaults: [string, RegExp, Handler][] = []): Router {
  const table: { method: string; pattern: RegExp; h: Handler }[] = []
  const calls: Call[] = []
  const router: Router = { calls, on: (method, pattern, h) => void table.push({ method, pattern, h }) }
  defaults.forEach(([m, p, h]) => router.on(m, p, h))
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const call = { method, url, body }
    calls.push(call)
    const hit = [...table].reverse().find((t) => t.method === method && t.pattern.test(url))
    if (!hit) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ detail: 'not found' }), text: async () => '' }
    const out = hit.h(url, body, call) as { __status?: number; body?: unknown }
    if (out && typeof out === 'object' && '__status' in out && out.__status) {
      return { ok: false, status: out.__status, statusText: 'err', json: async () => out.body ?? {}, text: async () => '' }
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => out, text: async () => JSON.stringify(out) }
  }))
  return router
}

/** Let promises and effects settle a few times: fetch mocks resolve on microtasks, effects chain loads. */
export async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel)
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)]
export const byText = (text: string | RegExp, sel = 'button', root: ParentNode = document): HTMLElement | null =>
  $$(sel, root).find((e) => (typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent ?? ''))) ?? null
export const click = (el: Element | null) => { if (!el) throw new Error('nothing to click'); return act(() => (el as HTMLElement).click()) }
export const type = (el: HTMLInputElement | HTMLTextAreaElement | null, value: string) => {
  if (!el) throw new Error('nothing to type into')
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
