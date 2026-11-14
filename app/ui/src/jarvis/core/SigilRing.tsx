// SigilRing (spec 20.9.1): the voice ring's bezel as a 96-tick glyph band at radius 123 to 131, plus the C02-07 bezel
// traced as hairline SVG. The ticks whose band is live are lit, so the sigil is the spectrum in a second projection;
// in every state with no frame (WAITING, PLANNED, FAULT) all 96 ticks are hairline and nothing is lit.
//
// It is DOM (SVG), never a canvas, and it is never redrawn by a loop: a re-render changes one attribute per tick. The
// glyph of each tick comes from a 12-glyph generic alphabet chosen by FNV-1a of `glyphSet` and the tick index, so the
// band is the same sigil on every machine. The drawing is aria-hidden; the text equivalent is the group's name.
import { memo, useMemo, useRef, useState, type PointerEvent } from 'react'
import { LAMP_SPECS, type LampState } from '../../shared/lamp'
import { SIGIL, bandAtAngle, glyphIndex, hzText, sigilTicks } from './model'
import './core.css'

export interface SigilRingProps {
  /** Band values 0..255 (24 from the voice frame, or any length: resampled with the ring bars' mirrored mapping). */
  bands: number[]
  state: LampState
  /** The seed of the glyph alphabet's order; the default is the Core ring's own. */
  glyphSet?: string
}

/** Twelve generic glyphs on a local box: y is radial (negative = outward), x is along the ring. No letter, no face. */
const GLYPHS: readonly string[] = [
  'M0 -4V4',
  'M-1.3 -4V4M1.3 -4V4',
  'M0 -4V-1.2M0 1.2V4',
  'M-2.2 0H2.2M0 -4V4',
  'M-2 -4L0 -1L2 -4M0 -1V4',
  'M-2.2 4L0 -4L2.2 4',
  'M-2.2 -4H2.2M0 -4V4',
  'M0 -4V4M-2.2 4H2.2',
  'M-1.6 -1.6H1.6V1.6H-1.6ZM0 -4V-1.6M0 1.6V4',
  'M0 -4L2.2 0L0 4L-2.2 0Z',
  'M0 -4V-0.4M0 2.2m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0',
  'M-2 -4V4M2 -4V0',
]

const S = SIGIL.HALF * 2
const C = SIGIL.HALF
const MID = (SIGIL.R_IN + SIGIL.R_OUT) / 2
const STEP = 360 / SIGIL.TICKS

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}
const arc = (r: number, d0: number, d1: number) => {
  const p = polar(r, d0)
  const q = polar(r, d1)
  return `M${p.x.toFixed(2)} ${p.y.toFixed(2)}A${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${q.x.toFixed(2)} ${q.y.toFixed(2)}`
}

/** A whole circle as one closed path (two half arcs: one arc cannot close on itself). */
const disc = (r: number) => `M${C} ${C - r}A${r} ${r} 0 1 1 ${C} ${C + r}A${r} ${r} 0 1 1 ${C} ${C - r}Z`

/** The traced bezel (C02-07): four hairline arcs with gaps at the quarters, two heavier index bars, a 5-degree scale
 *  with longer marks every 45 degrees, and quarter notches. Static, built once per module. */
const BEZEL = (() => {
  // the top gap is 36 degrees (about 105 units at r 168), wide enough for the state word, so the word never sits on a line
  const arcs = [arc(SIGIL.R_BEZEL, 18, 82), arc(SIGIL.R_BEZEL, 98, 172), arc(SIGIL.R_BEZEL, 188, 262), arc(SIGIL.R_BEZEL, 278, 342)].join('')
  const heavy = [arc(SIGIL.R_BEZEL, 300, 318), arc(SIGIL.R_BEZEL, 122, 136)].join('')
  let scale = ''
  for (let d = 0; d < 360; d += 5) {
    if (d < 18 || d > 342) continue // the word's gap stays clear

    const major = d % 45 === 0
    const a = polar(major ? SIGIL.R_SCALE_IN - 3 : SIGIL.R_SCALE_IN, d)
    const b = polar(SIGIL.R_SCALE_OUT, d)
    scale += `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`
  }
  let notch = ''
  for (const d of [90, 180, 270]) {
    const a = polar(SIGIL.R_BEZEL - 4, d - 2.2)
    const b = polar(SIGIL.R_BEZEL + 4, d)
    const c2 = polar(SIGIL.R_BEZEL - 4, d + 2.2)
    notch += `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}L${c2.x.toFixed(2)} ${c2.y.toFixed(2)}`
  }
  const inner = arc(SIGIL.R_IN - 3, 200, 340)
  return { arcs, heavy, scale, notch, inner }
})()

const STATE_WORD: Record<LampState, string> = { live: 'LIT BY THE SPECTRUM', simulated: 'LIT BY A FIXTURE', waiting: 'HOLLOW: NO FRAME', planned: 'HOLLOW: NOT BUILT', fault: 'HOLLOW: FAULT' }

function SigilRingImpl({ bands, state, glyphSet = 'jarvis.core.ring' }: SigilRingProps) {
  const lit = useMemo(() => sigilTicks(bands, state), [bands, state])
  const glyphs = useMemo(() => Array.from({ length: SIGIL.TICKS }, (_, k) => glyphIndex(glyphSet, k)), [glyphSet])
  const count = lit.reduce((n, x) => n + (x ? 1 : 0), 0)
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const label = state === 'live' || state === 'simulated'
    ? `Sigil ring, ${LAMP_SPECS[state].label}: ${count} of ${SIGIL.TICKS} ticks lit, the spectrum's live bars`
    : `Sigil ring, ${LAMP_SPECS[state].label}: hollow, no tick lit because no frame is arriving`

  const onMove = (e: PointerEvent<SVGPathElement>) => {
    const box = svg.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    const k = S / box.width
    const x = (e.clientX - box.left) * k - C
    const y = (e.clientY - box.top) * k - C
    const deg = (Math.atan2(y, x) * 180) / Math.PI + 90
    const b = bandAtAngle(deg)
    setHover({ x: x + C, y: y + C, text: `band ${b.band}, ${hzText(b.hz)}` })
  }

  return (
    <div className="jc-sigil" data-component="sigil-ring" data-state={state} data-lit={count} role="img" aria-label={label}>
      <svg ref={svg} viewBox={`0 0 ${S} ${S}`} aria-hidden="true" focusable="false">
        <g className="jc-sigil-bezel">
          <path className="jc-sigil-arc" d={BEZEL.arcs} />
          <path className="jc-sigil-heavy" d={BEZEL.heavy} />
          <path className="jc-sigil-scale" d={BEZEL.scale} />
          <path className="jc-sigil-notch" d={BEZEL.notch} />
          <path className="jc-sigil-inner" d={BEZEL.inner} />
        </g>
        <g className="jc-sigil-band">
          {glyphs.map((g, k) => (
            <path key={k} d={GLYPHS[g]} data-lit={lit[k] ? 'true' : undefined} transform={`rotate(${(k * STEP).toFixed(2)} ${C} ${C}) translate(${C} ${C - MID})`} />
          ))}
        </g>
        <text className="jc-sigil-word" x={C} y={C - SIGIL.R_BEZEL} textAnchor="middle" dominantBaseline="central">{STATE_WORD[state]}</text>
        {/* the hover target: the annulus of the band and the bars only, so the hill underneath stays reachable */}
        <path
          className="jc-sigil-hit"
          d={`${disc(SIGIL.R_OUT + 34)}${disc(SIGIL.R_IN - 6)}`}
          fillRule="evenodd"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
        {hover && (
          <g className="jc-sigil-cross" pointerEvents="none">
            <path d={`M${hover.x - 6} ${hover.y}H${hover.x + 6}M${hover.x} ${hover.y - 6}V${hover.y + 6}`} />
            <text x={hover.x + 8} y={hover.y - 8}>{hover.text}</text>
          </g>
        )}
      </svg>
    </div>
  )
}

export const SigilRing = memo(SigilRingImpl)
