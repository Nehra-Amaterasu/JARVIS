/**
 * The eleven centrepiece art ids (docs/design/jarvis-product-overhaul.md 20.4.6, wave 5 contract). Sections ask
 * ArtSlot for these by id; the gallery lists art by reading the manifest, so adding an id is a recipe in
 * tools/art/recipes plus a line here, never an edit to a section.
 */
export const CENTREPIECE_IDS = [
  'art.core.hill-ring',
  'art.room.faceplate',
  'art.senses.spindle',
  'art.memory.branch',
  'art.console.frame',
  'art.day.sun',
  'art.focus.dots',
  'art.study.island',
  'art.tree.trunk',
  'art.career.skyline',
  'art.proof.ring',
] as const

export type CentrepieceId = (typeof CENTREPIECE_IDS)[number]
