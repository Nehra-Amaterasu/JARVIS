// DayRing24 (A.J02, spec 20.9.2): the day as a 24 hour ring. One thin arc per rule window the app really reports (quiet
// hours of the presence rule, the night the auto-off holds back on), a 96-tick bezel (one tick per 15 minutes, a glyph per
// hour), the notch at now, and a scrubber.
//
// The scrubber is PREVIEW ONLY. Dragging it, or Left and Right in 15 minute steps, only changes the centre text: "PREVIEW
// 22:00: quiet hours no auto-on". It never sends a request and never changes a lamp: this component has no send, no store and
// no board in its props, so it cannot (e2e and vitest both assert it). Releasing the pointer, or Escape, returns to now.
// The centre carries the PLANNED dashed-ring glyph and the words "not the board" while a preview is up.
//
// No rule that sets a channel's on-window exists in any route, so none is drawn: the ring says so in one line.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { PlannedGlyph } from '../../shared/lamp/PlannedGlyph'
import { DAY_MIN, STEP_MIN, arcPath, hhmm, previewLine, ruleSpans, snapStep, type Rule } from './model'
import './room.css'

export interface DayRing24Props {
  rules: Rule[]
  now: Date
  /** The previewed time while scrubbing, or null when it is released. A callback for the host to mirror it; never a command. */
  onPreview?: (t: Date | null) => void
  /** Drawn pixels; the viewBox is fixed, so the ring scales. */
  size?: number
}

const C = 140
const R_TRACK = 108
const LANE = 14

const nowMin = (d: Date) => d.getHours() * 60 + d.getMinutes()

export function DayRing24({ rules, now, onPreview, size = 280 }: DayRing24Props) {
  const [prev, setPrev] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef(false)
  const nowM = nowMin(now)
  const at = prev ?? nowM

  const emit = (min: number | null) => {
    setPrev(min)
    if (!onPreview) return
    if (min === null) return onPreview(null)
    const t = new Date(now)
    t.setHours(Math.floor(min / 60), min % 60, 0, 0)
    onPreview(t)
  }

  const fromPointer = (e: PointerEvent<SVGSVGElement>): number | null => {
    const r = svg.current?.getBoundingClientRect()
    if (!r || r.width === 0) return null
    const x = e.clientX - (r.left + r.width / 2)
    const y = e.clientY - (r.top + r.height / 2)
    const turn = (Math.atan2(x, -y) / (Math.PI * 2) + 1) % 1
    return snapStep(turn * DAY_MIN)
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    const m = fromPointer(e)
    if (m === null) return
    drag.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    emit(m)
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const m = fromPointer(e)
    if (m !== null) emit(m)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = false
    emit(null)
  }
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    const step = (d: 1 | -1) => { e.preventDefault(); emit(snapStep(at, d)) }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') step(1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') step(-1)
    else if (e.key === 'PageUp') { e.preventDefault(); emit(snapStep(at + 60 - STEP_MIN, 1)) }
    else if (e.key === 'PageDown') { e.preventDefault(); emit(snapStep(at - 60 + STEP_MIN, -1)) }
    else if (e.key === 'Home') { e.preventDefault(); emit(0) }
    else if (e.key === 'End') { e.preventDefault(); emit(DAY_MIN - STEP_MIN) }
    else if (e.key === 'Escape' && prev !== null) { e.preventDefault(); e.stopPropagation(); emit(null) }
  }

  const pt = (min: number, r: number) => {
    const a = (min / DAY_MIN) * Math.PI * 2
    return { x: C + Math.sin(a) * r, y: C - Math.cos(a) * r }
  }
  const handle = pt(at, R_TRACK + 14)
  const nowTick = [pt(nowM, R_TRACK - 8 - rules.length * LANE), pt(nowM, R_TRACK + 8)]
  const lines = prev === null ? [] : previewLine(rules, prev).replace(/^PREVIEW \d\d:\d\d: /, '').split('; ')
  return (
    <figure className="jr-ring" data-previewing={prev === null ? undefined : 'true'} style={{ width: size }}>
      <svg ref={svg} viewBox="0 0 280 280" width={size} height={size} role="group" aria-label="Day ring" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {/* the 96 tick bezel: one tick per quarter hour, longer on the hour */}
        <g className="jr-ring-ticks" aria-hidden="true">
          {Array.from({ length: 96 }, (_, i) => {
            const hour = i % 4 === 0
            const a = pt(i * STEP_MIN, R_TRACK + (hour ? 4 : 7))
            const b = pt(i * STEP_MIN, R_TRACK + 10)
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} data-hour={hour ? 'true' : undefined} data-six={i % 24 === 0 ? 'true' : undefined} />
          })}
        </g>
        <g className="jr-ring-hours" aria-hidden="true">
          {[0, 6, 12, 18].map((h) => {
            const p = pt(h * 60, R_TRACK + 23)
            return <text key={h} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central">{String(h).padStart(2, '0')}</text>
          })}
        </g>
        {/* the track and one lane per rule */}
        <circle className="jr-ring-track" cx={C} cy={C} r={R_TRACK} fill="none" aria-hidden="true" />
        {rules.map((r, i) => (
          <g key={r.id} className="jr-ring-lane" data-kind={r.kind} data-state={r.state}>
            <circle className="jr-ring-lane-track" cx={C} cy={C} r={R_TRACK - 10 - i * LANE} fill="none" />
            {ruleSpans(r).map(([a, b], j) => <path key={j} d={arcPath(C, C, R_TRACK - 10 - i * LANE, a, b)} fill="none" />)}
          </g>
        ))}
        {!rules.length && <circle className="jr-ring-empty" cx={C} cy={C} r={R_TRACK - 10} fill="none" />}
        <line className="jr-ring-now" x1={nowTick[0].x} y1={nowTick[0].y} x2={nowTick[1].x} y2={nowTick[1].y} />
        {/* the scrubber: a slider whose only effect is the centre text */}
        <g role="slider" tabIndex={0} className="jr-ring-handle" aria-label="Preview time, in 15 minute steps. Preview only: nothing is sent."
          aria-valuemin={0} aria-valuemax={DAY_MIN - STEP_MIN} aria-valuenow={at} aria-valuetext={prev === null ? `now, ${hhmm(nowM)}` : `preview ${hhmm(prev)}`}
          onKeyDown={onKey} onBlur={() => prev !== null && emit(null)}>
          <circle cx={handle.x} cy={handle.y} r="32" className="jr-ring-hit" />
          <circle cx={handle.x} cy={handle.y} r="8" className="jr-ring-cap" data-previewing={prev === null ? undefined : 'true'} />
        </g>
        <g className="jr-ring-centre" aria-hidden="true">
          {prev === null ? (
            <>
              <text x={C} y={C - 10} textAnchor="middle" className="jr-ring-big">{hhmm(nowM)}</text>
              <text x={C} y={C + 16} textAnchor="middle" className="jr-ring-cap-word">NOW</text>
              <text x={C} y={C + 38} textAnchor="middle" className="jr-ring-sub">{rules.length ? `${rules.length} rule window${rules.length === 1 ? '' : 's'}` : 'no schedule'}</text>
            </>
          ) : (
            <>
              <text x={C} y={C - 4} textAnchor="middle" className="jr-ring-big" data-preview="true">{hhmm(prev)}</text>
              <text x={C} y={C + 22} textAnchor="middle" className="jr-ring-cap-word" data-preview="true">PREVIEW</text>
            </>
          )}
        </g>
      </svg>
      <figcaption className="jr-ring-cap-line" role="status" aria-live="polite">
        {prev === null ? (
          <span className="jr-ring-quiet"><PlannedGlyph width={14} height={14} /> Channel schedules: PLANNED</span>
        ) : (
          <span className="jr-ring-prev"><PlannedGlyph width={14} height={14} /><span title={lines.join('; ')}>PREVIEW {hhmm(prev)}, not the board: {lines.join('; ')}</span></span>
        )}
      </figcaption>
    </figure>
  )
}
