// The small forms of Senses (spec 20.9.3), all SVG or text: LinkCube, ChannelMatrix, ProbabilityArc with the spindle
// emblem, the Spectrum bars and the MotionTrace of the Signal view, and the moving ASCII trace under the terrain.
// None of them draws a person: the arc is a gauge, the spindle is three crossed lenses with no centre mark, the cube is
// the ESP32 node. A form with no source is hollow (dashed or hairline) and says why in words next to it.
import { useMemo, type ReactNode } from 'react'
import { LAMP_SPECS, Lamp, showsNumber, type LampReading } from '../../shared/lamp'
import { sparkline } from '../../shared/grammar'
import { ARC_SPAN, BAND_WORD, COLS, arcModel, arcPath, arcPoint, channelLevels, terrainRows, vitalText, type Band, type Frame, type LinkVitals, type Source } from './model'
import type { HistPoint } from './store'

const stateOf = (s: Source) => (s === 'live' ? 'live' : s === 'simulated' ? 'simulated' : 'waiting')
const inkFor = (s: Source) => `var(${LAMP_SPECS[stateOf(s)].token})`

/* ------------------------------------------------------------------ LinkCube */

/** The ESP32 node as an isometric cube with antenna lines. Its three faces are the three link vitals; the numbers sit
 *  beside it, each with its lamp glyph, under one header that carries the state word (a number with its lamp). */
export function LinkCube({ source, vitals, reading }: { source: Source; vitals: LinkVitals; reading: LampReading }) {
  const on = showsNumber(reading.state)
  const rows: { id: string; name: string; value: string }[] = [
    { id: 'fps', name: 'Rate', value: on ? vitalText(vitals.fps, 0, 'Hz') : '--' },
    { id: 'loss', name: 'Lost', value: on ? vitalText(vitals.lossPct, 1, '%') : '--' },
    { id: 'age', name: 'Age', value: on ? vitalText(vitals.ageS, 1, 's') : '--' },
  ]
  return (
    <div className="js-link" data-source={source}>
      <div className="js-link-head"><span className="js-tag">[LNK]</span> ESP32 link <Lamp reading={reading} subject="ESP32 link" /></div>
      <div className="js-link-body">
        <svg className="js-cube" viewBox="0 0 120 120" width="84" height="84" aria-hidden="true" focusable="false">
          <path className="js-cube-face" data-face="top" d="M60 26 104 48 60 70 16 48Z" />
          <path className="js-cube-face" data-face="left" d="M16 48 60 70V114L16 92Z" />
          <path className="js-cube-face" data-face="right" d="M60 70 104 48V92L60 114Z" />
          <path className="js-cube-ant" d="M60 26V6M46 30 36 10M74 30 84 10" />
          <path className="js-cube-wave" d="M52 4a8 8 0 0 1 16 0M44 8a16 12 0 0 1 32 0" />
        </svg>
        <ul className="js-vitals" aria-label="Link vitals">
          {rows.map((r) => (
            <li key={r.id} data-vital={r.id}>
              <span className="js-vital-name"><span className="js-tag">[{r.id.toUpperCase().slice(0, 3)}]</span> {r.name}</span>
              <b className="js-vital-val">{r.value}</b>
              <Lamp reading={reading} size={12} showLabel={false} subject={r.name} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ ChannelMatrix */

const QUARTERS = [
  (cx: number, cy: number, r: number) => `M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`,
  (cx: number, cy: number, r: number) => `M${cx} ${cy}L${cx + r} ${cy}A${r} ${r} 0 0 1 ${cx} ${cy + r}Z`,
  (cx: number, cy: number, r: number) => `M${cx} ${cy}L${cx} ${cy + r}A${r} ${r} 0 0 1 ${cx - r} ${cy}Z`,
  (cx: number, cy: number, r: number) => `M${cx} ${cy}L${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx} ${cy - r}Z`,
]

/** The 51 subcarrier dots in 3 rows of 17. A dot is a ring cut in four quarters, filled one quarter per step of
 *  amplitude; with no frame every dot is a dashed hollow ring. */
export function ChannelMatrix({ amps, source, cursor }: { amps: readonly number[]; source: Source; cursor: number | null }) {
  const levels = useMemo(() => channelLevels(amps), [amps])
  const hollow = source === 'none' || amps.length === 0
  const P = 24
  const G = 22
  return (
    <svg className="js-matrix" viewBox={`0 0 ${G + 17 * P} ${3 * P}`} width={G + 17 * P} height={3 * P} role="img" data-source={hollow ? 'none' : source}
      aria-label={hollow ? 'Channel matrix: no frame, 51 hollow dots' : `Channel matrix: 51 subcarriers, ${levels.filter((l) => l > 0).length} with a signal`}>
      {[1, 18, 35].map((n, r) => <text key={n} x="0" y={r * P + P / 2 + 4} className="js-scale-text" aria-hidden="true">{n}</text>)}
      {Array.from({ length: COLS }, (_, i) => {
        const cx = G + (i % 17) * P + P / 2
        const cy = Math.floor(i / 17) * P + P / 2
        const lv = hollow ? 0 : levels[i]
        return (
          <g key={i} className="js-dot" data-on={lv > 0 ? 'true' : undefined} data-cursor={cursor === i ? 'true' : undefined}>
            <circle cx={cx} cy={cy} r={9} className={hollow ? 'js-dot-ring js-dot-hollow' : 'js-dot-ring'} />
            {Array.from({ length: lv }, (_, q) => <path key={q} d={QUARTERS[q](cx, cy, 9)} className="js-dot-q" />)}
          </g>
        )
      })}
    </svg>
  )
}

/* ------------------------------------------------------------------ ProbabilityArc and the spindle */

export interface ProbabilityArcProps {
  band: Band | null
  p?: number | null
  trusted: boolean
  source: Source
  /** The speed of the spindle in seconds per turn, from real motion energy; null keeps it still. */
  orbitS?: number | null
  drillDays?: number | null
  gateDays?: number
  size?: number
}

const C = 130
const SEGS: { band: Band; from: number; to: number }[] = [
  { band: 'low', from: 3, to: 77 }, { band: 'mid', from: 83, to: 157 }, { band: 'high', from: 163, to: 237 },
]
const LENS = 'M0 -64C26 -28 26 28 0 64C-26 28 -26 -28 0 -64Z'

/** A 240-degree gauge with three bands. Before the held-out check the needle rests at its band's centre and no digit is
 *  drawn anywhere (the digits belong to the caller's text and only exist in the model once `trusted`). */
export function ProbabilityArc({ band, p, trusted, source, orbitS = null, drillDays, gateDays, size = 260 }: ProbabilityArcProps) {
  const m = arcModel({ band, p, trusted, drillDays, gateDays })
  const [nx, ny] = arcPoint(C, C, 96, 0)
  return (
    <svg
      className="js-arc" viewBox="0 8 260 196" width={size} height={Math.round((size * 196) / 260)} data-source={source} data-trusted={trusted ? 'true' : 'false'} data-band={band ?? 'none'}
      role="img" aria-label={`Motion signal, ${m.word}${m.digits ? `, ${m.digits}` : ''}. ${m.provenance}.`}
    >
      <g className="js-spindle" style={{ animationDuration: orbitS ? `${orbitS}s` : undefined }} data-turning={orbitS ? 'true' : 'false'}>
        {[0, 60, 120].map((a) => <path key={a} d={LENS} transform={`translate(${C} ${C}) rotate(${a}) scale(0.78)`} className="js-lens" />)}
        <circle cx={C} cy={C} r={54} className="js-lens-ring" />
      </g>
      <g className="js-arc-ticks" aria-hidden="true">
        {Array.from({ length: 25 }, (_, i) => {
          const [x0, y0] = arcPoint(C, C, 116, (i * ARC_SPAN) / 24)
          const [x1, y1] = arcPoint(C, C, i % 3 === 0 ? 124 : 121, (i * ARC_SPAN) / 24)
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} />
        })}
      </g>
      {SEGS.map((s) => (
        <path
          key={s.band} d={arcPath(C, C, 106, s.from, s.to)} className="js-arc-seg" data-band={s.band}
          data-active={band === s.band ? 'true' : undefined} data-hollow={band ? undefined : 'true'}
          style={band === s.band ? { stroke: inkFor(source) } : undefined}
        />
      ))}
      {(['low', 'mid', 'high'] as const).map((b, i) => {
        const [x, y] = arcPoint(C, C, 82, [40, 120, 200][i])
        return <text key={b} x={x} y={y + 4} textAnchor="middle" className="js-arc-word" data-active={band === b ? 'true' : undefined} aria-hidden="true">{BAND_WORD[b]}</text>
      })}
      {m.needle != null && (
        <g className="js-needle" style={{ transform: `rotate(${m.needle}deg)`, transformOrigin: `${C}px ${C}px` }}>
          <path d={`M${C} ${C}L${nx} ${ny}`} className="js-needle-line" />
          <circle cx={nx} cy={ny} r={5} className="js-needle-head" style={{ fill: inkFor(source) }} />
        </g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ Spectrum (Signal view) */

/** 51 bars, one per subcarrier, from the latest frame. Drawn as a CSS grid of real boxes, not a stretched SVG, so a bar keeps
 *  its corner radius and a true pixel width at any card width; the three axis numbers (1, 26, 51) are text under the bar
 *  centres they name. With no frame the bars are a hollow envelope at a resting height (about 40 percent, a gentle swell
 *  so it reads as a designed pose, not a missing chart) and the words "no frames" sit on a plate inside it. */
export function Spectrum({ amps, source, cursor, onCursor }: { amps: readonly number[]; source: Source; cursor: number | null; onCursor: (c: number | null) => void }) {
  const hollow = source === 'none' || amps.length === 0
  const peak = Math.max(1e-9, ...amps.filter(Number.isFinite))
  const at = (i: number) => `${(((i + 0.5) / COLS) * 100).toFixed(2)}%`
  return (
    <div className="js-spec-wrap">
      <div
        className="js-spectrum" role="img" data-source={hollow ? 'none' : source}
        aria-label={hollow ? 'Spectrum: no frame, 51 hollow bars' : 'Spectrum: amplitude of each of the 51 subcarriers'} onPointerLeave={() => onCursor(null)}
      >
        {Array.from({ length: COLS }, (_, i) => {
          const v = hollow ? 0.3 + 0.16 * Math.sin((i / (COLS - 1)) * Math.PI) : Math.max(0.02, (amps[i] ?? 0) / peak)
          return (
            <i
              key={i} className="js-bar" style={{ height: `${Math.max(3, v * 100).toFixed(1)}%` }} data-hollow={hollow ? 'true' : undefined}
              data-cursor={cursor === i ? 'true' : undefined} onPointerMove={() => onCursor(i)}
            />
          )
        })}
      </div>
      {hollow && <span className="js-hollow-label" aria-hidden="true">no frames</span>}
      <div className="js-axis-lab" aria-hidden="true">
        <span style={{ left: at(0) }}>1</span><span style={{ left: at(25) }}>26</span><span style={{ left: at(50) }}>51</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ MotionTrace (Signal view) */

export interface TraceGeom { path: string; area: string; thr: number | null; rings: { y: number; label: string }[]; last: [number, number] | null }

/** The motion score over about 30 s on a log scale (1x, 10x, 100x stay readable), with the decision threshold. */
export function traceGeometry(hist: readonly HistPoint[], w = 720, h = 170): TraceGeom {
  if (!hist.length) return { path: '', area: '', thr: null, rings: [], last: null }
  const lo = Math.log10(0.5)
  const hi = Math.log10(Math.max(20, ...hist.map((x) => x.score)) * 1.2)
  const y = (v: number) => h - ((Math.log10(Math.max(v, 0.5)) - lo) / (hi - lo)) * (h - 8) - 4
  const n = 150
  const x = (i: number) => ((i + n - hist.length) / (n - 1)) * w
  const pts = hist.map((p, i): [number, number] => [x(i), y(p.score)])
  const path = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('')
  const area = `${path}L${pts[pts.length - 1][0].toFixed(1)} ${h}L${pts[0][0].toFixed(1)} ${h}Z`
  const thr = hist[hist.length - 1].thr
  const rings = [1, 10, 100].filter((r) => Math.log10(r) <= hi).map((r) => ({ y: y(r), label: `${r}x` }))
  return { path, area, thr: thr ? y(thr) : null, rings, last: pts[pts.length - 1] }
}

const TRACE_H = 104

export function MotionTrace({ hist, source }: { hist: readonly HistPoint[]; source: Source }) {
  const g = useMemo(() => traceGeometry(hist, 720, TRACE_H), [hist])
  const empty = !hist.length || source === 'none'
  return (
    <div className="js-trace-wrap">
      <svg className="js-trace" viewBox={`0 0 720 ${TRACE_H}`} preserveAspectRatio="none" width="100%" role="img" data-source={empty ? 'none' : source}
        aria-label={empty ? 'Motion score over 30 seconds: no frames yet' : 'Motion score over 30 seconds on a log scale, with its threshold'}>
        {g.rings.map((r) => <line key={r.label} className="js-trace-ringline" x1="0" x2="720" y1={r.y} y2={r.y} />)}
        {empty ? <path className="js-trace-hollow" vectorEffect="non-scaling-stroke" d="M0 74C90 74 120 46 200 46S300 74 400 68 520 40 600 54 690 68 720 62" /> : (
          <>
            <path d={g.area} className="js-trace-area" />
            <path d={g.path} className="js-trace-line" vectorEffect="non-scaling-stroke" />
            {g.thr != null && <line x1="0" x2="720" y1={g.thr} y2={g.thr} className="js-trace-thr" vectorEffect="non-scaling-stroke" />}
          </>
        )}
      </svg>
      {/* the 1x, 10x, 100x marks are text, not svg text: the svg stretches with the card, the marks keep their size */}
      {g.rings.map((r) => <span key={r.label} className="js-trace-mark" style={{ top: `${(r.y / TRACE_H) * 100}%` }} aria-hidden="true">{r.label}</span>)}
      {empty && <span className="js-hollow-label" aria-hidden="true">no frames</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ MotionDial (Signal view) */

/** The dial's scale: 0.5x to 20x on a log scale, the same decades as the trace under it. */
export const DIAL_LO = 0.5
export const DIAL_HI = 20
export const dialFrac = (v: number): number => Math.max(0, Math.min(1, (Math.log10(Math.max(v, DIAL_LO)) - Math.log10(DIAL_LO)) / (Math.log10(DIAL_HI) - Math.log10(DIAL_LO))))

const DW = 240
const DH = 164
const DCX = 120
const DCY = 100
const DR = 82

/**
 * The motion score as a gauge in the Well Wisher dial family, drawn in JARVIS ink: a 240 degree track on a log scale, the
 * value arc in the source's ink, the threshold as a tick across the track, and the score at the hub (a dash with no
 * frame, and the track hollow). The hub number is real text (the caller's markup), so it keeps its test id and its size at
 * any width; the source lamp and its word sit in the card header.
 */
export function MotionDial({ score, threshold, source, hub }: { score: number | null; threshold: number | null; source: Source; hub: ReactNode }) {
  const on = source !== 'none' && score != null && Number.isFinite(score)
  const f = on ? dialFrac(score as number) : 0
  const tf = on && threshold != null && Number.isFinite(threshold) ? dialFrac(threshold) : null
  const [vx, vy] = arcPoint(DCX, DCY, DR, f * ARC_SPAN)
  const [t0x, t0y] = tf == null ? [0, 0] : arcPoint(DCX, DCY, DR - 11, tf * ARC_SPAN)
  const [t1x, t1y] = tf == null ? [0, 0] : arcPoint(DCX, DCY, DR + 11, tf * ARC_SPAN)
  const [s0x, s0y] = arcPoint(DCX, DCY, DR, 0)
  const [s1x, s1y] = arcPoint(DCX, DCY, DR, ARC_SPAN)
  return (
    <div className="js-dial" data-source={source} data-hollow={on ? undefined : 'true'}>
      <svg viewBox={`0 0 ${DW} ${DH}`} width={DW} height={DH} role="img" aria-label={on ? `Motion score dial, ${(score as number).toFixed(1)}x on a log scale from 0.5x to 20x${tf != null ? `, threshold ${(threshold as number).toFixed(2)}x` : ''}` : 'Motion score dial: no frames, so no reading'}>
        <g className="js-dial-ticks" aria-hidden="true">
          {Array.from({ length: 25 }, (_, i) => {
            const [x0, y0] = arcPoint(DCX, DCY, DR + 12, (i * ARC_SPAN) / 24)
            const [x1, y1] = arcPoint(DCX, DCY, DR + (i % 6 === 0 ? 18 : 15), (i * ARC_SPAN) / 24)
            return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} />
          })}
        </g>
        <path d={arcPath(DCX, DCY, DR, 0, ARC_SPAN)} className="js-dial-track" />
        {on && f > 0.004 && <path d={arcPath(DCX, DCY, DR, 0, f * ARC_SPAN)} className="js-dial-value" style={{ stroke: inkFor(source) }} />}
        {on && <circle cx={vx} cy={vy} r={6} className="js-dial-knob" style={{ fill: inkFor(source) }} />}
        {tf != null && <line x1={t0x} y1={t0y} x2={t1x} y2={t1y} className="js-dial-thr" />}
        <text x={s0x} y={s0y + 18} textAnchor="middle" className="js-dial-end" aria-hidden="true">0.5x</text>
        <text x={s1x} y={s1y + 18} textAnchor="middle" className="js-dial-end" aria-hidden="true">20x</text>
      </svg>
      <div className="js-dial-hub">{hub}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ the moving ASCII trace */

/** A line of block characters of the last motion scores, drawn as text; it moves one cell per fresh sample. Decoration:
 *  aria-hidden, and it carries no digit (the number is in the readout beside it, with its lamp). */
export function AsciiTrace({ hist, source, width = 64 }: { hist: readonly HistPoint[]; source: Source; width?: number }) {
  const text = useMemo(() => {
    if (source === 'none' || hist.length === 0) return '·'.repeat(width)
    return sparkline(hist.slice(-width).map((h) => h.score)).padStart(width, '·')
  }, [hist, source, width])
  return <span className="js-ascii" aria-hidden="true" data-source={source}>{text}</span>
}

/* ------------------------------------------------------------------ the text waterfall */

const WATERFALL = ' .:-=+*#%@'

/** The last frames as rows of characters, one per subcarrier: the same 51 x time picture as the terrain, in text, and it
 *  moves one row per fresh frame. With no frame every cell is a dot. A picture of text with a readable name. */
export function AsciiWaterfall({ frames, source, rows = 8 }: { frames: readonly Frame[]; source: Source; rows?: number }) {
  const lines = useMemo(() => {
    if (source === 'none' || frames.length === 0) return Array.from({ length: rows }, () => '.'.repeat(COLS))
    const norm = terrainRows(frames.slice(-rows))
    const out = norm.map((r) => r.map((v) => WATERFALL[Math.min(WATERFALL.length - 1, Math.round(v * (WATERFALL.length - 1)))]).join(''))
    while (out.length < rows) out.unshift('.'.repeat(COLS))
    return out
  }, [frames, source, rows])
  return <pre className="js-waterfall" data-source={source} role="img" aria-label={source === 'none' ? 'Text waterfall: no frames' : `Text waterfall of the last ${Math.min(rows, frames.length)} frames, 51 subcarriers`}>{lines.join('\n')}</pre>
}
