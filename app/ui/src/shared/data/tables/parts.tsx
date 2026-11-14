// Small pieces the three components share: the narrow-screen switch and the lamp tag.
import { useSyncExternalStore } from 'react'
import { LAMP_SPECS, LampGlyph, isLampState, type LampState } from '../../lamp'
import { NARROW_PX } from './layout'

const QUERY = `(max-width: ${NARROW_PX - 1}px)`

function subscribe(cb: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const mq = matchMedia(QUERY)
  mq.addEventListener?.('change', cb)
  return () => mq.removeEventListener?.('change', cb)
}
const snapshot = (): boolean => typeof matchMedia === 'function' && matchMedia(QUERY).matches

/** True under 900 px. The key-value cards and the bottom sheet follow it; a `layout` prop can force either form. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

/** The lamp as shape plus word, drawn with the contract's glyph. Colour is the third cue, never the only one. */
export function LampTag({ state, className }: { state: LampState; className?: string }) {
  const s = isLampState(state) ? state : 'waiting'
  const spec = LAMP_SPECS[s]
  return (
    <span className={className ? `d3-lamp ${className}` : 'd3-lamp'} data-lamp={s} style={{ ['--d3-lamp-ink' as string]: `var(${spec.token})` }}>
      <LampGlyph state={s} size={12} />
      <span className="d3-lamp-word">{spec.label}</span>
    </span>
  )
}

/** Why a state has no number, in words; the default reason of each non-numeric state. */
export const WHY: Record<LampState, string> = {
  live: '',
  simulated: 'generated data, not measured',
  waiting: 'no report',
  planned: 'not built yet',
  fault: 'the source reported an error',
}
