/**
 * The still drawings of the Focus views (EL-FOCUS), made in code so no third-party picture enters the tree. Three forms, none of them a
 * loop: the Length dial of Start (one dot per 5 minutes of the chosen length, a pure function of it), the resting dial of the idle
 * Session (60 ticks, none filled, because no block has started), and the hill of Rest whose sun stands as high as the block held. The
 * only motion is a 180 ms ripple along the Length dial when the length changes (a transition on the lit dots, so it runs on a real
 * change and never on its own); reduced motion, calm motion and forced colours drop it. Nothing here carries invented data.
 */
import type { CSSProperties, ReactNode } from 'react'

/** One dot per 5 minutes up to the longest length (90 min): 18 positions around the ring. */
export const DIAL_DOTS = 18
export const DIAL_STEP_MIN = 5

/** How many dots are lit for a length in minutes: a pure function of the length. */
export const litDots = (lenMin: number): number => Math.max(0, Math.min(DIAL_DOTS, Math.round(lenMin / DIAL_STEP_MIN)))

/** The Length dial. The numeral and the lamp are drawn by the caller, over and under the disc; the disc itself is decoration plus a reading in `data-lit`. */
export function LengthDial({ len, size = 'large', children }: { len: number; size?: 'large' | 'mini'; children?: ReactNode }) {
  const lit = litDots(len)
  const c = 100
  const r = 80
  return (
    <div className="fv-dial" data-art="length-dial" data-size={size} data-lit={lit}>
      <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        {Array.from({ length: DIAL_DOTS }, (_, i) => {
          const a = (i / DIAL_DOTS) * Math.PI * 2 - Math.PI / 2
          return <circle key={i} className="fv-dial-dot" data-lit={i < lit ? 'true' : 'false'} style={{ '--i': i } as CSSProperties} cx={c + Math.cos(a) * r} cy={c + Math.sin(a) * r} r={4} />
        })}
      </svg>
      {children ? <div className="fv-dial-core">{children}</div> : null}
    </div>
  )
}

/** The idle Session: a 60-tick hour, none of it filled, one hollow mark at the top where the first minute will land. */
export function RestingDial() {
  const c = 100
  const r = 90
  return (
    <div className="fv-dial fv-dial-rest" data-art="resting-dial" data-size="large">
      <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2
          const r0 = i % 5 === 0 ? r - 12 : r - 6
          return <line key={i} className="fv-dial-tick" data-major={i % 5 === 0 ? 'true' : 'false'} x1={c + Math.cos(a) * r0} y1={c + Math.sin(a) * r0} x2={c + Math.cos(a) * r} y2={c + Math.sin(a) * r} />
        })}
        <circle className="fv-dial-next" cx={c} cy={c - 64} r={5} />
      </svg>
      <span className="fv-dial-dimple" aria-hidden="true" />
    </div>
  )
}

/** The sun's height in the hill's 360-high box: a whole disc just clear of the far ridge with nothing held (190 of 360; a NaN reads as nothing held), highest at 90 minutes or more. Pure, so it is tested. */
export const sunY = (heldMin: number | null | undefined): number => {
  const m = typeof heldMin === 'number' && Number.isFinite(heldMin) ? heldMin : 0
  return 190 - 140 * Math.max(0, Math.min(1, m / 90))
}

/** The hill of Rest: three raised layers lifted by the elevation tokens (a filter shadow, not an outline), and a sun that stands as high as the last block held. */
export function Hill({ heldMin }: { heldMin?: number | null }) {
  const y = Math.round(sunY(heldMin))
  return (
    <svg className="fv-hill" viewBox="0 0 574 360" role="presentation" aria-hidden="true" focusable="false" data-art="hill" data-sun={y} preserveAspectRatio="xMidYMax slice">
      <circle className="fv-hill-sun" cx="430" cy={y} r="38" />
      <path className="fv-hill-far" d="M0 250 C 90 200 170 190 262 224 S 440 270 574 206 V360 H0 Z" />
      <path className="fv-hill-mid" d="M0 290 C 110 236 200 244 300 272 S 480 308 574 262 V360 H0 Z" />
      <path className="fv-hill-near" d="M0 332 C 120 296 230 300 330 322 S 500 344 574 316 V360 H0 Z" />
    </svg>
  )
}

/** A faint ring of 60 ticks, one per minute of the hour, at 1 px; it sits behind the readout and is never read aloud. */
export function TickRing({ size = 420 }: { size?: number }) {
  const c = size / 2
  const r = c - 6
  return (
    <svg className="fv-ticks" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false" data-art="ticks">
      {Array.from({ length: 60 }, (_, i) => {
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2
        const r0 = i % 5 === 0 ? r - 14 : r - 7
        return <line key={i} x1={c + Math.cos(a) * r0} y1={c + Math.sin(a) * r0} x2={c + Math.cos(a) * r} y2={c + Math.sin(a) * r} />
      })}
    </svg>
  )
}
