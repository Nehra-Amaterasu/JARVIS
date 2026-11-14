// DayArc (spec 20.16.1): today as one instrument. A half ring of 18 hour ticks from 06:00 to 24:00, three recessed tracks
// (outer: classes, solid; middle: planned, hollow; inner: done, filled) and one notch at now. The notch moves because the
// caller passes a new `now` once a minute (one timeout, model.msToNextMinute); this component has no timer, no transition
// and no animation, so it is the same picture under reduced motion and on a static page.
//
// DaySpine is the same data as a vertical spine for the phone (358 px): the arc would be 150 px tall there and unreadable.
import { useId, type ReactNode } from 'react'
import { LampGlyph, type LampState } from '../../../shared/lamp'
import { arcGeometry, arcPath, arcPoint, arcFrac, arcText, hourTicks, minOfDate, onArc, toMin, hhmm, ARC_START_MIN, ARC_SPAN_MIN, type DayBlock } from './model'

export interface DayArcProps {
  /** Class blocks (outer track). */
  blocks: DayBlock[]
  planned: DayBlock[]
  done: DayBlock[]
  now: Date
  state: LampState
  /** Drawing box; default 560 x 300. */
  width?: number
  height?: number
  /** No classes entered: the outer track is drawn dashed. */
  dashed?: boolean
  /** Drawn at the centre, above the datum (the Odometer hero). */
  children?: ReactNode
}

export function DayArc({ blocks, planned, done, now, state, width = 560, height = 300, dashed, children }: DayArcProps) {
  const g = arcGeometry(width, height)
  const tid = useId()
  const nowMin = minOfDate(now)
  const nf = arcFrac(nowMin)
  const hollow = state === 'waiting' || state === 'planned' || state === 'fault'
  const tracks: { key: 'class' | 'planned' | 'done'; r: number; list: DayBlock[] }[] = [
    { key: 'class', r: g.r.class, list: blocks },
    { key: 'planned', r: g.r.planned, list: planned },
    { key: 'done', r: g.r.done, list: done },
  ]
  const n1 = arcPoint(g.cx, g.cy, g.r.done - g.track, nf)
  const n2 = arcPoint(g.cx, g.cy, g.tickR + 8, nf)
  const words = arcText({ classes: blocks, planned, done })
  return (
    <figure className="td-arc" data-lamp={state} data-component="day-arc" style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={tid} focusable="false">
        <title id={tid}>{`Today from 06:00 to 24:00, now ${hhmm(nowMin)}. ${words.length ? words.join('. ') : 'No blocks yet.'}`}</title>
        {/* the recessed grooves: one per track, the full half ring */}
        {tracks.map((t) => (
          <path key={`g-${t.key}`} className="td-groove" data-track={t.key} data-dashed={t.key === 'class' && dashed ? 'true' : undefined}
            d={arcPath(g.cx, g.cy, t.r, 0, 1)} strokeWidth={g.track + 6} />
        ))}
        {/* the hour dots (the dial's scale), a longer tick every third hour */}
        {hourTicks().map((h) => {
          const f = arcFrac(h.min)
          const p = arcPoint(g.cx, g.cy, g.tickR, f)
          const l = arcPoint(g.cx, g.cy, g.labelR, f)
          return (
            <g key={h.min} className="td-tick" data-major={h.label ? 'true' : undefined} data-past={h.min <= nowMin ? 'true' : undefined}>
              <circle cx={p.x} cy={p.y} r={h.label ? 2.6 : 1.8} />
              {h.label && <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle">{h.label}</text>}
            </g>
          )
        })}
        {!hollow && tracks.map((t) => onArc(t.list).map((b) => (
          <g key={b.id} className="td-block" data-kind={b.kind}>
            {b.kind === 'planned' && <path className="td-block-rim" d={arcPath(g.cx, g.cy, t.r, b.a, b.b)} strokeWidth={g.track} />}
            <path className="td-block-body" d={arcPath(g.cx, g.cy, t.r, b.a, b.b)} strokeWidth={b.kind === 'planned' ? g.track - 5 : g.track} />
          </g>
        )))}
        {/* the datum: the flat side of the instrument */}
        <path className="td-datum" d={`M${g.cx - g.labelR - 6} ${g.cy}H${g.cx + g.labelR + 6}`} />
        {nowMin >= ARC_START_MIN - 60 && (
          <g className="td-now" data-now={hhmm(nowMin)}>
            <path d={`M${n1.x} ${n1.y}L${n2.x} ${n2.y}`} />
            <circle cx={n2.x} cy={n2.y} r={4} />
          </g>
        )}
      </svg>
      {children && <div className="td-arc-centre" style={{ left: g.cx, bottom: height - g.cy + 10, width: (g.r.done - g.track - 8) * 2, maxHeight: g.r.done - g.track - 10 }}>{children}</div>}
      <figcaption className="td-arc-legend">
        <span><i data-kind="class" />class</span>
        <span><i data-kind="planned" />planned</span>
        <span><i data-kind="done" />done</span>
        <span className="td-arc-lamp"><LampGlyph state={state} size={12} />{state === 'live' ? 'today' : state}</span>
      </figcaption>
    </figure>
  )
}

/** The arc as a vertical spine (phone): 06:00 at the top, 24:00 at the bottom, three lanes, the now line across. */
export function DaySpine({ blocks, planned, done, now, state, width = 320, height = 320, dashed }: Omit<DayArcProps, 'children'>) {
  const tid = useId()
  const top = 12
  const bot = height - 12
  const y = (min: number) => Math.round(top + ((Math.max(ARC_START_MIN, Math.min(ARC_START_MIN + ARC_SPAN_MIN, min)) - ARC_START_MIN) / ARC_SPAN_MIN) * (bot - top))
  const axis = 46
  const lanes: { key: DayBlock['kind']; x: number; list: DayBlock[] }[] = [
    { key: 'class', x: axis + 14, list: blocks },
    { key: 'planned', x: axis + 38, list: planned },
    { key: 'done', x: axis + 62, list: done },
  ]
  const nowMin = minOfDate(now)
  const words = arcText({ classes: blocks, planned, done })
  const hollow = state === 'waiting' || state === 'planned' || state === 'fault'
  return (
    <figure className="td-spine" data-lamp={state} data-component="day-spine" style={{ width: '100%', maxWidth: width, height }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMid meet" role="img" aria-labelledby={tid} focusable="false">
        <title id={tid}>{`Today from 06:00 to 24:00, now ${hhmm(nowMin)}. ${words.length ? words.join('. ') : 'No blocks yet.'}`}</title>
        {lanes.map((l) => (
          <line key={l.key} className="td-groove" data-track={l.key} data-dashed={l.key === 'class' && dashed ? 'true' : undefined} x1={l.x} x2={l.x} y1={top} y2={bot} strokeWidth={16} />
        ))}
        {hourTicks().map((h) => (
          <g key={h.min} className="td-tick" data-major={h.label ? 'true' : undefined}>
            <circle cx={axis} cy={y(h.min)} r={h.label ? 2.6 : 1.6} />
            {h.label && <text x={axis - 10} y={y(h.min)} textAnchor="end" dominantBaseline="middle">{h.label}</text>}
          </g>
        ))}
        {!hollow && lanes.map((l) => l.list.map((b) => {
          const a = y(toMin(b.from) ?? 0)
          const z = Math.max(a + 4, y(toMin(b.to) ?? 0))
          return (
            <g key={b.id} className="td-block" data-kind={b.kind}>
              {b.kind === 'planned' && <line className="td-block-rim" x1={l.x} x2={l.x} y1={a} y2={z} strokeWidth={12} />}
              <line className="td-block-body" x1={l.x} x2={l.x} y1={a} y2={z} strokeWidth={b.kind === 'planned' ? 7 : 12} />
            </g>
          )
        }))}
        <g className="td-now">
          <path d={`M${axis - 6} ${y(nowMin)}H${axis + 72}`} />
          <circle cx={axis + 72} cy={y(nowMin)} r={4} />
        </g>
      </svg>
    </figure>
  )
}
