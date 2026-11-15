// Package X03: the Blueprint Editor, the generator and the print sheets of the exam generator. Import this folder, not its files.
export { GeneratorDesk, type GeneratorDeskProps, type Step } from './GeneratorDesk'
export { BlueprintTable, Stepper, type BlueprintTableProps, type StepperProps } from './BlueprintTable'
export { PaperSkeleton, SKELETON_SCALE, type PaperSkeletonProps } from './PaperSkeleton'
export { SlotStrip, SourceChip, SOURCE_WORD, PAGE_SIZE, type SlotStripProps } from './SlotStrip'
export { PrintSheet, PRINT_KINDS, numbered, type PrintKind, type PrintSheetProps } from './PrintSheet'
export { PrintFrame, FRAME_CSS, type PrintHandle, type PrintFrameProps } from './PrintFrame'
export { NO_EXTRAS, type GeneratorExtras } from './extras'
export {
  HEADER, MAX_SECTIONS, marksOf, totalOf, minutesPerMark, validate, settle, toGen, paperStats, parseSeed, nextSeed, instruction, skeletonRows, printsAsCrop, isHollow,
  type GenBlueprint, type GenSection, type GeneratorPort, type Issue, type PaperSection, type PaperView, type PortBlueprint, type Slot, type SlotSource,
} from './model'
export { COPY, FOOTER, FORBIDDEN_WORDS } from './copy'
