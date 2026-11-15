// ProvenanceChip (package C03, spec 21.4.2 S4): the door an item came through, as words on a kit chip. The words are the
// provenance (Pasted, Calendar file, Folder, Archive, Classroom), so a source is never only a colour or a shape; the full
// sentence (the original line, the time) is in the detail pane and in the chip's accessible name.
import { Chip } from '../../../shared/kit'
import { SOURCE_WORD } from './model'
import type { IntakeSource } from './types'

export interface ProvenanceChipProps {
  source: IntakeSource
  /** The longer sentence for the hover text ("Read from a pasted line ..."); the detail pane prints it in full. */
  detail?: string
}

export function ProvenanceChip({ source, detail }: ProvenanceChipProps) {
  return (
    <span className="ik-prov" data-source={source} title={detail} aria-label={`Source: ${SOURCE_WORD[source]}`} role="img">
      <Chip tone="neutral">{SOURCE_WORD[source]}</Chip>
    </span>
  )
}
