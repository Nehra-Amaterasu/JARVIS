// The lamp and its word, side by side: the one drawing of "a number carries its state". Today's plates, the dial, the strip, the left
// rail's labels and the Proof rail's figures all draw it, so the word is the state's own label (LAMP_SPECS) and no page holds a second
// spelling of it. The glyph colour is the state's token; the word is ink at 4.5:1 (colour is a third cue, the shape and the word are
// the first two).
import { LAMP_SPECS, LampGlyph, type LampState } from '../../shared/lamp'
import './lampword.css'

export function LampWord({ state, size = 10, className }: { state: LampState; size?: number; className?: string }) {
  return (
    <span className={className ? `lw ${className}` : 'lw'} data-lamp={state}>
      <LampGlyph state={state} size={size} />
      <span className="lw-w">{LAMP_SPECS[state].label}</span>
    </span>
  )
}
