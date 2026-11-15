// The Memory section of shell v2 (A.J04, spec 20.9.4 and 20.16.3). Import this folder, not its files. The four registered views
// (the default exports of MemoryRecall, MemoryBeliefs, MemoryPeople and MemoryKeep, wired to the live ports) are loaded lazily by
// shell/views/memory-*.view.ts; the views with a `port` prop are the same surfaces on fixtures for the gallery and the jury page.
export { MemoryConstellation, type MemoryConstellationProps } from './Constellation'
export { StrataBands, type StrataBandsProps } from './Strata'
export { Trail } from './Trail'
export { Results } from './Results'
export { Detail, type DetailProps } from './Detail'
export { RecallView, NodeList, type RecallViewProps, type RecallTab } from './Recall'
export { BeliefsView, OriginChip, BOARD_SOCKETS, type BeliefsViewProps } from './Beliefs'
export { PeopleView, alphabetical, monthsAgo, RING_MAX, type PeopleViewProps } from './People'
export { KeepView, reviewLine, type KeepViewProps } from './Keep'
export { ReminderStrip, RemindersDrawer } from './Reminders'
export { MemoryFixture, type MemoryFixtureKind } from './MemoryFixture'
export { LIVE_RECALL, LIVE_BELIEFS, LIVE_PEOPLE, LIVE_REMINDERS, LIVE_SOURCES } from './port'
export * from './model'
