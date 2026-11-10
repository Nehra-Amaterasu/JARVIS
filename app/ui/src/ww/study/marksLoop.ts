/**
 * "Saved. Tomorrow's blocks changed: ..." (plan 4.2, 6). The marks route answers only with the score, and
 * the plan 9 Nov audit never pressed it, so the line is built from two real answers of the exams
 * engine: tomorrow's blocks before the save and after it. Only a difference that the engine itself
 * returned is listed; when the two are the same the line says so instead of staying silent
 * (ww_check marks_loop: marks move the next paper's weights, the block plan reads topic taps, so
 * "no change" is the common honest answer today).
 */
import type { ExamsAnswer } from './api'

export type Change = { label: string; delta: number }

const addDay = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** minutes per "paper title | focus title" on one day; a block with no focus rows counts under its own title. */
export function dayMinutes(x: ExamsAnswer | null, iso: string): Map<string, number> {
  const out = new Map<string, number>()
  const day = x?.days.find((d) => d.date === iso)
  for (const s of day?.slots ?? []) {
    for (const b of s.blocks) {
      if (!b.focus.length) out.set(b.title, (out.get(b.title) ?? 0) + b.minutes)
      for (const f of b.focus) out.set(f.title, (out.get(f.title) ?? 0) + f.minutes)
    }
  }
  return out
}

export function tomorrowOf(x: ExamsAnswer | null): string | null {
  return x?.date ? addDay(x.date, 1) : null
}

export function changes(before: ExamsAnswer | null, after: ExamsAnswer | null): Change[] {
  const iso = tomorrowOf(after) ?? tomorrowOf(before)
  if (!iso) return []
  const a = dayMinutes(before, iso)
  const b = dayMinutes(after, iso)
  const out: Change[] = []
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const d = (b.get(k) ?? 0) - (a.get(k) ?? 0)
    if (d !== 0) out.push({ label: k, delta: d })
  }
  return out.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta))
}

const fmt = (c: Change) => `${c.label} ${c.delta > 0 ? '+' : '-'}${Math.abs(c.delta)} min`

/** At most four changes are named; the rest are counted. */
export function savedLine(list: Change[]): string {
  if (!list.length) return "Saved. No change to tomorrow's plan."
  const head = list.slice(0, 4).map(fmt).join(', ')
  return `Saved. Tomorrow's blocks changed: ${head}${list.length > 4 ? `, and ${list.length - 4} more` : ''}`
}
