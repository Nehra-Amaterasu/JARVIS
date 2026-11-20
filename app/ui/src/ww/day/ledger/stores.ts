// The three stores the Ledger and the Body strip read and write (package L03): water, the spending log and the habit counters.
// None of them has an engine route yet (the life stores of engine plan group G are "later"), so each member answers WAITING with the
// reason through the null object below, and the screens draw hollow forms and say why instead of inventing a number. When a route
// exists, an adapter fills the same interface; nothing in the views changes. Every figure that goes through here is the student's own
// entry (nothing is read from a bank, a sensor or a phone), so a LIVE reply means "the student logged it".
import type { LogResult, PortReply } from '../ports'
import { waiting } from '../adapters/types'

export interface WaterDay { count: number }

export interface SpendRow { id: string; date: string; amount: number; category: string; note: string }
export interface NewSpend { date: string; amount: number; category: string; note: string }

/** A habit the student named. `limit` is the daily limit the student set, or null when none is set. */
export interface Habit { id: string; name: string; limit: number | null }
/** One logged occurrence. `at` is a local date YYYY-MM-DD (the day it was logged); `chip` is the optional "what led up to it". */
export interface HabitEvent { id: string; habit: string; at: string; chip: string | null }

export interface LedgerStores {
  water: {
    read(date: string): Promise<PortReply<WaterDay>>
    /** Set the day's count (a tap on a drop sets it to that drop; a tap on the last filled drop removes one). */
    set(date: string, count: number): Promise<PortReply<LogResult>>
  }
  spend: {
    month(month: string): Promise<PortReply<SpendRow[]>>
    add(row: NewSpend): Promise<PortReply<LogResult>>
    /** The student's own category list, up to eight. */
    categories(): Promise<PortReply<string[]>>
  }
  habits: {
    list(): Promise<PortReply<Habit[]>>
    events(from: string, to: string): Promise<PortReply<HabitEvent[]>>
    log(habit: string, date: string, chip: string | null): Promise<PortReply<LogResult>>
    /** Remove the newest event of a habit on a date. */
    undo(habit: string, date: string): Promise<PortReply<LogResult>>
    setLimit(habit: string, limit: number | null): Promise<PortReply<LogResult>>
  }
}

const NONE = 'the life stores are not connected yet'

/** The null object: every member is WAITING with its reason, so a missing adapter is never a thrown error on a screen. */
export const NULL_STORES: LedgerStores = {
  water: {
    read: async () => waiting('the water store is not connected yet'),
    set: async () => waiting('the water store is not connected yet, so nothing was saved'),
  },
  spend: {
    month: async () => waiting('the spending log is not connected yet'),
    add: async () => waiting('the spending log is not connected yet, so nothing was saved'),
    categories: async () => waiting(NONE),
  },
  habits: {
    list: async () => waiting('the habit store is not connected yet'),
    events: async () => waiting('the habit store is not connected yet'),
    log: async () => waiting('the habit store is not connected yet, so nothing was saved'),
    undo: async () => waiting('the habit store is not connected yet, so nothing was changed'),
    setLimit: async () => waiting('the habit store is not connected yet, so nothing was saved'),
  },
}

/** The stores the shell uses: today the null object; an adapter file replaces a member when its route exists. */
export const LEDGER_STORES: LedgerStores = NULL_STORES
