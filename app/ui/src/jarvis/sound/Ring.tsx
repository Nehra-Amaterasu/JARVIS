// The Now plate's sigil dial (spec 20.9.1 `core.sound`, the cybersigil grammar of Core): a bezel traced as hairline arcs, a
// 5 degree scale, a band of 72 formed marks from a 12-mark generic alphabet (no letter, no face) and, inside the band, the
// VOLUME GAUGE: a 270 degree track (from 225 to 495 degrees, open at the foot where the readout sits) with a 12-step scale.
//
// Honesty: the app can step the volume up and down but cannot read the level back (no read-back port, S0 section 4), so the
// gauge is drawn as its hollow dashed TRACK under a WAITING lamp and its fill never appears; `level` exists so a real read-back
// can draw the solid fill later, and nothing passes it today. A press of VOL- or VOL+ lights the track for one beat
// (`nudge`, --dur-state), which says "a step was sent", never "the level is now x". The band of marks is a STATE (all lit
// while playing, a quarter while paused, none at rest), never a spectrum and never a progress arc; it sits at 38 % ink so the
// play disc and the gauge read first (jury round 2 asked for exactly that). Under reduced motion the same pictures change
// instantly (sound.css). Plain SVG, built once.
import { memo, useMemo } from 'react'
import { fnv1a32 } from '../../shared/grammar'
import type { LampReading } from '../../shared/lamp'
import { RING, litMarks, ringWord, type RingState } from './model'
import './sound.css'

/** Twelve generic marks on a local box: y is radial (negative = outward), x is along the ring. */
const MARKS: readonly string[] = [
  'M0 -5V5',
  'M-1.6 -5V5M1.6 -5V5',
  'M0 -5V-1.4M0 1.4V5',
  'M-2.4 0H2.4M0 -5V5',
  'M-2.2 -5L0 -1.5L2.2 -5M0 -1.5V5',
  'M-2.4 5L0 -5L2.4 5',
  'M-2.4 -5H2.4M0 -5V5',
  'M0 -5V5M-2.4 5H2.4',
  'M-1.8 -1.8H1.8V1.8H-1.8ZM0 -5V-1.8M0 1.8V5',
  'M0 -5L2.4 0L0 5L-2.4 0Z',
  'M0 -5V-0.6M0 2.6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  'M-2.2 -5V5M2.2 -5V0',
]

const S = RING.HALF * 2
const C = RING.HALF
const MID = (RING.R_IN + RING.R_OUT) / 2
const STEP = 360 / RING.TICKS
/** The gauge sweeps 270 degrees clockwise from the lower left (225) over the top to the lower right (495 = 135). */
const G0 = 225
const SWEEP = 270

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}
const arc = (r: number, d0: number, d1: number) => {
  const p = polar(r, d0)
  const q = polar(r, d1)
  return `M${p.x.toFixed(2)} ${p.y.toFixed(2)}A${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${q.x.toFixed(2)} ${q.y.toFixed(2)}`
}
const tick = (r0: number, r1: number, d: number) => {
  const a = polar(r0, d)
  const b = polar(r1, d)
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

/** The traced bezel and the gauge, built once. */
const DRAWN = (() => {
  const arcs = [arc(RING.R_BEZEL, 8, 82), arc(RING.R_BEZEL, 98, 172), arc(RING.R_BEZEL, 188, 262), arc(RING.R_BEZEL, 278, 352)].join('')
  let scale = ''
  for (let d = 0; d < 360; d += 5) scale += tick(d % 45 === 0 ? RING.R_BEZEL - 9 : RING.R_BEZEL - 5, RING.R_BEZEL - 1, d)
  let cardinals = ''
  for (const d of [0, 90, 180, 270]) cardinals += tick(RING.R_BEZEL + 3, RING.R_BEZEL + 11, d)
  const track = arc(RING.R_GAUGE, G0, G0 + SWEEP)
  // 12 steps, 13 marks: the two ends and the middle are long so the empty and full ends read without numbers
  let steps = ''
  for (let k = 0; k <= 12; k++) {
    const long = k === 0 || k === 6 || k === 12
    steps += tick(RING.R_GAUGE + 4, RING.R_GAUGE + (long ? 12 : 8), G0 + (SWEEP * k) / 12)
  }
  return { arcs, scale, cardinals, track, steps }
})()

export interface RingProps {
  state: RingState
  seed?: string
  /** A volume read back from the system, 0..1. Nothing reports one today, so the fill is never drawn. */
  level?: number | null
  /** The lamp of that read-back. A level is a reading, so it never draws without one: the fill appears only under a LIVE or
   *  SIMULATED reading, and absent, WAITING, STALE or FAULT leave the gauge as its hollow dashed track. */
  reading?: LampReading | null
  /** The last volume step sent, lit for one beat. */
  nudge?: 'up' | 'down' | null
}

function RingImpl({ state, seed = 'jarvis.sound.ring', level = null, reading = null, nudge = null }: RingProps) {
  const marks = useMemo(() => Array.from({ length: RING.TICKS }, (_, k) => fnv1a32(`${seed}:${k}`) % MARKS.length), [seed])
  const lit = litMarks(state)
  const stated = reading?.state === 'live' || reading?.state === 'simulated'
  const fill = level == null || !stated ? null : Math.max(0, Math.min(1, level))
  return (
    <div
      className="sd-ring"
      data-state={state}
      data-lit={lit}
      data-gauge={fill == null ? 'waiting' : 'live'}
      data-nudge={nudge ?? undefined}
      role="img"
      aria-label={`Sound dial, ${ringWord(state)}. The inner gauge is the volume track; it stays empty because the app cannot read the volume back.`}
    >
      <svg viewBox={`0 0 ${S} ${S}`} aria-hidden="true" focusable="false">
        <g className="sd-ring-bezel">
          <path d={DRAWN.arcs} className="sd-ring-arc" />
          <path d={DRAWN.scale} className="sd-ring-scale" />
          <path d={DRAWN.cardinals} className="sd-ring-cardinal" />
        </g>
        <g className="sd-ring-band">
          {marks.map((g, k) => (
            <path key={k} d={MARKS[g]} data-lit={k < lit ? 'true' : undefined} transform={`rotate(${(k * STEP).toFixed(2)} ${C} ${C}) translate(${C} ${C - MID}) scale(0.7)`} />
          ))}
        </g>
        <g className="sd-gauge">
          <path d={DRAWN.track} className="sd-gauge-track" />
          <path d={DRAWN.steps} className="sd-gauge-steps" />
          {fill != null && fill > 0 && <path d={arc(RING.R_GAUGE, G0, G0 + SWEEP * fill)} className="sd-gauge-fill" />}
        </g>
      </svg>
    </div>
  )
}

export const Ring = memo(RingImpl)
