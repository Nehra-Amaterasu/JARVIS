/**
 * The room belief: where movement / presence PROBABLY is, as zones with probabilities.
 * Pure (no three.js) so the dot layout is unit-tested (src/__tests__/belief.test.ts);
 * twin/BeliefCloud.ts draws it.
 *
 * Aankhen sees no body. Wi-Fi CSI says "something moved, and this pattern looks most
 * like the desk", so the twin shows a probability, never a person: a cloud of small
 * dots per zone, dot count ∝ P(zone), scattered with a Gaussian falloff inside the
 * zone's radius. The cloud is tight and breathes slowly when still, and spreads and
 * jitters when the motion score is high; it fades when confidence is low.
 *
 * Data contract (the hub's frame/status field `belief`, x/y/r in room.json metres):
 *   { state: "in_room"|"empty"|"unsure", confidence: 0..1,
 *     zones: [{ id, name, p, x, y, r }], motion: 0..1,
 *     activity: { state, p } | null, updated: t }
 * An older hub sends no `belief`; fallbackBelief() derives the same shape from the
 * learned model's state probabilities (learned.p over desk / bed / room / outside),
 * placed on room.json's places (twin/places.ts).
 */
import { energyToHeat, type Places } from '../twin/places'

/* ------------------------------------------------------------------ the contract */
export type BeliefState = 'in_room' | 'empty' | 'unsure'
export interface BeliefZone { id: string; name: string; p: number; x: number; y: number; r: number }
export interface Belief {
  state: BeliefState
  confidence: number
  zones: BeliefZone[]
  motion: number
  activity: { state: string; p: number } | null
  updated: number
  /** false: the layout is estimated or no zone model has passed the day-7 drill test, so
   *  no zone may be shown or named: the cloud covers the room, "not sure where". */
  zonesTrusted?: boolean
  /** set when an untested model (the day-1 fingerprint CNN) drives the zones: the dots
   *  follow it anyway, and every label says "experimental" */
  experimental?: string | null
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const STATES: readonly string[] = ['in_room', 'empty', 'unsure']

/** Validate and clamp a raw `belief` block; null when it is missing or not one. */
export function readBelief(raw: unknown): Belief | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (!STATES.includes(b.state as string)) return null
  const zones: BeliefZone[] = []
  if (Array.isArray(b.zones)) {
    for (const z of b.zones as Record<string, unknown>[]) {
      if (!z || typeof z !== 'object') continue
      const x = num(z.x, Number.NaN), y = num(z.y, Number.NaN)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const id = String(z.id ?? z.name ?? '')
      zones.push({ id, name: String(z.name ?? id), p: clamp01(num(z.p)), x, y, r: Math.max(0.05, num(z.r, 0.4)) })
    }
  }
  const a = b.activity as Record<string, unknown> | null | undefined
  return {
    state: b.state as BeliefState,
    confidence: clamp01(num(b.confidence)),
    zones,
    motion: clamp01(num(b.motion)),
    activity: a && typeof a === 'object' && typeof a.state === 'string' ? { state: a.state, p: clamp01(num(a.p)) } : null,
    updated: num(b.updated),
    zonesTrusted: b.zones_trusted !== false,
    experimental: typeof b.experimental === 'string' && b.experimental ? b.experimental : null,
  }
}

/* ------------------------------------------------------------------ fallback (older hub) */
export interface LearnedLike {
  t?: number
  state: string
  p: Record<string, number>
  occupied_p: number
  activity?: { state: string; p: Record<string, number> } | null
}

/** learned state -> the zone it means, in my own words. Empty draws nothing. */
export const FALLBACK_ZONES: readonly { state: string; id: string; name: string; place: keyof Places }[] = [
  { state: 'desk', id: 'desk', name: 'at the desk chair', place: 'desk' },
  { state: 'bed', id: 'bed', name: 'on the bed', place: 'bed' },
  { state: 'room', id: 'floor', name: 'on the open floor', place: 'room' },
  { state: 'outside', id: 'door', name: 'out by the door', place: 'door' },
]
// How much each activity moves: the cloud's spread when the energy meter is quiet.
export const ACTIVITY_MOTION: Record<string, number> = { still: 0.08, typing: 0.3, waving: 0.65, walking: 0.9 }
// occupied_p above this is "in the room", below EMPTY_BELOW "empty", between: unsure.
export const IN_ROOM_AT = 0.6
export const EMPTY_BELOW = 0.35

export function fallbackBelief(
  l: LearnedLike | null | undefined,
  hb: { energy?: number | null; recent?: number | null } | null | undefined,
  places: Places | null,
): Belief | null {
  if (!l || !places || !l.p) return null
  const occ = clamp01(num(l.occupied_p))
  const state: BeliefState = occ >= IN_ROOM_AT ? 'in_room' : occ < EMPTY_BELOW ? 'empty' : 'unsure'
  const zones: BeliefZone[] = []
  for (const f of FALLBACK_ZONES) {
    const pl = places[f.place]
    if (!pl) continue
    zones.push({ id: f.id, name: f.name, p: clamp01(num(l.p[f.state])), x: pl.x, y: pl.y, r: pl.r })
  }
  const a = l.activity?.state
  const actP = a ? clamp01(num(l.activity?.p?.[a], 1)) : 0
  const motion = Math.max(energyToHeat(hb), a ? (ACTIVITY_MOTION[a] ?? 0) * actP : 0)
  return {
    state,
    confidence: Math.abs(occ - 0.5) * 2,
    zones,
    motion: clamp01(motion),
    activity: a ? { state: a, p: actP } : null,
    updated: num(l.t),
    zonesTrusted: false,         // an untrained model's place is never shown as a zone
  }
}

/* ------------------------------------------------------------------ the dot layout */
/** Zones at or under this probability get no dots. */
export const MIN_P = 0.03
/** Dots for a belief whose zones add up to 1. */
export const DOTS = 240

/** Dots per zone, ∝ p (largest remainder, so the total is exact): DOTS · Σp over the
 *  visible zones, Σp capped at 1. */
export function dotCounts(zones: readonly { p: number }[], total = DOTS): number[] {
  const ps = zones.map((z) => (z.p > MIN_P ? z.p : 0))
  const sum = ps.reduce((s, p) => s + p, 0)
  if (sum <= 0) return ps.map(() => 0)
  const n = Math.round(total * Math.min(1, sum))
  const exact = ps.map((p) => (n * p) / sum)
  const out = exact.map(Math.floor)
  let left = n - out.reduce((s, v) => s + v, 0)
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) { if (left <= 0) break; if (ps[i] > 0) { out[i]++; left-- } }
  return out
}

/** The fraction of a zone's radius the cloud fills: tight when still, wide when moving. */
export function spreadFor(motion: number): number {
  return 0.45 + 0.55 * clamp01(motion)
}
/** How tall the cloud stands (metres): a low haze when still, a column of activity when moving. */
export function heightFor(motion: number): number {
  return 0.18 + 0.9 * clamp01(motion)
}

/** Per-dot random offsets, fixed for the page: a unit Gaussian (x, y) and a uniform
 *  height in [0, 1). Fixed offsets mean a dot glides between layouts instead of hopping. */
export function dotOffsets(n: number, seed = 7): Float32Array {
  let s = seed >>> 0
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const u = Math.max(1e-9, rnd()), v = rnd()
    const m = Math.sqrt(-2 * Math.log(u))
    out[i * 3] = m * Math.cos(2 * Math.PI * v)
    out[i * 3 + 1] = m * Math.sin(2 * Math.PI * v)
    out[i * 3 + 2] = rnd()
  }
  return out
}

const TRUNC = 1 - Math.exp(-2)             // P(radius < 2σ) for a 2-D unit Gaussian

/**
 * Target positions for every dot (room metres, z up) and whether it is lit (1/0).
 * Zone i takes the next counts[i] dots; each sits at centre + offset · σ with
 * σ = r · spread / 2, drawn from a 2-D Gaussian truncated at 2σ = r · spread, so the
 * cloud is densest at the centre and no dot lands outside the zone. Unlit dots keep their old
 * target (they fade where they are). Returns the number of lit dots.
 */
export function layoutDots(zones: readonly BeliefZone[], motion: number, offsets: Float32Array,
  pos: Float32Array, lit: Float32Array, total = DOTS): number {
  const n = lit.length
  const counts = dotCounts(zones, total)
  const spread = spreadFor(motion), h = heightFor(motion)
  let k = 0
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi], cap = z.r * spread, sigma = cap / 2
    for (let j = 0; j < counts[zi] && k < n; j++, k++) {
      const gx = offsets[k * 3], gy = offsets[k * 3 + 1], rho = Math.hypot(gx, gy)
      // the same quantile of a Gaussian truncated at 2σ: smooth falloff, no rim of clamped dots
      const rt = rho > 1e-9 ? Math.sqrt(-2 * Math.log(1 - (1 - Math.exp(-rho * rho / 2)) * TRUNC)) / rho : 0
      pos[k * 3] = z.x + gx * rt * sigma
      pos[k * 3 + 1] = z.y + gy * rt * sigma
      // low dots are denser: height ~ u² keeps the cloud's weight on the floor
      const u = offsets[k * 3 + 2]
      pos[k * 3 + 2] = 0.03 + h * u * u
      lit[k] = 1
    }
  }
  for (let i = k; i < n; i++) lit[i] = 0
  return k
}

/* ------------------------------------------------------------------ words and colour */
export function topZone(b: Belief | null): BeliefZone | null {
  let best: BeliefZone | null = null
  for (const z of b?.zones ?? []) if (z.p > MIN_P && (!best || z.p > best.p)) best = z
  return best
}

// Below this the top zone is no better than a guess between the four places.
export const TELL_P = 0.3

/** "probably: at the desk chair · 62 %", "probably: nobody in the room · 80 %", or "can't tell". */
export const NOT_SURE_WHERE = 'in the room, not sure where'
/** An untrained model never shows more than this. */
export const UNTRAINED_CAP = 0.9

/** The zones to draw: the belief's own when trusted, else ONE room-wide zone at the
 *  probability-weighted centre, so dots never pile on a place nobody has verified. */
export function shownZones(b: Belief | null): BeliefZone[] {
  if (!b) return []
  if (b.zonesTrusted !== false || b.experimental || !b.zones.length) return b.zones
  const sum = b.zones.reduce((s, z) => s + z.p, 0)
  if (sum <= 0) return []
  const x = b.zones.reduce((s, z) => s + z.p * z.x, 0) / sum
  const y = b.zones.reduce((s, z) => s + z.p * z.y, 0) / sum
  return [{ id: 'room', name: NOT_SURE_WHERE, p: Math.min(1, sum), x, y, r: 1.1 }]
}

export function beliefLabel(b: Belief | null): string {
  if (!b) return "can't tell"
  const pct = (v: number) => `${Math.round(clamp01(v) * 100)} %`
  const untrusted = b.zonesTrusted === false
  if (b.state === 'empty') return `probably: nobody in the room · ${pct(untrusted ? Math.min(b.confidence, UNTRAINED_CAP) : b.confidence)}`
  if (untrusted && b.experimental) {
    const top = topZone(b)
    return top && top.p >= TELL_P ? `maybe: ${top.name} · ${pct(Math.min(top.p, UNTRAINED_CAP))} (experimental)` : NOT_SURE_WHERE
  }
  if (untrusted) return b.state === 'in_room' ? NOT_SURE_WHERE : "can't tell"
  const top = topZone(b)
  if (!top || top.p < TELL_P) return "can't tell"
  return `probably: ${top.name} · ${pct(top.p)}`
}

/** in_room: warm copper; unsure: grey; empty: nothing drawn. */
export const BELIEF_COLOR: Record<BeliefState, string | null> = { in_room: '#d98c52', unsure: '#9aa0a8', empty: null }

/** Dot opacity from confidence: a coin-flip belief is a faint haze, a sure one is clear. */
export function confidenceAlpha(c: number): number {
  const k = clamp01(c)
  return 0.22 + 0.78 * k * k * (3 - 2 * k)
}
