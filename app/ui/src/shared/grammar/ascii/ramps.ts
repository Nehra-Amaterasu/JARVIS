// The four ASCII ramps of spec 20.4.2 and the pure text functions built on them. Text only: no canvas, no image.

import { fnv1a32, mulberry32 } from '../sigil/hash'

export const RAMPS = {
  /** portraits, backdrops: ten levels */
  r10: ' .:-=+*#%@',
  /** data cells: five levels a reader can tell apart */
  r5: ' .:+#',
  /** triangle-character fields (C04-113), memory and tree backdrops */
  caret: ' .^AM',
  /** the Sobel edge pass on contours */
  edge: '/\\|_-',
} as const
export type RampName = keyof typeof RAMPS

/** Atmosphere budget (D-V2-4): at most 8 KB raw per plate, 6 files per section, 90 KB across the application. */
export const ATMOSPHERE_MAX_BYTES = 8192
export const ATMOSPHERE_MAX_FILES_PER_SECTION = 6
export const ATMOSPHERE_MAX_TOTAL_BYTES = 90 * 1024

/** The glyph of a ramp for a level t in [0, 1]. Non-finite t is the blank of the ramp. */
export function rampGlyph(ramp: RampName, t: number): string {
  const g = RAMPS[ramp]
  if (!Number.isFinite(t)) return g[0]
  const i = Math.round(Math.max(0, Math.min(1, t)) * (g.length - 1))
  return g[i]
}

/** The level in [0, 1] of a glyph on a ramp; a glyph that is not on it counts as full (it is ink). */
export function glyphLevel(ramp: RampName, ch: string): number {
  if (ch === ' ') return 0
  const g = RAMPS[ramp]
  const i = g.indexOf(ch)
  if (ramp === 'edge') return 1
  return i < 0 ? 1 : i / (g.length - 1)
}

/** The 4 x 4 ordered-dither (Bayer) thresholds, as fractions in (0, 1). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
export const bayer = (x: number, y: number): number => BAYER4[(y & 3) * 4 + (x & 3)]

/**
 * Freeze (spec 20.4.2): WAITING shows a frozen 1-bit Bayer field, never animated. Every glyph is kept or dropped by
 * comparing its ramp level with the threshold of its cell, so the shape survives as a 1-bit dither of itself.
 */
export function freezeText(text: string, ramp: RampName = 'r10', on = ':'): string {
  const lines = text.split('\n')
  return lines.map((ln, y) => [...ln].map((ch, x) => (ch === ' ' ? ' ' : glyphLevel(ramp, ch) >= bayer(x, y) ? on : ' ')).join('')).join('\n')
}

/** A plain 1-bit Bayer field at one level (the WAITING plate of a ScanFrame). */
export function bayerField(cols: number, rows: number, level = 0.35, on = '.'): string {
  const c = Math.max(1, Math.min(160, Math.floor(cols)))
  const r = Math.max(1, Math.min(60, Math.floor(rows)))
  const out: string[] = []
  for (let y = 0; y < r; y++) {
    let ln = ''
    for (let x = 0; x < c; x++) ln += level >= bayer(x, y) ? on : ' '
    out.push(ln)
  }
  return out.join('\n')
}

/**
 * Scatter (spec 20.4.2): on FAULT the plate's glyphs become a seeded permutation of / \ x, then stay still.
 * Seeded by the text itself, so the same plate always scatters the same way.
 */
export function scatterText(text: string): string {
  const rnd = mulberry32(fnv1a32(text))
  const set = ['/', '\\', 'x']
  let out = ''
  for (const ch of text) out += ch === ' ' || ch === '\n' ? ch : set[Math.floor(rnd() * 3)]
  return out
}

/** The block-character twin of a series (every Trace carries one). Gaps are a hatch, never interpolated. */
export const SPARK_BLOCKS = '▁▂▃▅▇'
export const SPARK_GAP = '░'
/** A sparkline holds at most this many points (the latest ones): bounded memory and a line that fits a row. */
export const SPARK_MAX = 512

export function sparkline(values: number[]): string {
  const vs = values.length > SPARK_MAX ? values.slice(-SPARK_MAX) : values
  let lo = Infinity, hi = -Infinity
  for (const v of vs) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v }
  if (lo === Infinity) return vs.map(() => SPARK_GAP).join('')
  const span = hi - lo
  let out = ''
  for (const v of vs) {
    if (!Number.isFinite(v)) { out += SPARK_GAP; continue }
    // a flat series is drawn at the middle step: it is level, not empty and not maximal
    const i = span === 0 ? 2 : Math.round(((v - lo) / span) * (SPARK_BLOCKS.length - 1))
    out += SPARK_BLOCKS[i]
  }
  return out
}

/**
 * The atmosphere lint (spec A.G02: "a lint that rejects an atmosphere plate bound to a count"). Atmosphere is
 * aria-hidden decoration, so it must not carry data: no digits (a number there would be a number without a lamp)
 * and no more than the byte budget. Returns the problems; an empty list passes.
 */
export function atmosphereProblems(text: string): string[] {
  const problems: string[] = []
  if (/[0-9]/.test(text)) problems.push('digits: an atmosphere plate must not show a number (it has no lamp)')
  const bytes = new TextEncoder().encode(text).length
  if (bytes > ATMOSPHERE_MAX_BYTES) problems.push(`size: ${bytes} bytes over the ${ATMOSPHERE_MAX_BYTES} byte plate budget`)
  return problems
}

/** The byte budget over a set of atmosphere files ({ section, bytes }), for the bundle check of later waves. */
export function atmosphereBudget(files: { name: string; section: string; bytes: number }[]): string[] {
  const problems: string[] = []
  const per = new Map<string, number>()
  let total = 0
  for (const f of files) {
    total += f.bytes
    per.set(f.section, (per.get(f.section) ?? 0) + 1)
    if (f.bytes > ATMOSPHERE_MAX_BYTES) problems.push(`${f.name}: ${f.bytes} bytes over ${ATMOSPHERE_MAX_BYTES}`)
  }
  for (const [s, n] of per) if (n > ATMOSPHERE_MAX_FILES_PER_SECTION) problems.push(`${s}: ${n} files over ${ATMOSPHERE_MAX_FILES_PER_SECTION}`)
  if (total > ATMOSPHERE_MAX_TOTAL_BYTES) problems.push(`total: ${total} bytes over ${ATMOSPHERE_MAX_TOTAL_BYTES}`)
  return problems
}
