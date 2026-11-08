/**
 * Life → Classes. The attendance engine (ww_attendance.py): today's lectures from the typed
 * timetable with one tap each (present / absent / cancelled; tap again to clear), and per
 * subject the classes of margin above the threshold. The number is a buffer for a sick
 * day, never "safe to skip": he lost three papers to attendance this semester. The rule is
 * assumed (75 % per subject) until Settings says it is confirmed, and the card says so.
 */
import { AlertTriangle, CalendarCheck, Check, Slash, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, post } from '../../lib/api'
import { useStore } from '../../lib/store'

type Status = 'present' | 'absent' | 'cancelled'
export interface TodayClass { id: string; start: string; end: string | null; subject: string; name: string; kind: string; room: string; status: Status | null }
export interface SubjectRow { subject: string; name: string; held: number; attended: number; weekly: number; pct: number | null; can_miss: number; need: number; last: string | null }
export interface AttendanceAnswer {
  status: string; date: string; say: string; note?: string; risks: string[]
  rule: { threshold: number; scope: 'per_subject' | 'overall'; confirmed: boolean; note?: string }
  today: TodayClass[]; subjects: SubjectRow[]
  overall: { held: number; attended: number; pct: number | null; can_miss: number; need: number } | null
}

const TAPS: { s: Status; label: string; icon: typeof Check }[] = [
  { s: 'present', label: 'Present', icon: Check }, { s: 'absent', label: 'Absent', icon: X }, { s: 'cancelled', label: 'Cancelled', icon: Slash }]
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`)

/** The margin in words: what the number means for this subject, in five words. */
export function marginText(r: SubjectRow, threshold: number): string {
  if (!r.held) return 'no class tapped yet'
  if (r.need) return `${r.need} in a row to reach ${Math.round(threshold * 100)}%`
  if (r.can_miss === 0) return 'at the line'
  return `${r.can_miss} class${r.can_miss === 1 ? '' : 'es'} of margin`
}

export function ClassesCard() {
  const [d, setD] = useState<AttendanceAnswer | null>(null)
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    let live = true
    api<AttendanceAnswer>('/api/mission/attendance').then((r) => { if (live) setD(r) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  const tap = useCallback(async (c: TodayClass, s: Status) => {
    const next = c.status === s ? 'clear' : s
    setD((cur) => cur ? { ...cur, today: cur.today.map((x) => x.id === c.id ? { ...x, status: next === 'clear' ? null : s } : x) } : cur)
    try {
      setD(await post<AttendanceAnswer>(`/api/mission/attendance/${encodeURIComponent(c.id)}/${next}`, {}))
    } catch {
      toast('Could not save that. Is the app running?', 'fault')
      api<AttendanceAnswer>('/api/mission/attendance').then(setD).catch(() => undefined)
    }
  }, [toast])
  if (!d || d.status !== 'ok') return null
  const t = d.rule.threshold
  const low = d.subjects.filter((r) => r.held && r.need).length
  return (
    <section className="card classes" aria-label="Classes">
      <div className="card-head">
        <span className="card-title"><CalendarCheck size={14} />Classes</span>
        <span className="small muted">{d.rule.confirmed ? `${Math.round(t * 100)}% ${d.rule.scope === 'overall' ? 'overall' : 'per subject'}`
          : <><AlertTriangle size={11} aria-hidden /> rule assumed {Math.round(t * 100)}%</>}</span>
      </div>

      {d.today.length ? (
        <ul className="cls-today" aria-label="today's classes">
          {d.today.map((c) => (
            <li key={c.id} className={c.status ? `is-${c.status}` : ''}>
              <span className="cls-when mono">{c.start}</span>
              <span className="cls-name" title={c.room || undefined}>{c.name}{c.kind === 'lab' && <em> lab</em>}</span>
              <span className="cls-taps" role="group" aria-label={`${c.name} at ${c.start}`}>
                {TAPS.map(({ s, label, icon: I }) => (
                  <button key={s} type="button" className={`btn sm ${c.status === s ? 'on' : ''}`} aria-pressed={c.status === s}
                    title={label} aria-label={label} onClick={() => void tap(c, s)}><I size={12} /></button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="small muted">{d.subjects.length ? 'No classes today.' : 'No timetable yet. Type the week into Settings → timetable.'}</p>}

      {d.subjects.length > 0 && (
        <table className="cls-table small" aria-label="attendance per subject">
          <thead><tr><th>Subject</th><th>Held</th><th>%</th><th>Margin</th></tr></thead>
          <tbody>
            {d.subjects.map((r) => (
              <tr key={r.subject} className={r.need ? 'is-low' : r.held && r.can_miss <= 1 ? 'is-tight' : ''}>
                <td>{r.name}</td>
                <td className="mono">{r.attended}/{r.held}</td>
                <td className="mono">{pct(r.pct)}</td>
                <td>{marginText(r, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="cls-note muted">
        {low ? `${low} subject${low > 1 ? 's' : ''} below the line. ` : ''}
        {d.note ?? 'Margin is a buffer for a sick day, not a budget.'}
      </p>
    </section>
  )
}
