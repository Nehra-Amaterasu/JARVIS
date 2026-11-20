import { br, type TreeSrc } from './schema'

const tree: TreeSrc = {
  id: 'craft',
  name: 'Craft and creative',
  about: 'Making things with your hands and eyes: drawing, sound, picture, print and the habit of finishing.',
  refreshDays: 90,
  branches: [
    br('Sketching', 'Lines and shapes | Light and shade | A finished study'),
    br('Typography', 'Type families | Spacing and hierarchy | A set page'),
    br('Photography', 'Light and framing | Editing a picture | A small series'),
    br('Audio', 'Recording cleanly | Cutting and levelling | A finished track or clip'),
    br('Video editing', 'Cuts and pacing | Sound under picture | A two-minute film'),
    br('Writing', 'A daily page | Editing a draft | A finished piece'),
    br('Music basics', 'Rhythm and pulse | Scales and chords | A short piece played through'),
    br('3D printing', 'A first print | Tolerances and supports | A part that fits'),
    br('Soldering', 'Clean joints | Through-hole parts | A working board'),
    br('Notebook systems', 'One notebook, one purpose | Weekly review | A system kept for a month'),
    br('Presentation', 'One idea per slide | Visuals that carry it | A talk given'),
    br('Craft capstone', 'Choose a piece | Make it in stages | Show it and note what you learned', true),
  ],
}
export default tree
