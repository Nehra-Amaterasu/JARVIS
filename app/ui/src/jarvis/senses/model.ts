// Senses, the pure parts (spec 20.9.3, A.J03). Nothing here touches the DOM, a socket or a clock: every function takes
// what it needs, so the honest states are testable without a browser. The drawing reads these numbers and adds none.
//
// One sentence is printed on every Senses screen and is the whole physics: "detects motion of anyone in range, identifies
// no one; one link, no pose." The picture is therefore a signal and a probability, never a person: no figure, no
// silhouette, no skeleton, no head. Frames from a simulator are SIMULATED (amber stamp) and no frame at all is a hollow
// form with the reason written under it.
import type { FrameMsg, RoomSpec } from '../../twin/SpatialTwin'
import type { LampReading, LampState } from '../../shared/lamp'
import type { Readiness } from '../../lib/roomMeasure'
import { EMPTY_BELOW, IN_ROOM_AT } from '../../lib/belief'

export const SENSES_SENTENCE = 'Detects motion of anyone in range, identifies no one. One link, no pose.'

export const COLS = 51
export const ROWS = 24
export const STAGE_W = 720
export const STAGE_H = 360

export type Source = 'live' | 'simulated' | 'none'
/** One row of the terrain: the CSI amplitudes of one frame. */
export interface Frame { t: number; amps: number[] }
export type Band = 'low' | 'mid' | 'high'

/** The hub's source word to the lamp family: only the ESP32 is measured; a simulation or a replay is generated data. */
export function sourceOf(frameSource: string | null | undefined): Source {
  if (frameSource === 'hardware') return 'live'
  if (frameSource === 'simulation' || frameSource === 'replay') return 'simulated'
  return 'none'
}

export const SOURCE_LAMP: Record<Source, LampState> = { live: 'live', simulated: 'simulated', none: 'waiting' }

/** The source lamp with its reason: a closed socket is a FAULT, a quiet hub is WAITING, and never the other way round. */
export function sourceReading(source: Source, online: boolean, hubError?: string | null, since: number | null = null): LampReading {
  if (!online) return { state: 'fault', since, reason: 'the app server is not answering' }
  if (hubError) return { state: 'fault', since, reason: hubError }
  if (source === 'live') return { state: 'live', since, reason: 'frames from the ESP32' }
  if (source === 'simulated') return { state: 'simulated', since, reason: 'generated frames, not measured' }
  return { state: 'waiting', since, reason: 'no source is running' }
}

/** The scenario names the hub offers, said in plain words. The ids go to the server unchanged. */
const SCENARIO_WORD: Record<string, string> = { evening: 'evening', walk: 'walk', still: 'still', empty: 'quiet' }
export const scenarioWord = (id: string): string => SCENARIO_WORD[id] ?? id

/* ------------------------------------------------------------------ the terrain */

/** Amplitudes per column, normalised per column across the rows kept (so a quiet subcarrier is not hidden by a loud one). */
export function terrainRows(frames: readonly Frame[], rows = ROWS, cols = COLS): number[][] {
  const kept = frames.slice(-rows).map((f) => Array.from({ length: cols }, (_, i) => (Number.isFinite(f.amps[i]) ? Math.max(0, f.amps[i]) : 0)))
  const peak = Array.from({ length: cols }, (_, i) => Math.max(1e-9, ...kept.map((r) => r[i])))
  return kept.map((r) => r.map((v, i) => v / peak[i]))
}

export interface Ridge {
  /** Depth index 0 (back) to ROWS - 1 (front). */
  depth: number
  pts: [number, number][]
  /** 0.18 at the back to 1 at the front. */
  alpha: number
  front: boolean
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * The ridge lines of the terrain on the 720 x 360 canvas. X = the 51 subcarriers, depth = time (the latest row in
 * front, nearest the viewer, wider and taller), height = the column-normalised amplitude. With fewer rows than ROWS the
 * rows keep their place at the front, so the picture grows from the front backwards.
 */
export function ridgeGeometry(norm: readonly number[][], w = STAGE_W, h = STAGE_H): Ridge[] {
  const n = norm.length
  return norm.map((row, k) => {
    const depth = ROWS - n + k
    const t = depth / (ROWS - 1)
    const span = lerp(w * 0.56, w * 0.88, t)
    const x0 = (w - span) / 2
    const base = lerp(h * 0.3, h * 0.84, t)
    const amp = lerp(h * 0.18, h * 0.3, t)
    const pts = row.map((v, i): [number, number] => [x0 + (span * i) / (row.length - 1), base - v * amp])
    return { depth, pts, alpha: 0.18 + 0.82 * t ** 1.6, front: k === n - 1 }
  })
}

/** The placeholder mound of an instrument with no signal: fixed, hollow, and labelled as a placeholder. */
export function hollowMound(w = STAGE_W, h = STAGE_H, rows = 7): Ridge[] {
  const shape = Array.from({ length: COLS }, (_, i) => Math.exp(-(((i - 25) / 11) ** 2)) * 0.9 + 0.04)
  return ridgeGeometry(Array.from({ length: rows }, (_, k) => shape.map((v) => v * (0.55 + 0.45 * (k / (rows - 1))))), w, h)
}

/** The floor grid under the terrain: lines of constant depth and of constant subcarrier, as point pairs. */
export function floorGrid(w = STAGE_W, h = STAGE_H): { depth: [number, number, number][]; across: [number, number, number, number][] } {
  const depth: [number, number, number][] = []
  for (let k = 0; k <= 6; k++) {
    const t = k / 6
    const span = lerp(w * 0.56, w * 0.88, t)
    depth.push([(w - span) / 2, w - (w - span) / 2, lerp(h * 0.3, h * 0.84, t)])
  }
  const across: [number, number, number, number][] = []
  for (let c = 0; c <= 10; c++) {
    const u = c / 10
    const back = (w - w * 0.56) / 2 + w * 0.56 * u
    const front = (w - w * 0.88) / 2 + w * 0.88 * u
    across.push([back, h * 0.3, front, h * 0.84])
  }
  return { depth, across }
}

/** The word under the cursor: the subcarrier number (1 to 51) and the front row's amplitude there. */
export function cursorText(frames: readonly Frame[], col: number): string {
  const c = Math.max(0, Math.min(COLS - 1, Math.round(col)))
  const last = frames[frames.length - 1]
  const v = last?.amps[c]
  return `subcarrier ${c + 1} of ${COLS}${v != null && Number.isFinite(v) ? `, amplitude ${v.toFixed(2)}` : ', no amplitude yet'}`
}

/** The subcarrier under an x position of the canvas, from the front row's span. */
export function colAt(x: number, w = STAGE_W): number {
  const span = w * 0.88
  const x0 = (w - span) / 2
  return Math.max(0, Math.min(COLS - 1, Math.round(((x - x0) / span) * (COLS - 1))))
}

/* ------------------------------------------------------------------ the probability arc */

/** The three bands of the arc from a probability, on the thresholds the belief already uses. */
export function bandOf(p: number | null | undefined): Band | null {
  if (p == null || !Number.isFinite(p)) return null
  return p < EMPTY_BELOW ? 'low' : p < IN_ROOM_AT ? 'mid' : 'high'
}

export const BAND_WORD: Record<Band, string> = { low: 'LOW', mid: 'MID', high: 'HIGH' }
export const ARC_SPAN = 240

export interface ArcModel {
  /** Needle angle from the arc's start in degrees (0 to 240), or null with no band. */
  needle: number | null
  word: string
  /** Digits are drawn only once the held-out check has passed. */
  digits: string | null
  provenance: string
}

/**
 * What the arc says. Before the held-out check the arc names a band and the word PREDICTING and never a digit; the
 * needle rests at the centre of its band, so it cannot be read as a measurement. After the check the number appears,
 * labelled as a model estimate.
 */
export function arcModel(a: { band: Band | null; p?: number | null; trusted: boolean; drillDays?: number | null; gateDays?: number }): ArcModel {
  const gate = a.gateDays ?? 7
  if (!a.band) return { needle: null, word: 'NO SIGNAL', digits: null, provenance: 'no frames, so no estimate' }
  const centre = { low: 40, mid: 120, high: 200 }[a.band]
  if (!a.trusted) {
    const days = a.drillDays == null ? 'drill days not read' : `${a.drillDays} of ${gate} drill days`
    return { needle: centre, word: 'PREDICTING', digits: null, provenance: `signal estimate, ${days}` }
  }
  const p = a.p != null && Number.isFinite(a.p) ? Math.max(0, Math.min(1, a.p)) : null
  return { needle: p == null ? centre : p * ARC_SPAN, word: BAND_WORD[a.band], digits: p == null ? null : `${Math.round(p * 100)} %`, provenance: 'model estimate, held-out day passed' }
}

/** Point on a circle at an angle measured clockwise from the arc's start (which sits 120 degrees left of the top). */
export function arcPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 210) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = arcPoint(cx, cy, r, from)
  const [x1, y1] = arcPoint(cx, cy, r, to)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/* ------------------------------------------------------------------ the motion tape */

export const TAPE_STEP_MIN = 5
export const TAPE_COLS = (24 * 60) / TAPE_STEP_MIN
export const TAPE_DAYS = 7
export type TapeCell = 'seen' | 'paused' | 'none'

/**
 * Seven days of five-minute columns. A column is `seen` only for a minute in which a frame said motion, `paused` while
 * the user had sensing paused in this window, and `none` otherwise. `none` is the absence of a record, never a finding:
 * the window that draws this tape sees only the minutes it was open.
 */
export class TapeStore {
  private cells = new Map<string, 'm' | 'p'>()
  private readonly dayStart: (ms: number) => number
  constructor(dayStart: (ms: number) => number = localDayStart) { this.dayStart = dayStart }

  private key(ms: number): string {
    const d = this.dayStart(ms)
    const col = Math.min(TAPE_COLS - 1, Math.floor((ms - d) / (TAPE_STEP_MIN * 60000)))
    return `${d}:${col}`
  }

  record(ms: number, kind: 'seen' | 'paused'): void {
    const k = this.key(ms)
    // motion seen is the stronger record: a pause never overwrites it
    if (kind === 'paused' && this.cells.get(k) === 'm') return
    this.cells.set(k, kind === 'seen' ? 'm' : 'p')
  }

  get size(): number { return this.cells.size }

  /** The seven days ending today, oldest first. */
  week(now: number): { start: number; cells: TapeCell[] }[] {
    const today = this.dayStart(now)
    const out: { start: number; cells: TapeCell[] }[] = []
    for (let back = TAPE_DAYS - 1; back >= 0; back--) {
      const start = this.dayStart(today - back * 86400000 + 43200000)
      const cells = Array.from({ length: TAPE_COLS }, (_, c): TapeCell => {
        const v = this.cells.get(`${start}:${c}`)
        return v === 'm' ? 'seen' : v === 'p' ? 'paused' : 'none'
      })
      out.push({ start, cells })
    }
    return out
  }

  toJSON(now: number): Record<string, 'm' | 'p'> {
    const keep = this.dayStart(now) - (TAPE_DAYS - 1) * 86400000 - 3600000
    const o: Record<string, 'm' | 'p'> = {}
    for (const [k, v] of this.cells) if (Number(k.split(':')[0]) >= keep) o[k] = v
    return o
  }

  load(o: unknown): void {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (/^\d+:\d+$/.test(k) && (v === 'm' || v === 'p')) this.cells.set(k, v)
  }
}

export function localDayStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const CELL_WORD: Record<TapeCell, string> = { seen: 'motion seen', paused: 'sensing paused by you', none: 'nothing seen' }

/** "Tue 14:20 to 14:25, motion seen". */
export function tapeHover(dayStart: number, col: number, cell: TapeCell): string {
  const m = col * TAPE_STEP_MIN
  return `${DAY[new Date(dayStart).getDay()]} ${hhmm(m)} to ${hhmm(m + TAPE_STEP_MIN)}, ${CELL_WORD[cell]}`
}

export const TAPE_CAPTION = 'Blank means nothing was seen, not that no one was there. This window records only the minutes it is open.'

export function tapeCounts(week: { cells: TapeCell[] }[]): { seen: number; paused: number } {
  let seen = 0, paused = 0
  for (const d of week) for (const c of d.cells) { if (c === 'seen') seen++; else if (c === 'paused') paused++ }
  return { seen, paused }
}

/* ------------------------------------------------------------------ the link row */

export interface LinkVitals { fps: number | null; lossPct: number | null; ageS: number | null }

export function linkVitals(f: FrameMsg | null, link: { loss_ratio?: number } | undefined, lastAt: number | null, now: number): LinkVitals {
  const fps = f?.csi && Number.isFinite(f.csi.rate_hz) ? f.csi.rate_hz : null
  const loss = link?.loss_ratio
  return {
    fps,
    lossPct: typeof loss === 'number' && Number.isFinite(loss) ? loss * 100 : null,
    ageS: lastAt == null ? null : Math.max(0, (now - lastAt) / 1000),
  }
}

/** The reading of one link vital: a number only with frames, else the em dash with the reason. */
export function vitalText(v: number | null, digits: number, unit: string): string {
  return v == null || !Number.isFinite(v) ? '--' : `${v.toFixed(digits)} ${unit}`
}

/** Quarter fills (0 to 4) of the 51 channel dots, from the latest amplitudes. */
export function channelLevels(amps: readonly number[], cols = COLS): number[] {
  const peak = Math.max(1e-9, ...amps.filter((v) => Number.isFinite(v)))
  return Array.from({ length: cols }, (_, i) => (Number.isFinite(amps[i]) && amps[i] > 0 ? Math.min(4, Math.round((amps[i] / peak) * 4)) : 0))
}

/* ------------------------------------------------------------------ the floor plan (isometric, SVG) */

export interface Iso { x: number; y: number }
/** Project room metres to the plan: x runs right and down, y runs left and down, at a fixed 2:1 isometric. */
export function isoOf(x: number, y: number, k: number, ox: number, oy: number, z = 0): Iso {
  return { x: ox + (x - y) * k * 0.866, y: oy + (x + y) * k * 0.5 - z * k }
}

export interface PlanFit { k: number; ox: number; oy: number }
/** The scale and origin that fit a room of this size into a w x h box with a margin. */
export function planFit(room: Pick<RoomSpec, 'width' | 'depth'> | null, w: number, h: number, margin = 24): PlanFit {
  const W = room?.width && room.width > 0 ? room.width : 4
  const D = room?.depth && room.depth > 0 ? room.depth : 4
  const spanX = (W + D) * 0.866
  const spanY = (W + D) * 0.5
  const k = Math.min((w - 2 * margin) / spanX, (h - 2 * margin) / spanY)
  return { k, ox: w / 2 + ((D - W) * 0.866 * k) / 2, oy: (h - spanY * k) / 2 }
}

/** The scale and origin that fit every drawn point (floor, furniture tops, rings, the two ends) into a w x h box. */
export function fitPoints(pts: readonly Iso[], w: number, h: number, margin = 14): PlanFit {
  if (pts.length === 0) return { k: 1, ox: w / 2, oy: h / 2 }
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const bw = Math.max(1e-6, maxX - minX)
  const bh = Math.max(1e-6, maxY - minY)
  const k = Math.min((w - 2 * margin) / bw, (h - 2 * margin) / bh)
  return { k, ox: margin + (w - 2 * margin - bw * k) / 2 - minX * k, oy: margin + (h - 2 * margin - bh * k) / 2 - minY * k }
}

/** The centroid and a radius of a zone polygon, in metres. A ring, never a position of a person. */
export function zoneRing(poly: number[][]): { x: number; y: number; r: number } | null {
  const pts = poly.filter((p) => p.length >= 2 && p.every(Number.isFinite))
  if (pts.length < 3) return null
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const y = pts.reduce((s, p) => s + p[1], 0) / pts.length
  const r = Math.max(...pts.map((p) => Math.hypot(p[0] - x, p[1] - y)))
  return { x, y, r: Math.max(0.15, r) }
}

/* ------------------------------------------------------------------ the teach rings */

export interface TeachRing { id: 'room' | 'quiet' | 'drill' | 'heldout'; name: string; fill: number; of: number; done: boolean; word: string }

/** The four steps as rings with a real fraction each. Held-out is separate and only the server's gate fills it. */
export function teachRings(r: Readiness | null): TeachRing[] {
  const has = (id: string) => r?.items.find((i) => i.id === id)?.ok === true
  const gate = Number(/of (\d+)/.exec(r?.items.find((i) => i.id === 'drill_days')?.label ?? '')?.[1]) || 7
  const quiet = (has('baseline_fan_off') ? 1 : 0) + (has('baseline_fan_on') ? 1 : 0)
  const days = r ? Math.min(gate, Math.max(0, r.drill_days)) : 0
  const heldOut = has('zone_gate')
  return [
    { id: 'room', name: 'Room measured', fill: has('layout') ? 1 : 0, of: 1, done: has('layout'), word: has('layout') ? 'measured with a tape' : 'not measured' },
    { id: 'quiet', name: 'Quiet baselines', fill: quiet, of: 2, done: quiet === 2, word: `${quiet} of 2 recorded` },
    { id: 'drill', name: 'Drill days', fill: days, of: gate, done: days >= gate, word: `${days} of ${gate} days` },
    { id: 'heldout', name: 'Held-out check', fill: heldOut ? 1 : 0, of: 1, done: heldOut, word: heldOut ? 'passed' : 'not passed yet' },
  ]
}

/* ------------------------------------------------------------------ narration and the copy lint */

/** The signal view's one-line reading. A fixed template: a number and a threshold, never a guess about a person. */
export function narration(f: FrameMsg | null, source: Source): string {
  if (!f || source === 'none') return 'No frames are arriving, so there is nothing to read.'
  const md = f.motion_detail
  const tag = source === 'simulated' ? 'Simulated: ' : ''
  if (md.score == null || md.threshold == null) return `${tag}The score is still warming up; it needs a baseline to compare against.`
  const above = md.score >= md.threshold
  return `${tag}Motion score ${md.score.toFixed(1)}x against a threshold of ${md.threshold.toFixed(1)}x: ${above ? 'movement seen on this link' : 'no movement seen on this link'}.`
}

/**
 * Words this section never prints (spec 20.9.3 and the owner's honesty rule): a link sees that something moved, so
 * "present", "absent", "occupied" and "empty room" claim more than one link knows. Returns the offending matches.
 */
export const FORBIDDEN_COPY = /\b(present|absent|occupied|occupancy|empty room|nobody in the room|no one is there)\b/i
export function copyProblems(text: string): string[] {
  const m = text.match(new RegExp(FORBIDDEN_COPY.source, 'gi'))
  return m ? [...new Set(m.map((s) => s.toLowerCase()))] : []
}

/** Art ids this section may draw. A face, an eye, a body or a pose is refused in the id itself (spec 20.9.3). */
export const SENSES_ART = ['art.senses.spindle'] as const
export const FORBIDDEN_ART = /(eye|face|body|pose|figure|skeleton|person|human|head)/i

/* ------------------------------------------------------------------ the signal view's readings */

/** A sensor row of the hub's status to the lamp family. Only a source that is reporting from the board is LIVE. */
export function sensorLamp(state: string | undefined): LampState {
  if (state === 'live') return 'live'
  if (state === 'simulated' || state === 'replay') return 'simulated'
  return 'waiting'
}

export interface BandView { pct: number; gatePct: number; calibrated: boolean; text: string }

/**
 * The band-energy meter against its own threshold. Calibrated: 0 to 3x the threshold, the threshold at a third.
 * Before calibration: against noise on a log scale (1x to 50x) with the start gate marked, and the text says uncalibrated.
 */
export function bandView(hb: { energy: number; threshold: number | null; ratio: number | null; recent: number; start_gate: number } | null | undefined): BandView | null {
  if (!hb) return null
  const calibrated = hb.ratio != null
  const pct = calibrated ? Math.min(100, ((hb.ratio as number) / 3) * 100) : Math.min(100, Math.max(0, Math.log(Math.max(hb.energy, 1)) / Math.log(50)) * 100)
  const gatePct = calibrated ? 33.3 : (Math.log(Math.max(hb.start_gate, 1)) / Math.log(50)) * 100
  const text = calibrated ? `${(hb.ratio as number).toFixed(2)}x its threshold` : `${hb.energy.toFixed(1)}x noise, uncalibrated`
  return { pct, gatePct, calibrated, text }
}
