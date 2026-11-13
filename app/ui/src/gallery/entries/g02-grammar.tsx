// The grammars of G02 (sigil, ASCII, terminal) on the gallery. The entry is written by the grammar package itself
// (shared/grammar/gallery.tsx) in the contract's GalleryEntry shape; this file only puts it in the collected folder.
import { entry } from '../../shared/grammar/gallery'
import type { GalleryEntryX } from '../types'

const entries: GalleryEntryX[] = [{ ...entry, merged: 'G02, 13 Nov 2026' }]

export default entries
