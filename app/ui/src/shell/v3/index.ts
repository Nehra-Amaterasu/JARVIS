/**
 * What a section view imports from the v3 shell (README.md in this folder is the contract). The shell itself (ShellV3, Spine,
 * TopPlate, LampPill, Dock, ViewChip) is mounted by ShellV2.tsx and is not exported: a view never renders it.
 */
export { Zones, type ZonesProps } from './Zones'
export { Tray, Glint, Ruler, asciiRuler, type TrayProps } from './Tray'
export { PhonePeeks } from './Sheets'
export {
  ViewChrome,
  useViewChrome,
  ZONE_RATIOS,
  ratioOf,
  type DockMode,
  type DockSpec,
  type MoreAction,
  type StepNumber,
  type TraySpec,
  type ViewChromeSpec,
  type ZoneRatio,
  type ZoneRatioName,
} from './contract'
export { lookV3Enabled } from '../look'
