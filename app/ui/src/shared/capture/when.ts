// Calendar arithmetic and the date and time phrases of the Capture Line (spec 20.5, A.D04). Everything here is a pure
// function of (tokens, now): no Date.now(), no locale, no time zone. `now` supplies local year, month, day, hour and
// minute only; days are added through Date.UTC so a daylight-saving jump can never move a date by one.
//
// Two directions, because the words mean different things to a log and to a reminder:
//   'past'   (spent, water, gym)  a log describes what happened: today, yesterday, "3 days ago", "last mon", "5 nov".
//   'future' (remind)             a reminder describes what is coming: tomorrow, "in 2 weeks", "next tue", "eom", "5 nov".
// A phrase that points the wrong way is not guessed into the right way: it comes back as an ask ("? tomorrow is still
// ahead").
//
// Rules a reader should not have to rediscover (each is a row in the parser test table):
//   next <weekday>   the first such weekday strictly AFTER today, never today (Fri 13 Nov: "next tue" is 17 Nov;
//                    Mon 30 Nov: "next tue" is 1 Dec, across the month end).
//   <weekday> alone  the nearest one (ahead for a reminder, behind for a log); on that very weekday it is an ask.
//   in N months      the same day number, clamped to the month's last day (31 Jan + 1 month is 28 Feb, 29 in 2028).
//   <d> <month>      the next such date on or after today (a log: the latest on or before today); 29 Feb finds a leap year.
//   <n>th alone      day of this month, or next month once it has passed; a month without that day is an ask.
//   eom, "end of month"  the last day of this month.
//   next week, next month   an ask: the person has not said which day.

export type Mode = 'past' | 'future'

export interface Ymd { y: number; m: number; d: number } // m is 1 to 12

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
}
export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const
const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Bounds on a relative phrase, so "in 9000 days" is an ask and not a date in the year 2051. */
export const MAX_DAYS = 400
export const MAX_WEEKS = 52
export const MAX_MONTHS = 24
/** How far a leap-day search looks (29 Feb is found within 8 years of any date). */
const LEAP_SEARCH_YEARS = 8

// ------------------------------------------------------------------------------------------------ calendar

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const daysInMonth = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
export const isDay = (y: number, m: number, d: number) => Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)

export const ymdOf = (now: Date): Ymd => ({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })
const pad2 = (n: number) => String(n).padStart(2, '0')
export const isoOf = (v: Ymd) => `${String(v.y).padStart(4, '0')}-${pad2(v.m)}-${pad2(v.d)}`
const utc = (v: Ymd) => Date.UTC(v.y, v.m - 1, v.d)
export const cmpYmd = (a: Ymd, b: Ymd) => utc(a) - utc(b)

export function addDays(v: Ymd, n: number): Ymd {
  const t = new Date(utc(v) + n * 86_400_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
export function weekdayOf(v: Ymd): number {
  return new Date(utc(v)).getUTCDay()
}
/** Same day number n months on, clamped to that month's last day. */
export function addMonths(v: Ymd, n: number): Ymd {
  const idx = v.y * 12 + (v.m - 1) + n
  const y = Math.floor(idx / 12)
  const m = (idx % 12) + 1
  return { y, m, d: Math.min(v.d, daysInMonth(y, m)) }
}
export const endOfMonth = (v: Ymd): Ymd => ({ y: v.y, m: v.m, d: daysInMonth(v.y, v.m) })

/** "Fri 13 Nov", plus the year when it is not this year's. */
export function dateWords(v: Ymd, now: Ymd): string {
  return `${cap(WEEKDAYS[weekdayOf(v)])} ${v.d} ${cap(MONTHS[v.m - 1])}${v.y !== now.y ? ` ${v.y}` : ''}`
}

// ------------------------------------------------------------------------------------------------ date phrases

export type DateHit = { len: number; raw: string; ymd: Ymd } | { len: number; raw: string; ask: string }

const ORDINAL = /^(\d{1,2})(st|nd|rd|th)$/
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const NUM = /^\d{1,3}$/

function weekdayHit(raw: string, wd: number, now: Ymd, mode: Mode, how: 'bare' | 'next' | 'last', len: number): DateHit {
  const today = weekdayOf(now)
  if (how === 'next') {
    if (mode === 'past') return { len, raw, ask: `? ${raw} is still ahead` }
    return { len, raw, ymd: addDays(now, ((wd - today + 6) % 7) + 1) }
  }
  if (how === 'last') {
    if (mode === 'future') return { len, raw, ask: `? ${raw} is behind us` }
    return { len, raw, ymd: addDays(now, -(((today - wd + 6) % 7) + 1)) }
  }
  const delta = mode === 'future' ? (wd - today + 7) % 7 : (today - wd + 7) % 7
  if (delta === 0) return { len, raw, ask: `? this ${raw} or ${mode === 'future' ? 'next' : 'last'} ${raw}` }
  return { len, raw, ymd: addDays(now, mode === 'future' ? delta : -delta) }
}

function explicitDate(raw: string, len: number, d: number, m: number, year: number | null, now: Ymd, mode: Mode): DateHit {
  const label = raw
  if (year !== null) {
    if (!isDay(year, m, d)) return { len, raw, ask: `? ${label} is not a day` }
    const v = { y: year, m, d }
    const c = cmpYmd(v, now)
    if (mode === 'future' && c < 0) return { len, raw, ask: `? ${label} is behind us` }
    if (mode === 'past' && c > 0) return { len, raw, ask: `? ${label} is still ahead` }
    return { len, raw, ymd: v }
  }
  // no year: the nearest such date in the direction of the mode
  if (d < 1 || d > (m === 2 ? 29 : daysInMonth(2001, m))) return { len, raw, ask: `? ${label} is not a day` }
  for (let k = 0; k <= LEAP_SEARCH_YEARS; k++) {
    const y = mode === 'future' ? now.y + k : now.y - k
    if (!isDay(y, m, d)) continue
    const v = { y, m, d }
    const c = cmpYmd(v, now)
    if (mode === 'future' ? c >= 0 : c <= 0) return { len, raw, ymd: v }
  }
  return { len, raw, ask: `? ${label} is not a day` }
}

/**
 * Try to read a date phrase starting at tokens[i] (already lower-case, trailing punctuation removed). Returns null
 * when nothing starts here, an ask when a date was meant but cannot be resolved without a guess, else the date.
 */
export function dateAt(t: readonly string[], i: number, now: Ymd, mode: Mode): DateHit | null {
  const a = t[i]
  const b = t[i + 1]
  const c = t[i + 2]
  if (a === undefined) return null

  if (a === 'today') return { len: 1, raw: a, ymd: now }
  if (a === 'tomorrow' || a === 'tmrw' || a === 'tmr') {
    return mode === 'past' ? { len: 1, raw: a, ask: `? ${a} is still ahead` } : { len: 1, raw: a, ymd: addDays(now, 1) }
  }
  if (a === 'yesterday') {
    return mode === 'future' ? { len: 1, raw: a, ask: `? ${a} is behind us` } : { len: 1, raw: a, ymd: addDays(now, -1) }
  }
  if (a === 'eom') return mode === 'past' ? { len: 1, raw: a, ask: '? end of month is still ahead' } : { len: 1, raw: a, ymd: endOfMonth(now) }
  if (a === 'month' && b === 'end') return mode === 'past' ? { len: 2, raw: 'month end', ask: '? month end is still ahead' } : { len: 2, raw: 'month end', ymd: endOfMonth(now) }
  if (a === 'end' && b === 'of') {
    const k = c === 'the' ? 1 : 0
    if (t[i + 2 + k] === 'month') {
      const raw = k ? 'end of the month' : 'end of month'
      return mode === 'past' ? { len: 3 + k, raw, ask: `? ${raw} is still ahead` } : { len: 3 + k, raw, ymd: endOfMonth(now) }
    }
  }

  // next / last, and "this week" style asks
  if ((a === 'next' || a === 'last' || a === 'this') && b !== undefined) {
    if (b === 'week' || b === 'month') return { len: 2, raw: `${a} ${b}`, ask: `? which day ${a} ${b}` }
    if (a !== 'this' && b in WEEKDAY_NAMES) return weekdayHit(`${a} ${b}`, WEEKDAY_NAMES[b], now, mode, a, 2)
  }

  // N unit ago / in N unit
  if (a === 'in' && b !== undefined && NUM.test(b) && c !== undefined && /^(day|days|week|weeks|month|months)$/.test(c)) {
    const raw = `in ${b} ${c}`
    if (mode === 'past') return { len: 3, raw, ask: `? ${raw} is still ahead` }
    const n = Number(b)
    const unit = c.startsWith('day') ? 'd' : c.startsWith('week') ? 'w' : 'm'
    if (n < 1 || (unit === 'd' && n > MAX_DAYS) || (unit === 'w' && n > MAX_WEEKS) || (unit === 'm' && n > MAX_MONTHS)) return { len: 3, raw, ask: `? is ${raw} right` }
    return { len: 3, raw, ymd: unit === 'd' ? addDays(now, n) : unit === 'w' ? addDays(now, 7 * n) : addMonths(now, n) }
  }
  if (a !== undefined && NUM.test(a) && b !== undefined && /^(day|days|week|weeks|month|months)$/.test(b) && c === 'ago') {
    const raw = `${a} ${b} ago`
    if (mode === 'future') return { len: 3, raw, ask: `? ${raw} is behind us` }
    const n = Number(a)
    const unit = b.startsWith('day') ? 'd' : b.startsWith('week') ? 'w' : 'm'
    if (n < 1 || (unit === 'd' && n > MAX_DAYS) || (unit === 'w' && n > MAX_WEEKS) || (unit === 'm' && n > MAX_MONTHS)) return { len: 3, raw, ask: `? is ${raw} right` }
    return { len: 3, raw, ymd: unit === 'd' ? addDays(now, -n) : unit === 'w' ? addDays(now, -7 * n) : addMonths(now, -n) }
  }

  // an ISO date
  const iso = ISO.exec(a)
  if (iso) return explicitDate(a, 1, Number(iso[3]), Number(iso[2]), Number(iso[1]), now, mode)

  // <d> <month> [year] and <month> <d> [year]
  const dayTok = (s: string | undefined): number | null => {
    if (s === undefined) return null
    const o = ORDINAL.exec(s)
    if (o) return Number(o[1])
    return /^\d{1,2}$/.test(s) ? Number(s) : null
  }
  const yearTok = (s: string | undefined): number | null => (s !== undefined && /^20\d{2}$/.test(s) ? Number(s) : null)
  const dA = dayTok(a)
  if (dA !== null && b !== undefined && b in MONTH_NAMES && dA >= 1 && dA <= 31) {
    const y = yearTok(c)
    return explicitDate(`${a} ${b}${y !== null ? ` ${c}` : ''}`, y !== null ? 3 : 2, dA, MONTH_NAMES[b], y, now, mode)
  }
  if (a in MONTH_NAMES && b !== undefined) {
    const dB = dayTok(b)
    if (dB !== null && dB >= 1 && dB <= 31) {
      const y = yearTok(c)
      return explicitDate(`${a} ${b}${y !== null ? ` ${c}` : ''}`, y !== null ? 3 : 2, dB, MONTH_NAMES[a], y, now, mode)
    }
  }

  // "the 15th" / "15th": a day of the month
  const lead = a === 'the' ? 1 : 0
  const ord = ORDINAL.exec(t[i + lead] ?? '')
  if (ord && !(t[i + lead + 1] !== undefined && t[i + lead + 1] in MONTH_NAMES)) {
    const n = Number(ord[1])
    const raw = lead ? `the ${t[i + 1]}` : (t[i] as string)
    const len = 1 + lead
    if (n < 1 || n > 31) return { len, raw, ask: `? what is ${raw}` }
    if (mode === 'future') {
      const thisMonth = n >= now.d ? now : addMonths({ ...now, d: 1 }, 1)
      if (!isDay(thisMonth.y, thisMonth.m, n)) return { len, raw, ask: `? ${cap(MONTHS[thisMonth.m - 1])} has no ${ord[0]}` }
      return { len, raw, ymd: { y: thisMonth.y, m: thisMonth.m, d: n } }
    }
    const back = n <= now.d ? now : addMonths({ ...now, d: 1 }, -1)
    if (!isDay(back.y, back.m, n)) return { len, raw, ask: `? ${cap(MONTHS[back.m - 1])} has no ${ord[0]}` }
    return { len, raw, ymd: { y: back.y, m: back.m, d: n } }
  }

  // a weekday on its own
  if (a in WEEKDAY_NAMES) return weekdayHit(a, WEEKDAY_NAMES[a], now, mode, 'bare', 1)
  return null
}

// ------------------------------------------------------------------------------------------------ time phrases

export type TimeHit = { len: number; raw: string; hhmm: string } | { len: number; raw: string; ask: string }
const hhmm = (h: number, m: number) => `${pad2(h)}:${pad2(m)}`

/** "7 pm", "7pm", "7:30 pm", "19:00", "noon". A bare 12-hour reading without am or pm is an ask, never a guess. */
export function timeAt(t: readonly string[], i: number): TimeHit | null {
  const a = t[i]
  const b = t[i + 1]
  if (a === undefined) return null
  if (a === 'noon') return { len: 1, raw: a, hhmm: '12:00' }

  const glued = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(a)
  const split = /^(\d{1,2})(?::(\d{2}))?$/.exec(a)
  let h: number
  let min: number
  let mer: string | null = null
  let len = 1
  let raw = a
  if (glued) {
    h = Number(glued[1]); min = glued[2] ? Number(glued[2]) : 0; mer = glued[3]
  } else if (split && (b === 'am' || b === 'pm')) {
    h = Number(split[1]); min = split[2] ? Number(split[2]) : 0; mer = b; len = 2; raw = `${a} ${b}`
  } else if (split && split[2] !== undefined) {
    // 19:00 and 07:05 are 24-hour; "7:05" with no am or pm could be either
    h = Number(split[1]); min = Number(split[2])
    const twentyFour = h >= 13 || h === 0 || a.length === 5
    if (min > 59 || h > 23) return { len, raw, ask: `? what is ${raw}` }
    if (!twentyFour) return { len, raw, ask: `? ${raw} am or ${raw} pm` }
    return { len, raw, hhmm: hhmm(h, min) }
  } else {
    return null
  }
  if (min > 59 || h < 1 || h > 12) return { len, raw, ask: `? what is ${raw}` }
  if (mer === 'am') h = h === 12 ? 0 : h
  else h = h === 12 ? 12 : h + 12
  return { len, raw, hhmm: hhmm(h, min) }
}

/** "at 7": the bare hour after "at". 13 to 23 are 24-hour; 1 to 12 are an ask; anything else is not a time. */
export function bareHourAt(t: readonly string[], i: number): TimeHit | null {
  const a = t[i]
  if (a === undefined || !/^\d{1,2}$/.test(a)) return null
  const n = Number(a)
  if (n >= 13 && n <= 23) return { len: 1, raw: a, hhmm: hhmm(n, 0) }
  if (n >= 1 && n <= 12) return { len: 1, raw: a, ask: `? ${a} am or ${a} pm` }
  return { len: 1, raw: a, ask: `? what is ${a}` }
}
