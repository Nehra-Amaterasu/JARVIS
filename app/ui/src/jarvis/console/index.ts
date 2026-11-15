// The Console section of shell v2 (A.J05, spec 20.9.5). Import this folder, not its files. The five registered views (the
// default exports of Health, Events, Connections, Hardware and Crew, wired to the live routes through useConsole) are
// loaded lazily by shell/views/console-*.view.ts; the *View components are the same surfaces driven by props, which the
// gallery and the jury page feed with stamped fixtures.
export { HealthView, type HealthViewProps } from './Health'
export { EventsView, type EventsViewProps } from './Events'
export { ConnectionsView, type ConnectionsViewProps, type ConnTab } from './Connections'
export { HardwareView, relayState, type HardwareViewProps, type HwTab } from './Hardware'
export { CrewView, agentReading, type CrewViewProps } from './Crew'
export { CommandDeck, OUT_KEEP, OUT_SHOWN } from './CommandDeck'
export { JobRow, JobBoard, LampLine, RoutePlates, ConsoleTabs, VramDial, ConsoleRow, ConsoleKey, GuardKey, AsciiRuler, PartHead, type JobRowProps, type RoutePlatesProps } from './parts'
export { askLine, readVerb, runHeavy, type CommandContext, type OutLine } from './commands'
export * from './model'
