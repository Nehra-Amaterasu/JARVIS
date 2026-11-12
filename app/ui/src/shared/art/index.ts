// The shared art components (B03c, spec 7.4 components 22 to 31 and 7.5 components 32 to 38). Importing from this
// index rather than from a shared barrel keeps parallel merges clean (B03b owns shared/kit's index).
export { NodeRing, type NodeRingProps, type RingNode, type NodeStatus } from './NodeRing'
export { Orbit, type OrbitProps } from './Orbit'
export { RingBars, type RingBarsProps } from './RingBars'
export { Ridge, type RidgeProps } from './Ridge'
export { Callout, type CalloutProps, type CalloutPoint } from './Callout'
export { Spec, type SpecProps, type SpecRow } from './Spec'
export { DotTimer, type DotTimerProps } from './DotTimer'
export { DateWheel, type DateWheelProps, type WheelItem } from './DateWheel'
export { PillarsChart, type PillarsChartProps } from './PillarsChart'
export { WeekStrip, type WeekStripProps, type WeekDay } from './WeekStrip'
export { AsciiSweep, AsciiEmptyState, type AsciiSweepProps, type AsciiEmptyStateProps } from './ascii'
export { StippleRing, DotMatrixMeter, type StippleRingProps, type DotMatrixMeterProps } from './dots'
export { Dither, type DitherProps } from './Dither'
export { CellSkeleton, type CellSkeletonProps } from './CellSkeleton'
// Component 38, "PlannedPlate" in the work-package list. Named BlankingPlate here so it cannot be confused with
// shared/planned/PlannedPlate (B02's minimal pattern-C plate), which it extends.
export { BlankingPlate, type BlankingPlateProps } from './BlankingPlate'
export { ArtTable, Figure } from './frame'
export { StateMark, StateTag, ART_STATES, STATE_WORD, type ArtState } from './state'
export { useCalm, useRoving, useBoundedLoop } from './hooks'
