// Career under the new shell: the pure rules (T02, 19 Nov 2026). Nothing here touches a store or the DOM, so the rules the
// tests name (a figure needs its stamp, the constellation brightness, the gap order, the bridge) are checked on plain data.
import type { Application } from '../../../germoney/game/plan'
import { CHEST_ITEMS } from '../../../germoney/game/trials'
import { addDays, daysBetween, MONTHS } from '../../../germoney/game/util'
import { stageIndex } from '../model'
import type { Cell, FundingSource, RoleProfile } from './store'
import { cellRead, cellReadFor, type CellRead } from './store'

// ---------------------------------------------------------------------------------------------- the Runway's flight board

/** The board shows the next 120 days with a tick every 7 (spec 20.8.6). */
export const HORIZON = 120
export const TICK_EVERY = 7

export interface Notch {
  id: string
  org: string
  /** Where on the axis, 0 to 1. */
  x: number
  days: number
  /** 0 (idea) to 4 (offer): the notch is as tall as the stage is far. */
  stage: number
  /** The closing date was confirmed by hand and stamped; otherwise the notch is dashed. */
  confirmed: boolean
  closes: string
}

/** A closing date counts as confirmed only through the stamped cell of the application, never through the bank's own flag. */
export const appCellKey = (id: string): string => `app:${id}`

export function flightNotches(apps: readonly Application[], today: string, cells: Record<string, Cell>): Notch[] {
  const out: Notch[] = []
  for (const a of apps) {
    const st = stageIndex(a.status)
    if (!a.closes || st === null) continue
    const days = daysBetween(today, a.closes)
    if (days < 0 || days > HORIZON) continue
    out.push({ id: a.id, org: a.org, x: days / HORIZON, days, stage: st, confirmed: cellReadFor(cells, appCellKey(a.id), a.closes).state === 'live', closes: a.closes })
  }
  return out.sort((p, q) => p.days - q.days || p.id.localeCompare(q.id))
}

export interface Tick { day: number; x: number; month: string | null }
export function flightTicks(today: string): Tick[] {
  const out: Tick[] = []
  for (let d = 0; d <= HORIZON; d++) {
    const key = addDays(today, d)
    const first = key.endsWith('-01')
    if (d % TICK_EVERY === 0 || first) out.push({ day: d, x: d / HORIZON, month: first ? MONTHS[Number(key.slice(5, 7)) - 1] : null })
  }
  return out
}

/** How many applications stand at each of the five stages (the five towers). */
export function stageCounts(apps: readonly Application[]): number[] {
  const n = [0, 0, 0, 0, 0]
  for (const a of apps) {
    const i = stageIndex(a.status)
    if (i !== null) n[i] += 1
  }
  return n
}

/** Left and Right move along the axis: the next notch index from the current one, clamped (no wrap, so the ends are felt). */
export const stepNotch = (i: number, dir: -1 | 1, n: number): number => Math.max(0, Math.min(n - 1, i + dir))

// ---------------------------------------------------------------------------------------------- the Ladder's path: roles and gaps

export interface NeedRead { tag: string; node: string | null; evidenced: boolean }
export interface RoleRead { id: string; title: string; needs: NeedRead[]; evidencedN: number; total: number; share: number }

/** A role's brightness is the share of its tags that stand on an EVIDENCED node. A tag with no node cannot be evidenced. */
export function readRoles(roles: readonly RoleProfile[], tagNode: Record<string, string>, evidenced: ReadonlySet<string>): RoleRead[] {
  return roles.map((r) => {
    const needs = r.tags.map((tag) => {
      const node = tagNode[tag] ?? null
      return { tag, node, evidenced: node !== null && evidenced.has(node) }
    })
    const n = needs.filter((x) => x.evidenced).length
    return { id: r.id, title: r.title, needs, evidencedN: n, total: needs.length, share: needs.length ? n / needs.length : 0 }
  })
}

export interface Gap { key: string; label: string; node: string | null; unlocks: number; roles: string[] }

/** What is missing, ranked by how many roles each missing thing unlocks, then by label (stable and visible). */
export function gapList(reads: readonly RoleRead[], nodeName: (id: string) => string): Gap[] {
  const by = new Map<string, Gap>()
  for (const r of reads) {
    for (const need of r.needs) {
      if (need.evidenced) continue
      const key = need.node ?? `tag:${need.tag}`
      const g = by.get(key) ?? { key, label: need.node ? nodeName(need.node) : need.tag, node: need.node, unlocks: 0, roles: [] }
      if (!g.roles.includes(r.id)) { g.roles.push(r.id); g.unlocks += 1 }
      by.set(key, g)
    }
  }
  return [...by.values()].sort((a, b) => b.unlocks - a.unlocks || a.label.localeCompare(b.label))
}

export interface Pt { x: number; y: number }
/** Stars on a sunflower spiral inside an ellipse (deterministic, no overlap for the 8 to 12 roles the spec allows). */
export function starPoints(n: number, w: number, h: number): Pt[] {
  const golden = 2.399963
  return Array.from({ length: n }, (_, i) => {
    const r = Math.sqrt((i + 0.6) / Math.max(1, n)) * 0.27
    return { x: w / 2 + Math.cos(i * golden) * r * w * 1.15, y: h / 2 + Math.sin(i * golden) * r * h * 1.2 }
  })
}
/** The skill nodes sit on an outer ring. */
export function nodePoints(ids: readonly string[], w: number, h: number): Record<string, Pt> {
  const out: Record<string, Pt> = {}
  ids.forEach((id, i) => {
    const a = (i / Math.max(1, ids.length)) * Math.PI * 2 - Math.PI / 2
    out[id] = { x: w / 2 + Math.cos(a) * w * 0.44, y: h / 2 + Math.sin(a) * h * 0.43 }
  })
  return out
}

/** Keyword to node: a node matches when its whole name, or every word of four letters or more of it, is in the text. The student edits the table. */
export function matchJd(text: string, nodes: readonly { id: string; name: string }[]): { tag: string; node: string }[] {
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ')} `
  const out: { tag: string; node: string }[] = []
  for (const n of nodes) {
    const name = n.name.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()
    if (!name) continue
    const words = name.split(' ').filter((w) => w.length >= 4)
    if (hay.includes(` ${name} `) || (words.length > 0 && words.every((w) => hay.includes(w)))) out.push({ tag: n.name, node: n.id })
  }
  return out
}

/**
 * The Tree nodes a pasted job description is matched against: the nodes of the student's own plan state first (with their names from
 * the bank), then every named bank node, and campaign or application nodes only as a fallback. With no campaign and no application
 * (a new student, the empty sandbox) the list is still the Tree itself, so "Match to my nodes" can match from a cold start.
 */
export function treeNodes(stateIds: readonly string[], names: Readonly<Record<string, string>>, fallback: readonly { id: string; name: string }[] = []): { id: string; name: string }[] {
  const m = new Map<string, string>()
  for (const id of stateIds) if (names[id]) m.set(id, names[id])
  for (const [id, name] of Object.entries(names)) if (name && !m.has(id)) m.set(id, name)
  for (const f of fallback) if (f.name && !m.has(f.id)) m.set(f.id, f.name)
  return [...m].map(([id, name]) => ({ id, name }))
}

/** The one sentence that sits with the Ladder, word for word from the spec. */
export const MATCH_NOTE = 'These are skill matches against role profiles you wrote or imported. It is not a prediction of being hired.'

// ---------------------------------------------------------------------------------------------- Abroad: the spec sheet and the rack

export const SPEC_ROWS = [
  { id: 'course', label: 'Course' },
  { id: 'language', label: 'Language of instruction' },
  { id: 'tuition', label: 'Tuition per semester' },
  { id: 'contribution', label: 'Semester contribution' },
  { id: 'window', label: 'Application window' },
  { id: 'exam', label: 'Entrance exam' },
  { id: 'finance', label: 'Proof of finances' },
  { id: 'checked', label: 'Checked on' },
] as const
export type SpecRowId = (typeof SPEC_ROWS)[number]['id']

export const specKey = (uni: string, row: string): string => `${uni}:${row}`

export const RACK_ITEMS = [
  { id: 'language', label: 'Language certificate' },
  { id: 'recognition', label: 'School-leaving recognition' },
  { id: 'transcript', label: 'Transcript translation' },
  { id: 'motivation', label: 'Motivation letter' },
  { id: 'recommend', label: 'Recommendation letters' },
  { id: 'blocked', label: 'Blocked-account proof' },
  { id: 'insurance', label: 'Health insurance proof' },
  { id: 'visa', label: 'Visa slot' },
] as const
export type RackId = (typeof RACK_ITEMS)[number]['id']
/** The visa slot waits for the two proofs it asks for; until then its key is blocked, not off. */
export const RACK_BLOCKED_BY: Partial<Record<RackId, RackId[]>> = { visa: ['blocked', 'insurance'] }

export type RackState = 'on' | 'off' | 'blocked'
export function rackState(id: RackId, done: Record<string, string>, uni: string): RackState {
  if (done[`${uni}:${id}`]) return 'on'
  const need = RACK_BLOCKED_BY[id]
  return need && need.some((n) => !done[`${uni}:${n}`]) ? 'blocked' : 'off'
}

/** Compare mode shows two columns: the pinned one and the next after it. */
export function compareColumns(keys: readonly string[], pinned: string | null): string[] {
  if (keys.length <= 2) return [...keys]
  const first = pinned && keys.includes(pinned) ? pinned : keys[0]
  const second = keys.find((k) => k !== first)!
  return [first, second]
}

/** A pinned university moves to the first column (the sticky one's neighbour). */
export function orderColumns(keys: readonly string[], pinned: string | null): string[] {
  return pinned && keys.includes(pinned) ? [pinned, ...keys.filter((k) => k !== pinned)] : [...keys]
}

// ---------------------------------------------------------------------------------------------- Money: the ledger and the bridge

export interface CostItem { id: string; label: string; due: string; cur: 'INR' | 'EUR'; bank: number | null; custom: boolean; asOf: string | null }
export const costKey = (id: string): string => `cost:${id}`

export function costItems(custom: readonly { id: string; label: string; inr: number; due: string }[]): CostItem[] {
  const fixed = CHEST_ITEMS.map((c) => ({ id: c.id, label: c.label, due: c.due, cur: c.cost.currency, bank: c.cost.amount, custom: false, asOf: c.cost.asOf }))
  const own = custom.map((c) => ({ id: c.id, label: c.label, due: c.due, cur: 'INR' as const, bank: c.inr, custom: true, asOf: null }))
  return [...fixed, ...own].sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
}

export interface CostRow extends CostItem {
  read: CellRead
  /** The confirmed amount in its own currency, or null. */
  amount: number | null
  /** The rupee figure: the amount itself for a rupee item, the amount at the typed rate for a euro item; null when either is unconfirmed. */
  inr: number | null
}

export interface RateRead { value: number | null; on: string | null; live: boolean }
/** The rate is LIVE only when the student typed a value AND a date was stamped with it. */
export function rateRead(value: number, on: string | null): RateRead {
  return on && value > 0 ? { value, on, live: true } : { value: null, on: null, live: false }
}

const num = (s: string): number | null => {
  const n = Number(s.replace(/[, ]/g, ''))
  return Number.isFinite(n) && s.trim() !== '' ? n : null
}

export function costRows(items: readonly CostItem[], cells: Record<string, Cell>, rate: RateRead): CostRow[] {
  return items.map((it) => {
    const read = cellRead(cells, costKey(it.id))
    const amount = read.state === 'live' ? num(read.value) : null
    const inr = amount === null ? null : it.cur === 'INR' ? amount : rate.live && rate.value ? Math.round(amount * rate.value) : null
    return { ...it, read, amount, inr }
  })
}

export interface Totals { inr: number; eur: number; counted: number; unconfirmed: number; needsRate: number }
/** The far bank: only confirmed figures, in rupees at the typed rate. What is left out is counted, never guessed. */
export function totals(rows: readonly CostRow[]): Totals {
  const t: Totals = { inr: 0, eur: 0, counted: 0, unconfirmed: 0, needsRate: 0 }
  for (const r of rows) {
    if (r.amount === null) { t.unconfirmed += 1; continue }
    if (r.cur === 'EUR') t.eur += r.amount
    if (r.inr === null) { t.needsRate += 1; continue }
    t.inr += r.inr
    t.counted += 1
  }
  return t
}

export interface Span { id: string; label: string; inr: number; on: string; kind: 'savings' | FundingSource['kind'] }
export type BridgeState = 'covered' | 'gap' | 'unknown'
export interface Bridge { covered: number; cost: number | null; gap: number | null; state: BridgeState }

/** Covered by the spans; a gap only when a cost is known. With no confirmed cost the bridge says unknown, not zero. */
export function bridge(spans: readonly Span[], cost: number | null): Bridge {
  const covered = spans.reduce((a, s) => a + s.inr, 0)
  if (cost === null || cost <= 0) return { covered, cost: null, gap: null, state: 'unknown' }
  const gap = Math.max(0, cost - covered)
  return { covered, cost, gap, state: gap > 0 ? 'gap' : 'covered' }
}

export const eur = (n: number): string => `€${Math.round(n).toLocaleString('en-IN')}`
export const rupees = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`
