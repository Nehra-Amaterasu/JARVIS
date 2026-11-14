// The Proof relief's reading (spec 20.16.2; package L04): which statistics stand on the ring, what each bar's height is and
// what its caption says. Pure, so the forbidden-word test and the geometry test run on invented rows.
//
// The rule of the view: evidence that the plan is working, never a score. So there is no total, no grade, no percentage
// of readiness, no prediction and no comparison with other people; a statistic without a count (n) is a dashed segment.
import type { LampState } from '../../shared/lamp'
import type { ProofData } from './proofData'

export interface ProofStat {
  id: string
  label: string
  /** Bar height, 0 to 1 (a share of the stat's own window, never of other people). */
  value: number
  /** How many observations the value stands on; 0 = no count, drawn dashed. */
  n: number
  state: LampState
  /** Mono caption: the count and the window, e.g. "12 of 20 · 14 d". */
  caption: string
}

/** Words this view never prints (spec 20.16.2 banned list, and the product's no-loss-framing rule). */
export const FORBIDDEN = ['score', 'grade', 'readiness', 'ready', 'predict', 'probability', 'chance', 'pass', 'fail', 'behind', 'streak', 'rank', 'percent', '%', 'others', 'average student'] as const

/** The days window of "days logged". */
export const DAYS_WINDOW = 14

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

function planned(id: string, label: string, why: string): ProofStat {
  return { id, label, value: 0, n: 0, state: 'planned', caption: why }
}

/** The five statistics of the ring, in a fixed order, from the reads the Proof panel already makes. */
export function proofStats(d: ProofData, simulated = false): ProofStat[] {
  const live: LampState = simulated ? 'simulated' : 'live'
  const v2 = d.v2.data
  const out: ProofStat[] = []

  const c = v2?.consistency
  if (d.v2.state === 'error') out.push({ id: 'kept', label: 'Counters kept', value: 0, n: 0, state: 'fault', caption: 'could not read' })
  else if (!c) out.push({ id: 'kept', label: 'Counters kept', value: 0, n: 0, state: 'waiting', caption: 'reading' })
  else if (!c.asked) out.push({ id: 'kept', label: 'Counters kept', value: 0, n: 0, state: 'waiting', caption: 'none asked yet' })
  else out.push({ id: 'kept', label: 'Counters kept', value: clamp01(c.hit / c.asked), n: c.asked, state: live, caption: `${c.hit} of ${c.asked} · ${c.window_days} d` })

  const recent = v2?.recent
  if (d.v2.state === 'error') out.push({ id: 'days', label: 'Days logged', value: 0, n: 0, state: 'fault', caption: 'could not read' })
  else if (!recent) out.push({ id: 'days', label: 'Days logged', value: 0, n: 0, state: 'waiting', caption: 'reading' })
  else {
    const logged = daysLogged(recent.map((r) => ({ date: r.date, count: r.count })), d.v2.data?.date ?? null)
    out.push({ id: 'days', label: 'Days logged', value: clamp01(logged / DAYS_WINDOW), n: DAYS_WINDOW, state: live, caption: `${logged} of ${DAYS_WINDOW} · ${DAYS_WINDOW} d` })
  }

  out.push(planned('recall', 'Recall held', 'arrives with recall review'))
  out.push(planned('practice', 'Questions matched', 'arrives with the question store'))
  out.push(planned('papers', 'Papers reviewed', 'arrives with the paper desk'))
  return out
}

/** Days with anything logged within the window ending on `today` (ISO); without a date, the newest rows. */
export function daysLogged(rows: { date: string; count: number }[], today: string | null): number {
  const end = today ? new Date(`${today}T12:00:00`) : null
  const start = end ? new Date(end.getTime() - (DAYS_WINDOW - 1) * 86_400_000) : null
  const inside = (iso: string) => {
    if (!end || !start) return true
    const t = new Date(`${iso}T12:00:00`).getTime()
    return t >= start.getTime() && t <= end.getTime()
  }
  const days = new Set(rows.filter((r) => r.count > 0 && inside(r.date)).map((r) => r.date))
  return Math.min(DAYS_WINDOW, days.size)
}

/** One bar of the ring: its angle span and its outer radius. Bars are spread evenly from 12 o'clock, clockwise. */
export function reliefBars(stats: readonly ProofStat[], inner = 78, depth = 52): { id: string; a0: number; a1: number; r0: number; r1: number; dashed: boolean; mid: number }[] {
  const k = Math.max(1, stats.length)
  const step = (Math.PI * 2) / k
  const pad = Math.min(0.18, step * 0.18)
  return stats.map((s, i) => {
    const a0 = -Math.PI / 2 + i * step + pad
    const a1 = -Math.PI / 2 + (i + 1) * step - pad
    const drawn = s.n > 0 && (s.state === 'live' || s.state === 'simulated')
    const r1 = inner + (drawn ? Math.max(4, s.value * depth) : depth)
    return { id: s.id, a0, a1, r0: inner, r1, dashed: !drawn, mid: (a0 + a1) / 2 }
  })
}

/** An annular sector as an SVG path. */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${p(r0, a0)}L${p(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`
}

export interface Drill {
  /** The student against his own earlier self, one row per series. */
  rows: { label: string; before: number; after: number }[]
  scale: [number, number]
  unit: string
  /** The observations under the statistic. */
  values: number[]
  noun: string
  histUnit: string
}

/** Level 2 of a statistic: what stands under it. Null when nothing measured does. */
export function drillOf(id: string, d: ProofData): Drill | null {
  const v2 = d.v2.data
  if (!v2) return null
  if (id === 'kept') {
    const rows = v2.series
      .map((s) => {
        const w = s.weeks.filter((x) => x.mean !== null)
        return w.length >= 2 ? { label: s.name, before: w[0].mean as number, after: w[w.length - 1].mean as number } : null
      })
      .filter((r): r is { label: string; before: number; after: number } => r !== null)
    const hi = Math.max(1, ...rows.flatMap((r) => [r.before, r.after]))
    return { rows, scale: [0, Math.ceil(hi)], unit: 'a day', values: v2.consistency.counters.map((c) => c.hit), noun: 'counters', histUnit: 'days kept' }
  }
  if (id === 'days') {
    return { rows: [], scale: [0, 1], unit: 'min', values: v2.recent.map((r) => r.minutes), noun: 'days', histUnit: 'min logged' }
  }
  return null
}
