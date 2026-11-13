// Package D05 (wave 6): the specimen composition, the strata, the data sigil and the rack row. Import this folder, not its files.
export { SpecimenLayout, CalloutPlate, type SpecimenLayoutProps, type CalloutPlateProps } from './SpecimenLayout'
export { StrataCore, type StrataCoreProps } from './StrataCore'
export { SigilMark, type SigilMarkProps } from './SigilMark'
export { RackRow, Rack, type RackRowProps, type RackProps } from './RackRow'
export type { StrataUnit } from './strata'
export type { SigilArm, Recent } from './markModel'
export type { RackState } from './rack'
export type { AnchorFrac } from './layout'
// the pure parts, for tests and for a caller that wants the numbers without the drawing
export { specimenGeometry, layoutProblems, leaderPath, leaderBend, defaultAnchors } from './layout'
export { sigilMarkSvg, sigilMarkModel } from './markModel'
export { strataLayout, slabThickness } from './strata'
export { effectiveRackState } from './rack'
