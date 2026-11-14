// Every sentence of the Paper Desk and the Review Desk that is not a number or a label from data, in one file so the
// forbidden-word test (no "important", "likely" or "expected" anywhere a student reads) can read all of it in one pass.
export const FOOTER = 'From papers on file. This prepares practice; it does not predict a paper or a result.'

export const COPY = {
  footer: FOOTER,
  deskTitle: 'Paper desk',
  strataNote: 'A dot is a topic in a year: its size is the topic’s share of that paper’s marks; its shape is the question type.',
  empty: 'Drop the first paper here',
  emptyNote: 'Nothing on file yet. A PDF or photos of a paper go in; questions come out for you to review. Nothing enters the bank until you accept it.',
  one: '1 paper: counts only, no pattern yet',
  tooFew: 'too few papers to show a pattern',
  waitingPrefix: 'Waiting',
  reviewCta: (n: number) => `Review ${n} waiting`,
  nothingToReview: 'Nothing waiting for review',
  acceptCertain: 'Accept all certain and review the rest',
  acceptCertainHint: 'Accepts only questions tagged by RULE at a margin of 0.5 or more with their marks found.',
  undo: 'Undo',
  rejected: 'Rejected. Undo within 10 s.',
  noPaper: 'Choose a paper in the list',
  refusedType: 'Only PDF and image files can be read',
  rulesOnly: 'Local model busy: tags come from rules only.',
  ocrMissing: 'Text layer only; photos need the OCR tool (needs your OK to install).',
  textUnverified: 'Recognised text, not checked against the crop. The crop is the source of truth.',
  cropOnly: 'No text was read. The crop is all there is.',
  textVerified: 'Text checked against the crop by you.',
  draftPoints: 'Draft points',
  draftWaiting: 'the local model is not connected',
  rubricSum: (sum: number, total: number) => (sum === total ? `${sum} of ${total} marks assigned` : `${sum} of ${total} marks assigned: points must sum to the question’s marks`),
  fixture: 'Invented papers for the gallery. SIMULATED, not read from a file.',
} as const

/** The words the product never says about papers (spec 20.7 and A.Y01): they promise what a count cannot. */
export const FORBIDDEN_WORDS = ['important', 'likely', 'expected'] as const
