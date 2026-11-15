// The Day ports (package L01, contract table of UW7): one TypeScript type, `DayPort`, that every Day screen reads and writes
// through (the Life month, its drawer, and later the week, the body strip, the ledger and the Classroom fold). A screen never
// calls a route; it calls a port, and a port is filled by an adapter file (`adapters/<name>.register.ts`). Until a source is
// connected the only adapter is the null one, which answers WAITING with a reason, so a screen draws a hollow form and says
// why instead of inventing a number.
//
// Freeze note (spec 21.9, risk 5): later Day packages (L03, AD09, AD10, AD11, DB05) import this file; a member or a field changes
// only by a dated line on the wave comms board, never by a quiet edit.
import type { DayData, Exam, Kind } from '../../shared/almanac'
import type { DayAdapterRegistration } from './adapters/types'
import type { PortReply } from '../study/ports'

export type { DayAdapterRegistration } from './adapters/types'
// the reply shape is the Study port's (one lamp state, one reason, one data field); type only, so no Study module is loaded
export type { PortReply } from '../study/ports'

// ------------------------------------------------------------------------------------------------ the nouns

/** A thing that happened on a day (a row of the Happened fold). */
export interface EntryRow {
  id: string
  /** HH:MM, or null when the log holds only the day. */
  time: string | null
  kind: Kind
  text: string
}

/** Where a planned row stands. A carried row is an outline moved on without a word of failure. */
export type PlanStatus = 'planned' | 'carried' | 'done'

export interface PlannedRow {
  id: string
  time: string | null
  kind: Kind
  text: string
  status: PlanStatus
}

/** A recurring intention that falls on a day (an `Intent`, spec 20.6). */
export interface IntentRow {
  id: string
  rule: string
  /** The next date it falls due, YYYY-MM-DD, or null when it has no date. */
  due: string | null
}

/** Everything the drawer draws for one day. */
export interface DayDetail {
  date: string
  happened: EntryRow[]
  planned: PlannedRow[]
  intents: IntentRow[]
  /** The "next time" strip: what is set for this weekday, month or year. */
  nextTime: string[]
}

export interface IntentQuery {
  from: string
  to: string
}

/** What the drawer can do to a row. `addIntent`, `logDone` and `movePlanned` are the add menu's three entries (20.6.1). */
export type LogOp = 'undo' | 'delete' | 'move' | 'done' | 'notNow' | 'addIntent' | 'logDone' | 'movePlanned'

export interface LogAction {
  op: LogOp
  date: string
  id?: string
  /** For `move`: the date to move the row to. */
  to?: string
}

export interface LogResult {
  /** True only when the source changed. A WAITING reply never carries this as true. */
  applied: boolean
  message: string
}

export interface ReminderRow {
  id: string
  time: string
  label: string
}

export interface DashRow {
  id: string
  title: string
  figure: number | null
  unit: string
}

/** The eight members of the Day port. `intake` carries deadlines and exam dates (the `classroom` mark); `gcal` the notches. */
export interface DayPort {
  month(month: string): Promise<PortReply<DayData[]>>
  day(date: string): Promise<PortReply<DayDetail>>
  intake(month: string): Promise<PortReply<Exam[]>>
  intents(q: IntentQuery): Promise<PortReply<IntentRow[]>>
  logs(action: LogAction): Promise<PortReply<LogResult>>
  reminders(date: string): Promise<PortReply<ReminderRow[]>>
  gcal(month: string): Promise<PortReply<DayData[]>>
  dashboards(month: string): Promise<PortReply<DashRow[]>>
}

export type DayMember = keyof DayPort
export const DAY_MEMBERS: readonly DayMember[] = ['month', 'day', 'intake', 'intents', 'logs', 'reminders', 'gcal', 'dashboards']

/** Put the registrations of every adapter file together: per member, the highest rank wins; the first file by path breaks a tie. */
export function composePort(regs: readonly DayAdapterRegistration[]): DayPort {
  const sorted = [...regs].sort((a, b) => a.rank - b.rank)
  const out: Partial<Record<DayMember, unknown>> = {}
  for (const r of sorted) for (const k of DAY_MEMBERS) if (r.port[k]) out[k] = r.port[k]
  // a member nobody supplies answers WAITING, so a missing adapter is never a thrown error on a screen
  for (const k of DAY_MEMBERS) out[k] ??= () => Promise.resolve({ state: 'waiting', reason: 'no adapter registered', since: null, data: null })
  return out as unknown as DayPort
}

const isReg = (x: unknown): x is DayAdapterRegistration =>
  !!x && typeof x === 'object' && typeof (x as DayAdapterRegistration).id === 'string' &&
  typeof (x as DayAdapterRegistration).rank === 'number' && typeof (x as DayAdapterRegistration).port === 'object'

/** Collect `adapters/*.register.ts` modules (default or `registration` export); a file with no registration is skipped. */
export function collectAdapters(modules: Record<string, unknown>): DayAdapterRegistration[] {
  const out: DayAdapterRegistration[] = []
  for (const path of Object.keys(modules).sort()) {
    const m = modules[path] as { default?: unknown; registration?: unknown } | undefined
    const reg = isReg(m?.default) ? m!.default : isReg(m?.registration) ? m!.registration : null
    if (reg) out.push(reg)
  }
  return out
}

/** The port the screens use: every registered adapter, composed. */
export const DAY_PORT: DayPort = composePort(collectAdapters(import.meta.glob('./adapters/*.register.ts', { eager: true })))
