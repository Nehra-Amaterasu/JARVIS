// The eleven section centrepieces of G03, one plate each. The pictures come from the private art track: in a build
// without it (the default, and every test build) ArtSlot draws its honest "private track off" plate instead, so this
// entry never shows a stand-in picture as if it were the real one.
import { ArtSlot } from '../../art/ArtSlot'
import { CENTREPIECE_IDS } from '../../art/centrepieces'
import type { GalleryEntryX } from '../types'

const SECTION_OF = (id: string) => id.split('.')[1] ?? id

const entries: GalleryEntryX[] = [
  {
    id: 'G03-centrepieces',
    title: 'Section centrepieces',
    group: 'art',
    merged: 'G03, 13 Nov 2026',
    note: 'One picture per section, built by the private art track. A build without that track shows a plate that says so.',
    states: CENTREPIECE_IDS.map((id) => ({
      label: SECTION_OF(id),
      node: (
        <div style={{ width: 'min(560px, 100%)' }}>
          <ArtSlot id={id} fit="cover" ratio={16 / 10} caption={id} />
        </div>
      ),
    })),
  },
]

export default entries
