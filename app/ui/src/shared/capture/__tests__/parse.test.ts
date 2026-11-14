// The Capture Line tokenizer (A.D04). Table-driven, with a fixed "now": Friday 13 Nov 2026, 10:30 local time. The
// accept lines are 30 phrases that parse as written, 10 ambiguous ones that wait, month ends, and "next tue".
import { describe, expect, it } from 'vitest'
import { DEFAULT_JARVIS_VERBS, MAX_TEXT, UNKNOWN_VERB, WW_VERBS, jarvisVerbs, parseCapture, parseJarvis, parseWw, readAloud, rewrite, type ParseResult } from '../parse'
import { addDays, addMonths, daysInMonth, endOfMonth, isLeap, weekdayOf } from '../when'

const NOW = new Date(2026, 10, 13, 10, 30) // Fri 13 Nov 2026, 10:30
const at = (y: number, m: number, d: number, h = 10, min = 30) => new Date(y, m - 1, d, h, min)

type Row = [string, Record<string, unknown>]

const OK: Row[] = [
  ['spent 120 chai', { verb: 'spent', amount: 120, label: 'chai', date: '2026-11-13' }],
  ['spent chai 120', { verb: 'spent', amount: 120, label: 'chai' }],
  ['spent 120 on chai', { verb: 'spent', amount: 120, label: 'chai' }],
  ['spent ₹45.50 auto', { verb: 'spent', amount: 45.5, label: 'auto' }],
  ['Spent 1,200 books yesterday', { verb: 'spent', amount: 1200, label: 'books', date: '2026-11-12' }],
  ['spent rs 80 lunch', { verb: 'spent', amount: 80, label: 'lunch' }],
  ['spent 15 bus 2 days ago', { verb: 'spent', amount: 15, label: 'bus', date: '2026-11-11' }],
  ['paid 300 rent 1 nov', { verb: 'spent', amount: 300, label: 'rent', date: '2026-11-01' }],
  ['spent 60 snacks last mon', { verb: 'spent', amount: 60, label: 'snacks', date: '2026-11-09' }],
  ['spent 20 tea today', { verb: 'spent', amount: 20, label: 'tea', date: '2026-11-13' }],
  ['water 250', { verb: 'water', ml: 250, date: '2026-11-13' }],
  ['water 250 ml', { verb: 'water', ml: 250 }],
  ['water 1.5 l', { verb: 'water', ml: 1500 }],
  ['water 1l', { verb: 'water', ml: 1000 }],
  ['drank 500 yesterday', { verb: 'water', ml: 500, date: '2026-11-12' }],
  ['water 750ml', { verb: 'water', ml: 750 }],
  ['gym legs 45', { verb: 'gym', label: 'legs', minutes: 45, date: '2026-11-13' }],
  ['gym 45 legs', { verb: 'gym', label: 'legs', minutes: 45 }],
  ['gym chest and back 1 h', { verb: 'gym', label: 'chest and back', minutes: 60 }],
  ['workout yoga 30 min yesterday', { verb: 'gym', label: 'yoga', minutes: 30, date: '2026-11-12' }],
  ['gym legs 1.5 hrs', { verb: 'gym', label: 'legs', minutes: 90 }],
  ['gym run 20m', { verb: 'gym', label: 'run', minutes: 20 }],
  ['remind me next tue 7 pm physics', { verb: 'remind', label: 'physics', date: '2026-11-17', time: '19:00', at: '2026-11-17T19:00' }],
  ['remind me tomorrow 8 am call home', { verb: 'remind', label: 'call home', date: '2026-11-14', time: '08:00' }],
  ['remind me to submit lab record on 20 nov', { verb: 'remind', label: 'submit lab record', date: '2026-11-20', time: null, at: '2026-11-20' }],
  ['remind me eom pay rent', { verb: 'remind', label: 'pay rent', date: '2026-11-30' }],
  ['remind me in 2 weeks 6:30 pm viva', { verb: 'remind', label: 'viva', date: '2026-11-27', time: '18:30' }],
  ['reminder sat 9am yoga', { verb: 'remind', label: 'yoga', date: '2026-11-14', time: '09:00' }],
  ['remind me 2026-12-01 noon exam form', { verb: 'remind', label: 'exam form', date: '2026-12-01', time: '12:00' }],
  ['remind me at 19:30 tomorrow gym bag', { verb: 'remind', label: 'gym bag', date: '2026-11-14', time: '19:30' }],
  ['remind me 31 dec 9 am renew pass', { verb: 'remind', label: 'renew pass', date: '2026-12-31', time: '09:00' }],
  ['remind me today 11 am team call', { verb: 'remind', label: 'team call', date: '2026-11-13', time: '11:00' }],
]

const ASK: [string, string][] = [
  ['120', '? what is 120'],
  ['chai', '? what is chai'],
  ['spent chai', '? how much for chai'],
  ['spent 120', '? 120 on what'],
  ['spent 120 chai 2 cups', '? which is the amount: 120 or 2'],
  ['water 2', '? 2 ml or 2 l'],
  ['water', '? how many ml'],
  ['gym legs', '? how many minutes of legs'],
  ['gym 45', '? which workout, 45 min'],
  ['remind me physics', '? which day for physics'],
  ['remind me next tue', '? remind you of what'],
  ['remind me at 7 physics tomorrow', '? 7 am or 7 pm'],
  ['remind me 7 pm physics', '? which day at 19:00'],
  ['remind me today 9 am physics', '? 09:00 has passed today'],
  ['remind me fri physics', '? this fri or next fri'],
  ['remind me next week physics', '? which day next week'],
  ['spent 120 chai tomorrow', '? tomorrow is still ahead'],
  ['remind me yesterday physics', '? yesterday is behind us'],
  ['remind me 31 feb physics', '? 31 feb is not a day'],
  ['remind me 13 pm physics', '? what is 13 pm'],
  ['spent 12abc chai', '? what is 12abc'],
  ['water 25000', '? is 25,000 ml right'],
]

const ok = (r: ParseResult) => {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`)
  return r.parsed
}

describe('thirty phrases parse as written', () => {
  it('has at least thirty rows', () => expect(OK.length).toBeGreaterThanOrEqual(30))
  for (const [text, want] of OK) {
    it(text, () => {
      const r = parseWw(text, NOW)
      expect(r.status).toBe('ok')
      expect(ok(r)).toMatchObject({ grammar: 'ww', ...want })
    })
  }
})

describe('ambiguous input waits and asks', () => {
  it('has at least ten rows', () => expect(ASK.length).toBeGreaterThanOrEqual(10))
  for (const [text, question] of ASK) {
    it(`${text}  ->  ${question}`, () => {
      const r = parseWw(text, NOW)
      expect(r.status).toBe('ask')
      if (r.status === 'ask') expect(r.question).toBe(question)
    })
  }
  it('every question starts with "? " and an ask never carries a Parsed to commit', () => {
    for (const [text] of ASK) {
      const r = parseWw(text, NOW)
      expect(r).not.toHaveProperty('parsed')
      if (r.status === 'ask') expect(r.question.startsWith('? ')).toBe(true)
    }
  })
  it('an ask keeps what it did understand, so the chips can show it and mark the rest as missing', () => {
    const r = parseWw('spent 120', NOW)
    if (r.status !== 'ask') throw new Error('ask expected')
    expect(r.fields.map((f) => [f.key, f.state])).toEqual([['verb', 'fixed'], ['amount', 'typed'], ['label', 'missing'], ['date', 'default']])
  })
})

describe('typing a verb', () => {
  it('the start of a verb is partial, not a question', () => {
    expect(parseWw('sp', NOW)).toEqual({ status: 'partial', candidates: ['spent'] })
    expect(parseWw('wa', NOW)).toEqual({ status: 'partial', candidates: ['water'] })
    expect(parseWw('w', NOW)).toEqual({ status: 'partial', candidates: ['water', 'gym'] }) // "workout" is a gym alias
    expect(parseWw('re', NOW)).toEqual({ status: 'partial', candidates: ['remind'] })
    expect(parseWw('g', NOW)).toEqual({ status: 'partial', candidates: ['gym'] })
  })
  it('empty and blank are empty', () => {
    expect(parseWw('', NOW)).toEqual({ status: 'empty' })
    expect(parseWw('   ', NOW)).toEqual({ status: 'empty' })
  })
  it('the verb is case-blind, and extra spaces do not matter', () => {
    expect(ok(parseWw('  SPENT   120    Chai ', NOW))).toMatchObject({ verb: 'spent', amount: 120, label: 'Chai' })
  })
})

describe('"next tue" and the weekdays', () => {
  const next = (nowAt: Date, phrase: string) => ok(parseWw(`remind me ${phrase} x`, nowAt)) as { date: string }
  it('from Friday 13 Nov, next tue is 17 Nov and a bare tue is the same day', () => {
    expect(next(NOW, 'next tue').date).toBe('2026-11-17')
    expect(next(NOW, 'tue').date).toBe('2026-11-17')
    expect(next(NOW, 'next fri').date).toBe('2026-11-20') // never today
    expect(next(NOW, 'sat').date).toBe('2026-11-14')
  })
  it('on a Tuesday, next tue is a week on and a bare tue is an ask', () => {
    const tue = at(2026, 11, 17)
    expect(next(tue, 'next tue').date).toBe('2026-11-24')
    const r = parseWw('remind me tue x', tue)
    expect(r.status === 'ask' && r.question).toBe('? this tue or next tue')
  })
  it('on a Sunday, next mon is tomorrow', () => expect(next(at(2026, 11, 15), 'next mon').date).toBe('2026-11-16'))
  it('every weekday word resolves to the right weekday', () => {
    for (const [w, n] of [['mon', 1], ['tuesday', 2], ['wed', 3], ['thurs', 4], ['fri', 5], ['saturday', 6], ['sun', 0]] as const) {
      const d = (ok(parseWw(`remind me next ${w} x`, at(2026, 11, 18))) as { date: string }).date // a Wednesday
      const [y, m, dd] = d.split('-').map(Number)
      expect(weekdayOf({ y, m, d: dd })).toBe(n)
    }
  })
  it('in the logs a weekday looks back: last mon from Friday is 9 Nov', () => {
    expect(ok(parseWw('spent 5 tea last mon', NOW))).toMatchObject({ date: '2026-11-09' })
    expect(ok(parseWw('spent 5 tea mon', NOW))).toMatchObject({ date: '2026-11-09' })
  })
})

describe('month ends, year ends and leap days', () => {
  const date = (nowAt: Date, line: string) => {
    const r = parseWw(line, nowAt)
    return r.status === 'ok' ? (r.parsed as { date: string }).date : r.status === 'ask' ? r.question : r.status
  }
  it('across 30 Nov: next tue is 1 Dec, eom is 30 Nov, "the 31st" is an ask, the 1st is 1 Dec', () => {
    const n = at(2026, 11, 30)
    expect(date(n, 'remind me next tue x')).toBe('2026-12-01')
    expect(date(n, 'remind me eom x')).toBe('2026-11-30')
    expect(date(n, 'remind me end of month x')).toBe('2026-11-30')
    expect(date(n, 'remind me month end x')).toBe('2026-11-30')
    expect(date(n, 'remind me 31st x')).toBe('? Nov has no 31st')
    expect(date(n, 'remind me the 1st x')).toBe('2026-12-01')
    expect(date(n, 'remind me in 1 day x')).toBe('2026-12-01')
  })
  it('in 1 month clamps to the last day: 31 Jan becomes 28 Feb, and 29 Feb in a leap year', () => {
    expect(date(at(2026, 1, 31), 'remind me in 1 month x')).toBe('2026-02-28')
    expect(date(at(2028, 1, 31), 'remind me in 1 month x')).toBe('2028-02-29')
    expect(date(at(2026, 12, 31), 'remind me in 1 month x')).toBe('2027-01-31')
    expect(date(at(2026, 11, 30), 'remind me in 3 months x')).toBe('2027-02-28')
  })
  it('across the new year: tomorrow, next tue and 29 feb', () => {
    const n = at(2026, 12, 31) // Thursday
    expect(date(n, 'remind me tomorrow x')).toBe('2027-01-01')
    expect(date(n, 'remind me next tue x')).toBe('2027-01-05')
    expect(date(n, 'remind me 29 feb x')).toBe('2028-02-29')
    expect(date(n, 'remind me 28 feb x')).toBe('2027-02-28')
  })
  it('a leap day: the day after 28 Feb 2028 is 29 Feb, in 2027 it is 1 Mar', () => {
    expect(date(at(2028, 2, 28), 'remind me tomorrow x')).toBe('2028-02-29')
    expect(date(at(2027, 2, 28), 'remind me tomorrow x')).toBe('2027-03-01')
  })
  it('logs look back over the month end: yesterday from 1 Mar, one month ago from 31 Mar 2024', () => {
    expect(date(at(2026, 3, 1), 'spent 5 tea yesterday')).toBe('2026-02-28')
    expect(date(at(2024, 3, 31), 'spent 5 tea 1 month ago')).toBe('2024-02-29')
    expect(date(at(2026, 12, 5), 'spent 5 tea 31st')).toBe('? Nov has no 31st')
    expect(date(at(2026, 12, 5), 'spent 5 tea 30th')).toBe('2026-11-30')
  })
  it('an explicit date takes the nearest year in the direction of the verb', () => {
    expect(date(NOW, 'remind me 5 nov x')).toBe('2027-11-05') // already past this year
    expect(date(NOW, 'remind me 13 nov x')).toBe('2026-11-13') // today
    expect(date(NOW, 'spent 5 tea 25 dec')).toBe('2025-12-25') // a log looks back
    expect(date(NOW, 'remind me nov 20 x')).toBe('2026-11-20')
    expect(date(NOW, 'remind me 5 nov 2026 x')).toBe('? 5 nov 2026 is behind us')
  })
  it('the date helpers agree with the calendar', () => {
    expect(isLeap(2000)).toBe(true)
    expect(isLeap(1900)).toBe(false)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(endOfMonth({ y: 2026, m: 4, d: 3 })).toEqual({ y: 2026, m: 4, d: 30 })
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 })
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 13)).toEqual({ y: 2027, m: 2, d: 28 })
    expect(addMonths({ y: 2026, m: 3, d: 31 }, -1)).toEqual({ y: 2026, m: 2, d: 28 })
  })
  it('a daylight-saving change never moves a date (days are added in UTC)', () => {
    for (let d = 0; d < 400; d += 17) {
      const base = addDays({ y: 2026, m: 1, d: 1 }, d)
      expect(addDays(addDays(base, 1), -1)).toEqual(base)
    }
  })
})

describe('times', () => {
  const time = (t: string) => {
    const r = parseWw(`remind me tomorrow ${t} x`, NOW)
    return r.status === 'ok' ? (r.parsed as { time: string | null }).time : r.status === 'ask' ? r.question : r.status
  }
  it('12-hour and 24-hour forms', () => {
    expect(time('7 pm')).toBe('19:00')
    expect(time('7pm')).toBe('19:00')
    expect(time('7:30 pm')).toBe('19:30')
    expect(time('12 am')).toBe('00:00')
    expect(time('12 pm')).toBe('12:00')
    expect(time('12:15 am')).toBe('00:15')
    expect(time('19:00')).toBe('19:00')
    expect(time('07:05')).toBe('07:05')
    expect(time('noon')).toBe('12:00')
  })
  it('a bare 12-hour reading is an ask, never a guess', () => {
    expect(time('7:05')).toBe('? 7:05 am or 7:05 pm')
    expect(time('at 7')).toBe('? 7 am or 7 pm')
    expect(time('7:75 pm')).toBe('? what is 7:75 pm')
    expect(time('0 pm')).toBe('? what is 0 pm')
  })
  it('a time before now today is an ask; the same time tomorrow is fine; the exact minute counts as passed', () => {
    expect(parseWw('remind me today 10:30 x', NOW).status).toBe('ask')
    expect(parseWw('remind me today 10:31 x', NOW).status).toBe('ok')
  })
})

describe('the fields and the line they rebuild', () => {
  it('each field carries a caption, what the person typed and what the chip shows', () => {
    const p = ok(parseWw('remind me next tue 7 pm physics', NOW))
    expect(p.fields.map((f) => [f.key, f.raw, f.display])).toEqual([
      ['verb', 'remind', 'remind'], ['label', 'physics', 'physics'], ['date', 'next tue', 'Tue 17 Nov'], ['time', '7 pm', '19:00'],
    ])
    expect(p.text).toBe('remind me next tue 7 pm physics')
  })
  it('a documented default is marked as one, and a date in another year says the year', () => {
    const p = ok(parseWw('spent 120 chai', NOW))
    expect(p.fields.find((f) => f.key === 'date')).toMatchObject({ state: 'default', display: 'Fri 13 Nov', raw: '' })
    expect(ok(parseWw('remind me 5 nov x', NOW)).fields.find((f) => f.key === 'date')?.display).toBe('Fri 5 Nov 2027')
  })
  it('amounts are grouped by thousands in the chip and typed as written', () => {
    const p = ok(parseWw('spent 1,200 books', NOW))
    expect(p.fields.find((f) => f.key === 'amount')).toMatchObject({ raw: '1,200', display: '1,200' })
  })
  it('rewrite replaces one field and keeps the rest, and the result parses back to the edited value', () => {
    const p = ok(parseWw('spent 120 chai', NOW))
    const line = rewrite('spent', p.fields, 'amount', '150')
    expect(line).toBe('spent 150 chai')
    expect(ok(parseWw(line, NOW))).toMatchObject({ amount: 150, label: 'chai' })
    expect(ok(parseWw(rewrite('spent', p.fields, 'date', 'yesterday'), NOW))).toMatchObject({ date: '2026-11-12', amount: 120 })
    const r = ok(parseWw('remind me next tue 7 pm physics', NOW))
    expect(rewrite('remind', r.fields, 'time', '8 pm')).toBe('remind me next tue 8 pm physics')
    expect(rewrite('remind', r.fields, 'date', '')).toBe('remind me 7 pm physics')
  })
  it('every ok parse round-trips: parsing its own canonical text gives the same values', () => {
    for (const [text] of OK) {
      const a = ok(parseWw(text, NOW))
      const b = ok(parseWw(a.text, NOW))
      expect({ ...b, fields: undefined, text: undefined }).toEqual({ ...a, fields: undefined, text: undefined })
    }
  })
  it('readAloud says what was understood or asked', () => {
    expect(readAloud(parseWw('spent 120 chai', NOW))).toContain('amount 120')
    expect(readAloud(parseWw('120', NOW))).toContain('Question: what is 120')
    expect(readAloud(parseWw('', NOW))).toBe('Type a line.')
  })
})

describe('no guess, no execution', () => {
  it('is deterministic: the same text and now give the same answer, and a different now can change it', () => {
    expect(parseWw('remind me tomorrow 8 am x', NOW)).toEqual(parseWw('remind me tomorrow 8 am x', new Date(NOW)))
    expect(ok(parseWw('remind me tomorrow 8 am x', at(2026, 12, 31)))).toMatchObject({ date: '2027-01-01' })
  })
  it('never reads the clock: a different real time of day does not change a log date', () => {
    expect(ok(parseWw('spent 5 tea', at(2026, 11, 13, 0, 1)))).toMatchObject({ date: '2026-11-13' })
    expect(ok(parseWw('spent 5 tea', at(2026, 11, 13, 23, 59)))).toMatchObject({ date: '2026-11-13' })
  })
  it('hostile and odd text never throws and always lands in one of the five statuses', () => {
    const odd = ['<script>alert(1)</script>', '${process.exit()}', '`rm -rf /`', "'; DROP TABLE x;--", 'spent 99999999999999999999 x', 'spent ' + '9'.repeat(400),
      'remind me ' + 'a '.repeat(200), 'water \u0000 5', 'spent ₹ ₹ ₹', 'gym 0 legs', 'gym -5 legs', 'spent 0 x', 'spent 1e5 x', 'remind me in 99999 days x', 'remind me in 0 days x', '💧 250']
    for (const s of odd) {
      const r = parseWw(s, NOW)
      expect(['empty', 'partial', 'ok', 'ask', 'unknown']).toContain(r.status)
    }
  })
  it('a long line is an ask, not a crash', () => {
    const r = parseWw('spent ' + 'x'.repeat(MAX_TEXT), NOW)
    expect(r.status === 'ask' && r.question).toContain('under')
  })
  it('a label that is markup stays text: the parser keeps it as data and the view escapes it', () => {
    expect(ok(parseWw('spent 5 <b>tea</b>', NOW))).toMatchObject({ label: '<b>tea</b>' })
  })
  it('a typed number is never made up: amounts out of range are asks, not clamped values', () => {
    expect(parseWw('spent 0 x', NOW).status).toBe('ask')
    expect(parseWw('spent 5000000 x', NOW).status).toBe('ask')
    expect(parseWw('gym legs 900', NOW).status).toBe('ask')
    expect(parseWw('water 6 l', NOW).status).toBe('ask')
  })
  it('every verb alias maps to one of the four verbs', () => {
    for (const w of ['spend', 'paid', 'drank', 'workout', 'reminder']) {
      expect(['ask', 'ok']).toContain(parseWw(`${w} 250 yesterday`, NOW).status)
    }
    expect(WW_VERBS).toEqual(['spent', 'water', 'gym', 'remind'])
  })
})

describe('the jarvis grammar is a closed verb list', () => {
  const VERBS = ['status', 'test hearing', 'restart brain', 'free gpu', 'export memory', 'jobs', 'plan']
  const j = (t: string) => parseJarvis(t, VERBS)
  it('knows remember, help and the verbs it is given', () => {
    expect(jarvisVerbs(VERBS)).toEqual(expect.arrayContaining(['status', 'test hearing', 'help']))
    expect(jarvisVerbs()).toEqual(expect.arrayContaining([...DEFAULT_JARVIS_VERBS]))
    expect(jarvisVerbs(VERBS)).not.toContain('remember') // a section that passes its own list gets exactly that list plus help
  })
  it('remember takes the rest of the line, with or without the arrow', () => {
    expect(parseJarvis('remember> I keep my notes in the blue folder')).toMatchObject({ status: 'ok', parsed: { verb: 'remember', args: 'I keep my notes in the blue folder' } })
    expect(parseJarvis('remember I like chai')).toMatchObject({ status: 'ok', parsed: { verb: 'remember', args: 'I like chai', text: 'remember I like chai' } })
    expect(parseJarvis('REMEMBER> Loud')).toMatchObject({ status: 'ok', parsed: { args: 'Loud' } })
  })
  it('remember with nothing to remember waits', () => {
    expect(parseJarvis('remember')).toMatchObject({ status: 'ask', question: '? remember what' })
    expect(parseJarvis('remember>')).toMatchObject({ status: 'ask', question: '? remember what' })
  })
  it('multi-word verbs match whole, case-blind, and keep their arguments', () => {
    expect(j('Test Hearing')).toMatchObject({ status: 'ok', parsed: { verb: 'test hearing', args: '' } })
    expect(j('export memory now')).toMatchObject({ status: 'ok', parsed: { verb: 'export memory', args: 'now' } })
    expect(j('status')).toMatchObject({ status: 'ok', parsed: { verb: 'status' } })
    expect(j('help')).toMatchObject({ status: 'ok', parsed: { verb: 'help' } })
  })
  it('the start of a verb is partial', () => {
    expect(j('sta')).toEqual({ status: 'partial', candidates: ['status'] })
    expect(j('test')).toEqual({ status: 'partial', candidates: ['test hearing'] })
    expect(j('restart')).toEqual({ status: 'partial', candidates: ['restart brain'] })
  })
  it('anything else answers unknown verb; try help', () => {
    for (const s of ['format c:', 'rm -rf /', '$(whoami)', 'status2', 'statuses', 'sudo status', '; status', 'remember2 x']) {
      expect(j(s)).toEqual({ status: 'unknown', message: UNKNOWN_VERB })
    }
    expect(UNKNOWN_VERB).toBe('unknown verb; try help')
  })
  it('a hostile verb list is cleaned, not trusted', () => {
    const v = jarvisVerbs(['ok', '$(x)', 'a'.repeat(80), 'ok', '  Mixed  Case  ', ''])
    expect(v).toEqual(expect.arrayContaining(['ok', 'mixed case', 'help']))
    expect(v.every((x) => /^[a-z][a-z0-9 -]*$/.test(x))).toBe(true)
  })
  it('the dispatcher picks the grammar', () => {
    expect(parseCapture('ww', 'water 250', NOW).status).toBe('ok')
    expect(parseCapture('jarvis', 'water 250', NOW).status).toBe('unknown')
    expect(parseCapture('jarvis', 'plan', NOW, ['plan']).status).toBe('ok')
  })
  it('the fields of a jarvis line rebuild it', () => {
    const p = parseJarvis('remember I like chai')
    if (p.status !== 'ok') throw new Error('ok expected')
    expect(rewrite('remember', p.parsed.fields, 'text', 'I like tea')).toBe('remember I like tea')
  })
})
