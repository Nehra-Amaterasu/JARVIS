/** Notation (plan 6): durations "45 min", dates "18 Dec" with the ISO date in a `title`. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}` : (iso ?? '')
}

export const fmtMin = (m: number): string => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

export const fmtDays = (d: number | null | undefined): string => (d == null ? '' : d <= 0 ? 'today' : `${d} d`)
