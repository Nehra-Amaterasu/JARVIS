// What the tonight sheet and the ledger share (package N2): the subject names, the face switch that carries the two screens inside the
// views they were placed in, and the one sentence line that prints an engine answer beside its state word.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePlan } from '../../../germoney/game/plan'
import { Lamp, Segmented, type LampState } from '../../../shared/kit'

/** Subject id to the name he typed for it; an id the plan does not list is printed as the engine sent it. Reads the plan's own academics. */
export function useSubjects(): { id: string; name: string }[] {
  const academics = usePlan((s) => s.academics)
  useEffect(() => { if (!usePlan.getState().academics) void usePlan.getState().loadAcademics() }, [])
  return (academics?.subjects ?? []).filter((s) => s && typeof s.id === 'string').map((s) => ({ id: s.id, name: s.name || s.id }))
}
export const nameOf = (subjects: { id: string; name: string }[], id: string): string => subjects.find((s) => s.id.toLowerCase() === id.toLowerCase())?.name ?? id

/** The engine's sentence beside its lamp. A sentence is never printed without the state it came with. */
export function Said({ state, text, role = 'status', id, reveal }: { state: LampState; text: string; role?: 'status' | 'alert'; id?: string; reveal?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null)
  // the answer to a press lands below the keys, where a short tray may have scrolled it out of sight: bring it into view, never past the tray
  useEffect(() => { if (reveal) ref.current?.scrollIntoView?.({ block: 'nearest' }) }, [reveal, text])
  return (
    <p ref={ref} className="tsh-said" role={role} data-state={state} data-said={id ?? ''}>
      <Lamp state={state} bare />
      <span>{text}</span>
    </p>
  )
}

export interface FaceSpec<T extends string> { id: T; label: string; node: ReactNode }

/**
 * Two faces of one view (the tonight sheet and the paper maker in Practice; today and the ledger in Plan). The switch is one 44 px
 * segmented control above the trays; the face not shown is not mounted, so it holds no request, and its own trays are never
 * rewritten: each face is a whole view that was built on the three trays.
 */
export function Faces<T extends string>({ faces, first, label, className }: { faces: FaceSpec<T>[]; first: T; label: string; className: string }) {
  const [face, setFace] = useState<T>(first)
  const shown = faces.find((f) => f.id === face) ?? faces[0]
  return (
    <div className={`tsh-faces ${className}`} data-face={shown.id}>
      <div className="tsh-faces-bar">
        <Segmented<T> variant="choice" label={label} value={shown.id} onChange={setFace} options={faces.map((f) => ({ id: f.id, label: f.label }))} />
      </div>
      <div className="tsh-face">{shown.node}</div>
    </div>
  )
}
