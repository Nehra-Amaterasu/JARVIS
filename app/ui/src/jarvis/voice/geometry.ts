// Signal to geometry, exactly (spec 9.5, 9.7, 9.10). Pure functions of real frames (or of a fixed table): no clock, no
// randomness beyond the seeded jitter table, no DOM. The same input is always the same Float32Array, byte for byte
// (test V-05), and none of it invents energy: a layer with no real frame is absent, not filled in.
import {
  HILL_BASELINE, HILL_CENTER_X, HILL_HALF_W, HILL_JITTER_SEED, HILL_JITTER_X, HILL_JITTER_Y, HILL_LAYER_DROP_Y, HILL_LAYER_SHRINK, HILL_MAX_H,
  HILL_STIPPLES, HILL_STIPPLE_FRACTION, N_BANDS, PEAK_FALL_DB_PER_S, PEAK_HOLD_MS, PH_BASE, PH_BREATH_AMP, PH_BREATH_MS, PH_BREATH_PERIOD_MS,
  PH_BUMP, PH_RING_BREATH_PX, QUALITY, RING_BAR_MIN, RING_BAR_SPAN, RING_BARS, RING_BASE_R, RING_CX, RING_CY, RING_STEP_DEG, T0_COLS, T0_FULL_SCALE,
  T0_WINDOW_MS, THINK_MARK_BARS, THINK_MARK_MS, THINK_ORBIT_MS, type Quality,
} from './constants'
import { lerpBand } from './bands'

/** mulberry32: a 32-bit seeded generator; the same seed gives the same table on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const JITTER_N = QUALITY.high.points
let jitter: { x: Float32Array; y: Float32Array } | null = null

/** The jitter table, generated once with mulberry32(0x5EED): Y plus or minus 0.04 of the stipple fraction, X plus or minus 0.8 px. */
export function jitterTable(): { x: Float32Array; y: Float32Array } {
  if (!jitter) {
    const r = mulberry32(HILL_JITTER_SEED)
    const x = new Float32Array(JITTER_N)
    const y = new Float32Array(JITTER_N)
    for (let i = 0; i < JITTER_N; i++) {
      y[i] = (r() * 2 - 1) * HILL_JITTER_Y
      x[i] = (r() * 2 - 1) * HILL_JITTER_X
    }
    jitter = { x, y }
  }
  return jitter
}

export interface Points {
  count: number
  x: Float32Array
  y: Float32Array
  /** Depth layer of each point (0 = now), which picks the alpha bucket and the point size. */
  layer: Uint8Array
}

const emptyPoints = (n: number): Points => ({ count: 0, x: new Float32Array(n), y: new Float32Array(n), layer: new Uint8Array(n) })
const trim = (p: Points): Points => (p.count === p.x.length ? p : { count: p.count, x: p.x.slice(0, p.count), y: p.y.slice(0, p.count), layer: p.layer.slice(0, p.count) })

/** Column position in [-1, 1]. */
export const colX = (c: number, cols: number): number => (c - (cols - 1) / 2) / ((cols - 1) / 2)
/** Band position of a column: low frequencies at the centre, 8 kHz at the edges, mirrored (stated in the legend). */
export const colBand = (xc: number): number => Math.abs(xc) * (N_BANDS - 1)
export const layerScale = (j: number): number => 1 - HILL_LAYER_SHRINK * j
export const layerBase = (j: number): number => HILL_BASELINE - HILL_LAYER_DROP_Y * j

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * The spectrum hill. `rows[j]` is the smoothed 24-band row for layer j (0 = now) or null when no real frame exists for
 * that time; a null row draws nothing. There is deliberately no taper: a flat spectrum looks flat.
 */
export function hillGeometry(rows: readonly (ArrayLike<number> | null)[], quality: Quality = 'high'): Points {
  const { cols, layers } = QUALITY[quality]
  const jt = jitterTable()
  const out = emptyPoints(cols * layers * HILL_STIPPLES)
  for (let j = 0; j < layers; j++) {
    const row = rows[j]
    if (!row) continue
    const sj = layerScale(j)
    const base = layerBase(j)
    for (let c = 0; c < cols; c++) {
      const xc = colX(c, cols)
      const H = HILL_MAX_H * clamp01(lerpBand(row, colBand(xc)) / 255)
      for (let s = 0; s < HILL_STIPPLES; s++) {
        const k = (j * cols + c) * HILL_STIPPLES + s
        const n = out.count++
        out.x[n] = HILL_CENTER_X + xc * HILL_HALF_W * sj + jt.x[k]
        out.y[n] = base - (HILL_STIPPLE_FRACTION[s] + jt.y[k]) * H * sj
        out.layer[n] = j
      }
    }
  }
  return trim(out)
}

/**
 * Tier 0, the envelope: x is time, not frequency (a scalar cannot make a spectrum). Column c shows the level
 * `|x_c| * 2.4 s` ago, linearly interpolated between real samples; a column older than the first sample, or newer than
 * nothing, is absent. One layer, 4 stipples: at most 384 points.
 */
export function envelopeGeometry(samples: readonly (readonly [number, number])[], now: number): Points {
  const jt = jitterTable()
  const out = emptyPoints(T0_COLS * HILL_STIPPLES)
  if (!samples.length) return trim(out)
  for (let c = 0; c < T0_COLS; c++) {
    const xc = colX(c, T0_COLS)
    const at = now - Math.abs(xc) * T0_WINDOW_MS
    const level = levelAt(samples, at)
    if (level === null) continue
    const H = HILL_MAX_H * clamp01(level / T0_FULL_SCALE)
    for (let s = 0; s < HILL_STIPPLES; s++) {
      const k = c * HILL_STIPPLES + s
      const n = out.count++
      out.x[n] = HILL_CENTER_X + xc * HILL_HALF_W + jt.x[k]
      out.y[n] = HILL_BASELINE - (HILL_STIPPLE_FRACTION[s] + jt.y[k]) * H
    }
  }
  return trim(out)
}

/** Real samples only: before the first sample null; between two, linear; at or after the newest, the newest (never extrapolated). */
function levelAt(samples: readonly (readonly [number, number])[], at: number): number | null {
  if (at < samples[0][0]) return null
  for (let i = samples.length - 1; i >= 0; i--) {
    const [t, v] = samples[i]
    if (t <= at) {
      const next = samples[i + 1]
      if (!next) return v
      const u = (at - t) / (next[0] - t)
      return v + (next[1] - v) * u
    }
  }
  return null
}

/** The placeholder mound, 10 to 18 % of the height: `v_ph(u) = 0.10 + 0.08 cos^2(pi u / 2)`, u = |x_c|. A fixed table. */
export const placeholderValue = (u: number): number => PH_BASE + PH_BUMP * Math.cos((Math.PI * u) / 2) ** 2

/** The breath factor of the placeholder: 1 + 0.25 sin(2 pi t / 2.5 s) for two cycles since the state began, then exactly 1. Off unless `enabled`. */
export function breathFactor(sinceStateMs: number, enabled: boolean): number {
  if (!enabled || sinceStateMs >= PH_BREATH_MS) return 1
  return 1 + PH_BREATH_AMP * Math.sin((2 * Math.PI * Math.max(0, sinceStateMs)) / PH_BREATH_PERIOD_MS)
}

/** The quiet fallback hill: one layer of the fixed mound, scaled by the breath. Drawn hollow, never cyan. */
export function placeholderHill(quality: Quality = 'high', breath = 1): Points {
  const { cols } = QUALITY[quality]
  const jt = jitterTable()
  const out = emptyPoints(cols * HILL_STIPPLES)
  for (let c = 0; c < cols; c++) {
    const xc = colX(c, cols)
    const H = HILL_MAX_H * placeholderValue(Math.abs(xc)) * breath
    for (let s = 0; s < HILL_STIPPLES; s++) {
      const k = c * HILL_STIPPLES + s
      const n = out.count++
      out.x[n] = HILL_CENTER_X + xc * HILL_HALF_W + jt.x[k]
      out.y[n] = HILL_BASELINE - (HILL_STIPPLE_FRACTION[s] + jt.y[k]) * H
    }
  }
  return trim(out)
}

// --- the ring ---

/** Bar lengths from one band row: `ell = 4 + 32 v(p)`, mirrored index m = min(k, 96 - k), p = (m / 48) * 23. */
export function ringLengthsBands(row: ArrayLike<number>): Float32Array {
  const out = new Float32Array(RING_BARS)
  for (let k = 0; k < RING_BARS; k++) {
    const m = Math.min(k, RING_BARS - k)
    out[k] = RING_BAR_MIN + RING_BAR_SPAN * clamp01(lerpBand(row, (m / (RING_BARS / 2)) * (N_BANDS - 1)) / 255)
  }
  return out
}

/** Tier 0 "level ring": 96 bars of equal length proportional to the level (0..1). */
export const ringLengthsLevel = (v01: number): Float32Array => new Float32Array(RING_BARS).fill(RING_BAR_MIN + RING_BAR_SPAN * clamp01(v01))

/** The placeholder ring: 96 bars at the minimum length, plus up to 2 px of breath over the same 5 s (`breath` in 0..1). */
export const ringLengthsPlaceholder = (breath01 = 0): Float32Array => new Float32Array(RING_BARS).fill(RING_BAR_MIN + PH_RING_BREATH_PX * clamp01(breath01))

/** The ring placeholder's breath as 0..1, zero at the start, zero again after two cycles: the static form equals the table. */
export function ringBreath(sinceStateMs: number, enabled: boolean): number {
  if (!enabled || sinceStateMs >= PH_BREATH_MS) return 0
  return 0.5 * (1 - Math.cos((2 * Math.PI * Math.max(0, sinceStateMs)) / PH_BREATH_PERIOD_MS))
}

export interface RingBars {
  count: number
  x0: Float32Array
  y0: Float32Array
  x1: Float32Array
  y1: Float32Array
  /** True when the bar's midpoint is below the hill baseline: drawn at half alpha (9.4). */
  below: Uint8Array
}

/** Bar k sits at angle -90 deg + 3.75 deg k (k = 0 at the top, clockwise), from radius 128 outward by its length. */
export function ringBars(lengths: ArrayLike<number>): RingBars {
  const out: RingBars = { count: RING_BARS, x0: new Float32Array(RING_BARS), y0: new Float32Array(RING_BARS), x1: new Float32Array(RING_BARS), y1: new Float32Array(RING_BARS), below: new Uint8Array(RING_BARS) }
  for (let k = 0; k < RING_BARS; k++) {
    const a = ((-90 + RING_STEP_DEG * k) * Math.PI) / 180
    const cx = Math.cos(a)
    const sy = Math.sin(a)
    out.x0[k] = RING_CX + cx * RING_BASE_R
    out.y0[k] = RING_CY + sy * RING_BASE_R
    out.x1[k] = RING_CX + cx * (RING_BASE_R + lengths[k])
    out.y1[k] = RING_CY + sy * (RING_BASE_R + lengths[k])
    out.below[k] = (out.y0[k] + out.y1[k]) / 2 > HILL_BASELINE ? 1 : 0
  }
  return out
}

/** The three bars of the thinking marker: one orbit per 2.4 s for at most 5 s, then fixed at the top. It encodes "working", never a level. */
export function thinkingMarker(sinceStateMs: number): number[] {
  const t = Math.min(Math.max(0, sinceStateMs), THINK_MARK_MS)
  const lead = t >= THINK_MARK_MS ? 0 : Math.floor((t / THINK_ORBIT_MS) * RING_BARS) % RING_BARS
  const first = lead - Math.floor(THINK_MARK_BARS / 2)
  return Array.from({ length: THINK_MARK_BARS }, (_, i) => (((first + i) % RING_BARS) + RING_BARS) % RING_BARS)
}

// --- the level bar ---

export interface PeakHold {
  db: number
  at: number
}

/** The peak tick shown at `now`: held 800 ms, then falling 40 dB/s (assumption). */
export function peakShown(p: PeakHold | null, now: number): number | null {
  if (!p) return null
  const over = now - p.at - PEAK_HOLD_MS
  return over <= 0 ? p.db : p.db - (PEAK_FALL_DB_PER_S * over) / 1000
}

/** Feed one real level; a new peak above the tick (as it is shown now) replaces it and restarts the hold. */
export function peakUpdate(p: PeakHold | null, db: number, now: number): PeakHold {
  const shown = peakShown(p, now)
  return shown === null || db >= shown ? { db, at: now } : (p as PeakHold)
}

// --- the test pattern (9.6): a fixed synthetic sequence for judging the look on a silent machine ---

/** A deterministic 24-band row for time t ms into the test pattern: a travelling bump, so it is plainly not speech. Stamped SIMULATED by the caller. */
export function testPatternBands(tMs: number): number[] {
  const centre = ((tMs / 1000) * 5) % N_BANDS
  return Array.from({ length: N_BANDS }, (_, i) => {
    const d = Math.abs(i - centre)
    const w = Math.min(d, N_BANDS - d)
    return Math.round(30 + 190 * Math.exp(-(w * w) / 8))
  })
}
