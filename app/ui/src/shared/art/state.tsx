// The five reading states (spec 6.6, D12) as far as the art components need them: a type, a shape and a word.
// B04 (the lamp and the {state, since, reason} contract) is built in parallel and owns the real Lamp. Until it
// lands, this file is the stated interface of the spec and nothing more: the same five names, the same five
// shapes (disc, ring, diamond, dashed ring, triangle), so swapping `StateMark` for the Lamp is one import. A
// state is never carried by colour alone: the shape differs in greyscale and the word is always printed.

export type ArtState = 'live' | 'waiting' | 'simulated' | 'planned' | 'fault'

export const ART_STATES: readonly ArtState[] = ['live', 'waiting', 'simulated', 'planned', 'fault']

export const STATE_WORD: Record<ArtState, string> = {
  live: 'LIVE',
  waiting: 'WAITING',
  simulated: 'SIMULATED',
  planned: 'PLANNED',
  fault: 'FAULT',
}

/** A reading may be drawn as the student's own only when it is live; every other state stamps the frame. */
export const isMeasured = (s: ArtState): boolean => s === 'live'

export function StateMark({ state, size = 12 }: { state: ArtState; size?: number }) {
  const c = size / 2
  return (
    <svg className="art-mark" data-mark={state} viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
      {state === 'live' && <circle cx={c} cy={c} r={c - 1} fill="currentColor" />}
      {state === 'waiting' && <circle cx={c} cy={c} r={c - 1.25} fill="none" stroke="currentColor" strokeWidth="1.5" />}
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
