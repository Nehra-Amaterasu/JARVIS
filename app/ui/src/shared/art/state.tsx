// The five reading states (spec 6.6, D12) as the art components use them. The names and words come from the lamp
// contract in shared/lamp (B04), so there is one table for the whole product; this file keeps only a small SVG mark
// sized for a caption plate. The shapes match the contract's five (disc, half disc, diamond, dashed ring, triangle):
// WAITING was a plain ring here before the merge, 1 dash pattern away from PLANNED, and is now the half disc.
// A state is never carried by colour alone: the shape differs in greyscale and the word is always printed.
import { LAMP_SPECS, LAMP_STATES, type LampState } from '../lamp/types'

export type ArtState = LampState

export const ART_STATES: readonly ArtState[] = LAMP_STATES

export const STATE_WORD = Object.fromEntries(LAMP_STATES.map((s) => [s, LAMP_SPECS[s].label])) as Record<ArtState, string>

/** A reading may be drawn as the student's own only when it is live; every other state stamps the frame. */
export const isMeasured = (s: ArtState): boolean => s === 'live'

export function StateMark({ state, size = 12 }: { state: ArtState; size?: number }) {
  const c = size / 2
  return (
    <svg className="art-mark" data-mark={state} viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
      {state === 'live' && <circle cx={c} cy={c} r={c - 1} fill="currentColor" />}
      {state === 'waiting' && (
        <>
          <circle cx={c} cy={c} r={c - 1.25} fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d={`M${c} 1.25A${c - 1.25} ${c - 1.25} 0 0 0 ${c} ${size - 1.25}Z`} fill="currentColor" />
        </>
      )}
      {state === 'simulated' && <path d={`M${c} 1L${size - 1} ${c}L${c} ${size - 1}L1 ${c}Z`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />}
      {state === 'planned' && <circle cx={c} cy={c} r={c - 1.25} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2" />}
      {state === 'fault' && <path d={`M${c} 1L${size - 1} ${size - 1}L1 ${size - 1}Z`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />}
    </svg>
  )
}

/** Shape plus word, for a caption plate. `reason` is the lamp contract's one line (why it is waiting, what faulted). */
export function StateTag({ state, reason }: { state: ArtState; reason?: string }) {
  return (
    <span className="art-tag" data-state={state}>
      <StateMark state={state} />
      <span className="art-tag-word">{STATE_WORD[state]}</span>
      {reason ? <span className="art-tag-reason">{reason}</span> : null}
    </span>
  )
}
