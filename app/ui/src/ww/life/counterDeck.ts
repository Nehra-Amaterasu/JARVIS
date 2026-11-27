// The counters of Day / Today as a deck you can correct (25 Nov: "no counters changing option, the undo only reverts the latest added
// 1 counter, went to college is tick or not").
//
// How a count is stored (app/jarvis_app/germoney.py, life_tap "count"): NOT as items. state.life[date].counts[id] is one integer, 0 to 500,
// set by POST /api/mission/life/count {id, value} or nudged by {id, delta}. So the three things asked for map onto that one route:
//   minus      -> {id, delta: -1}. The engine refuses below 0 ("a count is 0 to 500", HTTP 400): its words are shown, nothing is faked.
//   yes or no  -> {id, value: 1} or {id, value: 0} for a counter whose want is "yes" (and for the counter named "college"): a tick, never a 2.
//   undo       -> {id, value: <the number before>}: sets the exact old number, so undoing is right even after other taps on that counter.
// Every one of the three carries `expect: <the number he saw>` (R-64, 27 Nov): a second window or phone that moved the counter makes the
// engine answer 409 {message, id, present} and write nothing. The screen then says the engine's sentence, shows `present`, and pushes no
// undo step (nothing was done). A count not logged today is 0 to the engine, so a tile that shows a dash expects 0.
// Which counters stand on the card and in what order is R-63 GET and PUT /api/mission/life/layout {shown, order} (answers {shown, order,
// saved}), so the choice follows him across devices; this device's copy (localStorage) is only the fallback, for an engine that answers
// planned, has no such route, or does not answer. The sheet says which of the two is in use.
// The items route (/life/item, /item/delete, /item/restore) is for meals, media and reels; counters are not items, so it is not used here.
//
// The undo stack lives for the visit (module state, so Today -> Week -> Today keeps it) and forgets entries older than 15 minutes:
// long enough to fix a run of mis-taps, short enough that it never becomes a second history.
import { useEffect } from 'react'
import { create } from 'zustand'
import { ApiError, TOKEN, api } from '../../lib/api'
import { useLeft } from '../left/store'

export interface DeckCounter { id: string; name: string; want: 'less' | 'more' | 'yes'; today: number | null }
export interface UndoEntry { id: string; name: string; before: number; after: number; at: number }
export interface DeckPrefs { order: string[]; hidden: string[] }

interface LifeRes { status?: string; counters?: { id: string; name: string; want?: string; today: number | null }[] }
/** R-63's answer. `saved` is false until he has chosen once, and then shown and order are the engine's defaults (everything, in engine order). */
interface LayoutRes { state?: string; shown?: unknown; order?: unknown; saved?: unknown }

/** The engine refused a count because the number he saw is no longer the number it holds (409, detail {message, id, present}). */
export class CountConflict extends Error {
  id: string
  present: number
  constructor(message: string, id: string, present: number) { super(message); this.id = id; this.present = present }
}

/**
 * POST /api/mission/life/count. Not lib/api's `post`: that reads a 409's `detail` as a string, and this detail is an object, which came
 * out as "[object Object]" (api.ts, the line that reads j.detail; the engine's sentence was lost). The same token header, and every
 * other refusal is still an ApiError with the engine's string.
 */
async function postCount(body: Record<string, unknown>): Promise<LifeRes> {
  const res = await fetch('/api/mission/life/count', { method: 'POST', headers: { 'X-Jarvis-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.ok) return (await res.json()) as LifeRes
  let detail: unknown = null
  try { detail = ((await res.json()) as { detail?: unknown }).detail } catch { /* not JSON */ }
  if (res.status === 409 && detail && typeof detail === 'object') {
    const d = detail as { message?: unknown; id?: unknown; present?: unknown }
    if (typeof d.present === 'number') throw new CountConflict(typeof d.message === 'string' && d.message ? d.message : 'That counter changed in another window.', typeof d.id === 'string' ? d.id : String(body.id), d.present)
  }
  throw new ApiError(res.status, typeof detail === 'string' && detail ? detail : res.statusText)
}

export const PREFS_KEY = 'ww.day.counters.v1'
export const UNDO_MINUTES = 15
const MAX_UNDO = 30

const readPrefs = (): DeckPrefs => {
  try {
    const j = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<DeckPrefs> | null
    return { order: Array.isArray(j?.order) ? j!.order!.filter((x) => typeof x === 'string') : [], hidden: Array.isArray(j?.hidden) ? j!.hidden!.filter((x) => typeof x === 'string') : [] }
  } catch {
    return { order: [], hidden: [] }
  }
}
const writePrefs = (p: DeckPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* a private window: the choice lasts until the page closes */
  }
}

const toDeck = (rows: NonNullable<LifeRes['counters']>): DeckCounter[] =>
  rows.map((c) => ({ id: c.id, name: c.name, want: c.want === 'yes' || c.want === 'more' ? c.want : 'less', today: c.today }))

/** A "tick" counter: the engine says want "yes", or it is the college counter (a yes or no for the day, whatever want says). */
export const isTick = (c: Pick<DeckCounter, 'id' | 'want'>): boolean => c.want === 'yes' || c.id === 'college'

/** Apply the saved order and hide list to the counters as the engine has them. Counters the saved order does not know follow, in engine order. */
export function arrange(all: DeckCounter[], prefs: DeckPrefs): { shown: DeckCounter[]; hidden: DeckCounter[] } {
  const rank = (id: string) => { const i = prefs.order.indexOf(id); return i < 0 ? prefs.order.length + all.findIndex((c) => c.id === id) : i }
  const sorted = [...all].sort((a, b) => rank(a.id) - rank(b.id))
  return { shown: sorted.filter((c) => !prefs.hidden.includes(c.id)), hidden: sorted.filter((c) => prefs.hidden.includes(c.id)) }
}

const fresh = (u: UndoEntry[], now = Date.now()) => u.filter((e) => now - e.at < UNDO_MINUTES * 60_000)

/** Where the choice of counters lives right now: the engine's own list (R-63), or this device's copy when the engine has none to give. */
export type LayoutSource = 'engine' | 'device'

/** The engine's {shown, order} as the deck's {order, hidden}: hidden is every counter of the order that is not shown. */
export const prefsFromLayout = (shown: string[], order: string[]): DeckPrefs => ({ order, hidden: order.filter((id) => !shown.includes(id)) })
/** The deck's {order, hidden} as the body of PUT: `order` lists every counter, `shown` the ones standing on the card, in that order. */
export const layoutBody = (order: string[], hidden: string[]) => ({ order, shown: order.filter((id) => !hidden.includes(id)) })

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null)

interface Deck {
  counters: DeckCounter[] | null
  loaded: boolean
  /** The engine's last refusal or failure, in its own words; cleared by the next success. */
  said: string | null
  undo: UndoEntry[]
  prefs: DeckPrefs
  /** Which copy of the choice is in use; the sheet says it. */
  layoutSource: LayoutSource
  /** The engine's sentence when the last PUT of the choice was refused, or null. */
  layoutSaid: string | null
  load: () => Promise<void>
  loadLayout: () => Promise<void>
  /** Set a counter to an exact number (value) with the engine; the screen moves first and goes back on a refusal. */
  setTo: (id: string, value: number, record?: boolean) => Promise<boolean>
  step: (id: string, delta: 1 | -1) => Promise<boolean>
  tick: (id: string) => Promise<boolean>
  undoLast: () => Promise<boolean>
  /** Save the choice: to the engine when it keeps one, and always to this device's copy (the fallback). The screen moves first. */
  setPrefs: (p: DeckPrefs) => Promise<void>
  merge: (rows: { id: string; today: number | null | undefined }[]) => void
}

let seq = 0
// Count presses go to the engine one after another: each carries the number he saw, and two in flight at once would make the second
// look like a change made in another window (it could arrive before the first was written) and be refused with a 409.
let chain: Promise<unknown> = Promise.resolve()
const queued = <T,>(run: () => Promise<T>): Promise<T> => { const r = chain.then(run, run); chain = r.catch(() => undefined); return r }
const say = (m: string | null) => useDeck.setState({ said: m })
const why = (e: unknown) => (e instanceof Error && e.message ? e.message : 'The server did not answer.')

/** A 409: the engine wrote nothing and said what it holds. Say its sentence and show that number; no undo step is made. True when it was one. */
function conflict(e: unknown, id: string): boolean {
  if (!(e instanceof CountConflict)) return false
  useDeck.setState((s) => ({ said: e.message, counters: s.counters ? s.counters.map((c) => (c.id === (e.id || id) ? { ...c, today: e.present } : c)) : s.counters }))
  return true
}

export const useDeck = create<Deck>((set, get) => ({
  counters: null, loaded: false, said: null, undo: [], prefs: readPrefs(), layoutSource: 'device', layoutSaid: null,

  load: async () => {
    try {
      const r = await api<LifeRes>('/api/mission/life')
      if (r?.status === 'ok' && Array.isArray(r.counters)) set({ counters: toDeck(r.counters), loaded: true, said: null })
      else set({ loaded: true })
    } catch (e) {
      set({ loaded: true, said: `The counters could not be read: ${why(e)}` })
    }
    await get().loadLayout()
  },

  // R-63. Planned, absent (404 or 405), a body of another shape, or no answer: this device's copy stays in use and the sheet says so.
  loadLayout: async () => {
    try {
      const r = await api<LayoutRes>('/api/mission/life/layout')
      const shown = strings(r?.shown), order = strings(r?.order)
      if (!r || r.state === 'planned' || !shown || !order) { set({ layoutSource: 'device' }); return }
      if (r.saved === false) {
        // nothing chosen on the engine yet: what this device already chose is sent up once, so the first window to open it keeps its choice
        const mine = get().prefs
        if (mine.order.length > 0 || mine.hidden.length > 0) { set({ layoutSource: 'engine', layoutSaid: null }); await get().setPrefs(mine); return }
      }
      const p = prefsFromLayout(shown, order)
      writePrefs(p)
      set({ prefs: p, layoutSource: 'engine', layoutSaid: null })
    } catch { set({ layoutSource: 'device' }) }
  },

  setTo: async (id, value, record = true) => {
    const before = get().counters
    const row = before?.find((c) => c.id === id)
    if (!before || !row) return false
    const was = row.today ?? 0
    const mine = ++seq
    set({ said: null, counters: before.map((c) => (c.id === id ? { ...c, today: value } : c)) })
    try {
      const r = await queued(() => postCount({ id, value, expect: was }))
      if (mine === seq && r?.status === 'ok' && Array.isArray(r.counters)) set({ counters: toDeck(r.counters) })
      if (record && value !== was) set((s) => ({ undo: [...fresh(s.undo), { id, name: row.name, before: was, after: value, at: Date.now() }].slice(-MAX_UNDO) }))
      void useLeft.getState().loadSlice('life') // the rest of Today (the Capture Line's water) reads the same numbers
      return true
    } catch (e) {
      if (conflict(e, id)) return false
      if (mine === seq) set({ counters: before })
      say(`The engine did not take that: ${why(e)}`)
      return false
    }
  },

  step: async (id, delta) => {
    const before = get().counters
    const row = before?.find((c) => c.id === id)
    if (!before || !row) return false
    const was = row.today ?? 0
    const mine = ++seq
    // a minus on 0 is still sent: the engine's refusal is the answer shown, not a rule guessed here
    set({ said: null, counters: before.map((c) => (c.id === id ? { ...c, today: Math.max(0, was + delta) } : c)) })
    try {
      const r = await queued(() => postCount({ id, delta, expect: was }))
      if (mine === seq && r?.status === 'ok' && Array.isArray(r.counters)) set({ counters: toDeck(r.counters) })
      set((s) => ({ undo: [...fresh(s.undo), { id, name: row.name, before: was, after: was + delta, at: Date.now() }].slice(-MAX_UNDO) }))
      void useLeft.getState().loadSlice('life')
      return true
    } catch (e) {
      if (conflict(e, id)) return false
      if (mine === seq) set({ counters: before })
      say(`The engine did not take that: ${why(e)}`)
      return false
    }
  },

  tick: async (id) => {
    const row = get().counters?.find((c) => c.id === id)
    if (!row) return false
    return get().setTo(id, (row.today ?? 0) >= 1 ? 0 : 1)
  },

  undoLast: async () => {
    const stack = fresh(get().undo)
    const last = stack[stack.length - 1]
    if (!last) { set({ undo: [] }); return false }
    const ok = await get().setTo(last.id, last.before, false)
    // only a taken undo leaves the stack; a refused one stays, so it can be tried again
    if (ok) set({ undo: stack.slice(0, -1) })
    return ok
  },

  setPrefs: async (p) => {
    const before = get().prefs
    writePrefs(p)
    set({ prefs: p, layoutSaid: null })
    if (get().layoutSource !== 'engine') return
    try {
      const r = await api<LayoutRes>('/api/mission/life/layout', { method: 'PUT', body: layoutBody(p.order, p.hidden) })
      const shown = strings(r?.shown), order = strings(r?.order)
      // the engine's answer is the truth: it may know a counter the sheet did not
      if (shown && order) { const q = prefsFromLayout(shown, order); writePrefs(q); set({ prefs: q }) }
    } catch (e) {
      // refused or not heard: the choice goes back to what the engine still holds, and its words are shown
      writePrefs(before)
      set({ prefs: before, layoutSaid: `The engine did not keep that choice: ${why(e)}` })
    }
  },

  // the Capture Line adds water through the left store; take its numbers in without another read
  merge: (rows) => {
    const cur = get().counters
    if (!cur) return
    let changed = false
    const next = cur.map((c) => {
      const r = rows.find((x) => x.id === c.id)
      if (r && r.today !== undefined && r.today !== c.today) { changed = true; return { ...c, today: r.today } }
      return c
    })
    if (changed) set({ counters: next })
  },
}))

/** Test hook: a clean deck. */
export const resetDeckForTests = () => { seq = 0; chain = Promise.resolve(); useDeck.setState({ counters: null, loaded: false, said: null, undo: [], prefs: { order: [], hidden: [] }, layoutSource: 'device', layoutSaid: null }) }

/** Read the deck once for this visit and keep it in step with the left store (the Capture Line's water). Returns the live deck. */
export function useCounterDeck(): Deck {
  const deck = useDeck()
  useEffect(() => { if (!useDeck.getState().loaded) void useDeck.getState().load() }, [])
  useEffect(() => useLeft.subscribe((s, prev) => { if (s.counters !== prev.counters && s.counters) useDeck.getState().merge(s.counters) }), [])
  return deck
}

export { fresh as freshUndo }
