// The kit of design language v3 (docs/design/design-language-v3.md 2, 6, 8.2). Not re-exported from shared/kit/index.ts on
// purpose: Key and Chip here are different pieces from the clay Key and the Well Wisher Chip, and the pieces draw only
// inside [data-look='v3'], so a screen opts in by importing this folder.
export { Ground, Glint, Plate, Group, StepLabel, Ruler, asciiRule } from './Plate'
export type { PlateProps, PlateTier, GroupProps, StepLabelProps, StepMark, RulerProps } from './Plate'
export { Key, LockedKey, PressKey, Counter } from './Keys'
export type { KeyProps, KeyPose, LockedKeyProps, CounterProps } from './Keys'
export { Chip, Ledger, NO_VALUE_DASH } from './Data'
export type { ChipProps, LedgerProps, LedgerRow } from './Data'
export { Dial, Gauge, arcPath, polar, fraction } from './Forms'
export type { DialProps, FormProps } from './Forms'
export { Sigil, Mark } from './Marks'
export type { SigilProps, MarkProps, MarkKind } from './Marks'
// Wall (the demo backdrop, colour literals) is a gallery fixture: import it from './Wall' directly, never through this barrel.
