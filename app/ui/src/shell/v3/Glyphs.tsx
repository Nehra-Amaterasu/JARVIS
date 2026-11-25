/**
 * The marks of the v3 shell. The state glyph and the small utility marks are drawn here; the project and section icons are lucide
 * (25 Nov: the abstract drawn glyphs were hard to tell apart), chosen in this file only. Presentational only. The state glyph follows spec section 6: a shape per state so that colour only helps.
 */
import { AudioLines, BookMarked, BookOpen, Bot, Brain, Briefcase, CalendarDays, Compass, Gauge, House, Mic, PanelLeftClose, PanelLeftOpen, Sprout, Star, Target, Waves, Wifi, type LucideIcon } from 'lucide-react'
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

/** One metaphor per project, drawn by lucide in one line weight (1.75) so four marks differ by their shape, not their detail:
 *  JARVIS the voice (mic), Aankhen sensing by radio signal (Wi-Fi arcs; never an eye or a lens, the project has no camera),
 *  Yadaash memory (brain), Well Wisher his day and wishes (star). */
const PROJECT_ICON: Record<SubProjectId, LucideIcon> = { jarvis: Mic, aankhen: Wifi, yadaash: Brain, wellwisher: Star }

/** A sub-project's mark. 18 px in a spine row (the owner asked for clearer, smaller rows); the stroke stays 1.75 at every size. */
export function ProjectMark({ id, size = 18 }: { id: SubProjectId; size?: number }) {
  const Icon = PROJECT_ICON[id]
  return <Icon className="s3-mark" size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />
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

/** One metaphor per section, all lucide at 1.75. The ten differ by silhouette: sound bars, a house, a gauge, radio arcs, a book with a
 *  bookmark, a calendar, a target, an open book, a sprout, a briefcase; Agents (the planned row of Yadaash) is a bot. */
const SECTION_ICON: Record<string, LucideIcon> = {
  core: AudioLines,
  room: House,
  console: Gauge,
  senses: Waves,
  memory: BookMarked,
  agents: Bot,
  day: CalendarDays,
  focus: Target,
  study: BookOpen,
  tree: Sprout,
  career: Briefcase,
}

export function SectionIcon({ id, size = 18 }: { id: string; size?: number }) {
  const Icon = SECTION_ICON[id] ?? Compass
  return <Icon className="s3-icon" size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />
}

/** The fold key of the spine's foot: the chevron points the way the spine will go. */
export function FoldGlyph({ folded, size = 18 }: { folded: boolean; size?: number }) {
  const Icon = folded ? PanelLeftOpen : PanelLeftClose
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />
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
