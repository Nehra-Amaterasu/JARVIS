// The Core section of shell v2 (A.J01, spec 20.9.1). Import this folder, not its files. The registered view (the
// default export of CoreTalk.tsx, wired to lib/store) is loaded lazily by shell/views/core.view.ts; CoreTalkView is
// the same surface driven by props, which the gallery and the jury page feed with stamped fixtures.
export { SigilRing, type SigilRingProps } from './SigilRing'
export { LiveSigil, sigilSnap, SIGIL_MIN_MS } from './LiveSigil'
export { PipelineRibbon, type PipelineRibbonProps, type PipelineStage } from './PipelineRibbon'
export { OrganStrip, type OrganStripProps } from './OrganStrip'
export { CoreDrawer, type CoreDrawerProps } from './CoreDrawer'
export { Anatomy, anatomyRows, ORGAN_STAGE, SPOKE_MAX } from './Anatomy'
export { Transcript, TurnRow, type TranscriptProps } from './Transcript'
export { CoreTalkView, CORE_ART_ID, PHONE_MAX, type CoreTalkViewProps } from './CoreTalk'
export { coreBus, createBusFeed, wanted, CORE_KINDS } from './busFeed'
export * from './model'
export { HandoffChip } from '../handoff'
