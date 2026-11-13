// What G01 added on 13 Nov: the panel that takes the aimed light, and the one PLANNED drawing that the kit lamp,
// the contract lamp and the planned plate all use, so the same state looks the same everywhere.
import * as kit from '../../shared/kit'
import * as lamp from '../../shared/lamp'
import type { GalleryEntryX } from '../types'

const merged = 'G01, 13 Nov 2026'
const ANGLES = [315, 0, 45, 135] as const

const entries: GalleryEntryX[] = [
  {
    id: 'kit/LitPanel',
    title: 'LitPanel',
    group: 'kit',
    merged,
    note: 'A panel whose lit ridge follows a fixed angle, or the pointer when no angle is given.',
    states: [
      ...ANGLES.map((a) => ({
        label: `light from ${a} degrees`,
        node: (
          <kit.LitPanel angle={a}>
            <p>The ridge on the lit side is brighter; the far side falls into shade.</p>
          </kit.LitPanel>
        ),
      })),
      {
        label: 'follows the pointer',
        node: (
          <kit.LitPanel>
            <p>Move the mouse across this panel. Touch and keyboard leave it as it is.</p>
          </kit.LitPanel>
        ),
      },
    ],
  },
  {
    id: 'kit/PlannedGlyph',
    title: 'PlannedGlyph (kit)',
    group: 'kit',
    merged,
    note: 'The dashed ring that means PLANNED: not built, and it says so.',
    states: [12, 16, 24, 48].map((size) => ({ label: `${size} px`, node: <span style={{ color: 'var(--ink-1)' }}><kit.PlannedGlyph size={size} /></span> })),
  },
  {
    id: 'lamp/PlannedGlyph',
    title: 'PlannedGlyph',
    group: 'lamp',
    merged,
    note: 'The same drawing, exported by the lamp package that owns it.',
    states: [12, 16, 24, 48].map((size) => ({ label: `${size} px`, node: <span style={{ color: 'var(--ink-1)' }}><lamp.PlannedGlyph size={size} /></span> })),
  },
]

export default entries
