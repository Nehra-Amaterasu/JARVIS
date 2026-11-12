// From the signal and the core's words to one scene description (what to draw), and from a scene to canvas calls.
// `planScene` is pure given the signal and `now`; `drawScene` only calls a 2D context, so a recorder can stand in for it
// (tests V-03, V-04, V-15). The rule that carries the honesty: solid points are planned only when `vs.measured`, which
// voiceState grants only while a frame younger than 400 ms exists; everything else is hollow, quiet ink, no cyan.
import {
  HILL_ALPHA, HILL_ALPHA_FLOOR_MORE, HILL_BASELINE, HILL_CENTER_X, HILL_HALF_W, HILL_LAYER_SPACING_MS, HILL_PX_FAR, HILL_PX_MORE, HILL_PX_NEAR,
  PH_SQUARE_PX, QUALITY, RING_BAR_MIN, RING_BAR_W, RING_BARS, RING_BELOW_ALPHA, RING_BASE_R, RING_BEZEL_R,
  RING_CX, RING_CY, STAGE_H, STAGE_W, T0_FULL_SCALE, type Quality,
} from './constants'
import { levelFill } from './bands'
import {
  breathFactor, colX, envelopeGeometry, hillGeometry, jitterTable, placeholderHill, ringBars, ringBreath, ringLengthsBands, ringLengthsLevel,
  ringLengthsPlaceholder, testPatternBands, thinkingMarker, type Points, type RingBars,
} from './geometry'
import type { VoiceSignal } from './signal'
import { voiceState, type CoreView, type Tier, type VoiceStateResult } from './voiceState'

export type SceneStyle = 'solid' | 'hollow' | 'simulated'

export interface Scene {
  vs: VoiceStateResult
  style: SceneStyle
  hill: Points
  ring: RingBars
  /** 2 draws every second bar (muted, 9.6 row 2). */
  ringStride: 1 | 2
  /** The three bars of the thinking marker, or null. */
  marker: number[] | null
  /** A 60 degree fault arc (error) or a 30 degree measured arc (hearing speech) on the bezel. */
  arc: 'fault' | 'speech' | null
  glyph: 'triangle' | null
  /** "SIMULATED", drawn into the canvas corner, only for the test pattern. */
  stamp: string | null
  /** Level bar fill 0..1 and the dB number, only while measured (or simulated); null otherwise. */
  fill: number | null
  levelDb: number | null
  thrFill: number | null
  /** The channel of the reading, if any. */
  channel: 'in' | 'out' | null
  /** True when an envelope (Tier 0) is drawn instead of a spectrum. */
  envelope: boolean
}

export interface SceneInputs {
  core: CoreView
  signal: VoiceSignal
  now: number
  tier: Tier
  quality: Quality
  /** The Settings switch "Placeholder breath" (off by default). */
  breath: boolean
  sensitivityDb: number
  /** Epoch ms at which the owner pressed "Show a 5 s test pattern", or null. Never set automatically. */
  testPatternSince: number | null
}

/** The level bar's reading for the active channel: fill 0..1, the dB number (null at Tier 0: no dB without calibration), the threshold tick. All null unless measured. */
export function levelReading(vs: VoiceStateResult, signal: VoiceSignal, now: number, sensitivityDb: number): { fill: number | null; db: number | null; thrFill: number | null } {
  if (!vs.measured || !vs.channel) return { fill: null, db: null, thrFill: null }
  const ch = vs.channel
  const view = signal.view(ch, now)
  if (view.hasBands) {
    return {
      fill: view.rmsDb === null ? null : levelFill(view.rmsDb, ch, sensitivityDb),
      db: view.rmsDb,
      thrFill: view.thrDb === null ? null : levelFill(view.thrDb, ch, sensitivityDb),
    }
  }
  const hist = signal.scalarHistory(ch, now)
  const newest = hist.length ? hist[hist.length - 1][1] : null
  return { fill: newest === null ? null : Math.min(1, Math.max(0, newest / T0_FULL_SCALE)), db: null, thrFill: null }
}

/** The state shown while the owner's 5 s test pattern runs: SIMULATED, never measured. */
export const testPatternView = (since: number | null): VoiceStateResult => ({
  state: 'idle', detail: 'test-pattern', lamp: { state: 'simulated', since, reason: 'test pattern, not a reading' },
  label: 'TEST PATTERN', source: null, channel: null, measured: false, legend: 'SIMULATED: test pattern, not a reading', announce: 'Test pattern, simulated',
})

const flatBaseline = (quality: Quality): Points => {
  const { cols } = QUALITY[quality]
  const jt = jitterTable()
  const x = new Float32Array(cols)
  const y = new Float32Array(cols)
  for (let c = 0; c < cols; c++) {
    x[c] = HILL_CENTER_X + colX(c, cols) * HILL_HALF_W + jt.x[c]
    y[c] = HILL_BASELINE
  }
  return { count: cols, x, y, layer: new Uint8Array(cols) }
}

const emptyPoints = (): Points => ({ count: 0, x: new Float32Array(0), y: new Float32Array(0), layer: new Uint8Array(0) })

export function planScene(i: SceneInputs): Scene {
  const { core, signal, now, tier, quality } = i
  if (i.testPatternSince !== null) {
    const t = Math.max(0, now - i.testPatternSince)
    const layers = QUALITY[quality].layers
    const rows = Array.from({ length: layers }, (_, j) => (t - HILL_LAYER_SPACING_MS * j >= 0 ? testPatternBands(t - HILL_LAYER_SPACING_MS * j) : null))
    const vs = testPatternView(i.testPatternSince)
    const row0 = rows[0] ?? testPatternBands(0)
    return {
      vs, style: 'simulated', hill: hillGeometry(rows, quality), ring: ringBars(ringLengthsBands(row0)), ringStride: 1, marker: null, arc: null, glyph: null,
      stamp: 'SIMULATED', fill: null, levelDb: null, thrFill: null, channel: null, envelope: false,
    }
  }
  const input = signal.view('in', now)
  const output = signal.view('out', now)
  const vs = voiceState(core, { input, output }, now, tier)
  const sinceState = core.stateSince === null ? 0 : now - core.stateSince
  if (vs.measured && vs.channel) {
    const ch = vs.channel
    const view = ch === 'in' ? input : output
    const r = levelReading(vs, signal, now, i.sensitivityDb)
    const lvl = { fill: r.fill, levelDb: r.db, thrFill: r.thrFill }
    if (view.hasBands) {
      const rows = signal.historyBands(ch, now, HILL_LAYER_SPACING_MS, QUALITY[quality].layers)
      const row0 = rows[0]
      return {
        vs, style: 'solid', hill: hillGeometry(rows, quality), ring: ringBars(row0 ? ringLengthsBands(row0) : ringLengthsPlaceholder(0)), ringStride: 1,
        marker: null, arc: vs.state === 'hearing' ? 'speech' : null, glyph: null, stamp: null,
        ...lvl, channel: ch, envelope: false,
      }
    }
    // Tier 0: the legacy scalar. An envelope (time on x), a level ring, and no dB anywhere.
    const hist = signal.scalarHistory(ch, now)
    const newest = hist.length ? hist[hist.length - 1][1] : null
    return {
      vs, style: 'solid', hill: envelopeGeometry(hist, now), ring: ringBars(ringLengthsLevel(newest === null ? 0 : Math.min(1, newest / T0_FULL_SCALE))), ringStride: 1,
      marker: null, arc: vs.state === 'hearing' ? 'speech' : null, glyph: null, stamp: null,
      ...lvl, channel: ch, envelope: true,
    }
  }
  // Nothing measured: hollow, quiet, fixed. The mound only for NO SIGNAL; the others sit on a flat dotted baseline.
  const mound = vs.state === 'no-signal'
  const breath = mound && i.breath
  const hill = mound ? placeholderHill(quality, breathFactor(sinceState, breath)) : flatBaseline(quality)
  const ring = ringBars(ringLengthsPlaceholder(ringBreath(sinceState, breath)))
  return {
    vs, style: 'hollow', hill: hill.count ? hill : emptyPoints(), ring, ringStride: vs.state === 'muted' ? 2 : 1,
    marker: vs.state === 'thinking' ? thinkingMarker(sinceState) : null, arc: vs.state === 'error' ? 'fault' : null, glyph: vs.state === 'error' ? 'triangle' : null,
    stamp: null, fill: null, levelDb: null, thrFill: null, channel: null, envelope: false,
  }
}

// --- drawing ---

/** The slice of CanvasRenderingContext2D the picture uses, so a recorder can stand in for it in tests. */
export interface Ctx2D {
  clearRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  closePath(): void
  rect(x: number, y: number, w: number, h: number): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  globalAlpha: number
  font: string
  textBaseline: CanvasTextBaseline
  textAlign: CanvasTextAlign
}

/** Colours read from the stage by getComputedStyle (so forced colours, the theme and the scene all apply). */
export interface Palette {
  ink: string
  measured: string
  quiet: string
  simulated: string
  fault: string
}

export const FALLBACK_PALETTE: Palette = { ink: '#E9E5DC', measured: '#5FD0E0', quiet: '#9A9A9A', simulated: '#E8B45A', fault: '#E87A6A' }

export interface DrawOptions {
  /** prefers-contrast: more: alpha floor 0.5, 2.5 px points. */
  contrastMore?: boolean
}

const rad = (deg: number) => (deg * Math.PI) / 180

function squares(ctx: Ctx2D, p: Points, layer: number | null, px: number): void {
  const h = px / 2
  for (let n = 0; n < p.count; n++) if (layer === null || p.layer[n] === layer) ctx.rect(p.x[n] - h, p.y[n] - h, px, px)
}

function drawHill(ctx: Ctx2D, s: Scene, pal: Palette, o: DrawOptions): void {
  if (!s.hill.count) return
  if (s.style === 'hollow') {
    // One path of 3 px outline squares in the quiet ink: never solid, never cyan.
    ctx.beginPath()
    squares(ctx, s.hill, null, PH_SQUARE_PX)
    ctx.strokeStyle = pal.quiet
    ctx.lineWidth = 1
    ctx.globalAlpha = 1
    ctx.stroke()
    return
  }
  // One path per alpha bucket: 8 fills a frame, not thousands of draw calls.
  for (let j = 0; j < HILL_ALPHA.length; j++) {
    ctx.beginPath()
    const px = o.contrastMore ? HILL_PX_MORE : j <= 3 ? HILL_PX_NEAR : HILL_PX_FAR
    squares(ctx, s.hill, j, px)
    ctx.globalAlpha = o.contrastMore ? Math.max(HILL_ALPHA[j], HILL_ALPHA_FLOOR_MORE) : HILL_ALPHA[j]
    ctx.fillStyle = s.style === 'simulated' ? pal.simulated : j === 0 ? pal.measured : pal.ink
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawRing(ctx: Ctx2D, s: Scene, pal: Palette): void {
  const r = s.ring
  const hollow = s.style === 'hollow'
  ctx.strokeStyle = hollow ? pal.quiet : s.style === 'simulated' ? pal.simulated : pal.ink
  ctx.lineWidth = hollow ? 1 : RING_BAR_W
  for (const below of [0, 1]) {
    ctx.beginPath()
    for (let k = 0; k < r.count; k += s.ringStride) {
      if (r.below[k] !== below) continue
      if (hollow) {
        // A bar drawn as a 2 px outlined slot: hollow reads as "not a measurement" without colour.
        const dx = r.x1[k] - r.x0[k]
        const dy = r.y1[k] - r.y0[k]
        const len = Math.hypot(dx, dy) || 1
        const nx = (-dy / len) * (RING_BAR_W / 2)
        const ny = (dx / len) * (RING_BAR_W / 2)
        ctx.moveTo(r.x0[k] + nx, r.y0[k] + ny)
        ctx.lineTo(r.x1[k] + nx, r.y1[k] + ny)
        ctx.lineTo(r.x1[k] - nx, r.y1[k] - ny)
        ctx.lineTo(r.x0[k] - nx, r.y0[k] - ny)
        ctx.closePath()
      } else {
        ctx.moveTo(r.x0[k], r.y0[k])
        ctx.lineTo(r.x1[k], r.y1[k])
      }
    }
    ctx.globalAlpha = below ? RING_BELOW_ALPHA : 1
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  if (s.marker) {
    // The thinking marker: three longer hollow bars, labelled by the strip, encoding "working" and never a level.
    ctx.beginPath()
    for (const k of s.marker) {
      const a = rad(-90 + (360 / RING_BARS) * k)
      const len = RING_BAR_MIN + 14
      const c = Math.cos(a)
      const si = Math.sin(a)
      const nx = -si * 1
      const ny = c * 1
      ctx.moveTo(RING_CX + c * RING_BASE_R + nx, RING_CY + si * RING_BASE_R + ny)
      ctx.lineTo(RING_CX + c * (RING_BASE_R + len) + nx, RING_CY + si * (RING_BASE_R + len) + ny)
      ctx.lineTo(RING_CX + c * (RING_BASE_R + len) - nx, RING_CY + si * (RING_BASE_R + len) - ny)
      ctx.lineTo(RING_CX + c * RING_BASE_R - nx, RING_CY + si * RING_BASE_R - ny)
      ctx.closePath()
    }
    ctx.strokeStyle = pal.quiet
    ctx.lineWidth = 1
    ctx.stroke()
  }
  if (s.arc) {
    // A fault arc is 60 degrees in the fault colour, a speech arc 30 degrees in the measured colour, both on the bezel at the top.
    const span = s.arc === 'fault' ? 60 : 30
    ctx.beginPath()
    ctx.arc(RING_CX, RING_CY, RING_BEZEL_R, rad(-90 - span / 2), rad(-90 + span / 2))
    ctx.strokeStyle = s.arc === 'fault' ? pal.fault : pal.measured
    ctx.lineWidth = 4
    ctx.stroke()
  }
  if (s.glyph === 'triangle') {
    // The fault triangle in the centre: a shape, so the state needs no colour.
    ctx.beginPath()
    ctx.moveTo(RING_CX, RING_CY - 18)
    ctx.lineTo(RING_CX + 18, RING_CY + 14)
    ctx.lineTo(RING_CX - 18, RING_CY + 14)
    ctx.closePath()
    ctx.strokeStyle = pal.fault
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

/** One full redraw. The caller clears nothing: this clears the stage itself. */
export function drawScene(ctx: Ctx2D, s: Scene, pal: Palette, o: DrawOptions = {}): void {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H)
  drawRing(ctx, s, pal)
  drawHill(ctx, s, pal, o)
  if (s.stamp) {
    // The stamp is drawn into the canvas corner so a screenshot of the test pattern can never pass as a reading.
    ctx.fillStyle = pal.simulated
    ctx.beginPath()
    ctx.moveTo(18, 22)
    ctx.lineTo(26, 30)
    ctx.lineTo(18, 38)
    ctx.lineTo(10, 30)
    ctx.closePath()
    ctx.fill()
    ctx.font = '12px ui-monospace, Consolas, monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(s.stamp, 34, 30)
  }
}
