// The Memory section's pure logic (A.J04, spec 20.9.4, D-V2-25): the constellation layout, the strata, the trail, the
// holdings, the two-line diff of a fix and the chips of origin. Nothing here reads the clock, the DOM or the network: the
// same store gives the same picture on every machine, the layout is computed once per change of the store (never a
// physics loop), and the numbers on screen are the store's own counts.
import { fnv1a32, mulberry32 } from '../../shared/grammar'
import type { Fact, GalaxyNode, GalaxyPayload, Origin, Stats } from './types'

/* ------------------------------------------------------------------ the stage box */
export const STAGE_W = 860
export const STAGE_H = 470
/** At most this many nodes are on the stage; more than that and the stage shows clusters with counts (spec 20.9.4). */
export const MAX_NODES = 120
/** The topic wedge of index i points at i x 137.5 degrees, so neighbouring topics never crowd each other. */
export const GOLDEN_DEG = 137.5
const CX = STAGE_W / 2
const CY = STAGE_H / 2
export const RX = 372
export const RY = 200

export const GROUP_WORD: Record<string, string> = {
  claude: 'Claude chats', note: 'Notes', instagram: 'Instagram', voice: 'JARVIS replies', authored: 'Typed facts',
  other: 'Other', people: 'People', beliefs: 'Beliefs', taste: 'Taste',
}
export const groupWord = (g: string): string => GROUP_WORD[g] ?? g
/** The one letter on a node: the source tag, never any stored text. */
export const groupLetter = (g: string): string => (g ? g[0].toUpperCase() : '?')

/** The group a node belongs to: its source for a memory, its kind for the other three. */
export function groupOf(n: Pick<GalaxyNode, 'kind' | 'source'>): string {
  return n.kind === 'memory' ? (n.source || 'other') : n.kind === 'person' ? 'people' : n.kind === 'belief' ? 'beliefs' : 'taste'
}

export const parseTime = (t: string | null | undefined): number | null => {
  if (!t) return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

/* ------------------------------------------------------------------ the constellation */
export interface Placed {
  id: string
  kind: GalaxyNode['kind']
  group: string
  label: string
  source: string
  time: number | null
  x: number
  y: number
  r: number
  /** 1 newest third, 2 middle, 3 oldest third of what is drawn. */
  ring: 1 | 2 | 3
  /** 0 is the newest. */
  rank: number
}
export interface Cluster { group: string; count: number; x: number; y: number; r: number }
export interface GroupInfo { group: string; count: number; index: number; angle: number }
export interface Layout {
  mode: 'nodes' | 'clusters' | 'group'
  placed: Placed[]
  clusters: Cluster[]
  links: [string, string][]
  groups: GroupInfo[]
  /** Nodes of the store that were laid out (the payload's own list; a sampled payload holds fewer than the store). */
  total: number
  /** Nodes drawn as nodes on this stage. */
  drawn: number
  /** In a zoomed group: the older nodes that are not drawn. */
  hidden: number
  zoom: string | null
}

export interface LayoutOpts { zoom?: string | null; max?: number }

const newestFirst = (a: GalaxyNode, b: GalaxyNode): number => {
  const ta = parseTime(a.time)
  const tb = parseTime(b.time)
  if (ta === null && tb === null) return a.id < b.id ? -1 : 1
  if (ta === null) return 1
  if (tb === null) return -1
  return tb - ta || (a.id < b.id ? -1 : 1)
}

/** Size follows the node's weight in the store (the payload's `importance`): there is no recall log yet. */
export const nodeRadius = (importance: number): number => 6 + 7 * Math.sqrt(Math.max(0, Math.min(1, importance || 0)))

export function layoutConstellation(nodes: GalaxyNode[], edges: [number, number][], opts: LayoutOpts = {}): Layout {
  const max = opts.max ?? MAX_NODES
  const zoom = opts.zoom ?? null
  const counts = new Map<string, number>()
  for (const n of nodes) counts.set(groupOf(n), (counts.get(groupOf(n)) ?? 0) + 1)
  const order = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || (a < b ? -1 : 1))
  const groups: GroupInfo[] = order.map((g, i) => ({ group: g, count: counts.get(g)!, index: i, angle: (i * GOLDEN_DEG) % 360 }))
  const gi = new Map(groups.map((g) => [g.group, g]))
  const total = nodes.length

  const base = { groups, total, zoom, links: [] as [string, string][] }
  const pool = (zoom ? nodes.filter((n) => groupOf(n) === zoom) : nodes).slice().sort(newestFirst)

  // above the cap the stage shows one cluster per group; a click zooms into the group
  if (!zoom && pool.length > max) {
    const clusters: Cluster[] = groups.map((g) => {
      const a = (g.angle * Math.PI) / 180
      const spread = 0.34 + 0.5 * Math.sqrt(g.index / Math.max(1, groups.length))
      return { group: g.group, count: g.count, x: CX + RX * spread * Math.cos(a), y: CY + RY * spread * Math.sin(a), r: 16 + 26 * Math.sqrt(g.count / total) }
    })
    return { ...base, mode: 'clusters', placed: [], clusters, drawn: 0, hidden: 0 }
  }

  const drawnNodes = pool.slice(0, max)
  const hidden = pool.length - drawnNodes.length
  const n = drawnNodes.length
  const half = Math.min(30, 150 / Math.max(1, groups.length))
  const placed: Placed[] = drawnNodes.map((node, rank) => {
    const g = groupOf(node)
    const rnd = mulberry32(fnv1a32(node.id))
    const t = n > 1 ? Math.sqrt(rank / (n - 1)) : 0
    let deg: number
    let rr: number
    if (zoom) {
      // one group: the sunflower, the golden angle again, newest in the middle
      deg = (rank * GOLDEN_DEG) % 360
      rr = 0.08 + 0.9 * t
    } else {
      deg = gi.get(g)!.angle + (rnd() * 2 - 1) * half
      rr = 0.1 + 0.88 * t + (rnd() - 0.5) * 0.04
    }
    const a = (deg * Math.PI) / 180
    return {
      id: node.id, kind: node.kind, group: g, label: node.label, source: node.source, time: parseTime(node.time),
      x: Math.round((CX + RX * rr * Math.cos(a)) * 10) / 10, y: Math.round((CY + RY * rr * Math.sin(a)) * 10) / 10,
      r: Math.round(nodeRadius(node.importance) * 10) / 10, ring: (rank < n / 3 ? 1 : rank < (2 * n) / 3 ? 2 : 3) as 1 | 2 | 3, rank,
    }
  })
  const at = new Map(placed.map((p) => [p.id, p]))
  const links: [string, string][] = []
  for (const [i, j] of edges) {
    const a = nodes[i]?.id
    const b = nodes[j]?.id
    if (a && b && a !== b && at.has(a) && at.has(b)) links.push(a < b ? [a, b] : [b, a])
    if (links.length >= 260) break
  }
  return { ...base, mode: zoom ? 'group' : 'nodes', placed, clusters: [], links, drawn: placed.length, hidden }
}

export const layoutOf = (g: GalaxyPayload, opts: LayoutOpts = {}): Layout => layoutConstellation(g.nodes, g.edges, opts)

/** Arrow keys: the nearest node in that direction (along the key, with the cross distance counted double). */
export function nearestInDirection(placed: readonly Pick<Placed, 'id' | 'x' | 'y' | 'rank'>[], fromId: string | null, dir: 'left' | 'right' | 'up' | 'down'): string | null {
  if (!placed.length) return null
  const from = placed.find((p) => p.id === fromId)
  if (!from) return placed.reduce((a, b) => (a.rank <= b.rank ? a : b)).id
  let best: { id: string; s: number } | null = null
  for (const p of placed) {
    if (p.id === from.id) continue
    const dx = p.x - from.x
    const dy = p.y - from.y
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 1) continue
    const s = along + 2 * across
    if (!best || s < best.s || (s === best.s && p.id < best.id)) best = { id: p.id, s }
  }
  return best?.id ?? null
}

/** Neighbours of a node in the drawn links (hover dims everything else to 30 percent). */
export function neighboursOf(links: readonly [string, string][], id: string | null): Set<string> {
  const out = new Set<string>()
  if (!id) return out
  out.add(id)
  for (const [a, b] of links) {
    if (a === id) out.add(b)
    else if (b === id) out.add(a)
  }
  return out
}

/* ------------------------------------------------------------------ recall: which nodes light, and the path */
const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The drawn nodes whose snippet is the start of a recalled fact (or the other way round), in the fact's rank order. */
export function litFromFacts(placed: readonly Placed[], facts: readonly Fact[]): string[] {
  const out: string[] = []
  const heads = placed.map((p) => ({ id: p.id, h: norm(p.label).slice(0, 36) })).filter((x) => x.h.length >= 8)
  for (const f of facts) {
    const t = norm(f.text)
    if (t.length < 8) continue
    const hit = heads.find((x) => !out.includes(x.id) && (t.startsWith(x.h) || x.h.startsWith(t.slice(0, 36))))
    if (hit) out.push(hit.id)
  }
  return out
}

/** The dotted path through the lit nodes, in rank order. Empty for fewer than two. */
export function pathThrough(placed: readonly Placed[], ids: readonly string[]): string {
  const pts = ids.map((id) => placed.find((p) => p.id === id)).filter((p): p is Placed => !!p)
  if (pts.length < 2) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
}

/* ------------------------------------------------------------------ strata: months as bands */
export interface Band { ym: string; label: string; count: number; byGroup: Record<string, number> }
export interface Strata { bands: Band[]; undated: number; max: number; total: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const ymOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export const monthLabel = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5)} ${ym.slice(0, 4)}`

/** The last `months` months that hold anything, newest first, with the quiet months in between kept as empty bands. */
export function strataOf(nodes: readonly Pick<GalaxyNode, 'kind' | 'source' | 'time'>[], months = 12): Strata {
  const by = new Map<string, Record<string, number>>()
  let undated = 0
  for (const n of nodes) {
    const t = parseTime(n.time)
    if (t === null) { undated++; continue }
    const k = ymOf(t)
    const rec = by.get(k) ?? {}
    const g = groupOf(n)
    rec[g] = (rec[g] ?? 0) + 1
    by.set(k, rec)
  }
  const keys = [...by.keys()].sort()
  if (!keys.length) return { bands: [], undated, max: 0, total: 0 }
  const out: Band[] = []
  let [y, m] = keys[keys.length - 1].split('-').map(Number)
  for (let i = 0; i < months; i++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    if (ym < keys[0]) break
    const rec = by.get(ym) ?? {}
    out.push({ ym, label: monthLabel(ym), count: Object.values(rec).reduce((a, b) => a + b, 0), byGroup: rec })
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  const total = out.reduce((a, b) => a + b.count, 0)
  return { bands: out, undated, max: Math.max(1, ...out.map((b) => b.count)), total }
}

/** Dither cells of one band: `n` of `cols` x `rows` lit by an ordered 4x4 threshold, so equal density is equal ink. */
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
export function ditherCells(density: number, cols: number, rows: number): [number, number][] {
  const d = Math.max(0, Math.min(1, density))
  const out: [number, number][] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if ((BAYER4[r % 4][c % 4] + 0.5) / 16 <= d) out.push([c, r])
  return out
}

/* ------------------------------------------------------------------ the trail: the last 30 recalls of this session */
export const TRAIL_MAX = 30
export const TRAIL_ITEMS = 6
export interface Recall { n: number; q: string; at: number; hits: number }

/** Push a recall; the oldest leave past 30. Held in memory for the session only: a trail is not a streak. */
export function pushRecall(list: readonly Recall[], q: string, hits: number, at: number): Recall[] {
  const n = (list[list.length - 1]?.n ?? 0) + 1
  return [...list, { n, q, at, hits }].slice(-TRAIL_MAX)
}

export interface TrailArc { n: number; q: string; x: number; base: number; dots: { rank: number; x: number; y: number }[]; path: string }
/** An arc per recall: it leaves the query tick on the ruler and passes through its items in rank order, numbered 1 to n. */
export function trailLayout(list: readonly Recall[], w = STAGE_W - 40, base = 222): TrailArc[] {
  const slot = w / TRAIL_MAX
  return list.map((r, i) => {
    const x = 20 + slot * (i + 0.5)
    const k = Math.min(TRAIL_ITEMS, r.hits)
    const dots = Array.from({ length: k }, (_, j) => ({ rank: j + 1, x: x + (j % 2 ? 4 : -4), y: base - 28 - j * 28 }))
    const path = dots.length ? `M${x} ${base} ${dots.map((d) => `L${d.x} ${d.y}`).join(' ')}` : ''
    return { n: r.n, q: r.q, x, base, dots, path }
  })
}

/* ------------------------------------------------------------------ holdings */
export interface HoldingRow { id: string; label: string; n: number | null; note: string }
/** The counts of the store, each one a number the store reported; the Keep vault and the Recall pane print these. */
export function holdingsOf(stats: Stats | null, g: GalaxyPayload | null): HoldingRow[] {
  const beliefs = stats?.beliefs ?? null
  const bTotal = beliefs ? Object.values(beliefs).reduce((a, b) => a + b, 0) : g?.counts.beliefs ?? null
  return [
    { id: 'facts', label: 'Facts in memory', n: stats?.memories ?? g?.counts.memories ?? null, note: stats?.memory_sources ? `${Object.keys(stats.memory_sources).length} sources` : 'by source' },
    { id: 'messages', label: 'Messages archived', n: stats?.archive_messages ?? null, note: stats?.threads != null ? `${stats.threads} conversations` : 'conversations' },
    { id: 'people', label: 'People', n: stats?.people ?? g?.counts.people ?? null, note: stats?.people_scored != null ? `${stats.people_scored} scored` : 'threads' },
    { id: 'beliefs', label: 'Beliefs', n: bTotal, note: beliefs ? `${beliefs.unconfirmed ?? 0} waiting · ${beliefs.confirmed ?? 0} confirmed` : 'inferred' },
    { id: 'taste', label: 'Taste topics', n: stats?.taste_topics ?? g?.counts.topics ?? null, note: stats?.taste_captions != null ? `from ${stats.taste_captions} liked posts` : 'inferred' },
  ]
}

/** The constellation never invents a node: drawn nodes plus the nodes inside clusters plus the hidden older ones equal the nodes laid out. */
export function nodeCountEqualsStore(l: Layout): boolean {
  const inClusters = l.clusters.reduce((a, c) => a + c.count, 0)
  const inGroup = l.zoom ? l.groups.find((g) => g.group === l.zoom)?.count ?? 0 : l.total
  return l.mode === 'clusters' ? inClusters === l.total : l.drawn + l.hidden === inGroup
}

/** "sampled": the payload holds fewer memories than the store, and the stage says so rather than passing the sample as the whole. */
export function sampleLine(g: GalaxyPayload): string | null {
  return g.sampled || g.counts.memories_shown < g.counts.memories
    ? `${g.counts.memories_shown.toLocaleString('en-IN')} of ${g.counts.memories.toLocaleString('en-IN')} memories laid out`
    : null
}

/* ------------------------------------------------------------------ fix: the two-line diff */
export interface Seg { t: string; k: 'same' | 'del' | 'add' }
const WORDS = 160
/** Old line with the removed words marked, new line with the added words marked (an LCS over words). */
export function twoLineDiff(before: string, after: string): { old: Seg[]; next: Seg[] } {
  const a = before.trim().split(/\s+/).filter(Boolean).slice(0, WORDS)
  const b = after.trim().split(/\s+/).filter(Boolean).slice(0, WORDS)
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const old: Seg[] = []
  const next: Seg[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { old.push({ t: a[i], k: 'same' }); next.push({ t: b[j], k: 'same' }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) old.push({ t: a[i++], k: 'del' })
    else next.push({ t: b[j++], k: 'add' })
  }
  while (i < a.length) old.push({ t: a[i++], k: 'del' })
  while (j < b.length) next.push({ t: b[j++], k: 'add' })
  return { old, next }
}

export const FIX_DAYS = 7
export interface FixRow { id: string; node: string; before: string; after: string; at: number }
const DAY = 86_400_000
/** One local history row per edit; rows older than seven days are dropped, and so is the undo they carried. */
export function pruneFixes(rows: readonly FixRow[], now: number): FixRow[] {
  return rows.filter((r) => now - r.at < FIX_DAYS * DAY && r.at <= now + DAY)
}
export function addFix(rows: readonly FixRow[], row: FixRow, now: number): FixRow[] {
  return pruneFixes([...rows.filter((r) => r.id !== row.id), row], now).slice(-60)
}
export const removeFix = (rows: readonly FixRow[], id: string): FixRow[] => rows.filter((r) => r.id !== id)
export const fixesFor = (rows: readonly FixRow[], node: string): FixRow[] => rows.filter((r) => r.node === node).sort((a, b) => b.at - a.at)

/* ------------------------------------------------------------------ delete: the confirm names the count */
export function deleteLine(count: number, remaining: number | null): string {
  const what = count === 1 ? '1 item' : `${count} items`
  const left = remaining === null ? '' : ` ${Math.max(0, remaining).toLocaleString('en-IN')} stay.`
  return `This removes ${what} from what JARVIS holds.${left} There is no undo for a delete.`
}

/* ------------------------------------------------------------------ chips of origin */
/** RULE when the store says a rule wrote it, HAND when the owner confirmed or typed it, MODEL otherwise. */
export function originOf(o: { status?: string | null; source?: string | null; by?: string | null; kind?: string | null }): Origin {
  const src = (o.source ?? '').toLowerCase()
  if (src.startsWith('rule')) return 'RULE'
  if (o.status === 'confirmed' || src.startsWith('authored') || src === 'typed') return 'HAND'
  if (o.by && o.by !== 'model') return 'HAND'
  if (o.kind === 'correction' || o.kind === 'instruction') return 'HAND'
  return 'MODEL'
}

/* ------------------------------------------------------------------ search words, as the classic page marked them */
const STOP = new Set(['what', 'did', 'about', 'with', 'that', 'this', 'have'])
export const queryTerms = (q: string): string[] => q.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w))
export function highlightParts(text: string, terms: string[]): { t: string; hit: boolean }[] {
  if (!terms.length) return [{ t: text, hit: false }]
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).filter((p) => p !== '').map((t) => ({ t, hit: terms.some((w) => w === t.toLowerCase()) }))
}

export const fmtDay = (ms: number | null): string => {
  if (ms === null) return 'undated'
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
export const fmtN = (n: number | null | undefined): string => (n === null || n === undefined ? 'no reading' : n.toLocaleString('en-IN'))

/** "in 18 min", "in 1 h 35 min", "in 2 days": when a reminder is due, said the way a person would (epoch seconds). */
export function relDue(due: number, now: number): string {
  const s = Math.round(due - now)
  if (s <= 0) return 'due now'
  const m = Math.round(s / 60)
  if (m < 1) return 'in under a minute'
  if (m < 60) return `in ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`
  const d = Math.round(h / 24)
  return `in ${d} day${d === 1 ? '' : 's'}`
}
