// D05 on the gallery: the specimen layout, the strata, the data sigil and the rack row. The entries are written beside the
// components (shared/data/specimen/gallery.tsx); this file only puts them in the collected folder.
import { entries } from '../../shared/data/specimen/gallery'
import type { GalleryEntryX } from '../types'

const list: GalleryEntryX[] = entries.map((e) => ({ ...e, merged: 'D05, 13 Nov 2026' }))

export default list
