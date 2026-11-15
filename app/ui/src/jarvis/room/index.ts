// Room (A.J02): the section's public pieces. The two views are the default exports of RoomSwitches.tsx and RoomRules.tsx, which
// shell/views/room-*.view.ts load lazily.
export { GuardKey, type GuardKeyProps, type GuardState } from './GuardKey'
export { DayRing24, type DayRing24Props } from './DayRing24'
export { BoardPlate, Faceplate, ModeDial, useSceneGuard } from './Faceplate'
export { GateCard, type GateCardProps } from './GateCard'
export { RoomSwitchesView, type RoomSwitchesViewProps } from './RoomSwitches'
export { RoomRulesView, type RoomRulesViewProps } from './RoomRules'
export { keySlots, rulesFrom, previewLine, type KeySlot, type Rule } from './model'
