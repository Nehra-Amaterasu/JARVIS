// The Senses section of shell v2 (A.J03, spec 20.9.3). Import this folder, not its files. The registered views (live.tsx,
// wired to the shared store) are loaded lazily by shell/views/senses-*.view.ts; the three views are the same surfaces driven
// by props, which the gallery and the jury page feed with stamped fixtures.
export { PresenceView } from './PresenceView'
export { SignalView } from './SignalView'
export { TeachView } from './TeachView'
export { SignalTerrain, drawTerrain, type SignalTerrainProps } from './SignalTerrain'
export { LinkCube, ChannelMatrix, ProbabilityArc, Spectrum, MotionTrace, MotionDial, dialFrac, AsciiTrace, traceGeometry } from './forms'
export { MotionTape, type MotionTapeProps } from './MotionTape'
export { FloorPlan, type FloorPlanProps } from './FloorPlan'
export { TeachRingForm } from './TeachRings'
export { TeachDesk, LearnedPanel } from './TeachDesk'
export { SensesStore, sensesStore, useSenses, EMPTY_STATE, type SensesState } from './store'
export { effectiveSource, SensesFrame, SensesSelect, type SensesViewProps } from './parts'
export * from './model'
