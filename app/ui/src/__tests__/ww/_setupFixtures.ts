// Test support for chunk 12: a routed fake fetch and fictional data (no real subject, name or address).
// A route is "METHOD /path"; a handler returns [status, body]. Unknown routes answer 404 so a page that
// asks for something the test did not expect shows up as a failure, not a hang.
import { act } from 'react'
import { vi } from 'vitest'

export type Handler = (body: unknown, path: string) => [number, unknown]
export interface Fake { calls: { method: string; path: string; body: unknown }[]; routes: Record<string, Handler> }

export function fakeFetch(routes: Record<string, Handler | [number, unknown]>): Fake {
  const fake: Fake = { calls: [], routes: {} }
  for (const [k, v] of Object.entries(routes)) fake.routes[k] = typeof v === 'function' ? v : () => v
  vi.stubGlobal('fetch', async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    const clean = String(path).split('?')[0]
    fake.calls.push({ method, path: clean, body })
    const h = fake.routes[`${method} ${clean}`]
    const [status, json] = h ? h(body, clean) : [404, { detail: 'not found' }]
    return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => json } as unknown as Response
  })
  return fake
}

export const SUBJECT_A = { id: 'subject-a', name: 'Subject A', kind: 'current', exam_date: null, days_left: null, strategy: '', units: [] }

export const INPUTS = {
  raw: {
    exams: [
      { subject: 'subject-a', title: 'Subject A', kind: 'end_sem', date: '2026-12-10', units: [1, 2], approx: true, max: 60, target: 40, difficulty: 'normal' },
      { subject: 'subject-b', title: 'Subject B', kind: 'cie', date: '2026-11-20', units: [], approx: false, max: 20, target: 14, difficulty: 'hard', may_miss: true },
    ],
    deadlines: [{ title: 'Programme form', date: '2027-01-15', kind: 'application' }],
    profile: { traits: ['curious'], weak_points: [], prefers: [], github: null },
    study: { weekday_minutes: 240 },
    subjects: [{ id: 'subject-a', name: 'Subject A', units: [{ n: 1, title: 'Unit one', exam_weight: 'high', topics: ['topic a'] }], question_bank: [{ unit: 1, topic: 'topic a', question: 'State $x^2$.', marks: 5, section: 'A' }] }],
    goals: [{ id: 'g1', horizon: 'quarter', metric: 'hours', target: 100, deadline: '2027-02-01' }],
    timetable: { section: 'S1', room: 'R1', slots: [{ day: 'mon', start: '09:00', end: '10:00', subject: 'subject-a', kind: 'lecture' }] },
    attendance_rule: { threshold: 0.75, scope: 'per_subject', confirmed: false },
  },
  inputs: { source: 'private', warnings: [] },
}

/** Let promises, effects and the fake fetch settle. */
export async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

/** Type into a controlled React input, select or textarea. */
export function type(el: Element, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    set.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

export function click(el: Element): void {
  act(() => void (el as HTMLElement).click())
}

export const byText = (sel: string, text: string | RegExp, root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLElement>(sel)].find((e) => (typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent ?? '')))

/** The input/select/textarea whose <label> reads `label`. */
export function field(label: string, root: ParentNode = document): HTMLInputElement {
  const l = byText('label', label, root) as HTMLLabelElement | undefined
  if (!l) throw new Error(`no label "${label}"`)
  return (l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input,select,textarea')) as HTMLInputElement
}
