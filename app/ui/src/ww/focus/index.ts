// The Focus workspace (plan chunk 10). MissionRoot mounts WwFocusPage as the `focus` entry of the frame.
export { WwFocusPage } from './FocusWorkspace'
export { WwCrucible } from './Crucible'
export { WwDrill } from './Drill'
export * from './session'

// Y02, the shell v2 views (docs/design/jarvis-product-overhaul.md A.Y02). Drill, Crucible and the rest are the contract's names.
export { FocusStart, FocusStartPanel } from './FocusStart'
export { Crucible, CruciblePanel, stripFor } from './CrucibleSession'
export { FocusRest, FocusRestPanel } from './FocusRest'
export { Drill, useElapsedMin } from './DrillScreen'
export { ParkField } from './ParkField'
export { nullFocusPort, registerFocusPort, activeFocusPort, type FocusPort } from './ports'
export { TRACKS, collectTracks, type TrackRegistration } from './tracks'
