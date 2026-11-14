// StrataCore (spec 20.5.2): units as geological strata. One slab per unit, its thickness is the evidence (first-try correct
// answers, the last 30 days, weighted by the recall estimate). A unit with no evidence is a flat dashed outline: it is
// there, and it says it has nothing behind it. The block is drawn in light isometric projection like the owner's contour
// block references (C04-23): wavy contour hairlines on the front face, a lit top and a shaded right side. A 44 px row for
// every unit stands beside the block on a leader, so the hit area is a row, not a 7 px slab; Up and Down move between
// rows, Enter or a click opens the unit (`onSelect`, which the caller wires to the unit drawer).
//
// Honesty: the percentages and the question counts are drawn only for LIVE and SIMULATED. WAITING, PLANNED and FAULT draw
// every layer flat and dashed, print no number, and say why. SIMULATED stamps the word.
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ArtTable, Dither } from '../../art'
import { LAMP_SPECS, LampGlyph, showsNumber, type LampState } from '../../lamp'
import {
  BLOCK_W, DEPTH_DX, DEPTH_DY, FLAT_T, MAX_UNITS, THIN_N, evidencePct, hasEvidence, strataLayout, unitsDrawn, type StrataUnit,
} from './strata'
import './specimen.css'

export interface StrataCoreProps {
  units: StrataUnit[]
  state: LampState
  /** Why the state is what it is ("no report", "no answers yet"); printed on the hollow forms. */
  reason?: string
  /** Opens the unit (the caller's drawer with the frequency bar and the next three questions). */
  onSelect?: (id: string) => void
  /** What the block is ("Physics units"); it leads the accessible name. */
  label?: string
}

/** Eight cells of evidence as text, filled to the share: the row's own small bar. */
const meterText = (v: number): string => {
  const k = Math.max(1, Math.min(8, Math.round(v * 8)))
  return '█'.repeat(k) + '░'.repeat(8 - k)
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function StrataCore({ units, state, reason, onSelect, label = 'Unit strata' }: StrataCoreProps) {
  const live = showsNumber(state)
  const list = useMemo(() => unitsDrawn(units), [units])
  // a hollow form draws every layer as having no evidence, whatever the numbers say: they are not allowed to speak
  const shown = useMemo(() => (live ? list : list.map((u) => ({ ...u, evidence: 0, n: 0 }))), [list, live])
  const lay = useMemo(() => strataLayout(shown), [shown])
  const [active, setActive] = useState(Math.max(0, list.length - 1))
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const uid = useId()
  const at = Math.min(active, Math.max(0, list.length - 1))
  const why = reason ?? (state === 'simulated' ? 'generated, not measured' : list.length === 0 ? 'no units yet' : LAMP_SPECS[state].means)
  // the rows read top to bottom, the last unit first (the top slab), so Up and Down match what the eye sees
  const order = useMemo(() => list.map((_, i) => list.length - 1 - i), [list])

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, pos: number) => {
    const last = order.length - 1
    const to = e.key === 'ArrowDown' ? Math.min(last, pos + 1) : e.key === 'ArrowUp' ? Math.max(0, pos - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (to < 0) return
    e.preventDefault()
    setActive(order[to])
    rows.current[to]?.focus()
  }

  const bottom = lay.slabs.length ? Math.max(...lay.slabs.map((s) => s.y + s.t)) : lay.h / 2
  const frontX = 0
  return (
    <figure className="sp-strata" data-component="strata-core" data-state={live ? state : 'hollow'} aria-label={`${label}, ${LAMP_SPECS[state].label}`}>
      <div className="sp-strata-body">
        <span className="sp-strata-dither" aria-hidden="true"><Dither kind="ridge" cols={90} rows={Math.max(10, Math.round(lay.h / 4))} scale={4} /></span>
        <svg className="sp-strata-svg" width={lay.w} height={lay.h} viewBox={`0 0 ${lay.w} ${lay.h}`} role="img" aria-label={`${label}: ${list.length} units as layers, thickness is evidence. ${live ? '' : `No evidence drawn: ${why}.`} The list beside it has the same units.`}>
          <g transform={`translate(8 ${DEPTH_DY})`}>
            {lay.slabs.map((s, k) => {
              const u = shown[s.index]
              const front = `M${frontX} ${s.y}h${BLOCK_W}v${s.t}h${-BLOCK_W}z`
              const top = `M${frontX} ${s.y}l${DEPTH_DX} ${-DEPTH_DY}h${BLOCK_W}l${-DEPTH_DX} ${DEPTH_DY}z`
              const side = `M${BLOCK_W} ${s.y}l${DEPTH_DX} ${-DEPTH_DY}v${s.t}l${-DEPTH_DX} ${DEPTH_DY}z`
              return (
                <g
                  key={s.id}
                  className="sp-slab"
                  data-flat={s.flat ? 'true' : undefined}
                  data-thin={s.thin ? 'true' : undefined}
                  data-active={list[s.index].id === list[at]?.id ? 'true' : undefined}
                  data-slab={u.id}
                  style={{ ['--k' as string]: k } as CSSProperties}
                >
                  <path className="sp-face-side" d={side} />
                  <path className="sp-face-top" d={top} />
                  <path className="sp-face-front" d={front} />
                  {s.contours && <path className="sp-contour" d={s.contours} />}
                  <path className="sp-slab-edge" d={`${front}${top}${side}`} />
                </g>
              )
            })}
            {/* the rock under the stack: a hairline plinth so a lone flat layer still stands on something */}
            <path className="sp-plinth" d={`M${-6} ${bottom + 3}h${BLOCK_W + DEPTH_DX + 12}`} />
          </g>
          {lay.slabs.map((s) => (
            <g key={`l-${s.id}`} className="sp-trace" data-active={list[s.index].id === list[at]?.id ? 'true' : undefined} transform="translate(8 14)">
              <path d={s.leader} />
              <circle cx={s.from.x} cy={s.from.y} r="2.5" />
            </g>
          ))}
        </svg>
        <ol className="sp-strata-rows" style={{ ['--rows' as string]: list.length }} aria-label={`${label} units`}>
          {order.map((idx, pos) => {
            const u = list[idx]
            const has = live && hasEvidence(u)
            return (
              <li key={u.id} className="sp-strata-li">
                <button
                  ref={(el) => { rows.current[pos] = el }}
                  type="button"
                  className="sp-strata-row"
                  id={`${uid}-${idx}`}
                  tabIndex={idx === at ? 0 : -1}
                  data-active={idx === at ? 'true' : undefined}
                  data-evidence={has ? (u.n < THIN_N ? 'thin' : 'solid') : 'none'}
                  onFocus={() => setActive(idx)}
                  onKeyDown={(e) => onKey(e, pos)}
                  onClick={() => onSelect?.(u.id)}
                  aria-label={`${u.label}: ${has ? `${evidencePct(u)} percent first-try evidence from ${u.n} answers` : live ? 'no evidence yet, flat layer' : `no number, ${LAMP_SPECS[state].label}`}`}
                >
                  <span className="sp-row-main">
                    <span className="sp-row-label" title={u.label}>{clip(u.label, 22)}</span>
                    <span className="sp-row-meta">
                      {has ? `${evidencePct(u)} %  n ${u.n}` : live ? 'no evidence yet' : '– –'}
                    </span>
                  </span>
                  <span className="sp-row-spark" aria-hidden="true">{has ? meterText(u.evidence) : '┄┄┄┄┄┄┄┄'}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
      <figcaption className="sp-strata-cap">
        <span className="sp-strata-state" data-state={state}>
          <LampGlyph state={state} size={12} />
          <b>{LAMP_SPECS[state].label}</b>
          {live ? <span>thickness is evidence; a dashed layer has none</span> : <span>{why}</span>}
        </span>
        {state === 'simulated' && <span className="sp-stamp">SIMULATED</span>}
        {list.length >= MAX_UNITS && units.length > MAX_UNITS && <span className="sp-strata-more">first {MAX_UNITS} of {units.length} units</span>}
      </figcaption>
      <ArtTable
        caption={`${label} (units, top layer first)`}
        head={['Unit', 'First-try evidence', 'Answers', 'Layer']}
        rows={[...list].reverse().map((u) => [u.label, live && hasEvidence(u) ? `${evidencePct(u)} %` : '–', live ? u.n : '–', live && hasEvidence(u) ? 'solid' : `flat, ${FLAT_T} px, dashed`])}
      />
    </figure>
  )
}
