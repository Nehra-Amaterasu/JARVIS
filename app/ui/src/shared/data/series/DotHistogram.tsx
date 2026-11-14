// DotHistogram (spec 20.5.2, package D02): a dot-matrix meter of observations. Each bin is a column of sockets on a
// charcoal screen, and a lit dot is one observation (or a stated number of them: past 200 dots one dot stands for 5,
// and the multiplier is written beside the legend). A part dot is a ring, never rounded up into a whole one. A median
// tick and a bracket over the middle half sit on the base. A second form, the ridge, draws the same counts as one
// stippled contour. Hover, or Left and Right, move across the bins with a callout ("6 blocks, 20 to 29 min").
// Only LIVE and SIMULATED light a dot or print a number; the hollow form shows the empty sockets and says why.
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { LAMP_SPECS, LampGlyph, type LampState } from '../../lamp'
import {
  HIST_DEFAULT_BINS, HIST_H, HIST_H_PHONE, binLabel, binText, binValues, dotStacks, dotUnit, fmtValue, histLayout, type Bins, type HistGeom,
} from './layout'
import { Housing, Screen, TableFold, isHollow, useWidth } from './parts'

export interface DotHistogramProps {
  values: number[]
  bins?: number
  /** Observations per dot; raised to the next of 1, 2, 5, 10, 20 ... when the drawing would pass 200 dots. */
  unitPerDot?: number
  state: LampState
  /** Optional (beyond the contract): what is counted, the value unit, the plural noun of one observation, why hollow. */
  label?: string
  unit?: string
  noun?: string
  reason?: string
}

type Form = 'dots' | 'ridge'
const PHONE_W = 600

export function DotHistogram({ values, bins = HIST_DEFAULT_BINS, unitPerDot, state, label = 'Distribution', unit, noun = 'observations', reason }: DotHistogramProps) {
  const hollow = isHollow(state)
  const [stageRef, width] = useWidth(760)
  const height = width < PHONE_W ? HIST_H_PHONE : HIST_H
  const b = useMemo(() => binValues(hollow ? [] : values, bins), [values, bins, hollow])
  const u = dotUnit(b.n, unitPerDot)
  const stacks = useMemo(() => dotStacks(b.counts, u), [b, u])
  const g = useMemo(() => histLayout(b, stacks, { w: width, h: height }), [b, stacks, width, height])
  const [sel, setSel] = useState<number | null>(null)
  const [form, setForm] = useState<Form>('dots')
  const uid = useId().replace(/:/g, '')
  const one = noun.endsWith('s') ? noun.slice(0, -1) : noun
  const text = (i: number) => binText(b.counts[i], b.edges[i], b.integer, noun, unit)

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width) return
    const x = ((e.clientX - r.left) / r.width) * g.w
    const i = Math.max(0, Math.min(b.counts.length - 1, Math.floor((x - g.plot.x0) / (g.cols[0]?.cw || 1))))
    if (i !== sel) setSel(i)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = b.counts.length
    const from = sel ?? -1
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(n - 1, from + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, from < 0 ? n - 1 : from - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') { setSel(null); return }
    else return
    e.preventDefault()
    setSel(next)
  }

  const readout = hollow ? (
    <div className="sr-big" aria-hidden="true"><span className="sr-num sr-num-hollow">-- --</span></div>
  ) : (
    <>
      <div className="sr-big">
        <span className="sr-num">{b.n ? fmtValue(b.median) : '--'}</span>
        {unit && b.n > 0 && <span className="sr-unit">{unit}</span>}
        <span className="sr-asof">median of {b.n} {b.n === 1 ? one : noun}</span>
      </div>
      <div className="sr-sub">
        {b.n > 0 && <span className="sr-kv"><span className="sr-k">middle half</span> {fmtValue(b.q1)} to {fmtValue(b.q3)}{unit ? ` ${unit}` : ''}</span>}
        <span className="sr-kv"><span className="sr-k">one dot</span> {u === 1 ? `1 ${one}` : `${u} ${noun}`}</span>
        {b.dropped > 0 && <span className="sr-kv"><span className="sr-k">left out</span> {b.dropped} not a number</span>}
      </div>
      <p className="sr-diff" aria-live="polite">{sel !== null ? text(sel) : ' '}</p>
    </>
  )

  return (
    <Housing
      component="DotHistogram" state={state} label={label} reason={reason} readout={readout}
      foot={hollow ? undefined : (
        <div className="sr-foot-row">
          <ul className="sr-legend" aria-label="Legend">
            <li><svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="3.5" className="sr-lg-disc" /></svg>{u === 1 ? `1 ${one}` : `${u} ${noun}`}</li>
            {u > 1 && <li><svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="3" className="sr-lg-ring" /></svg>part of {u}</li>}
            <li><svg width="12" height="12" aria-hidden="true"><path d="M6 0V12" className="sr-lg-median" /></svg>median</li>
            <li><svg width="22" height="10" aria-hidden="true"><path d="M1 2V7H21V2" className="sr-lg-bracket" /></svg>middle half</li>
          </ul>
          <div className="sr-forms" role="group" aria-label="Form">
            {(['dots', 'ridge'] as const).map((f) => (
              <button key={f} type="button" className="sr-key" aria-pressed={form === f} onClick={() => setForm(f)}>{f === 'dots' ? 'Dots' : 'Ridge'}</button>
            ))}
          </div>
        </div>
      )}
      table={hollow ? undefined : (
        <TableFold
          caption={`${label}: ${b.n} ${noun} in ${b.counts.length} bins`}
          head={[unit ? `Range (${unit})` : 'Range', 'Count']}
          rows={() => b.counts.map((c, i) => [binLabel(b.edges[i], b.integer), c])}
        />
      )}
    >
      <div ref={stageRef} className="sr-stage" data-compact={width < 420 ? 'true' : 'false'}>
        <Screen
          height={height} planned={state === 'planned'}
          tag={hollow ? 'no values' : `${width < PHONE_W ? '' : 'distribution · '}${b.n} obs · 1 dot = ${u}`}
          status={<><LampGlyph state={state} size={9} />{LAMP_SPECS[state].label}</>}
        >
          {hollow ? (
            <div className="sr-plot" role="img" aria-label={`${label}: ${LAMP_SPECS[state].label}, no values drawn`}>
              <HistSvg b={b} g={g} stacks={stacks} uid={uid} hollow state={state} sel={null} form="dots" />
            </div>
          ) : (
            <div
              className="sr-plot" role="slider" tabIndex={0} aria-label={`${label} bins`}
              aria-valuemin={0} aria-valuemax={Math.max(0, b.counts.length - 1)} aria-valuenow={sel ?? 0}
              aria-valuetext={sel !== null ? text(sel) : `${b.n} ${noun} in ${b.counts.length} bins; arrow keys move across the bins`}
              onPointerMove={onMove} onPointerLeave={() => setSel(null)} onKeyDown={onKey}
              onBlur={() => setSel(null)}
            >
              <HistSvg b={b} g={g} stacks={stacks} uid={uid} state={state} sel={sel} form={form} />
              {sel !== null && <BinCallout g={g} stacks={stacks} i={sel} text={text(sel)} state={state} />}
            </div>
          )}
        </Screen>
      </div>
    </Housing>
  )
}

function HistSvg({ b, g, stacks, uid, hollow = false, state, sel, form }: { b: Bins; g: HistGeom; stacks: { full: number; part: boolean }[]; uid: string; hollow?: boolean; state: LampState; sel: number | null; form: Form }) {
  const { plot, across, pitch, r, rows } = g
  const dotAt = (col: { x: number; cw: number }, k: number) => {
    const row = Math.floor(k / across)
    const c = k % across
    const inner = across * pitch
    const x0 = col.x + (col.cw - inner) / 2 + pitch / 2
    return { x: Math.round((x0 + c * pitch) * 10) / 10, y: Math.round((plot.y1 - pitch / 2 - row * pitch) * 10) / 10 }
  }
  // every lit dot has a socket: the layout picked a pitch at which the tallest stack fits, so this cap never bites
  // unless the plot is tiny, and then the column is full rather than overflowing the screen
  const maxLit = rows * across
  const tallest = Math.max(1, ...stacks.map((s) => s.full + (s.part ? 1 : 0)))
  const ridge = g.cols.map((c, i) => {
    const s = stacks[i]
    const n = s.full + (s.part ? 1 : 0)
    return { x: c.cx, y: Math.round((plot.y1 - (n / tallest) * (plot.y1 - plot.y0) * 0.92) * 10) / 10 }
  })
  const ridgeD = ridge.length ? `M${plot.x0} ${plot.y1}L${ridge.map((p) => `${p.x} ${p.y}`).join('L')}L${plot.x1} ${plot.y1}Z` : ''
  const lblEvery = g.cols[0] && g.cols[0].cw < 34 ? 2 : 1
  const baseY = plot.y1 + 4
  return (
    <svg className="sr-svg" width={g.w} height={g.h} viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden="true" focusable="false" data-tone={state}>
      <defs>
        <pattern id={`${uid}-stip`} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="0.9" className="sr-stip-dot" />
        </pattern>
      </defs>
      {g.cols.map((c) => {
        const s = stacks[c.i]
        const lit = hollow ? 0 : Math.min(s.full, maxLit)
        const sx = c.x + (c.cw - across * pitch) / 2
        return (
          <g key={c.i} className="sr-col" data-sel={sel === c.i ? 'true' : 'false'}>
            {sel === c.i && <rect className="sr-col-sel" x={c.x + 2} y={plot.y0 - 6} width={c.cw - 4} height={plot.y1 - plot.y0 + 10} rx={3} />}
            {form === 'dots' && (
              <>
                {/* the unlit sockets: one patterned rect per column (bounded DOM), tiles aligned with the lit dots */}
                <pattern id={`${uid}-sk${c.i}`} x={sx} y={plot.y1} width={pitch} height={pitch} patternUnits="userSpaceOnUse">
                  <circle cx={pitch / 2} cy={pitch / 2} r={r * 0.42} className="sr-socket" />
                </pattern>
                <rect x={sx} y={plot.y1 - rows * pitch} width={across * pitch} height={rows * pitch} fill={`url(#${uid}-sk${c.i})`} />
                {Array.from({ length: lit }, (_, k) => {
                  const p = dotAt(c, k)
                  return <circle key={k} cx={p.x} cy={p.y} r={r} className="sr-dot" />
                })}
                {!hollow && s.part && s.full < maxLit && (() => {
                  const p = dotAt(c, s.full)
                  return <circle cx={p.x} cy={p.y} r={r - 0.5} className="sr-dot-part" />
                })()}
              </>
            )}
          </g>
        )
      })}
      {form === 'ridge' && !hollow && (
        <g className="sr-ridge">
          <path d={ridgeD} fill={`url(#${uid}-stip)`} />
          <path className="sr-line" d={`M${ridge.map((p) => `${p.x} ${p.y}`).join('L')}`} />
          {ridge.map((p, i) => <circle key={i} className={sel === i ? 'sr-disc' : 'sr-ring'} cx={p.x} cy={p.y} r={sel === i ? 3.6 : 2.4} />)}
        </g>
      )}
      <path className={hollow ? 'sr-datum-hollow' : 'sr-base'} d={`M${plot.x0} ${baseY}H${plot.x1}${g.cols.map((c) => `M${c.x} ${baseY}v4`).join('')}M${plot.x1} ${baseY}v4`} />
      {hollow ? (
        <text className="sr-svg-word" x={(plot.x0 + plot.x1) / 2} y={(plot.y0 + plot.y1) / 2} textAnchor="middle">{`[${LAMP_SPECS[state].label}]`}</text>
      ) : (
        <>
          {g.cols.map((c) => (c.i % lblEvery === 0 ? <text key={c.i} className="sr-svg-label" x={c.x + 2} y={baseY + 16}>{fmtValue(b.edges[c.i][0])}</text> : null))}
          {b.n > 0 && (
            <>
              <path className="sr-median-tick" d={`M${g.xOf(b.median)} ${plot.y0 - 6}V${baseY + 6}`} />
              <path className="sr-bracket" d={`M${g.xOf(b.q1)} ${baseY + 22}v6H${g.xOf(b.q3)}v-6`} />
              <text className="sr-svg-label" x={(g.xOf(b.q1) + g.xOf(b.q3)) / 2} y={baseY + 38} textAnchor="middle">middle half</text>
            </>
          )}
        </>
      )}
    </svg>
  )
}

function BinCallout({ g, stacks, i, text, state }: { g: HistGeom; stacks: { full: number; part: boolean }[]; i: number; text: string; state: LampState }) {
  const c = g.cols[i]
  const s = stacks[i]
  const n = s.full + (s.part ? 1 : 0)
  const top = Math.max(4, g.plot.y1 - Math.ceil(n / g.across) * g.pitch - 54)
  const W = 168
  const left = Math.max(4, Math.min(g.w - W - 4, c.cx - W / 2))
  return (
    <div className="sr-callout" style={{ left, top, inlineSize: W }} aria-hidden="true">
      <span className="sr-co-val">{text}</span>
      <span className="sr-co-lamp"><LampGlyph state={state} size={10} />{LAMP_SPECS[state].label}</span>
    </div>
  )
}
