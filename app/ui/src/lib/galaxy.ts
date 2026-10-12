/**
 * The memory galaxy's data side (ROADMAP Y1, Y2): wire types from /api/galaxy and the
 * pure transforms the scene and the growth chart run on. Kept free of three.js and
 * React so every number on screen is unit-tested (src/__tests__/galaxy.test.ts).
 *
 * Colour follows the house rule — colour is provenance:
 *   confirmed  cyan   facts he authored or confirmed
 *   inferred   amber  beliefs he has not confirmed, taste topics named by the model,
 *                     and JARVIS's own past replies (stored back, never verified)
 *   recorded   white  what really happened: his messages, chats, notes, his people
 *   faded      grey   beliefs he marked "used to be true"
 * The "source" colouring is the alternative view, and the growth chart's palette. Its
 * five hues were checked with the dataviz validator on the app's #050506 surface:
 * all inside the dark lightness band, chroma >= 0.1, contrast >= 3:1, worst adjacent
 * CVD dE 15.9 and normal-vision dE 19.7 in this stacking order. The two reserved
 * meanings keep their family: confirmed facts are a cyan step, JARVIS's own replies
 * an amber step.
 */

export type NodeKind = 'memory' | 'person' | 'belief' | 'topic'
export type ColorMode = 'provenance' | 'source'
export type Provenance = 'confirmed' | 'inferred' | 'recorded' | 'faded'

export interface GalaxyNode {
  id: string
  kind: NodeKind
  label: string
  source: string
  time: string | null
  importance: number
  x: number
  y: number
  z: number
  status?: string
}

export interface Growth {
  months: string[]
  families: string[]
  by_source: Record<string, number[]>
  undated: Record<string, number>
  people_new: number[]
  beliefs_updated: number[]
  ingest: { date: string; rows: number }[]
  beliefs_ingest: { date: string; rows: number }[]
  totals: { memories: number; people: number; beliefs: number }
}

export interface GalaxyPayload {
  version: number
  built: string
  build_ms: number
  max_memories: number
  sampled: boolean
  counts: { memories: number; memories_shown: number; people: number; beliefs: number; topics: number; edges: number }
  sources: Record<string, number>
  nodes: GalaxyNode[]
  edges: [number, number][]
  growth: Growth
  cached?: boolean
  stale?: boolean
  took_ms?: number
}

export interface NodeDetail {
  id: string
  kind: NodeKind
  label: string
  time: string | null
  source?: string
  family?: string
  role?: string
  date?: string | null
  last?: string | null
  snippet?: string
  status?: string
  category?: string
  era?: string
  confidence?: number
  support?: number
  closeness?: number
  rank?: number
  n_msgs?: number
  span_days?: number
  why?: string
  words?: string[]
  share?: number
  trend?: string
  links: { id: string; kind: NodeKind; label: string }[]
}

/* ------------------------------------------------------------------ colour */
/** Stacking order of the growth chart = yaadash_galaxy.FAMILIES, then "other". */
export const FAMILIES = ['claude', 'note', 'instagram', 'voice', 'authored', 'other'] as const

export const SOURCE_COLORS: Record<string, string> = {
  claude: '#3987e5',
  note: '#d55181',
  instagram: '#9085e9',
  voice: '#c98500',
  authored: '#139bb9',
  other: '#7a8494',
}

export const SOURCE_LABEL: Record<string, string> = {
  claude: 'Claude chats',
  note: 'Notes',
  instagram: 'Instagram',
  voice: 'JARVIS’s own replies',
  authored: 'Facts he confirmed',
  other: 'Other',
}

export const PROVENANCE_COLORS: Record<Provenance, string> = {
  confirmed: '#5ce1ff',
  inferred: '#ffb020',
  recorded: '#d9dee6',
  faded: '#6b7280',
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  confirmed: 'Confirmed',
  inferred: 'Inferred · unverified',
  recorded: 'Recorded',
  faded: 'Used to be true',
}

export const KIND_LABEL: Record<NodeKind, string> = { memory: 'Memory', person: 'Person', belief: 'Belief', topic: 'Taste topic' }
export const KIND_CODE: Record<NodeKind, number> = { memory: 0, person: 1, belief: 2, topic: 3 }
/** Sprite size per kind before importance: people and topics are hubs, so larger. */
const KIND_SIZE: Record<NodeKind, number> = { memory: 1, person: 2.3, belief: 1.6, topic: 2.1 }

export function provenanceOf(n: Pick<GalaxyNode, 'kind' | 'source' | 'status'>): Provenance {
  switch (n.kind) {
    case 'memory':
      return n.source === 'authored' ? 'confirmed' : n.source === 'voice' ? 'inferred' : 'recorded'
    case 'person':
      return 'recorded'
    case 'belief':
      return n.status === 'confirmed' ? 'confirmed' : n.status === 'outdated' ? 'faded' : 'inferred'
    case 'topic':
      return 'inferred'
  }
}

/** The legend bucket a node falls in under a colour mode (also what a filter hides). */
export function groupOf(n: GalaxyNode, mode: ColorMode): string {
  if (mode === 'provenance') return provenanceOf(n)
  if (n.kind !== 'memory') return n.kind
  return n.source in SOURCE_COLORS ? n.source : 'other'
}

export function colorOf(n: GalaxyNode, mode: ColorMode): string {
  if (mode === 'source' && n.kind === 'memory') return SOURCE_COLORS[n.source] ?? SOURCE_COLORS.other
  return PROVENANCE_COLORS[provenanceOf(n)]
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/* ------------------------------------------------------------------ time */
/** Month slot of a 'YYYY-MM-DD' date; -1 = undated (always shown). Out-of-range dates clamp. */
export function monthIndex(months: string[], date: string | null | undefined, lookup?: Map<string, number>): number {
  if (!date || months.length === 0) return -1
  const ym = date.slice(0, 7)
  const hit = lookup ? lookup.get(ym) : months.indexOf(ym)
  if (hit !== undefined && hit >= 0) return hit
  if (ym < months[0]) return 0
  if (ym > months[months.length - 1]) return months.length - 1
  // inside the range but missing (cannot happen with the server's continuous months)
  let lo = 0
  let hi = months.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (months[mid] < ym) lo = mid + 1
    else hi = mid
  }
  return lo
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function monthLabel(ym: string | undefined): string {
  if (!ym) return '—'
  const m = Number(ym.slice(5, 7))
  return `${MONTH_NAMES[m - 1] ?? '?'} ${ym.slice(0, 4)}`
}

/* ------------------------------------------------------------------ GPU buffers */
export interface Buffers {
  count: number
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  births: Float32Array
  kinds: Float32Array
  edgeCount: number
  edgePositions: Float32Array
  edgeBirths: Float32Array
  radius: number
  /** 90th-percentile distance from the centre: what the camera frames, so a few
   * outliers on the rim do not shrink the galaxy to a dot. */
  fitRadius: number
}

export const WORLD_SCALE = 10

/** Everything the single THREE.Points draw call (and the edge lines) need, in typed
 * arrays laid out once. 10k nodes take a few ms (measured in the unit test). */
export function buildBuffers(p: GalaxyPayload, mode: ColorMode, scale = WORLD_SCALE): Buffers {
  const n = p.nodes.length
  const months = p.growth?.months ?? []
  const lookup = new Map(months.map((m, i) => [m, i]))
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const sizes = new Float32Array(n)
  const births = new Float32Array(n)
  const kinds = new Float32Array(n)
  let r2 = 0
  const radii = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const nd = p.nodes[i]
    const x = nd.x * scale
    const y = nd.y * scale
    const z = nd.z * scale
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
    radii[i] = Math.sqrt(x * x + y * y + z * z)
    r2 = Math.max(r2, x * x + y * y + z * z)
    const [r, g, b] = hexToRgb(colorOf(nd, mode))
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
    const imp = Math.min(1, Math.max(0, nd.importance))
    sizes[i] = KIND_SIZE[nd.kind] * (0.55 + 0.9 * imp)
    births[i] = monthIndex(months, nd.time, lookup)
    kinds[i] = KIND_CODE[nd.kind]
  }
  const edges = p.edges ?? []
  const edgePositions = new Float32Array(edges.length * 6)
  const edgeBirths = new Float32Array(edges.length * 2)
  let m = 0
  for (const [a, b] of edges) {
    if (a < 0 || b < 0 || a >= n || b >= n) continue
    edgePositions.set(positions.subarray(a * 3, a * 3 + 3), m * 6)
    edgePositions.set(positions.subarray(b * 3, b * 3 + 3), m * 6 + 3)
    // An edge exists from the month both of its ends do.
    const born = Math.max(births[a], births[b])
    edgeBirths[m * 2] = born
    edgeBirths[m * 2 + 1] = born
    m++
  }
  return {
    count: n, positions, colors, sizes, births, kinds,
    edgeCount: m, edgePositions: edgePositions.subarray(0, m * 6), edgeBirths: edgeBirths.subarray(0, m * 2),
    radius: Math.sqrt(r2),
    fitRadius: n ? radii.sort()[Math.floor(0.9 * (n - 1))] : 0,
  }
}

/** Re-colour in place (colour-mode switch without rebuilding geometry). */
export function recolor(p: GalaxyPayload, mode: ColorMode, out: Float32Array): Float32Array {
  for (let i = 0; i < p.nodes.length; i++) {
    const [r, g, b] = hexToRgb(colorOf(p.nodes[i], mode))
    out[i * 3] = r
    out[i * 3 + 1] = g
    out[i * 3 + 2] = b
  }
  return out
}

/** 1 = shown, 0 = filtered out by the legend. */
export function visibility(p: GalaxyPayload, mode: ColorMode, hidden: ReadonlySet<string>, out?: Float32Array): Float32Array {
  const v = out ?? new Float32Array(p.nodes.length)
  for (let i = 0; i < p.nodes.length; i++) v[i] = hidden.has(groupOf(p.nodes[i], mode)) ? 0 : 1
  return v
}

/** Each node's birth month slot (-1 = undated), without building GPU buffers. */
export function birthsOf(p: GalaxyPayload): Float32Array {
  const months = p.growth?.months ?? []
  const lookup = new Map(months.map((m, i) => [m, i]))
  const out = new Float32Array(p.nodes.length)
  p.nodes.forEach((n, i) => { out[i] = monthIndex(months, n.time, lookup) })
  return out
}

/** Nodes of each kind that exist by month `month`. */
export function countsAt(p: GalaxyPayload, births: Float32Array, month: number): Record<NodeKind, number> {
  const c: Record<NodeKind, number> = { memory: 0, person: 0, belief: 0, topic: 0 }
  for (let i = 0; i < births.length; i++) if (births[i] <= month) c[p.nodes[i].kind]++
  return c
}

/** How many nodes exist by month `month` (undated ones always do). */
export function visibleAt(births: Float32Array, month: number): number {
  let c = 0
  for (let i = 0; i < births.length; i++) if (births[i] <= month) c++
  return c
}

/** Legend rows: each group with its colour and how many nodes are in it. In source
 * mode people, beliefs and topics keep their provenance colour, so their rows carry
 * the kind (drawn as its shape) instead of a swatch: `color` is null. */
export function legend(p: GalaxyPayload, mode: ColorMode): { key: string; label: string; color: string | null; count: number }[] {
  const counts = new Map<string, number>()
  for (const n of p.nodes) counts.set(groupOf(n, mode), (counts.get(groupOf(n, mode)) ?? 0) + 1)
  if (mode === 'provenance') {
    return (Object.keys(PROVENANCE_COLORS) as Provenance[]).filter((k) => counts.get(k))
      .map((k) => ({ key: k, label: PROVENANCE_LABEL[k], color: PROVENANCE_COLORS[k], count: counts.get(k)! }))
  }
  const rows: { key: string; label: string; color: string | null; count: number }[] = FAMILIES.filter((k) => counts.get(k))
    .map((k) => ({ key: k as string, label: SOURCE_LABEL[k], color: SOURCE_COLORS[k], count: counts.get(k)! }))
  for (const k of ['person', 'belief', 'topic'] as const) {
    if (counts.get(k)) rows.push({ key: k, label: k === 'person' ? 'People' : k === 'belief' ? 'Beliefs' : 'Taste topics', color: null, count: counts.get(k)! })
  }
  return rows
}

/* ------------------------------------------------------------------ morph */
/** Where each node of `next` starts when the layout refreshes: where it was in `prev`
 * (so the galaxy glides to the new layout), and which nodes are new (they pop in). */
export function morphStart(prev: GalaxyPayload | null, prevPositions: Float32Array | null, next: GalaxyPayload,
  nextPositions: Float32Array): { start: Float32Array; fresh: Uint8Array; moved: number } {
  const start = new Float32Array(nextPositions)
  const fresh = new Uint8Array(next.nodes.length)
  if (!prev || !prevPositions) return { start, fresh, moved: 0 }
  const was = new Map<string, number>()
  prev.nodes.forEach((n, i) => was.set(n.id, i))
  let moved = 0
  next.nodes.forEach((n, i) => {
    const j = was.get(n.id)
    if (j === undefined) { fresh[i] = 1; return }
    start[i * 3] = prevPositions[j * 3]
    start[i * 3 + 1] = prevPositions[j * 3 + 1]
    start[i * 3 + 2] = prevPositions[j * 3 + 2]
    moved++
  })
  return { start, fresh, moved }
}

/* ------------------------------------------------------------------ growth chart */
export interface StackLayer { key: string; color: string; label: string; y0: number[]; y1: number[]; total: number }

/** Stacked series for the growth chart, in FAMILIES order (bottom up). Cumulative =
 * how big that part of the brain is by each month; otherwise rows per month. */
export function stackGrowth(g: Growth, cumulative: boolean, hidden: ReadonlySet<string> = new Set()):
  { layers: StackLayer[]; max: number } {
  const n = g.months.length
  const base = new Array<number>(n).fill(0)
  const layers: StackLayer[] = []
  for (const key of FAMILIES) {
    const raw = g.by_source[key]
    if (!raw || hidden.has(key)) continue
    let run = 0
    const series = raw.map((v) => (cumulative ? (run += v) : v))
    const y0 = base.slice()
    const y1 = y0.map((b, i) => b + series[i])
    for (let i = 0; i < n; i++) base[i] = y1[i]
    layers.push({ key, color: SOURCE_COLORS[key], label: SOURCE_LABEL[key], y0, y1, total: raw.reduce((a, b) => a + b, 0) })
  }
  return { layers, max: Math.max(0, ...base) }
}

/** SVG area paths for stacked layers inside a plot box, with the y axis topped at
 * `yTop`. Coordinates are rounded to 0.1 px to keep the strings short. */
export function areaPaths(layers: StackLayer[], box: { left: number; top: number; width: number; height: number }, yTop: number):
  { key: string; color: string; d: string }[] {
  return layers.map((l) => {
    const n = l.y1.length
    if (!n) return { key: l.key, color: l.color, d: '' }
    const X = (i: number) => (box.left + (n <= 1 ? box.width / 2 : (i / (n - 1)) * box.width)).toFixed(1)
    const Y = (v: number) => (box.top + box.height - (v / (yTop || 1)) * box.height).toFixed(1)
    let d = `M${X(0)},${Y(l.y1[0])}`
    for (let i = 1; i < n; i++) d += `L${X(i)},${Y(l.y1[i])}`
    for (let i = n - 1; i >= 0; i--) d += `L${X(i)},${Y(l.y0[i])}`
    return { key: l.key, color: l.color, d: d + 'Z' }
  })
}

/** "Nice" axis maximum and ticks (1, 2, 5 × 10^k). */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

/* ------------------------------------------------------------------ picking */
/** The visible node nearest the pointer on screen, or -1. `mvp` is a column-major
 * projection*view matrix (THREE.Matrix4.elements); x/y in CSS pixels of a w*h canvas.
 * Brute force over every point: ~0.3 ms for 10k, cheaper than a raycaster's per-point
 * world-space test, and it agrees with what the eye sees (screen distance). */
export function pickNearest(positions: Float32Array, births: Float32Array, vis: Float32Array | null, month: number,
  mvp: ArrayLike<number>, w: number, h: number, px: number, py: number, maxPx = 14): number {
  const e = mvp
  let best = -1
  let bestD = maxPx * maxPx
  let bestDepth = Infinity
  const n = births.length
  for (let i = 0; i < n; i++) {
    if (births[i] > month || (vis && vis[i] === 0)) continue
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
    if (cw <= 1e-6) continue
    const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw * 0.5 + 0.5) * w
    const sy = (1 - ((e[1] * x + e[5] * y + e[9] * z + e[13]) / cw * 0.5 + 0.5)) * h
    const dx = sx - px
    const dy = sy - py
    const d = dx * dx + dy * dy
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && cw < bestDepth)) {
      best = i
      bestD = d
      bestDepth = cw
    }
  }
  return best
}

/* ------------------------------------------------------------------ synthetic data */
/** A synthetic galaxy for the frame-rate bench and the tests. Invented; never shown
 * as JARVIS's memory (the bench page says so). Deterministic for a seed. */
export function synthPayload(n: number, seed = 1, monthsCount = 72): GalaxyPayload {
  let s = seed >>> 0 || 1
  const rnd = () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
  const months: string[] = []
  for (let i = 0; i < monthsCount; i++) months.push(`${2020 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`)
  const centers = Array.from({ length: 24 }, () => [gauss() * 0.55, gauss() * 0.55, gauss() * 0.25])
  const fams = ['instagram', 'instagram', 'instagram', 'claude', 'note', 'authored', 'voice']
  const nodes: GalaxyNode[] = []
  const bySource: Record<string, number[]> = {}
  for (let i = 0; i < n; i++) {
    const u = rnd()
    const kind: NodeKind = u < 0.9 ? 'memory' : u < 0.93 ? 'person' : u < 0.98 ? 'belief' : 'topic'
    const c = centers[Math.floor(rnd() * centers.length)]
    const m = Math.floor(rnd() * monthsCount)
    const source = kind === 'memory' ? fams[Math.floor(rnd() * fams.length)] : kind === 'person' ? 'people' : kind === 'topic' ? 'taste' : 'distill'
    if (kind === 'memory') (bySource[source] ??= new Array(monthsCount).fill(0))[m]++
    nodes.push({
      id: `s${i}`, kind, label: `synthetic ${kind} ${i}`, source,
      status: kind === 'belief' ? (rnd() < 0.5 ? 'unconfirmed' : 'confirmed') : kind === 'topic' ? 'inferred' : undefined,
      time: rnd() < 0.02 ? null : `${months[m]}-15`, importance: rnd(),
      x: c[0] + gauss() * 0.12, y: c[1] + gauss() * 0.12, z: c[2] + gauss() * 0.12,
    })
  }
  const edges: [number, number][] = []
  for (let i = 1; i < n; i++) {
    edges.push([i, Math.floor(rnd() * i)])
    if (i % 2) edges.push([i, Math.max(0, i - 1 - Math.floor(rnd() * 20))])
  }
  const families = FAMILIES.filter((f) => bySource[f])
  return {
    version: 1, built: 'synthetic', build_ms: 0, max_memories: n, sampled: false,
    counts: { memories: nodes.filter((x) => x.kind === 'memory').length, memories_shown: nodes.filter((x) => x.kind === 'memory').length,
      people: nodes.filter((x) => x.kind === 'person').length, beliefs: nodes.filter((x) => x.kind === 'belief').length,
      topics: nodes.filter((x) => x.kind === 'topic').length, edges: edges.length },
    sources: {}, nodes, edges,
    growth: {
      months, families: [...families], by_source: bySource, undated: {}, people_new: new Array(monthsCount).fill(0),
      beliefs_updated: new Array(monthsCount).fill(0), ingest: [], beliefs_ingest: [],
      totals: { memories: n, people: 0, beliefs: 0 },
    },
  }
}
