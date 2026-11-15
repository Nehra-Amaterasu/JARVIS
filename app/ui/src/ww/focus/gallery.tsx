/**
 * The Y02 gallery states (gallery/entries/Y02.tsx loads this file lazily, only in a build that holds Well Wisher): Start, the
 * Crucible session, Rest and the Drill, every state on INVENTED rows (fixtures.ts). Every reading drawn from them is SIMULATED; the
 * clock is a still (a fixed elapsed minute count), and nothing here reads a route or a store.
 */
import type { ReactNode } from 'react'
import { CruciblePanel } from './CrucibleSession'
import { Drill } from './DrillScreen'
import { FocusRestPanel } from './FocusRest'
import { FocusStartPanel } from './FocusStart'
import { FIX_PICK, FIX_QUESTIONS, FIX_SET, fixturePort } from './fixtures'
import { initialState, reduce, type Act, type DrillState } from './model'
import { nullFocusPort } from './ports'
import type { LastBlock } from './store'
import './views/focus-views.css'

const noop = () => {}
const TRACKS = [
  { id: 'digital', label: 'Digital logic' },
  { id: 'math', label: 'Maths' },
  { id: 'academics', label: 'Academics' },
]
const FIX_AT = Date.UTC(2026, 10, 14, 14, 20)

const start = (over: Partial<Parameters<typeof FocusStartPanel>[0]> = {}) => (
  <FocusStartPanel tracks={TRACKS} trackId="digital" onTrack={noop} len={50} onLen={noop} cue="Redo the timing diagrams" onCue={noop} wager={false} onWager={noop}
    guards={false} onGuards={noop} pick={FIX_PICK} onDismissPick={noop} onPractise={noop} onStart={noop} eyesLine="eyes: not live (no hardware)" stamp="simulated" {...over} />
)

const crucible = (over: Partial<Parameters<typeof CruciblePanel>[0]> = {}) => (
  <CruciblePanel plannedMin={50} elapsedMin={32} paused={false} trackLabel="Digital logic" guards={false} wager={false} parked={[]} onPause={noop} onResume={noop}
    onEnd={noop} onFile={noop} {...over} />
)

const BLOCK: LastBlock = { at: FIX_AT, kind: 'done', line: 'Session complete: 50 min on Digital logic logged.', heldMin: 50, counted: 50, length: 50, trackLabel: 'Digital logic', parked: 1 }

const play = (acts: Act[]): DrillState => acts.reduce(reduce, initialState(FIX_QUESTIONS, 'practice set'))
const typed = (v: string): Act[] => [{ t: 'input', v }]
const drill = (s: DrillState, port = fixturePort()) => <Drill port={port} initial={s} elapsedMin={12} onGo={noop} />

const END_STATE = play([
  ...typed('1,92'), { t: 'check' }, { t: 'step', d: 1 },
  ...typed('300'), { t: 'hint' }, { t: 'check' }, { t: 'step', d: 1 },
  { t: 'check' }, { t: 'mark', ok: true }, { t: 'step', d: 1 },
  { t: 'skip' },
  { t: 'park', text: 'Ask about the clock tree', stored: false },
  { t: 'end' },
])

/** The labels of the states, in order; the entry and the test read the same list. */
export const Y02_LABELS = [
  'Start: track, length, cue, switches and Pick for me (SIMULATED)',
  'Start: no rotation yet (WAITING)',
  'Start: a block is already running',
  'Session: 32 of 50 minutes, dots standing',
  'Session: held, with the Park field open',
  'Rest: a block ended early, the filled dots stay',
  'Rest: a block complete, one break offered',
  'Drill: a numeric question, the unit chip and the Check key',
  'Drill: two hints open (logged, nothing lowered)',
  'Drill: a miss, "Not yet. Worked answer below"',
  'Drill: a recall card, the key shown, marked by you',
  'Drill: a written answer, rubric points ticked by you',
  'Drill: the set end, counts only',
  'Drill: nothing queued (null port: WAITING)',
] as const

const STATES: ReactNode[] = [
  start(),
  start({ tracks: [], trackId: null, pick: null, blocked: 'No rotation yet: add one in Setup > Rotation.' }),
  start({ running: { trackLabel: 'Digital logic' }, onOpenSession: noop }),
  crucible(),
  crucible({ paused: true, elapsedMin: 32, parked: [{ text: 'Ask about the clock tree', stored: false }], cue: 'Redo the timing diagrams', parkOpen: true }),
  <FocusRestPanel last={{ ...BLOCK, kind: 'ended', heldMin: 32.4, counted: 32, line: 'Session ended: you stopped it. 32 min counted.' }} onStart={noop} onToday={noop} simulated />,
  <FocusRestPanel last={BLOCK} onStart={noop} onToday={noop} simulated />,
  drill(play([])),
  drill(play([{ t: 'hint' }, { t: 'hint' }])),
  drill(play([...typed('300'), { t: 'check' }]), fixturePort()),
  drill(play([{ t: 'step', d: 2 }, { t: 'check' }])),
  drill(play([{ t: 'step', d: 3 }, { t: 'tick', idx: 0 }, { t: 'tick', idx: 2 }])),
  drill(END_STATE),
  <Drill port={nullFocusPort} elapsedMin={0} onGo={noop} />,
]

export function Y02State({ index }: { index: number }) {
  return <div className="y02-box">{STATES[index] ?? null}</div>
}

export { FIX_SET }
