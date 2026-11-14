// Package Y01: the Paper Desk. Import this folder, not its files.
export { PaperStrata, type PaperStrataProps, type StrataCell } from './PaperStrata'
export { CoverageLedger, EMPTY_COVERAGE, type Coverage, type CoverageLedgerProps } from './CoverageLedger'
export { PaperDrop, PAPER_ACCEPT, acceptsFile, type PaperDropProps } from './PaperDrop'
export { ImportTray, wordsTrace, type ImportTrayProps } from './ImportTray'
export { ExtractionTrace, type ExtractionTraceProps } from './ExtractionTrace'
export { PaperDesk, loadDesk, EMPTY_DATA, type DeskData, type PaperDeskProps } from './PaperDesk'
export { MIN_PAPERS, TOO_FEW, ONE_PAPER, wilson, countText, intervalText, patternState } from './stats'
export { COPY, FOOTER, FORBIDDEN_WORDS } from './copy'
