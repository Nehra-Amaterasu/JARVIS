// A tag chip (package Y01): where a tag on a question came from. RULE is a counted rule, MODEL the local model's
// suggestion (dashed until the student accepts it), HAND the student's own. The word is always printed; the dashed outline
// and the glyph repeat it, so the source is never only a colour.
import type { TagSource } from '../ports'

const MEANS: Record<TagSource, string> = {
  RULE: 'tagged by a counted rule',
  // since R-64 (28 Nov) the model may be the local one or Claude; the review desk names it beside the chip
  MODEL: 'set by a model, not yet your decision',
  HAND: 'set by you',
}
const GLYPH: Record<TagSource, string> = { RULE: '#', MODEL: '~', HAND: '+' }

export function TagChip({ source, label }: { source: TagSource; label?: string }) {
  return (
    <span className="rv-tag" data-src={source} title={MEANS[source]}>
      <span className="rv-tag-glyph" aria-hidden="true">{GLYPH[source]}</span>
      <span>{source}</span>
      {label && <span className="rv-tag-label">{label}</span>}
      <span className="ww-sr-only">, {MEANS[source]}</span>
    </span>
  )
}
