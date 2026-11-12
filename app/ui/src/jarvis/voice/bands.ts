// The band map of spec 9.2, in TypeScript, identical to core/playback.py (band_edges and the dB window).
// Pure functions only. The golden file (src/__tests__/jarvis/voice/golden.json) pins them for both sides.
import { DB_SPAN, F_HI, F_LO, IN_DB_LO, N_BANDS, OUT_DB_LO } from './constants'

export type Channel = 'in' | 'out'

/** n + 1 edges, f_i = lo * r^i with r = (hi / lo)^(1 / n). */
export function bandEdges(n = N_BANDS, lo = F_LO, hi = F_HI): number[] {
  return Array.from({ length: n + 1 }, (_, i) => lo * Math.pow(hi / lo, i / n))
}

/** The band of a frequency: floor(24 ln(f / 100) / ln(80)); null outside [100, 8000). A 1 kHz sine is band 12, 1.7 kHz is band 15. */
export function bandOfFrequency(f: number, n = N_BANDS, lo = F_LO, hi = F_HI): number | null {
  if (!Number.isFinite(f) || f < lo || f >= hi) return null
  return Math.min(n - 1, Math.floor((n * Math.log(f / lo)) / Math.log(hi / lo)))
}

/** The dB at which a channel's mapping window starts: output -60, input -70 (the mic floor is higher). */
export const dbFloor = (ch: Channel): number => (ch === 'out' ? OUT_DB_LO : IN_DB_LO)

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Round half to even, like numpy's `rint` in core/playback.py: 212.5 is 212 there, and Math.round would say 213. */
export function rint(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}

/** dB to a 0..255 band count, linear in dB; `shiftDb` is the display sensitivity (0 by default, +12 for High). No automatic gain. */
export function dbToByte(db: number, ch: Channel, shiftDb = 0): number {
  if (!Number.isFinite(db)) return 0
  return rint(255 * clamp01((db + shiftDb - dbFloor(ch)) / DB_SPAN))
}

/** The level bar's fill, 0..1, over the same window as the bands. */
export function levelFill(db: number | null | undefined, ch: Channel, shiftDb = 0): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0
  return clamp01((db + shiftDb - dbFloor(ch)) / DB_SPAN)
}

/** Linear interpolation of a 24-band row at a fractional band position `p` (0..23); the result is on the same 0..255 scale. */
export function lerpBand(bands: ArrayLike<number>, p: number): number {
  const q = Math.min(Math.max(p, 0), bands.length - 1)
  const lo = Math.floor(q)
  const hi = Math.min(lo + 1, bands.length - 1)
  const f = q - lo
  return bands[lo] + (bands[hi] - bands[lo]) * f
}

/** The text twin of a dB value: "-23 dB". Rounded to a whole dB, the way the legend prints it. */
export const dbText = (db: number): string => `${Math.round(db)} dB`
