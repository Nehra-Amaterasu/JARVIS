/**
 * Aankhen's eyes — the pure half of the view (components/EyesView.tsx): colour, axes,
 * the body glyph's poses, the sentence, the scroll clock. No DOM here, so every rule
 * is unit-tested (src/__tests__/eyes.test.ts).
 *
 * The data is aankhen/eyes.py's "eyes" message: ripple columns (51 subcarriers, noise
 * units, +-6), the phase ripple's columns, and the motion spectrum (log10 x noise).
 * Colour is provenance, as everywhere (styles/tokens.css): the ice ramp only for what
 * the ESP32 measured, the amber ramp for anything simulated or replayed.
 */

/* ------------------------------------------------------------------ the message */
export interface EyesSpectrum {
  hz: number[]
  power: number[]                         // log10(power / noise floor): 0 noise, 1 = 10x, 2 = 100x
  peak_hz: number | null
  bands: Record<string, number | null>    // breathing / body / fast / above, x noise floor
  window_s: number
}
export interface EyesMsg {
  type: 'eyes'
  source: string
  t: number
  column: number[] | null
  phase_column: number[] | null
  spectrum: EyesSpectrum | null
  rate_hz: number
  seconds: number
}

/** The 51 subcarriers in the order the columns carry them (aankhen/csi.py LLTF_KEEP):
 *  DC (0) and +1 (marked invalid by the S3) are not in the data. */
export const SUBCARRIERS: number[] = Array.from({ length: 53 }, (_, i) => i - 26).filter((s) => s !== 0 && s !== 1)
export const SPACING_KHZ = 312.5
export const CLIP_Z = 6

/** Centre frequency of a 2.4 GHz Wi-Fi channel, MHz (ch 1 = 2412, 5 MHz apart; 14 = 2484). */
export function channelMHz(ch: number | null | undefined): number | null {
  if (!ch || ch < 1 || ch > 14) return null
  return ch === 14 ? 2484 : 2407 + 5 * ch
}

/* ------------------------------------------------------------------ colour */
export type Provenance = 'live' | 'sim'
export const provenanceOf = (source: string | null | undefined): Provenance => (source === 'hardware' ? 'live' : 'sim')

// Near-black through deep blue and the --live cyan to white; amber through --sim to
// cream. Stops are placed so the ramp brightens evenly to the eye: the deep blues get
// room at the bottom, where most of a quiet room lives.
export const RAMPS: Record<Provenance, [number, string][]> = {
  live: [[0, '#040508'], [0.14, '#071733'], [0.34, '#0c4687'], [0.58, '#169ed8'], [0.8, '#5ce1ff'], [1, '#f2fbff']],
  sim: [[0, '#060403'], [0.14, '#241104'], [0.34, '#613107'], [0.58, '#b9700e'], [0.8, '#ffb020'], [1, '#fff4dc']],
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** The ramp at t (0..1) as 0-255 RGB, interpolated between stops. */
export function rampColor(t: number, p: Provenance): [number, number, number] {
  const stops = RAMPS[p]
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  let i = 1
  while (i < stops.length - 1 && stops[i][0] < x) i++
  const [t0, c0] = stops[i - 1], [t1, c1] = stops[i]
  const k = t1 > t0 ? (x - t0) / (t1 - t0) : 0
  const a = hex(c0), b = hex(c1)
  return [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * k)) as [number, number, number]
}

/** A 256-entry RGBA table of the ramp: the shaders' colour lookup texture. */
export function rampTable(p: Provenance, n = 256): Uint8Array {
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const [r, g, b] = rampColor(i / (n - 1), p)
    out.set([r, g, b, 255], i * 4)
  }
  return out
}

// |z| -> brightness. An empty room's columns sit at |z| ~ 0.3 (the 100 ms mean of white
// noise, in per-sample noise units): below the knee they stay black, so quiet is
// calm. What people do mostly lands at 0.7-3 (simulator: a still sitter ~1.0, the
// evening's p90 1.5; the real board's columns 1.1-1.5), so the ramp spends itself
// there and is white from Z_TOP up; the data itself is clipped at CLIP_Z (6).
export const KNEE = 0.45
export const Z_TOP = 4
export const GAMMA = 0.7
export function intensity(z: number): number {
  const a = Math.abs(z)
  if (!Number.isFinite(a) || a <= KNEE) return 0
  return Math.pow(Math.min(1, (a - KNEE) / (Z_TOP - KNEE)), GAMMA)
}

/** Spectrum power (log10 x noise) -> brightness for the spectrogram strip: the noise
 *  floor (0) is black, 300x (2.5) is white. */
export const STRIP_TOP = 2.5
export function stripIntensity(p: number): number {
  if (!Number.isFinite(p) || p <= 0.15) return 0
  return Math.pow(Math.min(1, (p - 0.15) / (STRIP_TOP - 0.15)), 0.8)
}

/* ------------------------------------------------------------------ the rhythm's axes */
// LOG frequency, 0.1-10 Hz. On a linear axis breathing (0.1-0.5 Hz) would get 4 % of
// the width and the noise above 4 Hz 60 %; on a log axis each of the human bands gets
// room in proportion to what it means (an octave is an octave).
export const F_MIN = 0.1
export const F_MAX = 10
const LOG_SPAN = Math.log(F_MAX / F_MIN)
export const freqToX = (f: number, w: number) => (Math.log(Math.max(f, 1e-6) / F_MIN) / LOG_SPAN) * w
export const xToFreq = (x: number, w: number) => F_MIN * Math.exp((x / w) * LOG_SPAN)

/** The power axis: log10 x noise, with headroom above the strongest bin, and never
 *  less than 100x so a quiet room looks quiet instead of being zoomed into noise. */
export function powerRange(power: ArrayLike<number>): [number, number] {
  let hi = 2
  for (let i = 0; i < power.length; i++) if (power[i] + 0.35 > hi) hi = power[i] + 0.35
  return [-0.4, Math.min(hi, 4)]
}

export interface Pt { x: number; y: number }
/** Spectrum -> screen points (log-x, top-down y) for a plot w x h. */
export function spectrumPoints(hz: ArrayLike<number>, power: ArrayLike<number>, w: number, h: number,
  range: [number, number] = powerRange(power)): Pt[] {
  const [lo, hi] = range
  const pts: Pt[] = []
  for (let i = 0; i < hz.length; i++) {
    if (hz[i] < F_MIN * 0.999 || hz[i] > F_MAX * 1.001) continue
    const v = Math.min(hi, Math.max(lo, power[i]))
    pts.push({ x: freqToX(hz[i], w), y: h - ((v - lo) / (hi - lo)) * h })
  }
  return pts
}

/** A smooth path through the points (Catmull-Rom as cubic Béziers, tension 0.5),
 *  with the control points' y clamped to the plot so it never overshoots off-screen. */
export function smoothPath(pts: Pt[], h: number): string {
  if (!pts.length) return ''
  const c = (v: number) => Math.min(h, Math.max(0, v))
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = c(p1.y + (p2.y - p0.y) / 6)
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = c(p2.y - (p3.y - p1.y) / 6)
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

/** What moves at which speed — drawn as soft regions under the rhythm, for reference
 *  only: the view never names a peak as one of them. 0.1-0.5 Hz in a 6.4 s window is 3
 *  bins that slow drift leaks into, so it says "slow drift · breathing": it cannot tell. They overlap
 *  (a wave and a walk are both ~1-2 Hz), so they sit on two lanes, and a peak in the
 *  overlap lights both: the spectrum alone cannot tell them apart, and says so. */
export interface ActivityBand { id: string; label: string; short: string; lo: number; hi: number; lane: 0 | 1 }
export const ACTIVITY_BANDS: ActivityBand[] = [
  { id: 'breathing', label: 'slow drift · breathing', short: 'slow', lo: 0.1, hi: 0.5, lane: 0 },
  { id: 'walking', label: 'walking', short: 'walk', lo: 1, hi: 2, lane: 0 },
  { id: 'typing', label: 'typing · fidgeting', short: 'type · fidget', lo: 3, hi: 10, lane: 0 },
  { id: 'waving', label: 'waving', short: 'wave', lo: 1, hi: 3, lane: 1 },
]
export const bandsAt = (f: number | null | undefined): string[] =>
  f == null ? [] : ACTIVITY_BANDS.filter((b) => f >= b.lo && f <= b.hi).map((b) => b.id)

/** "1.52 Hz" and "91 /min" (breaths or steps a minute read better than hertz). */
export function fmtRhythm(hz: number | null | undefined): { hz: string; perMin: string } | null {
  if (hz == null || !Number.isFinite(hz)) return null
  return { hz: hz.toFixed(2), perMin: String(Math.round(hz * 60)) }
}

/* ------------------------------------------------------------------ the scroll clock */
// Columns arrive at ~10 Hz with network and scheduling jitter. Drawing each one the
// moment it lands would make the waterfall stutter, so the picture runs on its own
// clock: it advances at the measured column rate, is pulled gently towards "newest
// minus LAG columns", and never shows a column that has not arrived (it stops at the
// newest's centre: the right edge would otherwise blend with the next, unwritten one).
// 2.5 columns of lag (~0.3 s) ride through the gaps measured on a busy machine (columns
// 140 ms apart, the worst 380 ms) without the picture catching up and stopping.
export const LAG = 2.5
export interface ScrollClock { pos: number; count: number; interval: number; lastAt: number }
export const newClock = (): ScrollClock => ({ pos: 0, count: 0, interval: 100, lastAt: 0 })

/** A column arrived at time `now` (ms). */
export function clockArrive(c: ScrollClock, now: number): void {
  if (c.count > 0) {
    const dt = now - c.lastAt
    if (dt > 20 && dt < 1000) c.interval += (dt - c.interval) * 0.1
  } else {
    c.pos = 1 - LAG
  }
  c.count += 1
  c.lastAt = now
}

/** Advance the picture by dt ms at time now; returns the head position (columns). */
export function clockStep(c: ScrollClock, now: number, dt: number): number {
  if (c.count === 0) return c.pos
  const desired = c.count - LAG + Math.min(1, (now - c.lastAt) / c.interval)
  c.pos += dt / c.interval
  const err = desired - c.pos
  if (Math.abs(err) > 12) c.pos = desired                  // after a hidden tab: jump, don't race
  else c.pos += err * Math.min(1, dt / 350)                // ~0.35 s to absorb a late column
  c.pos = Math.min(c.pos, c.count - 0.5)
  return c.pos
}

/* ------------------------------------------------------------------ the body */
export type Pose = 'standing' | 'seated' | 'typing' | 'waving' | 'walking' | 'lying' | 'lying-wave' | 'away' | 'unknown'

export const ZONE_TEXT: Record<string, string> = {
  desk: 'at the desk', bed: 'on the bed', room: 'in the room', outside: 'outside the room', empty: 'room empty',
}
export const ACT_TEXT: Record<string, string> = {
  still: 'still', typing: 'typing', waving: 'waving', walking: 'walking', none: 'not in the room',
}

export interface LearnedLike {
  state: string
  p: Record<string, number>
  activity?: { state: string; p: Record<string, number> } | null
}

export interface BodyRead {
  pose: Pose
  zone: string | null                     // learned.state
  zoneText: string                        // "at the desk"
  zoneP: number | null                    // the zone estimate's probability
  activity: string | null
  actText: string
  actP: number | null
}

/** The learned models' latest guess -> what the glyph shows. "Away" whenever the
 *  model says I am not in my room (outside / empty) or that I am doing nothing in it. */
export function readBody(l: LearnedLike | null | undefined): BodyRead {
  if (!l) return { pose: 'unknown', zone: null, zoneText: 'no trained model yet', zoneP: null, activity: null, actText: '—', actP: null }
  const zone = l.state
  const zoneP = l.p?.[zone] ?? null
  const act = l.activity?.state ?? null
  const actP = act ? l.activity?.p?.[act] ?? null : null
  const zoneText = ZONE_TEXT[zone] ?? zone
  const base = { zone, zoneText, zoneP, activity: act, actText: act ? ACT_TEXT[act] ?? act : '—', actP }
  if (zone === 'empty' || zone === 'outside' || act === 'none') return { ...base, pose: 'away', actText: 'not in the room' }
  let pose: Pose
  if (act === 'walking') pose = 'walking'
  else if (act === 'waving') pose = zone === 'bed' ? 'lying-wave' : 'waving'
  else if (act === 'typing') pose = 'typing'
  else pose = zone === 'bed' ? 'lying' : zone === 'desk' ? 'seated' : 'standing'
  return { ...base, pose }
}

/** Joint angles (degrees, clockwise on screen) and foreshortening for each pose of
 *  the front-view glyph. Arms and legs hang straight down at 0; for the figure's LEFT
 *  limbs (on the viewer's left) positive swings them outwards, for the right ones
 *  negative does. Thighs and forearms pointing at the viewer are drawn shortened
 *  (thigh / fore scales): that is how a seated or typing body reads from the front. */
export interface PoseGeom {
  shL: number; elL: number; shR: number; elR: number
  hpL: number; knL: number; hpR: number; knR: number
  thigh: number                            // thigh length scale (1 standing, ~0.3 seated)
  foreL: number; foreR: number             // forearm length scale
  drop: number                             // how far the body sinks (seated: onto the seat)
  tilt: number                             // whole-figure rotation (lying: -90)
  desk: boolean                            // show the desk line (typing)
  bed: boolean                             // show the bed line (lying)
}
const STAND: PoseGeom = { shL: 7, elL: -5, shR: -7, elR: 5, hpL: 3, knL: 0, hpR: -3, knR: 0, thigh: 1, foreL: 1, foreR: 1, drop: 0, tilt: 0, desk: false, bed: false }
export const POSES: Record<Pose, PoseGeom> = {
  standing: STAND,
  away: STAND,
  unknown: STAND,
  seated: { ...STAND, shL: 12, elL: -38, shR: -12, elR: 38, hpL: 22, knL: -22, hpR: -22, knR: 22, thigh: 0.32, drop: 21 },
  typing: { ...STAND, shL: 16, elL: -52, shR: -16, elR: 52, hpL: 22, knL: -22, hpR: -22, knR: 22, thigh: 0.32, foreL: 0.55, foreR: 0.55, drop: 21, desk: true },
  waving: { ...STAND, shR: -148, elR: -18 },
  walking: { ...STAND, shL: 9, shR: -9 },
  lying: { ...STAND, tilt: -90, bed: true },
  'lying-wave': { ...STAND, shR: -148, elR: -18, tilt: -90, bed: true },
}

/* ------------------------------------------------------------------ the sentence */
export interface SeeLine { text: string; estimate: boolean; from: 'staff' | 'model' | 'presence' | 'none' }

/** "What I see right now": the movement agent's own words when the staff runs, else
 *  the learned models' guess, else the presence fusion — always labelled for what it is. */
export function seeSentence(opts: {
  staffSummary?: string | null
  learned?: LearnedLike | null
  presence?: { state: string; count: number | null } | null
}): SeeLine {
  const s = opts.staffSummary?.trim()
  if (s) return { text: s, estimate: true, from: 'staff' }
  const l = opts.learned
  if (l) {
    const b = readBody(l)
    const zone = b.zoneText.charAt(0).toUpperCase() + b.zoneText.slice(1)
    if (b.pose === 'away') return { text: `${zone} — nobody moving in it that I can tell`, estimate: true, from: 'model' }
    return { text: b.activity ? `${zone}, ${b.actText}` : zone, estimate: true, from: 'model' }
  }
  const p = opts.presence
  if (p) {
    const who = p.count != null && p.count > 0 ? ` · ${p.count} ${p.count === 1 ? 'person' : 'people'}` : ''
    return { text: `Room ${p.state}${who}`, estimate: true, from: 'presence' }
  }
  return { text: 'Nothing to see yet — no source', estimate: false, from: 'none' }
}
