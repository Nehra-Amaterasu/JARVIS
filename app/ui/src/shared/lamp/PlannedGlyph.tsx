// The one PLANNED drawing (wave 5, G01; spec 6.6 and 12.4): a dashed ring. Before this file the kit lamp drew it on a
// 12 px box (r 4.5, dash 2.2 1.8), the contract lamp and the planned plate on a 16 px box (r 6, dash 2.4 2.2): two
// different rings for one state, which the jury counted as a defect. Every PLANNED glyph now comes from here: the kit
// LampGlyph, the contract LampGlyph, the planned plate and chip, and the PLANNED folder tab. It lives in shared/lamp
// because the lamp is the lowest layer the kit and shared/planned both already import.
import type { SVGProps } from 'react'

/** The ring on its 16 x 16 box, exported so a test can compare every PLANNED glyph with the one source. */
export const PLANNED_RING = { cx: 8, cy: 8, r: 6, strokeWidth: 1.5, dash: '2.4 2.2' } as const

export type PlannedGlyphProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox' | 'ref'>

/** The dashed ring. Decorative (aria-hidden): the word PLANNED beside it is the information. Draws in currentColor. */
export function PlannedGlyph({ size = 12, className, ...rest }: PlannedGlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-glyph="dashed-ring"
      {...rest}
      className={className ? `planned-glyph ${className}` : 'planned-glyph'}
    >
      <circle
        cx={PLANNED_RING.cx}
        cy={PLANNED_RING.cy}
        r={PLANNED_RING.r}
        fill="none"
        stroke="currentColor"
        strokeWidth={PLANNED_RING.strokeWidth}
        strokeDasharray={PLANNED_RING.dash}
      />
    </svg>
  )
}
