// Every sentence of the generator screens that is not a figure or a label from data, in one file, so the forbidden-word test
// (no "important", "likely" or "expected") reads all of it in one pass. The footer is the Paper Desk's, imported not copied.
import { FOOTER, FORBIDDEN_WORDS } from '../papers/copy'

export { FOOTER, FORBIDDEN_WORDS }
export { HEADER } from './model'

export const COPY = {
  title: 'Practice paper',
  noBlueprint: 'No blueprint yet',
  noBlueprintNote: 'A blueprint is the shape of a paper: its sections, how many questions to set and attempt, and the marks. Infer one from a paper on file, or start one by hand.',
  start: 'Start by hand',
  infer: 'Infer from a paper',
  inferWaiting: 'inferring a blueprint needs the paper engine',
  save: 'Confirm and draw a paper',
  saveWaiting: 'saving a blueprint is not connected yet',
  unsavedEdits: 'Your edits are not saved: saving a blueprint is not connected yet.',
  addSection: 'Add a section',
  maxSections: 'At most 7 sections',
  balanced: (n: number) => `balanced: ${n} marks`,
  rowHint: 'Alt and the arrow keys move the chosen section. Plus adds one.',
  previewNote: 'Layout only, not the paper. The questions are drawn in the next step.',
  minutesPerMark: 'Minutes per mark',
  noDuration: 'no duration set',
  drawing: 'Drawing the paper',
  drawWaiting: 'Nothing was drawn',
  reseed: 'Reseed',
  seedLabel: 'Seed',
  seedBad: 'A seed is a whole number from 1 to 2147483646.',
  seedNote: 'The seed is printed in the footer, so the same paper can be drawn again.',
  hollowTitle: (n: number) => `${n} slot${n === 1 ? '' : 's'} left hollow`,
  hollowNote: 'A slot with no reviewed question is left hollow and printed as a gap. Nothing is padded.',
  noPaper: 'No paper drawn yet',
  noPaperNote: 'Confirm a balanced blueprint, then draw a paper. Each slot names where its question came from.',
  printCta: 'Print or save as PDF',
  printNote: 'The browser print dialog opens. Choose Save as PDF to keep a file. The sheet sets its own A4 page and 18 mm margins.',
  cropNote: (n: number) => `${n} question${n === 1 ? '' : 's'} print${n === 1 ? 's' : ''} as the page crop, because the text was read but not checked by you.`,
  nightPlanned: 'The night sheet is planned',
  keyNone: 'No key stored for this question',
  keyHead: 'Answer key',
  markingHead: 'Marking sheet',
  markingNote: 'Marked by you. Write the marks you give, then enter them in the Reader.',
  stepNeedsBlueprint: 'confirm a balanced blueprint first',
  stepNeedsPaper: 'draw a paper first',
  fixture: 'Invented blueprint and questions for the gallery. SIMULATED, not read from a file.',
} as const
