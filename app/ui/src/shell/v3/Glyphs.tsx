/**
 * The drawn marks of the v3 shell, all in one house line (1.6 stroke, round caps) on a 20 or 24 unit box, taken from the
 * final mockup. Presentational only. The state glyph follows spec section 6: a shape per state so that colour only helps.
 */
import type { ReactElement } from 'react'
import type { LampState } from '../../shared/lamp/types'
import type { SubProjectId } from './subprojects'

/** 14 px state shape. LIVE disc, WAITING disc with its left half filled, SIMULATED diamond with a dot, PLANNED dashed ring,
 *  FAULT filled triangle with a bar. Draws in currentColor; the caller sets the colour role. */
export function StateGlyph({ state, size = 14 }: { state: LampState; size?: number }) {
  return (
    <svg className="s3-glyph" data-glyph={state} viewBox="0 0 14 14" width={size} height={size} aria-hidden="true" focusable="false">
      {state === 'live' && <circle cx="7" cy="7" r="5.2" fill="currentColor" />}
      {state === 'waiting' && (
        <>
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M7 2a5 5 0 0 0 0 10z" fill="currentColor" />
        </>
      )}
      {state === 'planned' && <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeDasharray="2.1 2" />}
      {state === 'simulated' && (
        <>
          <path d="M7 1.4 12.6 7 7 12.6 1.4 7z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <circle cx="7" cy="7" r="1.7" fill="currentColor" />
        </>
      )}
      {state === 'fault' && (
        <>
          <path d="M7 1.4 13.2 12.4H.8z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          <path d="M7 5.4v3.2M7 10.1v.2" className="s3-glyph-bar" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

const MARK: Record<SubProjectId, ReactElement> = {
  jarvis: (
    <>
      <circle r="9" />
      <path d="M0-6V-2.5M0 2.5V6M-6 0H-2.5M2.5 0H6M-4.2-4.2l1.8 1.8M4.2 4.2l-1.8-1.8M4.2-4.2l-1.8 1.8M-4.2 4.2l1.8-1.8" />
    </>
  ),
  aankhen: (
    <>
      <path d="M-9-3a13 13 0 0 1 18 0M-6 1a8 8 0 0 1 12 0M-3 5a3.2 3.2 0 0 1 6 0" />
      <circle cy="8.6" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  yadaash: (
    <>
      <circle cx="-3.6" r="6" />
      <circle cx="3.6" r="6" />
      <circle r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  wellwisher: (
    <>
      <path d="M-3-8H-8V8H-3M3-8H8V8H3" />
      <circle r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
}

/** A sub-project's own formed mark: a sigil ring with rays, three signal arcs, two linked loops, a bracket pair with a dot. */
export function ProjectMark({ id, size = 22 }: { id: SubProjectId; size?: number }) {
  return (
    <svg className="s3-mark" viewBox="-12 -12 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {MARK[id]}
    </svg>
  )
}

/** The brand: four squares, two lit and two dimmed. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="s3-brandmark" viewBox="-12 -12 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      <rect x="-9" y="-9" width="7.5" height="7.5" rx="2.4" />
      <rect x="1.5" y="-9" width="7.5" height="7.5" rx="2.4" opacity=".55" />
      <rect x="-9" y="1.5" width="7.5" height="7.5" rx="2.4" opacity=".55" />
      <rect x="1.5" y="1.5" width="7.5" height="7.5" rx="2.4" />
    </svg>
  )
}

const ICON: Record<string, ReactElement> = {
  core: <path d="M4 10v0M7 6.5v7M10 3v14M13 6.5v7M16 9v2" />,
  room: (
    <>
      <path d="M3 9.5 10 3.5l7 6V16.5H3z" />
      <path d="M8.5 16.5v-4h3v4" />
    </>
  ),
  console: (
    <>
      <path d="M3.5 14a6.5 6.5 0 1 1 13 0" />
      <path d="M10 14l3-4.5" />
    </>
  ),
  senses: (
    <>
      <path d="M3 8a10 10 0 0 1 14 0M5.8 10.8a6 6 0 0 1 8.4 0M8.6 13.6a2 2 0 0 1 2.8 0" />
      <circle cx="10" cy="16" r=".8" fill="currentColor" />
    </>
  ),
  memory: (
    <>
      <ellipse cx="10" cy="5.5" rx="6" ry="2.5" />
      <path d="M4 5.5v4.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5.5" />
      <path d="M4 10v4.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V10" />
    </>
  ),
  day: (
    <>
      <rect x="3" y="4.5" width="14" height="12" rx="2.5" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
    </>
  ),
  focus: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  study: (
    <>
      <path d="M3.5 4.5c2.5-.6 5 0 6.5 1.5 1.5-1.5 4-2.1 6.5-1.5v10c-2.5-.6-5 0-6.5 1.5-1.5-1.5-4-2.1-6.5-1.5z" />
      <path d="M10 6v10" />
    </>
  ),
  tree: <path d="M10 17V9M10 9C10 6 8 4.5 5 4.5 5 7.5 7 9 10 9zM10 11.5c0-2.5 1.8-4 5-4 0 3-2 4-5 4z" />,
  career: (
    <>
      <rect x="3" y="6.5" width="14" height="9.5" rx="2.5" />
      <path d="M7.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 12.5 5v1.5M3 10.5h14" />
    </>
  ),
}

export function SectionIcon({ id, size = 20 }: { id: string; size?: number }) {
  return (
    <svg className="s3-icon" viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON[id] ?? <circle cx="10" cy="10" r="5" />}
    </svg>
  )
}

export function Chevron({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 5l4 4 4-4" />
    </svg>
  )
}

export function LockGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.8" />
      <path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" />
    </svg>
  )
}

/** The lamp pill's ring: one short arc per lamp, coloured by its state, worst first from the top. */
export function PillRing({ states, size = 22 }: { states: readonly LampState[]; size?: number }) {
  const n = Math.max(1, states.length)
  const c = 43.98 // circumference of r = 7
  const seg = Math.max(1, c / n - 2.6)
  return (
    <svg className="s3-ring" viewBox="-10 -10 20 20" width={size} height={size} aria-hidden="true" focusable="false">
      {states.map((s, i) => (
        <circle key={i} className="s3-ring-arc" data-state={s} r="7" fill="none" strokeWidth="3.4" strokeLinecap="butt"
          strokeDasharray={`${seg.toFixed(2)} ${(c - seg).toFixed(2)}`} strokeDashoffset={(-(i * c) / n).toFixed(2)} transform="rotate(-90)" />
      ))}
    </svg>
  )
}

/** Three window keys' glyphs. */
export const WinGlyph = {
  min: (
    <svg viewBox="0 0 14 14" width="14" height="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M2 10h10" />
    </svg>
  ),
  max: (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 14 14" width="14" height="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  ),
  dots: (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="4.5" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="15.5" cy="10" r="1.6" />
    </svg>
  ),
}
