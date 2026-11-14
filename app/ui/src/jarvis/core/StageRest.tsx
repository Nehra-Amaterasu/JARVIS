// The stage at rest (RC1, after the wave 6 jury: "only the speaking state is rich; asleep and thinking, which are seen
// most, show a near-empty ring"). Three still pieces, drawn whenever the voice picture has no measured frame:
//
//  - RestHill: the hill's outline at rest, three dashed contours on the hill's own geometry (baseline 300, half width
//    320, the stipple layers' 9 px drop). Dashed and unfilled is the WAITING form of the lamp contract: it is the
//    shape of the instrument, never a level, and it steps aside the moment a measured frame draws (core.css, :has()).
//  - AsciiRuler: the hill's band axis as two ASCII scales either side of the ring (the bands are mirrored, low at the
//    centre), so an empty stage still reads as a measuring instrument.
//  - Eye: the Core's own sigil in the ring's eye. Asleep it is formed and still. Thinking, its strokes form in sequence
//    by CSS (core.css jc-form: three passes of 1.4 s, at most 4.6 s, then still): a motion tied to the thinking state
//    itself, never a drawn sound level. Reduced motion, calm and the Pause key show the formed sigil.
//
// All of it is SVG, CSS and text, aria-hidden (the canvas and the strip carry the words), and nothing here runs a timer.
import { Sigil } from '../../shared/grammar'
import { HILL_BASELINE, HILL_CENTER_X, HILL_HALF_W, HILL_LAYER_DROP_Y, HILL_LAYER_SHRINK, HILL_MAX_H, STAGE_H, STAGE_W } from '../voice'

/** The rest envelope: a generic mirrored double rise at under a third of the hill's height. A form, not a fixture. */
const restHeight = (t: number): number => HILL_MAX_H * (0.05 + 0.24 * Math.exp(-((t - 0.46) ** 2) / 0.032) + 0.07 * Math.exp(-((t - 0.86) ** 2) / 0.008))

function contour(layer: number): string {
  const half = HILL_HALF_W * (1 - HILL_LAYER_SHRINK * layer)
  const base = HILL_BASELINE + HILL_LAYER_DROP_Y * layer
  const k = 1 - 0.2 * layer
  const pts: string[] = []
  for (let i = 0; i <= 80; i++) {
    const x = HILL_CENTER_X - half + (2 * half * i) / 80
    const t = Math.abs(x - HILL_CENTER_X) / half
    pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${(base - restHeight(t) * k).toFixed(1)}`)
  }
  return pts.join('')
}

const CONTOURS = [0, 1, 2].map(contour)

export function RestHill() {
  return (
    <svg className="jc-rest" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} aria-hidden="true" focusable="false" data-testid="jc-rest">
      {CONTOURS.map((d, i) => <path key={i} d={d} data-layer={i} />)}
      <path className="jc-rest-base" d={`M${HILL_CENTER_X - HILL_HALF_W} ${HILL_BASELINE}H${HILL_CENTER_X + HILL_HALF_W}`} />
    </svg>
  )
}

/** One scale: four major ticks with four minor between, ASCII only. */
const SCALE = "|''''|''''|''''|''''|"

export function AsciiRuler() {
  return (
    <div className="jc-ruler" aria-hidden="true">
      <span className="jc-ruler-side" data-side="l">HIGH {SCALE}</span>
      <span className="jc-ruler-side" data-side="r">{SCALE} HIGH</span>
    </div>
  )
}

export function Eye({ pose }: { pose: 'asleep' | 'thinking' }) {
  return (
    <div className="jc-eye" data-pose={pose} aria-hidden="true">
      <Sigil seed="jarvis.core.talk" size={48} fold={8} />
    </div>
  )
}
