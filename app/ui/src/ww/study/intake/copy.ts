// Every sentence of the intake desk that is not data, in one file so the forbidden-word test can read all of it in one pass.
export const COPY = {
  title: 'Intake',
  footer: 'Every item waits for your press. An accepted deadline is listed; it never changes a count by itself.',
  emptyTitle: 'Nothing brought in yet',
  emptyNote: 'Drop a folder, paste a list or import a calendar file above. Each item waits here until you accept or decline it.',
  noMatch: 'Nothing in this filter.',
  fixture: 'Invented items for the gallery. SIMULATED, not read from a list or a file.',
  classroomPlate: 'Classroom',
  classroomReason: 'Not linked. You sign in first; the four doors work without it.',
  noFetchShort: 'The app never downloads a file for you.',
  noFetch: 'The app never downloads a file for you: save it into your watched folder yourself.',
  ambiguousNeeds: 'Choose which date you mean first',
  chooseDate: 'Which date is it?',
  noDate: 'no date',
  taken: 'Sent for reading. Nothing enters the bank until you accept it there.',
  removeNote: 'Removes the row. A file in your own folder is never touched.',
  undone: 'Back to new.',
  pasteHint: 'One item per line, for example: Maths Assignment 3 - due 18 Nov 5pm',
  pasteNote: 'The lines are read into your list as NEW. Nothing is accepted until you press Accept.',
  icsNote: 'Each event is read into your list as NEW. Switch off the ones you do not want; nothing is accepted yet.',
  archiveNote: 'The files inside are listed first. Only the ones you keep are queued, each as PENDING for review.',
  coursesEmpty: 'No classes read yet.',
  coursesNote: 'A class name maps to one subject. Your confirmation is kept and never overwritten.',
  olderNote: 'not decided for 14 days; kept, never deleted',
} as const

/** The words the product never says here: they promise what a count cannot. And no control says it is linked before it is. */
export const FORBIDDEN_WORDS = ['important', 'likely', 'expected', 'connected'] as const
