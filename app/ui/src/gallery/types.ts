// The gallery's one entry shape (wave 5 contract, N01). `GalleryEntry` is the contract type, exactly as written in the
// spec; `GalleryEntryX` only adds optional fields for the bench mount and the "merged in" line, so a package that writes
// the plain contract shape (G01, G02, G03 and later waves) is accepted unchanged.
import type { ReactNode } from 'react'

export type GalleryGroup = 'kit' | 'art' | 'lamp' | 'voice' | 'grammar' | 'data' | 'section' | 'theme'

export type GalleryEntry = {
  id: string
  title: string
  group: GalleryGroup
  states: { label: string; node: ReactNode }[]
  note?: string
}

export type GalleryEntryX = GalleryEntry & {
  /** Other exports this entry draws (the bench's export-coverage set), e.g. 'LampGlyph' beside 'Lamp'. */
  also?: string[]
  /** Drawn by Well Wisher's own `.ww-*` kit stylesheet, so it needs the `.ww` wrapper. */
  legacy?: boolean
  /** A modal or popover: the bench opens one of these on ?open= and draws them first. */
  overlay?: boolean
  /** The package and the day the component merged, shown as the "merged in" line. */
  merged?: string
}

/** The order of the groups in the index and the filter. */
export const GROUPS: readonly { id: GalleryGroup; label: string; hint: string }[] = [
  { id: 'kit', label: 'Kit', hint: 'Buttons, switches, readouts and frames' },
  { id: 'art', label: 'Art', hint: 'Rings, ridges, dials and the art ids' },
  { id: 'lamp', label: 'Lamp', hint: 'The five states and what they mean' },
  { id: 'voice', label: 'Voice', hint: 'The voice picture on fixture frames' },
  { id: 'grammar', label: 'Grammar', hint: 'Sigil, ASCII and terminal' },
  { id: 'data', label: 'Data', hint: 'Number and chart components' },
  { id: 'section', label: 'Sections', hint: 'The section themes as swatches' },
  { id: 'theme', label: 'Themes', hint: 'The two clay themes' },
]
