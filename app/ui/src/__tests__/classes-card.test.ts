/**
 * The Classes card on Life (Classes.tsx): today's lectures with a present / absent /
 * cancelled tap (tap again clears), the per-subject margin table, and the "rule assumed"
 * flag until Settings confirms the college's rule. Server answers are fictional.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassesCard, marginText, type AttendanceAnswer, type SubjectRow } from '../germoney/pages/Classes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (subject: string, extra: Partial<SubjectRow> = {}): SubjectRow =>
  ({ subject, name: subject.toUpperCase(), held: 0, attended: 0, weekly: 3, pct: null, can_miss: 0, need: 0, last: null, ...extra })

const ANSWER: AttendanceAnswer = {
  status: 'ok', date: '2026-11-09', say: '', risks: ['Rule assumed'], note: 'A buffer, not a budget.',
  rule: { threshold: 0.75, scope: 'per_subject', confirmed: false },
  today: [{ id: 'mon-0845-control', start: '08:45', end: '09:45', subject: 'control', name: 'Control', kind: 'lecture', room: '', status: null },
          { id: 'tue-1345-lab', start: '13:45', end: '15:45', subject: 'lab', name: 'ESDM', kind: 'lab', room: '', status: 'present' }],
  subjects: [row('control', { held: 40, attended: 24, pct: 0.6, need: 24 }), row('micro', { held: 40, attended: 36, pct: 0.9, can_miss: 8 }),
             row('lab', { held: 4, attended: 3, pct: 0.75 })],
  overall: null,
}

let host: HTMLDivElement
let root: Root
const calls: string[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    const body = init?.method === 'POST'
      ? { ...ANSWER, today: ANSWER.today.map((c) => (url.includes(c.id) ? { ...c, status: url.endsWith('/clear') ? null : (url.split('/').pop() as never) } : c)) }
      : ANSWER
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('marginText', () => {
  it('says what the number means', () => {
    expect(marginText(row('a'), 0.75)).toBe('no class tapped yet')
    expect(marginText(row('a', { held: 40, attended: 24, need: 24 }), 0.75)).toBe('24 in a row to reach 75%')
    expect(marginText(row('a', { held: 40, attended: 36, can_miss: 8 }), 0.75)).toBe('8 classes of margin')
    expect(marginText(row('a', { held: 4, attended: 3, can_miss: 1 }), 0.75)).toBe('1 class of margin')
    expect(marginText(row('a', { held: 4, attended: 3 }), 0.75)).toBe('at the line')
  })
})

describe('ClassesCard', () => {
  it('shows today, flags the assumed rule and lists the margin per subject', async () => {
    await act(async () => { root.render(createElement(ClassesCard)) })
    await flush()
    expect(host.textContent).toContain('rule assumed 75%')
    const items = host.querySelectorAll('.cls-today > li')
    expect(items.length).toBe(2)
    expect(items[1].className).toContain('is-present')
    expect(host.querySelectorAll('.cls-table tbody tr').length).toBe(3)
    expect(host.querySelector('.cls-table tr.is-low')?.textContent).toContain('24 in a row')
    expect(host.textContent).toContain('1 subject below the line')
  })

  it('taps a class present, and a second tap on the same status clears it', async () => {
    await act(async () => { root.render(createElement(ClassesCard)) })
    await flush()
    const present = host.querySelector<HTMLButtonElement>('.cls-today > li:first-child button[aria-label="Present"]')!
    await act(async () => { present.click() })
    await flush()
    expect(calls.at(-1)).toBe('POST /api/mission/attendance/mon-0845-control/present')
    expect(host.querySelector('.cls-today > li:first-child')?.className).toContain('is-present')
    const again = host.querySelector<HTMLButtonElement>('.cls-today > li:first-child button[aria-label="Present"]')!
    await act(async () => { again.click() })
    await flush()
    expect(calls.at(-1)).toBe('POST /api/mission/attendance/mon-0845-control/clear')
  })
})
