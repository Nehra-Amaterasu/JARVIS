// LitPanel (wave 5, G01; spec 20.4.4 "aimed light"): a Panel whose raised face catches one light. It answers the
// first jury's "flat clay with no material" (signature moment 3 of 10) without adding motion: the sheen is a
// pre-painted layer (kit clay.css, .k-lit) whose opacity alone changes, the light direction is one of 8 quantised
// angles, and only the hovered (or focused) panel is lit. Nothing runs at idle: no timer, no animation frame, and the
// pointer handler writes one attribute only when the pointer crosses into another 45 degree sector.
import { useRef, type PointerEvent } from 'react'
import { Panel, type PanelProps } from './Frames'
import { cx } from './util'

export type LitAngle = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315
export const LIT_ANGLES: readonly LitAngle[] = [0, 45, 90, 135, 180, 225, 270, 315]

/** The direction the light comes from, in degrees clockwise from the top, snapped to the nearest of the 8 angles. */
export function snapAngle(dx: number, dy: number): LitAngle {
  if (dx === 0 && dy === 0) return 315
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI // 0 = up, 90 = right
  const k = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return LIT_ANGLES[k]
}

export type LitPanelProps = PanelProps & {
  /** A fixed light. Omitted: the light follows a mouse pointer over the panel (8 directions), resting at 315 (top left). */
  angle?: LitAngle
  /** Hold the lit state (a gallery specimen, or a panel that is the current item). Omitted: lit only while hovered or focused. */
  lit?: boolean
}

export function LitPanel({ angle, lit, className, ...panel }: LitPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const follow = angle === undefined
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!follow || e.pointerType !== 'mouse' || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const next = String(snapAngle(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)))
    if (ref.current.dataset.angle !== next) ref.current.dataset.angle = next
  }
  return (
    <div ref={ref} className={cx('k-lit', className)} data-angle={angle ?? 315} data-follow={follow ? 'true' : undefined} data-lit={lit ? 'true' : undefined} onPointerMove={follow ? onPointerMove : undefined}>
      <Panel {...panel} />
    </div>
  )
}
