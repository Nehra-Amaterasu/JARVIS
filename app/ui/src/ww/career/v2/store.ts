// Career under the new shell: what the student confirms by hand, kept on this device (T02, 19 Nov 2026).
//
// Three things have no engine route yet and must still be honest: the "checked on" stamp of a university cell, the requirement
// keys of a university's rack, and the funding sources the student states. They live in one small local store behind the
// adapter below; when the engine lane lists a route for them (docs/design/well-wisher-engine-plan.md) only `adapter` changes.
// Nothing here is read from the network and nothing is invented: a cell is LIVE only when the student typed the value from the
// page and a date was stamped with it, otherwise it is WAITING "unconfirmed".
import { create } from 'zustand'

/** One confirmed cell: the value as the student read it from the university's own page, and the day they checked it. */
export interface Cell { value: string; on: string }
/** A role the student wrote or imported: a title and the skill tags it needs (Q-V2-10). */
export interface RoleProfile { id: string; title: string; tags: string[] }
export type FundingKind = 'family' | 'scholarship' | 'work' | 'loan'
/** A funding source the student states. `on` is the day they stated or last confirmed it. */
export interface FundingSource { id: string; label: string; kind: FundingKind; inr: number; on: string; deadline?: string }

export interface CareerLocal {
  /** `<uni>:<row>` and `app:<id>` to a confirmed cell. */
  cells: Record<string, Cell>
  /** `<uni>:<requirement>` to the day it was marked done. */
  done: Record<string, string>
  /** University keys on the shortlist, in column order (at most 6). */
  shortlist: string[]
  pinned: string | null
  roles: RoleProfile[]
  /** A skill tag to the Tree node the student linked it to. */
  tagNode: Record<string, string>
  funding: FundingSource[]
  /** The day the rupees-per-euro rate was typed, and where it came from. */
  rate: { on: string | null; source: string }
  /** A certificate's local scan path and expiry, as typed. */
  certs: Record<string, { scan: string; expiry: string }>
}

export const EMPTY: CareerLocal = { cells: {}, done: {}, shortlist: [], pinned: null, roles: [], tagNode: {}, funding: [], rate: { on: null, source: '' }, certs: {} }

const KEY = 'ww.career.v2'
export const MAX_COLS = 6

const read = (): CareerLocal => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const p = JSON.parse(raw) as Partial<CareerLocal>
    return { ...EMPTY, ...p, rate: { ...EMPTY.rate, ...(p.rate ?? {}) } }
  } catch {
    return EMPTY
  }
}
const write = (s: CareerLocal) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private window or blocked storage: the page keeps working for the session */ }
}

/** The adapter: the one place that would call an engine route. Null until one is merged. */
export const adapter: { load: () => CareerLocal; save: (s: CareerLocal) => void } = { load: read, save: write }

interface Actions {
  confirmCell: (key: string, value: string, on: string) => void
  clearCell: (key: string) => void
  setDone: (key: string, on: string | null) => void
  setShortlist: (keys: string[]) => void
  pin: (key: string | null) => void
  addRole: (r: RoleProfile) => void
  removeRole: (id: string) => void
  setTagNode: (tag: string, node: string | null) => void
  addFunding: (f: FundingSource) => void
  removeFunding: (id: string) => void
  setRate: (on: string | null, source: string) => void
  setCert: (id: string, scan: string, expiry: string) => void
}

const pick = (s: CareerLocal & Actions): CareerLocal => ({ cells: s.cells, done: s.done, shortlist: s.shortlist, pinned: s.pinned, roles: s.roles, tagNode: s.tagNode, funding: s.funding, rate: s.rate, certs: s.certs })

export const useCareerLocal = create<CareerLocal & Actions>((set, get) => {
  const commit = (patch: Partial<CareerLocal>) => {
    set(patch)
    adapter.save(pick(get()))
  }
  return {
    ...adapter.load(),
    confirmCell: (key, value, on) => commit({ cells: { ...get().cells, [key]: { value: value.trim(), on } } }),
    clearCell: (key) => { const c = { ...get().cells }; delete c[key]; commit({ cells: c }) },
    setDone: (key, on) => { const d = { ...get().done }; if (on) d[key] = on; else delete d[key]; commit({ done: d }) },
    setShortlist: (keys) => commit({ shortlist: keys.slice(0, MAX_COLS) }),
    pin: (key) => commit({ pinned: key }),
    addRole: (r) => commit({ roles: [...get().roles.filter((x) => x.id !== r.id), r] }),
    removeRole: (id) => commit({ roles: get().roles.filter((x) => x.id !== id) }),
    setTagNode: (tag, node) => { const m = { ...get().tagNode }; if (node) m[tag] = node; else delete m[tag]; commit({ tagNode: m }) },
    addFunding: (f) => commit({ funding: [...get().funding.filter((x) => x.id !== f.id), f] }),
    removeFunding: (id) => commit({ funding: get().funding.filter((x) => x.id !== id) }),
    setRate: (on, source) => commit({ rate: { on, source } }),
    setCert: (id, scan, expiry) => commit({ certs: { ...get().certs, [id]: { scan, expiry } } }),
  }
})

// ---------------------------------------------------------------------------------------------- pure rules

export type CellState = 'live' | 'waiting'
export interface CellRead { state: CellState; value: string; on: string | null }

/** LIVE only with a value AND the day it was checked; anything less is WAITING. The rule of the whole package, in one place. */
export function cellRead(cells: Record<string, Cell>, key: string): CellRead {
  const c = cells[key]
  return c && c.value.trim() && c.on ? { state: 'live', value: c.value, on: c.on } : { state: 'waiting', value: '', on: null }
}

/**
 * A cell read against the figure the page shows NOW. The stamp vouches only for the value the student typed on the day they
 * checked: when the list's figure is different (an edit, a refreshed list) the cell is WAITING with `stale` set, never LIVE.
 */
export function cellReadFor(cells: Record<string, Cell>, key: string, current: string): CellRead & { stale: boolean } {
  const r = cellRead(cells, key)
  if (r.state === 'live' && r.value.trim() !== current.trim()) return { state: 'waiting', value: '', on: null, stale: true }
  return { ...r, stale: false }
}
export const STALE_WHY = 'date changed since you checked it'

/** The one verified figure of the package, quoted with its source as the spec gives it. */
export const VERIFIED_FACT = {
  label: 'Proof of finances, per year',
  amountEur: 10332,
  checkedOn: '2026-11-13',
  source: 'https://www.study-in-germany.com/en/plan-your-studies/requirements/',
  sourceName: 'the national study portal',
  note: 'The page gave no language levels and no semester fee, so those stay unconfirmed until you confirm them from the university\'s own page.',
} as const

/** A short, stable key for a university or any free name. */
export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

export const stampText = (on: string): string => {
  const [y, m, d] = on.split('-').map(Number)
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return y && m && d ? `${d} ${M[m - 1]} ${y}` : on
}
