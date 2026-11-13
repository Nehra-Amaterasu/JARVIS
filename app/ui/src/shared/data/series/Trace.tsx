// Trace (spec 20.5.2, package D02): the product's time-series instrument. A single 1.5 px hairline on a charcoal
// scope screen over a faint dot grid; the last point a disc, the seven before it rings; days with no data a hatched
// band where the line stops (never interpolated); an ASCII ruler `|····|····|` with mono dates; a dashed datum for the
// student's own median. Hover or the arrow keys scrub a hairline with a callout; Enter pins it, so a second scrub reads
// a two-point difference. The line draws once on first view in 320 ms; calm and the OS reduce flag show it drawn.
// Only LIVE and SIMULATED draw a number; WAITING, PLANNED and FAULT draw the hollow form (a dashed datum and the ruler)
// and say why.
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { sparkline } from '../../grammar'
import { LAMP_SPECS, LampGlyph, type LampState } from '../../lamp'
import {
  RULER_PX_PER_CHAR, TRACE_H, TRACE_H_PHONE, TRACE_PHONE_W, cleanPoints, diffText, fmtDay, fmtValue, nearestIndex, rulerText,
  stepIndex, traceLayout, type TraceGeom, type TracePoint,
} from './layout'
import { Housing, Screen, TableFold, isHollow, useDrawOnce, useWidth } from './parts'

export interface TraceProps {
  points: TracePoint[]
  /** The student's own 30-day median: a dashed datum. Never someone else's. */
  median?: number
  state: LampState
  /** Optional (beyond the contract): what the series is, its unit, why a hollow form is hollow, the median's name. */
  label?: string
  unit?: string
  reason?: string
  medianLabel?: string
}

/** "+6", "−2", "±0": a plain signed difference, neutral ink (no colour for up or down). */
const signed = (d: number) => (Math.abs(d) < 0.05 ? '±0' : `${d > 0 ? '+' : '−'}${fmtValue(Math.abs(d))}`)

/** The block-character twin of the latest twelve values (gaps as a hatch). */
export const TRACE_SPARK_N = 12
const PAGE = 7
/** A gap band at least this wide says "no data" in words; a narrower one carries the empty-set sign. */
const GAP_WORD_MIN = 52

export function Trace({ points, median, state, label = 'Series', unit, reason, medianLabel = 'median 30 d' }: TraceProps) {
  const hollow = isHollow(state)
  const [stageRef, width] = useWidth(760)
  const height = width < TRACE_PHONE_W ? TRACE_H_PHONE : TRACE_H
  const g = useMemo(() => traceLayout(hollow ? [] : points, { w: width, h: height }, hollow ? undefined : median), [points, median, width, height, hollow])
  const draw = useDrawOnce(!hollow && g.paths.length > 0)
  const [hover, setHover] = useState<number | null>(null)
  const [pin, setPin] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const uid = useId().replace(/:/g, '')
  const hintId = `${uid}-hint`

  const cur = hover !== null && g.dots[hover]?.y != null ? hover : null
  const pinned = pin !== null && g.dots[pin]?.y != null ? pin : null
  const lastDot = g.last !== null ? g.dots[g.last] : null
  const vt = (i: number | null) => {
    const d = i === null ? null : g.dots[i]
    return d && d.v !== null ? `${fmtDay(d.t)}: ${fmtValue(d.v)}${unit ? ` ${unit}` : ''}` : 'no point'
  }
  const diff = cur !== null && pinned !== null && cur !== pinned
    ? diffText({ t: g.dots[pinned].t, v: g.dots[pinned].v! }, { t: g.dots[cur].t, v: g.dots[cur].v! }, unit)
    : null

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width) return
    const i = nearestIndex(g, ((e.clientX - r.left) / r.width) * g.w)
    if (i !== hover) setHover(i)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = cur ?? g.last
    let next: number | null | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = stepIndex(g, from, 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = stepIndex(g, from, -1)
    else if (e.key === 'PageUp') next = stepIndex(g, from, -1, PAGE)
    else if (e.key === 'PageDown') next = stepIndex(g, from, 1, PAGE)
    else if (e.key === 'Home') next = stepIndex(g, null, 1)
    else if (e.key === 'End') next = stepIndex(g, null, -1)
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const at = cur ?? g.last
      setPin((p) => (p === at ? null : at))
      return
    } else if (e.key === 'Escape') {
      if (pin !== null) setPin(null)
      else setHover(null)
      return
    } else return
    e.preventDefault()
    setHover(next ?? null)
  }

  const spark = sparkline(cleanPoints(points).slice(-TRACE_SPARK_N).map((p) => (p.v === null ? NaN : p.v)))
  const readout = hollow ? (
    <div className="sr-big" data-hollow="true" aria-hidden="true"><span className="sr-num sr-num-hollow">-- --</span></div>
  ) : (
    <>
      <div className="sr-big">
        <span className="sr-num">{lastDot && lastDot.v !== null ? fmtValue(lastDot.v) : '--'}</span>
        {unit && <span className="sr-unit">{unit}</span>}
        <span className="sr-asof">{lastDot ? `latest, ${fmtDay(lastDot.t)}` : 'no point yet'}</span>
      </div>
      <div className="sr-sub">
        {typeof median === 'number' && Number.isFinite(median) && <span className="sr-kv"><span className="sr-k">{medianLabel}</span> {fmtValue(median)}{unit ? ` ${unit}` : ''}</span>}
        {typeof median === 'number' && Number.isFinite(median) && lastDot && lastDot.v !== null && (
          <span className="sr-kv"><span className="sr-k">latest vs median</span> {signed(lastDot.v - median)}{unit ? ` ${unit}` : ''}</span>
        )}
        <span className="sr-spark" aria-label={`last ${TRACE_SPARK_N} as blocks`} role="img">{spark}</span>
      </div>
      <p className="sr-diff" aria-live="polite">{diff ? <><span className="sr-k">pinned</span> {diff}</> : pinned !== null ? <><span className="sr-k">pinned</span> {vt(pinned)}; move to compare</> : ' '}</p>
    </>
  )

  const measured = g.dots.filter((d) => d.v !== null).length
  return (
    <Housing
      component="Trace" state={state} label={label} reason={reason} readout={readout}
      foot={hollow ? undefined : <TraceLegend gaps={g.gaps.length > 0} median={g.medianY !== null} />}
      table={hollow ? undefined : (
        <TableFold
          caption={`${label}: ${measured} measured of ${g.dots.length} points`}
          head={['Date', unit ? `Value (${unit})` : 'Value']}
          rows={() => g.dots.map((d) => [fmtDay(d.t), d.v === null ? 'no data' : fmtValue(d.v)])}
        />
      )}
    >
      <div ref={stageRef} className="sr-stage">
        <Screen
          height={height} planned={state === 'planned'} draw={draw.phase} boxRef={draw.ref}
          tag={hollow ? 'no values' : `${width < TRACE_PHONE_W ? '' : 'series · '}${g.dots.length} pts${g.gaps.length ? ` · ${g.gaps.length} no data` : ''}`}
          status={<><LampGlyph state={state} size={9} />{LAMP_SPECS[state].label}</>}
        >
          {hollow ? (
            <div className="sr-plot" role="img" aria-label={`${label}: ${LAMP_SPECS[state].label}, no values drawn`}>
              <TraceSvg g={g} uid={uid} hollow state={state} cur={null} pinned={null} />
            </div>
          ) : (
            <div
              className="sr-plot" role="slider" tabIndex={0}
              aria-label={`${label} trace`} aria-describedby={hintId}
              aria-valuemin={0} aria-valuemax={Math.max(0, g.dots.length - 1)} aria-valuenow={cur ?? g.last ?? 0}
              aria-valuetext={vt(cur ?? g.last)}
              onPointerMove={onMove}
              onPointerLeave={() => { if (!focused) setHover(null) }}
              onClick={() => { if (cur !== null) setPin((p) => (p === cur ? null : cur)) }}
              onKeyDown={onKey}
              onFocus={() => { setFocused(true); if (hover === null) setHover(g.last) }}
              onBlur={() => { setFocused(false); setHover(null) }}
              onAnimationEnd={(e) => { if (e.animationName === 'sr-draw') draw.done() }}
            >
              <TraceSvg g={g} uid={uid} state={state} cur={cur} pinned={pinned} />
              {cur !== null && <Callout g={g} i={cur} unit={unit} state={state} />}
              {pinned !== null && pinned !== cur && <Callout g={g} i={pinned} unit={unit} state={state} pinned />}
            </div>
          )}
          <span id={hintId} className="sr-hint">Arrow keys move along the days, Enter pins a point to compare, Escape clears.</span>
        </Screen>
      </div>
    </Housing>
  )
}

function TraceLegend({ gaps, median }: { gaps: boolean; median: boolean }) {
  return (
    <ul className="sr-legend" aria-label="Legend">
      <li><svg width="22" height="10" aria-hidden="true"><path d="M1 8L8 3L14 6L21 2" className="sr-lg-line" /></svg>measured</li>
      <li><svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="3.5" className="sr-lg-disc" /></svg>latest</li>
      <li><svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="3" className="sr-lg-ring" /></svg>week before</li>
      {median && <li><svg width="22" height="10" aria-hidden="true"><path d="M1 5H21" className="sr-lg-median" /></svg>own median</li>}
      {gaps && <li><svg width="16" height="10" aria-hidden="true"><rect x="0.5" y="0.5" width="15" height="9" className="sr-lg-gap" /></svg>no data, not filled in</li>}
    </ul>
  )
}

function TraceSvg({ g, uid, hollow = false, state, cur, pinned }: { g: TraceGeom; uid: string; hollow?: boolean; state: LampState; cur: number | null; pinned: number | null }) {
  const { plot } = g
  const cols = Math.round((plot.x1 - plot.x0) / RULER_PX_PER_CHAR)
  const rulerY = plot.y1 + 16
  const labels = g.dots.length
    ? [g.dots[0], g.dots[Math.floor((g.dots.length - 1) / 2)], g.dots[g.dots.length - 1]].filter((d, k, a) => a.findIndex((o) => o.i === d.i) === k)
    : []
  const midY = (plot.y0 + plot.y1) / 2
  return (
    <svg className="sr-svg" width={g.w} height={g.h} viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden="true" focusable="false" data-tone={state}>
      <defs>
        <pattern id={`${uid}-grid`} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="0.7" className="sr-grid-dot" />
        </pattern>
        <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="sr-hatch-line" />
        </pattern>
        {/* the halftone ground: a 4 px dot screen whose dots thin out towards the base (C02-02, C04-26) */}
        <pattern id={`${uid}-tone`} width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.9" className="sr-tone-dot" />
        </pattern>
        <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
        </linearGradient>
        <mask id={`${uid}-tmask`} maskUnits="userSpaceOnUse" x={plot.x0} y={plot.y0 - 8} width={plot.x1 - plot.x0} height={plot.y1 - plot.y0 + 8}>
          <rect x={plot.x0} y={plot.y0 - 8} width={plot.x1 - plot.x0} height={plot.y1 - plot.y0 + 8} fill={`url(#${uid}-fade)`} />
        </mask>
      </defs>
      <rect x={plot.x0} y={plot.y0 - 8} width={plot.x1 - plot.x0} height={plot.y1 - plot.y0 + 16} fill={`url(#${uid}-grid)`} />
      {/* the baseline: a hairline with a tick every 40 px (the datum of 20.5.1) */}
      <path className="sr-base" d={`M${plot.x0} ${plot.y1 + 4}H${plot.x1}${Array.from({ length: Math.floor((plot.x1 - plot.x0) / 40) + 1 }, (_, k) => `M${plot.x0 + k * 40} ${plot.y1 + 4}v3`).join('')}`} />
      {hollow ? (
        <>
          <path className="sr-datum-hollow" d={`M${plot.x0} ${midY}H${plot.x1}`} />
          <text className="sr-svg-word" x={(plot.x0 + plot.x1) / 2} y={midY - 10} textAnchor="middle">{`[${LAMP_SPECS[state].label}]`}</text>
        </>
      ) : (
        <>
          <g className="sr-area" mask={`url(#${uid}-tmask)`}>
            {g.areas.map((d, k) => <path key={k} d={d} fill={`url(#${uid}-tone)`} />)}
          </g>
          {g.gaps.map((gp, k) => (
            <g key={k} className="sr-gap">
              <rect x={gp.x0} y={plot.y0 - 8} width={gp.x1 - gp.x0} height={plot.y1 - plot.y0 + 12} fill={`url(#${uid}-hatch)`} />
              <path className="sr-gap-edge" d={`M${gp.x0} ${plot.y0 - 8}V${plot.y1 + 4}M${gp.x1} ${plot.y0 - 8}V${plot.y1 + 4}`} />
              <text className="sr-gap-word" x={(gp.x0 + gp.x1) / 2} y={plot.y1 - 6} textAnchor="middle">{gp.x1 - gp.x0 >= GAP_WORD_MIN ? 'no data' : '∅'}</text>
            </g>
          ))}
          {g.medianY !== null && (
            <>
              <path className="sr-median" d={`M${plot.x0} ${g.medianY}H${plot.x1}`} />
              <text className="sr-svg-label" x={plot.x1 + 6} y={g.medianY + 4}>med</text>
            </>
          )}
          {g.max !== null && <text className="sr-svg-label" x={plot.x1 + 6} y={plot.y0 + 4}>{`hi ${fmtValue(g.max)}`}</text>}
          {g.min !== null && <text className="sr-svg-label" x={plot.x1 + 6} y={plot.y1}>{`lo ${fmtValue(g.min)}`}</text>}
          {pinned !== null && <path className="sr-scrub sr-scrub-pin" d={`M${g.dots[pinned].x} ${plot.y0 - 8}V${plot.y1 + 4}`} />}
          {cur !== null && <path className="sr-scrub" d={`M${g.dots[cur].x} ${plot.y0 - 8}V${plot.y1 + 4}`} />}
          {g.paths.map((d, k) => <path key={k} className="sr-line" d={d} pathLength={1} />)}
          <g className="sr-marks">
            {g.rings.map((i) => <circle key={i} className="sr-ring" cx={g.dots[i].x} cy={g.dots[i].y!} r={2.6} />)}
            {g.last !== null && (
              <>
                <circle className="sr-halo" cx={g.dots[g.last].x} cy={g.dots[g.last].y!} r={7} />
                <circle className="sr-disc" cx={g.dots[g.last].x} cy={g.dots[g.last].y!} r={3.6} />
              </>
            )}
            {cur !== null && <circle className="sr-cursor" cx={g.dots[cur].x} cy={g.dots[cur].y!} r={5} />}
            {pinned !== null && <rect className="sr-pin" x={g.dots[pinned].x - 4} y={g.dots[pinned].y! - 4} width={8} height={8} transform={`rotate(45 ${g.dots[pinned].x} ${g.dots[pinned].y})`} />}
          </g>
        </>
      )}
      <text className="sr-ruler" x={plot.x0} y={rulerY} textLength={plot.x1 - plot.x0} lengthAdjust="spacing">{rulerText(cols)}</text>
      {!hollow && labels.map((d, k) => (
        <text key={d.i} className="sr-svg-label" x={d.x} y={rulerY + 16} textAnchor={k === 0 ? 'start' : k === labels.length - 1 ? 'end' : 'middle'}>{fmtDay(d.t)}</text>
      ))}
    </svg>
  )
}

/** The scrub callout: a flat plate joined to its point by a 1 px leader that bends once at 45 degrees. */
function Callout({ g, i, unit, state, pinned = false }: { g: TraceGeom; i: number; unit?: string; state: LampState; pinned?: boolean }) {
  const d = g.dots[i]
  if (d.y === null || d.v === null) return null
  const right = d.x < g.w * 0.62
  const W = 112
  const H = 46
  const lx = right ? d.x + 12 : d.x - 12
  const ly = d.y - 12
  const left = Math.max(4, Math.min(g.w - W - 4, right ? lx + 8 : lx - 8 - W))
  const top = Math.max(4, Math.min(g.h - H - 4, ly - H / 2))
  const edge = right ? left : left + W
  return (
    <>
      <svg className="sr-leader" width={g.w} height={g.h} aria-hidden="true" focusable="false">
        <path d={`M${d.x} ${d.y}L${lx} ${ly}H${edge}`} />
      </svg>
      <div className="sr-callout" data-pinned={pinned ? 'true' : 'false'} style={{ left, top, inlineSize: W }} aria-hidden="true">
        <span className="sr-co-date">{pinned ? `pin ${fmtDay(d.t)}` : fmtDay(d.t)}</span>
        <span className="sr-co-val">{fmtValue(d.v)}{unit && <small> {unit}</small>}</span>
        <span className="sr-co-lamp"><LampGlyph state={state} size={10} />{LAMP_SPECS[state].label}</span>
      </div>
    </>
  )
}
