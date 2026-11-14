// The local, deterministic tokenizer of the Capture Line (spec 20.5, A.D04). No network, no model, no eval, no shell:
// a closed list of verbs, a handful of regular expressions and the calendar arithmetic in when.ts. The same text and the
// same `now` always give the same answer, which is what lets the test table pin 30 phrases and 10 ambiguities.
//
// The rule that matters most is "no guess". A phrase either reads in exactly one way or it comes back as an ask
// ("? what is 120") that waits for the person; nothing is committed on a hunch. Where a word could be read two ways the
// parser asks (a bare "7" after "at" is 7 am or 7 pm; "water 2" is 2 ml or 2 l; two numbers in a spend are two possible
// amounts). The numbers a person types are theirs: the parser never invents one, and it never turns a typed amount into a
// reading of any source.
import { bareHourAt, dateAt, dateWords, isoOf, timeAt, ymdOf, type DateHit, type Mode, type TimeHit, type Ymd } from './when'

export const MAX_TEXT = 160
export const MAX_LABEL = 60
/** The most a water entry may be in one go, and the least that is not a typing slip, in ml. */
export const WATER_MIN_ML = 10
export const WATER_MAX_ML = 5000
export const MAX_AMOUNT = 1_000_000
export const MAX_MINUTES = 600
export const DEFAULT_JARVIS_VERBS: readonly string[] = ['remember', 'help']
export const WW_VERBS = ['spent', 'water', 'gym', 'remind'] as const
export type WwVerb = (typeof WW_VERBS)[number]
const VERB_WORDS: Record<string, WwVerb> = { spent: 'spent', spend: 'spent', paid: 'spent', water: 'water', drank: 'water', gym: 'gym', workout: 'gym', remind: 'remind', reminder: 'remind' }

// ------------------------------------------------------------------------------------------------ types

export type FieldKey = 'verb' | 'amount' | 'label' | 'date' | 'time' | 'minutes' | 'volume' | 'text'
export type FieldKind = 'fixed' | 'number' | 'text' | 'date' | 'time'
/** typed: the person wrote it; default: a documented default (a log's day is today); missing: asked for; fixed: the verb. */
export type FieldState = 'typed' | 'default' | 'missing' | 'fixed'

export interface Field {
  key: FieldKey
  caption: string
  /** What the chip shows ("Fri 13 Nov", "19:00", "1,200"). */
  display: string
  /** What the person would type for it; '' for a default or a missing one. Used to rebuild the line after a chip edit. */
  raw: string
  kind: FieldKind
  state: FieldState
}

interface Base { text: string; fields: Field[] }
export interface SpentParsed extends Base { grammar: 'ww'; verb: 'spent'; amount: number; label: string; date: string }
export interface WaterParsed extends Base { grammar: 'ww'; verb: 'water'; ml: number; date: string }
export interface GymParsed extends Base { grammar: 'ww'; verb: 'gym'; label: string; minutes: number; date: string }
/** `date` is YYYY-MM-DD, `time` is HH:MM or null (all day), `at` is YYYY-MM-DDTHH:MM in local time, or the date alone. */
export interface RemindParsed extends Base { grammar: 'ww'; verb: 'remind'; label: string; date: string; time: string | null; at: string }
export interface JarvisParsed extends Base { grammar: 'jarvis'; verb: string; args: string }
export type Parsed = SpentParsed | WaterParsed | GymParsed | RemindParsed | JarvisParsed

export type ParseResult =
  | { status: 'empty' }
  /** The first word is the start of a verb: still typing. */
  | { status: 'partial'; candidates: string[] }
  | { status: 'ok'; parsed: Parsed }
  /** Ambiguous or incomplete: `question` starts with "? ", the chips show what was understood, and nothing is committed. */
  | { status: 'ask'; verb: string | null; question: string; fields: Field[]; hint?: string }
  /** The jarvis grammar's answer to a word that is not a verb. */
  | { status: 'unknown'; message: string }

export const UNKNOWN_VERB = 'unknown verb; try help'
export const WW_HINT = 'spent 120 chai · water 250 · gym legs 45 · remind me next tue 7 pm physics'

// ------------------------------------------------------------------------------------------------ helpers

const cleanTok = (s: string) => s.toLowerCase().replace(/[,;!?]+$/, '').replace(/(?<=[a-z])\.$/, '')
const AMOUNT = /^(?:₹|rs\.?|inr)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)(?:rs|\/-|₹)?$/
const looksNumeric = /^[₹\d]/
const CURRENCY = /^(?:₹|rs|inr)$/
const group = (n: number): string => {
  const [i, f] = String(n).split('.')
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '')
}
const fld = (key: FieldKey, caption: string, kind: FieldKind, state: FieldState, raw: string, display: string): Field => ({ key, caption, kind, state, raw, display })
const missing = (key: FieldKey, caption: string, kind: FieldKind): Field => fld(key, caption, kind, 'missing', '', '?')
const verbField = (v: string): Field => fld('verb', 'VERB', 'fixed', 'fixed', v, v)

function ask(verb: string | null, question: string, fields: Field[], hint?: string): ParseResult {
  return { status: 'ask', verb, question, fields, hint }
}

interface Scan { used: boolean[]; date: DateHit | null; time: TimeHit | null; ask: string | null }

/** Walk the tokens from `start` and claim the date phrase and, for a reminder, the time phrase. */
function scan(tok: readonly string[], start: number, now: Ymd, mode: Mode, withTime: boolean): Scan {
  const out: Scan = { used: tok.map(() => false), date: null, time: null, ask: null }
  const take = (len: number, from: number) => { for (let k = 0; k < len; k++) out.used[from + k] = true }
  for (let i = start; i < tok.length; i++) {
    if (out.used[i]) continue
    const filler = tok[i] === 'on' || (withTime && tok[i] === 'at') ? 1 : 0
    const at = i + filler
    const d = dateAt(tok, at, now, mode)
    if (d) {
      take(d.len + filler, i)
      if (out.date) out.ask ??= `? two days: ${out.date.raw} and ${d.raw}`
      else out.date = d
      if ('ask' in d) out.ask ??= d.ask
      i = at + d.len - 1
      continue
    }
    if (!withTime) continue
    const t = timeAt(tok, at) ?? (tok[i] === 'at' ? bareHourAt(tok, at) : null)
    if (t) {
      take(t.len + filler, i)
      if (out.time) out.ask ??= `? two times: ${out.time.raw} and ${t.raw}`
      else out.time = t
      if ('ask' in t) out.ask ??= t.ask
      i = at + t.len - 1
    }
  }
  return out
}

function dateField(sc: Scan, now: Ymd, defaultToday: boolean): Field {
  if (sc.date && 'ymd' in sc.date) return fld('date', 'DATE', 'date', 'typed', sc.date.raw, dateWords(sc.date.ymd, now))
  if (sc.date) return fld('date', 'DATE', 'date', 'typed', sc.date.raw, sc.date.raw)
  return defaultToday ? fld('date', 'DATE · today', 'date', 'default', '', dateWords(now, now)) : missing('date', 'DATE', 'date')
}
const dateIso = (sc: Scan, now: Ymd) => (sc.date && 'ymd' in sc.date ? isoOf(sc.date.ymd) : isoOf(now))

const dropLead = (words: string[], leads: readonly string[]): string[] => (words.length > 1 && leads.includes(words[0].toLowerCase()) ? words.slice(1) : words)
const joinLabel = (words: string[]) => words.join(' ')

const canonical = (verb: string, parts: (string | null | undefined)[]) => [verb, ...parts.filter((p): p is string => !!p)].join(' ')

// ------------------------------------------------------------------------------------------------ the verbs

function parseSpent(orig: string[], tok: string[], now: Ymd): ParseResult {
  const sc = scan(tok, 1, now, 'past', false)
  for (let i = 1; i < tok.length; i++) if (!sc.used[i] && CURRENCY.test(tok[i]) && AMOUNT.test(tok[i + 1] ?? '')) sc.used[i] = true
  const cands: number[] = []
  const bad: number[] = []
  for (let i = 1; i < tok.length; i++) {
    if (sc.used[i]) continue
    if (AMOUNT.test(tok[i])) cands.push(i)
    else if (looksNumeric.test(tok[i])) bad.push(i)
  }
  const amountIdx = cands.length === 1 ? cands[0] : -1
  const words: string[] = []
  for (let i = 1; i < tok.length; i++) if (!sc.used[i] && !cands.includes(i) && !bad.includes(i)) words.push(orig[i])
  const label = joinLabel(dropLead(words, ['on', 'for', 'at', 'to']))
  const amount = amountIdx >= 0 ? Number((AMOUNT.exec(tok[amountIdx]) as RegExpExecArray)[1].replace(/,/g, '')) : null
  const amountRaw = amountIdx >= 0 ? (AMOUNT.exec(tok[amountIdx]) as RegExpExecArray)[1] : ''
  const fields = [
    verbField('spent'),
    amount !== null ? fld('amount', 'AMOUNT', 'number', 'typed', amountRaw, group(amount)) : missing('amount', 'AMOUNT', 'number'),
    label ? fld('label', 'LABEL', 'text', 'typed', label, label) : missing('label', 'LABEL', 'text'),
    dateField(sc, now, true),
  ]
  if (sc.ask) return ask('spent', sc.ask, fields)
  if (bad.length) return ask('spent', `? what is ${orig[bad[0]]}`, fields)
  if (cands.length > 1) return ask('spent', `? which is the amount: ${tok[cands[0]]} or ${tok[cands[1]]}`, fields)
  if (amount === null) return ask('spent', label ? `? how much for ${label}` : '? spent how much', fields)
  if (amount <= 0) return ask('spent', `? what is ${amountRaw}`, fields)
  if (amount > MAX_AMOUNT) return ask('spent', `? is ${group(amount)} right`, fields)
  if (!label) return ask('spent', `? ${group(amount)} on what`, fields)
  if (label.length > MAX_LABEL) return ask('spent', `? keep the label under ${MAX_LABEL} characters`, fields)
  const date = dateIso(sc, now)
  const text = canonical('spent', [amountRaw, label, sc.date?.raw])
  return { status: 'ok', parsed: { grammar: 'ww', verb: 'spent', amount, label, date, text, fields } }
}

const VOLUME = /^(\d+(?:\.\d+)?)(ml|l|ltr|litre|litres|liter|liters)?$/
const VOLUME_UNIT = /^(ml|l|ltr|litre|litres|liter|liters)$/

function parseWater(orig: string[], tok: string[], now: Ymd): ParseResult {
  const sc = scan(tok, 1, now, 'past', false)
  const cands: { i: number; n: number; unit: string | null }[] = []
  let stray: number | null = null
  for (let i = 1; i < tok.length; i++) {
    if (sc.used[i]) continue
    const v = VOLUME.exec(tok[i])
    if (v) cands.push({ i, n: Number(v[1]), unit: v[2] ?? null })
    else if (VOLUME_UNIT.test(tok[i]) && cands.length && cands[cands.length - 1].i === i - 1 && cands[cands.length - 1].unit === null) cands[cands.length - 1].unit = tok[i]
    else stray ??= i
  }
  const one = cands.length === 1 ? cands[0] : null
  const isLitre = one?.unit !== null && one?.unit !== undefined && one.unit !== 'ml'
  const ml = one ? Math.round(isLitre ? one.n * 1000 : one.n) : null
  const raw = one ? `${one.n}${one.unit ? ` ${one.unit}` : ''}` : ''
  const fields = [
    verbField('water'),
    one && ml !== null ? fld('volume', 'VOLUME', 'number', 'typed', raw, `${group(ml)} ml`) : missing('volume', 'VOLUME', 'number'),
    dateField(sc, now, true),
  ]
  if (sc.ask) return ask('water', sc.ask, fields)
  if (stray !== null) return ask('water', `? what is ${orig[stray]}`, fields)
  if (cands.length > 1) return ask('water', `? which is the amount: ${tok[cands[0].i]} or ${tok[cands[1].i]}`, fields)
  if (!one || ml === null) return ask('water', '? how many ml', fields)
  if (one.unit === null && one.n < 10) return ask('water', `? ${one.n} ml or ${one.n} l`, fields)
  if (ml < WATER_MIN_ML || ml > WATER_MAX_ML) return ask('water', `? is ${group(ml)} ml right`, fields)
  const text = canonical('water', [raw, sc.date?.raw])
  return { status: 'ok', parsed: { grammar: 'ww', verb: 'water', ml, date: dateIso(sc, now), text, fields } }
}

const DURATION = /^(\d+(?:\.\d+)?)(min|mins|minutes|m|h|hr|hrs|hour|hours)?$/
const DURATION_UNIT = /^(min|mins|minutes|m|h|hr|hrs|hour|hours)$/

function parseGym(orig: string[], tok: string[], now: Ymd): ParseResult {
  const sc = scan(tok, 1, now, 'past', false)
  const cands: { i: number; n: number; unit: string | null }[] = []
  const bad: number[] = []
  const unitOf = new Set<number>()
  for (let i = 1; i < tok.length; i++) {
    if (sc.used[i]) continue
    const d = DURATION.exec(tok[i])
    if (d) cands.push({ i, n: Number(d[1]), unit: d[2] ?? null })
    else if (DURATION_UNIT.test(tok[i]) && cands.length && cands[cands.length - 1].i === i - 1 && cands[cands.length - 1].unit === null) {
      cands[cands.length - 1].unit = tok[i]
      unitOf.add(i)
    } else if (looksNumeric.test(tok[i])) bad.push(i)
  }
  const one = cands.length === 1 ? cands[0] : null
  const hours = one?.unit !== null && one?.unit !== undefined && one.unit.startsWith('h')
  const minutes = one ? Math.round(hours ? one.n * 60 : one.n) : null
  const minRaw = one ? `${one.n}${one.unit ? ` ${one.unit}` : ''}` : ''
  const words: string[] = []
  for (let i = 1; i < tok.length; i++) if (!sc.used[i] && !cands.some((c) => c.i === i) && !unitOf.has(i) && !bad.includes(i)) words.push(orig[i])
  const label = joinLabel(dropLead(words, ['at', 'for']))
  const fields = [
    verbField('gym'),
    label ? fld('label', 'WORKOUT', 'text', 'typed', label, label) : missing('label', 'WORKOUT', 'text'),
    minutes !== null ? fld('minutes', 'MINUTES', 'number', 'typed', minRaw, `${group(minutes)} min`) : missing('minutes', 'MINUTES', 'number'),
    dateField(sc, now, true),
  ]
  if (sc.ask) return ask('gym', sc.ask, fields)
  if (bad.length) return ask('gym', `? what is ${orig[bad[0]]}`, fields)
  if (cands.length > 1) return ask('gym', `? which is the time: ${tok[cands[0].i]} or ${tok[cands[1].i]}`, fields)
  if (!label) return ask('gym', minutes !== null ? `? which workout, ${group(minutes)} min` : '? which workout', fields)
  if (minutes === null) return ask('gym', `? how many minutes of ${label}`, fields)
  if (minutes < 1 || minutes > MAX_MINUTES) return ask('gym', `? is ${group(minutes)} min right`, fields)
  if (label.length > MAX_LABEL) return ask('gym', `? keep the label under ${MAX_LABEL} characters`, fields)
  const text = canonical('gym', [label, minRaw, sc.date?.raw])
  return { status: 'ok', parsed: { grammar: 'ww', verb: 'gym', label, minutes, date: dateIso(sc, now), text, fields } }
}

const DATE_ATTEMPT = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/

function parseRemind(orig: string[], tok: string[], now: Ymd, hour: number, minute: number): ParseResult {
  const start = tok[1] === 'me' ? 2 : 1
  const sc = scan(tok, start, now, 'future', true)
  let stray: number | null = null
  const words: string[] = []
  for (let i = start; i < tok.length; i++) {
    if (sc.used[i]) continue
    if (DATE_ATTEMPT.test(tok[i])) stray ??= i
    words.push(orig[i])
  }
  const label = joinLabel(dropLead(words, ['to']))
  const time = sc.time && 'hhmm' in sc.time ? sc.time.hhmm : null
  const fields = [
    verbField('remind'),
    label ? fld('label', 'ABOUT', 'text', 'typed', label, label) : missing('label', 'ABOUT', 'text'),
    dateField(sc, now, false),
    sc.time && 'hhmm' in sc.time ? fld('time', 'TIME', 'time', 'typed', sc.time.raw, sc.time.hhmm) : sc.time ? fld('time', 'TIME', 'time', 'typed', sc.time.raw, sc.time.raw) : fld('time', 'TIME', 'time', 'default', '', 'all day'),
  ]
  if (sc.ask) return ask('remind', sc.ask, fields)
  if (stray !== null) return ask('remind', `? what is ${orig[stray]}`, fields)
  if (!label) return ask('remind', '? remind you of what', fields)
  if (label.length > MAX_LABEL) return ask('remind', `? keep the label under ${MAX_LABEL} characters`, fields)
  if (!sc.date || !('ymd' in sc.date)) return ask('remind', time ? `? which day at ${time}` : `? which day for ${label}`, fields)
  const date = isoOf(sc.date.ymd)
  if (time && date === isoOf(now) && time <= `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`) return ask('remind', `? ${time} has passed today`, fields)
  const text = canonical('remind me', [sc.date.raw, sc.time?.raw, label])
  return { status: 'ok', parsed: { grammar: 'ww', verb: 'remind', label, date, time, at: time ? `${date}T${time}` : date, text, fields } }
}

// ------------------------------------------------------------------------------------------------ entry points

/**
 * Read one line of Well Wisher capture: `spent 120 chai`, `water 250`, `gym legs 45`, `remind me next tue 7 pm physics`.
 * `now` is a parameter (local time) so the same text always gives the same answer.
 */
export function parseWw(text: string, now: Date): ParseResult {
  const line = text.trim().replace(/\s+/g, ' ')
  if (!line) return { status: 'empty' }
  if (line.length > MAX_TEXT) return ask(null, `? keep it under ${MAX_TEXT} characters`, [], WW_HINT)
  const orig = line.split(' ')
  const tok = orig.map(cleanTok)
  const first = tok[0]
  const verb = VERB_WORDS[first]
  if (!verb) {
    if (tok.length === 1) {
      const cand = Object.keys(VERB_WORDS).filter((w) => w.startsWith(first) && first.length >= 1)
      const names = [...new Set(cand.map((w) => VERB_WORDS[w]))]
      if (names.length) return { status: 'partial', candidates: names }
    }
    return ask(null, `? what is ${orig[0]}`, [], WW_HINT)
  }
  const ymd = ymdOf(now)
  switch (verb) {
    case 'spent': return parseSpent(orig, tok, ymd)
    case 'water': return parseWater(orig, tok, ymd)
    case 'gym': return parseGym(orig, tok, ymd)
    default: return parseRemind(orig, tok, ymd, now.getHours(), now.getMinutes())
  }
}

/** The closed verb list of the jarvis grammar: `remember` and whatever verbs a section passes in; `help` is always there. */
export function jarvisVerbs(verbs?: readonly string[]): string[] {
  const out: string[] = []
  for (const v of [...(verbs ?? DEFAULT_JARVIS_VERBS), 'help']) {
    const w = String(v).trim().toLowerCase().replace(/\s+/g, ' ')
    if (/^[a-z][a-z0-9 -]{0,31}$/.test(w) && !out.includes(w) && out.length < 24) out.push(w)
  }
  return out.sort((a, b) => b.length - a.length)
}

export function parseJarvis(text: string, verbs?: readonly string[]): ParseResult {
  const line = text.trim().replace(/\s+/g, ' ')
  if (!line) return { status: 'empty' }
  const list = jarvisVerbs(verbs)
  const lower = line.toLowerCase()
  const hit = list.find((v) => lower === v || lower.startsWith(`${v} `) || lower.startsWith(`${v}>`))
  if (!hit) {
    const prefix = list.filter((v) => v.startsWith(lower)).sort()
    if (prefix.length) return { status: 'partial', candidates: prefix }
    return { status: 'unknown', message: UNKNOWN_VERB }
  }
  const args = line.slice(hit.length).replace(/^>?\s*/, '')
  const needsText = hit === 'remember'
  const fields: Field[] = [verbField(hit)]
  if (needsText || args) fields.push(args ? fld('text', 'TEXT', 'text', 'typed', args, args) : missing('text', 'TEXT', 'text'))
  if (needsText && !args) return ask(hit, '? remember what', fields)
  if (line.length > MAX_TEXT * 3) return ask(hit, `? keep it under ${MAX_TEXT * 3} characters`, fields)
  return { status: 'ok', parsed: { grammar: 'jarvis', verb: hit, args, text: args ? `${hit} ${args}` : hit, fields } }
}

export function parseCapture(grammar: 'ww' | 'jarvis', text: string, now: Date, verbs?: readonly string[]): ParseResult {
  return grammar === 'ww' ? parseWw(text, now) : parseJarvis(text, verbs)
}

/**
 * The line after one chip is edited: every other field keeps what the person typed, this one takes `value`. The caller
 * puts the result back in the field and parses it again, so a chip edit and a keyboard edit are the same thing.
 */
export function rewrite(verb: string, fields: readonly Field[], key: FieldKey, value: string): string {
  const raw = (k: FieldKey) => (k === key ? value.trim() : (fields.find((f) => f.key === k)?.raw ?? ''))
  switch (verb) {
    case 'spent': return canonical('spent', [raw('amount'), raw('label'), raw('date')])
    case 'water': return canonical('water', [raw('volume'), raw('date')])
    case 'gym': return canonical('gym', [raw('label'), raw('minutes'), raw('date')])
    case 'remind': return canonical('remind me', [raw('date'), raw('time'), raw('label')])
    default: return canonical(verb, [raw('text')])
  }
}

/** One plain sentence for a screen reader: what was understood, or what is asked. */
export function readAloud(r: ParseResult): string {
  switch (r.status) {
    case 'ok': return `Understood: ${r.parsed.fields.filter((f) => f.kind !== 'fixed' || f.key === 'verb').map((f) => `${f.caption.toLowerCase()} ${f.display}`).join(', ')}. Press Enter to log it.`
    case 'ask': return `${r.question.replace(/^\? /, 'Question: ')}. Nothing is logged until this is clear.`
    case 'unknown': return r.message
    case 'partial': return `Keep typing: ${r.candidates.join(', ')}`
    default: return 'Type a line.'
  }
}
