// A fake engine for the adapter tests (package AD08): a table of "METHOD /path" to a canned answer, a record of every call, and a
// global fetch that honours an abort signal. The answers are the plan file's envelopes (section 9.1.5), invented from end to end.
import { vi } from 'vitest'

export interface Call { method: string; path: string; query: URLSearchParams; body: unknown; headers: Record<string, string>; raw: BodyInit | null | undefined }
export interface Answer { status?: number; json?: unknown; bytes?: Uint8Array; type?: string; throws?: Error }
export type Handler = Answer | ((c: Call) => Answer)

export function fakeEngine(table: Record<string, Handler>) {
  const calls: Call[] = []
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => { headers[k.toLowerCase()] = v })
    let body: unknown = undefined
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body) } catch { body = init.body } }
    const call: Call = { method, path: url.pathname, query: url.searchParams, body, headers, raw: init.body }
    calls.push(call)
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const h = table[`${method} ${url.pathname}`]
    if (!h) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } })
    const a = typeof h === 'function' ? h(call) : h
    if (a.throws) throw a.throws
    if (a.bytes) return new Response(a.bytes as unknown as BodyInit, { status: a.status ?? 200, headers: { 'content-type': a.type ?? 'image/png' } })
    return new Response(JSON.stringify(a.json ?? {}), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock, count: (m: string, p: string) => calls.filter((c) => c.method === m && c.path === p).length, writes: () => calls.filter((c) => c.method !== 'GET') }
}

export const env = (state: string, reason: string, extra: Record<string, unknown> = {}) => ({ state, reason, source: 'your papers on file', ...extra })
export const list = (items: unknown[], state = 'live', reason = 'ok', extra: Record<string, unknown> = {}) => env(state, reason, { items, count: items.length, total: items.length, ...extra })
export const refuse = (status: number, detail: string): Answer => ({ status, json: { detail } })

// invented records (no real paper text, course or institution name)
export const PAPER = { id: 'p-aaaaaaaaaaaa', title: 'Paper A', filename: 'a.pdf', year: 2023, subject: 'signals', pages: 4, total_marks: 60, counts: { questions: 6, pending: 2, accepted: 3, rejected: 1, marks_missing: 0 } }
export const PAPER_B = { id: 'p-bbbbbbbbbbbb', title: 'Paper B', year: null, subject: '', pages: 2, total_marks: null, counts: { questions: 1, pending: 1, accepted: 0, rejected: 0, marks_missing: 1 } }
export const QUESTION = {
  id: 'q-000000000001', paper_id: PAPER.id, label: '4', text: 'Invented question four.', text_status: 'verified', marks: 12, type: 'numerical', status: 'pending',
  unit: 2, topic: 'Sampling', tag_source: 'rule', tag_margin: 0.31, has_crop: true, updated: '2026-11-15T10:00:00', crop: { page: 1, bbox: [10, 20, 110, 70], png: 'crops/x.png' },
}
export const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
