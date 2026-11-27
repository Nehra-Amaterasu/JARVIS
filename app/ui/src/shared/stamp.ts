// A date or a stamp as the screen prints it (moved out of study/classroom/DuePanes.tsx on 27 Nov, R32, so Setup's paper sources print a read
// time the same way instead of copying the helper).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "YYYY-MM-DD" (and an optional "HH:MM") as "27 Nov 2026, 18:00"; a stamp that does not parse is shown as the engine wrote it. */
export function formatDay(day: string, time = ''): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  if (!m) return day
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return day
  return `${Number(m[3])} ${month} ${m[1]}${time ? `, ${time}` : ''}`
}
/**
 * A stamp that may carry a time ("2026-11-26T18:00" or "2026-11-26 18:00"): the day, then the time when there is one.
 * A stamp that carries a zone ("...Z" or "+05:30") is what the real engine writes for posted, start, read_at and synced_at, and it is a
 * UTC clock: written as it stands, an announcement of 09:00 UTC read 09:00 on a screen in IST, 5 h 30 min early (seen against the seeded
 * sandbox, 27 Nov). It is converted to the viewer's own clock. A stamp with no zone is already local and is left as written.
 */
export function formatStamp(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`
    }
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s)
  return m ? formatDay(m[1], m[2]) : formatDay(s)
}
