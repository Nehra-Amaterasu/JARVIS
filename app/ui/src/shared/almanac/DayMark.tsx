// DayMark (package L01, spec 20.6.1): one glyph per kind, filled when done and hollow when planned, so a planned and a done
// thing never share a mark. Shape carries the meaning and ink weight is a second cue (no hue per kind: nine hues on a calendar
// is the clutter the owner asked to remove). The drawing is 14 x 14; `data-shape` is what the tests read.
import type { ReactNode } from 'react'
import { SHAPES, shapeOf, type Kind, type ShapeName } from './types'

const FILLED: Partial<Record<ShapeName, ReactNode>> = {
  disc: <circle cx="7" cy="7" r="5.25" className="alm-f" />,
  square: <rect x="2" y="2" width="10" height="10" rx="1.5" className="alm-f" />,
  triangle: <path d="M7 1.75 L12.6 11.75 H1.4 Z" className="alm-f" strokeLinejoin="round" />,
  drop: <path d="M7 1.25 C7 1.25 2.4 6.1 2.4 9 A4.6 4.6 0 0 0 11.6 9 C11.6 6.1 7 1.25 7 1.25 Z" className="alm-f" />,
  bar: <rect x="5.25" y="1.25" width="3.5" height="11.5" rx="1.2" className="alm-f" />,
  dash: <rect x="1.5" y="5.75" width="11" height="2.5" rx="1.25" className="alm-f" />,
  diamond: <path d="M7 1 L13 7 L7 13 L1 7 Z" className="alm-f" strokeLinejoin="round" />,
  notch: <path d="M2 2 H9 L12 5 V12 H2 Z" className="alm-f" strokeLinejoin="round" />,
  hexagon: <path d="M7 1.2 L12.2 4.1 V9.9 L7 12.8 L1.8 9.9 V4.1 Z" className="alm-f" strokeLinejoin="round" />,
}

const HOLLOW: Partial<Record<ShapeName, ReactNode>> = {
  ring: <circle cx="7" cy="7" r="4.4" className="alm-l" />,
  'square-outline': <rect x="2.75" y="2.75" width="8.5" height="8.5" rx="1.2" className="alm-l" />,
  'triangle-outline': <path d="M7 3 L11.4 11 H2.6 Z" className="alm-l" strokeLinejoin="round" />,
  'drop-outline': <path d="M7 2.2 C7 2.2 3.2 6.3 3.2 8.9 A3.8 3.8 0 0 0 10.8 8.9 C10.8 6.3 7 2.2 7 2.2 Z" className="alm-l" />,
  'bar-outline': <rect x="5.4" y="2.4" width="3.2" height="9.2" rx="1" className="alm-l" />,
  'diamond-dashed': <path d="M7 2.2 L11.8 7 L7 11.8 L2.2 7 Z" className="alm-l alm-dashed" strokeLinejoin="round" />,
  'notch-outline': <path d="M2.9 2.9 H8.6 L11.1 5.4 V11.1 H2.9 Z" className="alm-l" strokeLinejoin="round" />,
  'hexagon-outline': <path d="M7 2.4 L11.2 4.8 V9.2 L7 11.6 L2.8 9.2 V4.8 Z" className="alm-l" strokeLinejoin="round" />,
}

export const drawShape = (name: ShapeName): ReactNode => FILLED[name] ?? HOLLOW[name] ?? null

export interface DayMarkProps {
  kind: Kind
  done: boolean
  /** The accessible name. Default: the kind's word and "done" or "planned" (a rest day is just "Rest day"). */
  label?: string
  size?: number
  /** Inside a control that already carries the name (a cell): hidden from assistive technology. */
  decorative?: boolean
  className?: string
}

export function DayMark({ kind, done, label, size = 14, decorative, className }: DayMarkProps) {
  const shape = shapeOf(kind, done)
  const word = SHAPES[kind].word
  const name = label ?? (kind === 'rest' ? word : `${word}, ${done ? 'done' : 'planned'}`)
  return (
    <svg
      className={className ? `alm-mark ${className}` : 'alm-mark'}
      viewBox="0 0 14 14"
      width={size}
      height={size}
      data-kind={kind}
      data-done={done ? 'true' : 'false'}
      data-shape={shape}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? 'true' : undefined}
      focusable="false"
    >
      {drawShape(shape)}
    </svg>
  )
}
