/**
 * ONE source of truth for the lamps the v3 shell prints (design-language-v3.md 3.3, 8.3): the lamp pill and the spine tiles
 * both read collectLamps(), so the pill can never count a set the spine does not show (jury round 3: "1 FAULT · 2 WAITING"
 * beside a spine of three waiting projects). The table is the shared one (shared/lamp: the four JARVIS annunciators and the
 * two Well Wisher ones) plus the steward, which is a lamp like the others (spec 8.3).
 *
 * Nothing here invents a state: a lamp nobody has reported on is WAITING, with the words of what it waits for.
 */
import { JARVIS_ANNUNCIATORS, WW_ANNUNCIATORS } from '../../shared/lamp/Annunciators'
import { LAMP_SPECS, NO_REPORT, WAITING_DEFAULT, type LampReading, type LampState } from '../../shared/lamp/types'
import type { SubProjectId } from './subprojects'

export interface LampDef {
  id: string
  label: string
  project: SubProjectId
  /** The section a press on this lamp opens (the pill's list links to it). */
  home: string
  /** Why it is WAITING when nobody has reported: the full sentence, then the short form the spine tile prints. */
  idle: string
  idleShort: string
}

const EXTRA: Record<string, Omit<LampDef, 'id' | 'label'>> = {
  steward: { project: 'jarvis', home: 'console', idle: 'the steward has not reported yet', idleShort: 'not reported' },
  voice: { project: 'jarvis', home: 'core', idle: 'no voice core is running', idleShort: 'no voice core' },
  room: { project: 'jarvis', home: 'room', idle: 'no board is connected', idleShort: 'no board' },
  senses: { project: 'aankhen', home: 'senses', idle: 'no sensor is running', idleShort: 'no sensor' },
  memory: { project: 'yadaash', home: 'memory', idle: 'the store has not been read yet', idleShort: 'not read' },
  phone: { project: 'wellwisher', home: 'day', idle: 'no phone is linked', idleShort: 'no phone' },
  quiet: { project: 'wellwisher', home: 'day', idle: 'quiet hours are not set', idleShort: 'not set' },
}

/** The shared table, in the order the pill breaks ties: the steward first, then the annunciators as the title bar had them. */
export const LAMP_TABLE: readonly LampDef[] = [
  { id: 'steward', label: 'Steward', ...EXTRA.steward },
  ...[...JARVIS_ANNUNCIATORS, ...WW_ANNUNCIATORS].map((a) => ({ id: a.id, label: a.label, ...EXTRA[a.id] })),
]

/** Worst first: a fault, then what is waiting, then simulated, planned, and last what is live (rule 4.8). */
export const STATE_ORDER: readonly LampState[] = ['fault', 'waiting', 'simulated', 'planned', 'live']

export interface LampRow {
  def: LampDef
  reading: LampReading
  /** The reason in words: the report's own, or what the lamp waits for when nobody reported. */
  reason: string
  /** The reason in few words, for a spine tile. */
  short: string
}

export type Readings = Readonly<Record<string, LampReading | undefined>>

export function rowOf(def: LampDef, readings: Readings): LampRow {
  const reading = readings[def.id] ?? WAITING_DEFAULT
  const silent = reading.state === 'waiting' && (!reading.reason || reading.reason === NO_REPORT)
  const reason = silent ? def.idle : reading.reason || LAMP_SPECS[reading.state].means
  return { def, reading, reason, short: silent ? def.idleShort : reading.reason || def.label.toLowerCase() }
}

/** Every lamp of the table, worst state first; inside one state the table order holds (a stable sort). */
export function collectLamps(readings: Readings, table: readonly LampDef[] = LAMP_TABLE): LampRow[] {
  return table
    .map((d, i) => ({ r: rowOf(d, readings), i }))
    .sort((a, b) => STATE_ORDER.indexOf(a.r.reading.state) - STATE_ORDER.indexOf(b.r.reading.state) || a.i - b.i)
    .map((x) => x.r)
}

export interface PillPart {
  state: LampState
  count: number
  word: string
}

/** "1 FAULT", "6 WAITING": a count per state present, worst first. The pill prints them joined by a middle dot. */
export function pillParts(rows: readonly LampRow[]): PillPart[] {
  const count = new Map<LampState, number>()
  for (const r of rows) count.set(r.reading.state, (count.get(r.reading.state) ?? 0) + 1)
  return STATE_ORDER.filter((s) => count.has(s)).map((s) => ({ state: s, count: count.get(s)!, word: LAMP_SPECS[s].label }))
}

export const pillText = (parts: readonly PillPart[]): string => parts.map((p) => `${p.count} ${p.word}`).join(' · ')

/** The state of one sub-project's tile: its worst lamp. A project with no lamp is WAITING with no reason (never LIVE). */
export function projectState(project: SubProjectId, rows: readonly LampRow[]): { state: LampState; word: string; text: string } {
  const own = rows.filter((r) => r.def.project === project)
  const worst = own[0] // rows are worst first already
  if (!worst) return { state: 'waiting', word: 'WAITING', text: 'WAITING · no lamp' }
  const word = LAMP_SPECS[worst.reading.state].label
  // a waiting lamp says what it waits for; any other state names the lamp, so a fault reads "FAULT · steward"
  const detail = worst.reading.state === 'waiting' ? worst.short : worst.def.label.toLowerCase()
  return { state: worst.reading.state, word, text: `${word} · ${detail}` }
}
