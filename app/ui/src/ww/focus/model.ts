/**
 * The Drill's rules as pure functions and one reducer (A.Y02, 20.7.7), so every promise is a test and no screen holds a rule:
 *   - a hint reveal is logged and lowers nothing; the worked answer (rung 3) moves the question to the shelf;
 *   - a miss is "Not yet", never a failure: no red, no streak, no "mistakes" total;
 *   - the set ends with counts only ("11 attempted, 7 matched, 4 on the shelf");
 *   - the terminal strip text changes only on a real event (check, hint, park, skip, step, end, again), never on typing or a tick.
 */
import type { AttemptResult, DrillQuestion } from './ports'

// ---------------------------------------------------------------------------------------------- answers

/**
 * Reads a number the way a person writes it (principle 18, liberal in): "1,5", "−3", "2.2e-3", "3.2 x 10^-3", "1/4", "4.7 V".
 * Units after the number are ignored (the unit chip beside the field names the unit); null when no number leads.
 */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/[−‒–]/g, '-').replace(/\s+/g, ' ')
  if (!s) return null
  s = s.replace(/\s*[x×*]\s*10\s*\^?\s*\(?(-?\+?\d+)\)?/i, 'e$1')
  const frac = s.match(/^([-+]?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/)
  const num = (t: string) => Number(t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t.replace(/,/g, ''))
  if (frac) {
    const d = num(frac[2])
    return d === 0 ? null : num(frac[1]) / d
  }
  const m = s.match(/^[-+]?(?:\d[\d,]*\.?\d*|\.\d+)(?:e[-+]?\d+)?/i)
  if (!m) return null
  const v = num(m[0])
  return Number.isFinite(v) ? v : null
}

/** "matches / does not match the key": a relative tolerance (1 percent unless the question says otherwise), absolute at zero. */
export function checkNumeric(raw: string, key: number, tolerance = 0.01): { matches: boolean; got: number | null } {
  const got = parseNumber(raw)
  if (got === null) return { matches: false, got }
  const slack = Math.max(Math.abs(key) * tolerance, 1e-9)
  return { matches: Math.abs(got - key) <= slack, got }
}

// ---------------------------------------------------------------------------------------------- state

export interface QResult {
  state: AttemptResult
  hints: number
  shown: boolean
  markedBy: 'check' | 'you'
  marks?: { got: number; of: number }
}

export interface Parked { text: string; stored: boolean }

export interface DrillState {
  qs: DrillQuestion[]
  i: number
  res: Record<string, QResult>
  /** Rungs opened per question (0 to hints.length + 1). */
  rungs: Record<string, number>
  hintLog: { id: string; rung: number }[]
  answers: Record<string, string>
  /** recall: the key has been shown and the student has not yet said whether they had it. */
  revealed: Record<string, boolean>
  ticks: Record<string, number[]>
  parked: Parked[]
  ended: boolean
  /** Ended before the last question was resolved: the filled dots stay, nothing is taken away. */
  early: boolean
  paused: boolean
  strip: string
}

export const MAX_RUNGS = (q: DrillQuestion) => q.hints.slice(0, 2).length + 1

export function initialState(qs: DrillQuestion[], title = 'set'): DrillState {
  return {
    qs, i: 0, res: {}, rungs: {}, hintLog: [], answers: {}, revealed: {}, ticks: {}, parked: [], ended: false, early: false, paused: false,
    strip: qs.length ? `> ${title} | ${qs.length} questions | ready` : '> nothing queued',
  }
}

export type Act =
  | { t: 'input'; v: string }
  | { t: 'check' }
  | { t: 'mark'; ok: boolean }
  | { t: 'tick'; idx: number }
  | { t: 'hint' }
  | { t: 'step'; d: number }
  | { t: 'jump'; i: number }
  | { t: 'skip' }
  | { t: 'park'; text: string; stored: boolean }
  | { t: 'pause'; on: boolean }
  | { t: 'end' }
  | { t: 'again' }

export interface Counts { attempted: number; matched: number; shelf: number; skipped: number; hints: number; total: number; resolved: number }

export function counts(s: DrillState): Counts {
  let attempted = 0, matched = 0, skipped = 0, shelf = 0, resolved = 0
  for (const q of s.qs) {
    const r = s.res[q.id]
    if (!r) continue
    resolved++
    if (r.state === 'skipped') { skipped++; shelf++; continue }
    attempted++
    if (r.state === 'matched') matched++
    else shelf++
  }
  return { attempted, matched, shelf, skipped, hints: s.hintLog.length, total: s.qs.length, resolved }
}

/** The line the set ends on: counts only, no percentage, no comparison with a past set. */
export const countsLine = (c: Counts) => `${c.attempted} attempted, ${c.matched} matched, ${c.shelf} on the shelf`

export const current = (s: DrillState): DrillQuestion | undefined => s.qs[s.i]

const strip = (s: DrillState, event: string): string => {
  const c = counts(s)
  return `> q ${Math.min(s.i + 1, Math.max(1, s.qs.length))}/${s.qs.length} ${event} | matched ${c.matched} | hints ${c.hints} | parked ${s.parked.length}`
}

function settle(s: DrillState, q: DrillQuestion, state: AttemptResult, markedBy: 'check' | 'you', marks?: { got: number; of: number }): DrillState {
  const rung = s.rungs[q.id] ?? 0
  const shown = rung >= MAX_RUNGS(q)
  // the worked answer was opened first: attempted, on the shelf, not a match (hints 1 and 2 change nothing)
  const final: AttemptResult = state === 'matched' && shown ? 'missed' : state
  const res: QResult = { state: final, hints: rung, shown, markedBy, ...(marks ? { marks } : {}) }
  const next: DrillState = { ...s, res: { ...s.res, [q.id]: res } }
  return { ...next, strip: strip(next, final === 'matched' ? 'matched' : final === 'skipped' ? 'skipped' : 'on the shelf') }
}

export function reduce(s: DrillState, a: Act): DrillState {
  const q = current(s)
  switch (a.t) {
    case 'input':
      // typing is not an event: the strip stays as it was
      return q ? { ...s, answers: { ...s.answers, [q.id]: a.v } } : s
    case 'check': {
      if (!q || s.res[q.id]) return s
      if (q.kind === 'numeric') {
        const raw = s.answers[q.id] ?? ''
        if (!raw.trim()) return s
        const { matches } = checkNumeric(raw, q.keyNumber ?? Number.NaN, q.tolerance)
        return settle(s, q, matches ? 'matched' : 'missed', 'check')
      }
      if (q.kind === 'recall') {
        if (s.revealed[q.id]) return s
        return { ...s, revealed: { ...s.revealed, [q.id]: true }, strip: strip(s, 'key shown') }
      }
      const of = q.rubric?.length ?? 0
      const got = (s.ticks[q.id] ?? []).length
      return settle(s, q, of > 0 && got === of ? 'matched' : 'missed', 'you', { got, of })
    }
    case 'mark':
      if (!q || s.res[q.id] || !s.revealed[q.id]) return s
      return settle(s, q, a.ok ? 'matched' : 'missed', 'you')
    case 'tick': {
      if (!q || s.res[q.id] || q.kind !== 'written') return s
      const t = s.ticks[q.id] ?? []
      return { ...s, ticks: { ...s.ticks, [q.id]: t.includes(a.idx) ? t.filter((x) => x !== a.idx) : [...t, a.idx].sort((x, y) => x - y) } }
    }
    case 'hint': {
      if (!q) return s
      const now = s.rungs[q.id] ?? 0
      if (now >= MAX_RUNGS(q)) return s
      const rung = now + 1
      const next: DrillState = { ...s, rungs: { ...s.rungs, [q.id]: rung }, hintLog: [...s.hintLog, { id: q.id, rung }] }
      return { ...next, strip: strip(next, rung >= MAX_RUNGS(q) ? 'worked answer opened' : `hint ${rung}`) }
    }
    case 'step': {
      const i = Math.max(0, Math.min(s.qs.length - 1, s.i + a.d))
      return i === s.i ? s : { ...s, i, strip: strip({ ...s, i }, 'stepped') }
    }
    case 'jump': {
      const i = Math.max(0, Math.min(s.qs.length - 1, a.i))
      return i === s.i ? s : { ...s, i, strip: strip({ ...s, i }, 'jumped') }
    }
    case 'skip': {
      if (!q || s.res[q.id]) return s
      const done = settle(s, q, 'skipped', 'you')
      const i = Math.min(s.qs.length - 1, s.i + 1)
      return { ...done, i }
    }
    case 'park': {
      const text = a.text.trim()
      if (!text) return s
      const next = { ...s, parked: [...s.parked, { text, stored: a.stored }] }
      return { ...next, strip: strip(next, 'parked') }
    }
    case 'pause':
      return s.paused === a.on ? s : { ...s, paused: a.on, strip: strip(s, a.on ? 'held' : 'resumed') }
    case 'end': {
      const c = counts(s)
      return { ...s, ended: true, early: c.resolved < c.total, strip: strip(s, 'set ended') }
    }
    case 'again': {
      const shelf = s.qs.filter((x) => { const r = s.res[x.id]; return r && r.state !== 'matched' })
      if (!shelf.length) return s
      return { ...initialState(shelf, 'shelf'), parked: s.parked, strip: `> shelf | ${shelf.length} questions | again` }
    }
    default:
      return s
  }
}

/** The weekday a question comes back on, in words ("Thursday"), from an ISO date; null when the date is not one. */
export function weekdayOf(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { weekday: 'long' })
}
