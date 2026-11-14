// Package DB01: CountdownDots, NextThree and HandoffKey, each in its states. Words are neutral (Unit 3, physics): no real
// person, course or institution appears here.
import { CountdownDots } from '../../shared/data/countdown'
import { HandoffKey } from '../../shared/data/handoff'
import { NextThree } from '../../shared/data/nextthree'
import type { NextItem } from '../../shared/data/nextthree'
import type { GalleryEntryX } from '../types'

const merged = 'DB01, 14 Nov 2026'

const items: NextItem[] = [
  { id: 'a', title: 'Redo Unit 3, questions 4 to 9', reason: 'your lowest first-try share, 9 attempts', state: 'live', scores: { weak: 0.42, due: 1 } },
  { id: 'b', title: 'Read the Unit 5 notes', reason: 'a review is due and the unit has no practice yet', state: 'live', scores: { weak: 0, due: 1 } },
  { id: 'c', title: 'Plan the free slot on Thursday', reason: 'two hours open before the first paper', state: 'live', scores: { slot: 0.7 } },
]

const entries: GalleryEntryX[] = [
  {
    id: 'data/CountdownDots',
    title: 'CountdownDots',
    group: 'data',
    merged,
    note: 'One 8 px dot per day to a date, 60 at most. A dot fills as a day is lived and never refills. Nothing changes colour near the end and no bar runs toward zero. Without a date the row is dashed and says why.',
    states: [
      { label: 'LIVE, 30 days, 9 lived', node: <CountdownDots daysLeft={21} lived={9} to="the first paper" state="live" /> },
      { label: 'LIVE, 3 days left (same look as day 30)', node: <CountdownDots daysLeft={3} lived={27} to="the first paper" state="live" /> },
      { label: 'LIVE, 90 days: the last 60 are drawn', node: <CountdownDots daysLeft={90} lived={0} to="the end of term" state="live" /> },
      { label: 'LIVE, the day itself', node: <CountdownDots daysLeft={0} lived={20} to="the first paper" state="live" /> },
      { label: 'SIMULATED (stamped)', node: <CountdownDots daysLeft={14} lived={6} to="a sample date" state="simulated" /> },
      { label: 'WAITING (dashed row)', node: <CountdownDots daysLeft={0} to="the first paper" state="waiting" reason="no date on file" /> },
      { label: 'PLANNED', node: <CountdownDots daysLeft={0} to="the first paper" state="planned" reason="needs an exam window" /> },
      { label: 'FAULT', node: <CountdownDots daysLeft={0} to="the first paper" state="fault" reason="the calendar did not answer" /> },
    ],
  },
  {
    id: 'data/NextThree',
    title: 'NextThree',
    group: 'data',
    merged,
    note: 'Up to three actions, each with a reason line and its own lamp. It shows fewer and never pads. Tab to a row to see the arithmetic behind its rank, in mono. A row opens its target and runs nothing.',
    states: [
      { label: 'LIVE, three rows (press a row)', node: <NextThree items={items} state="live" onOpen={() => undefined} /> },
      { label: 'LIVE, two rows, not padded', node: <NextThree items={items.slice(0, 2)} state="live" onOpen={() => undefined} /> },
      { label: 'LIVE, a row that is itself SIMULATED', node: <NextThree items={[items[0], { ...items[1], state: 'simulated' }]} state="live" /> },
      { label: 'SIMULATED (stamped)', node: <NextThree items={items.slice(0, 2)} state="simulated" /> },
      { label: 'WAITING (hollow)', node: <NextThree items={[]} state="waiting" reason="needs papers on file" /> },
      { label: 'PLANNED', node: <NextThree items={[]} state="planned" reason="the generator is not built yet" /> },
      { label: 'FAULT', node: <NextThree items={[]} state="fault" reason="the question store did not answer" /> },
    ],
  },
  {
    id: 'data/HandoffKey',
    title: 'HandoffKey',
    group: 'data',
    merged,
    note: 'A 44 px mono key that opens a target and hands context over. It never executes anything. When the target is not there the key is dashed and inert and the reason sits beside it.',
    states: [
      { label: 'LIVE, with context', node: <HandoffKey label="Open Exam Season" target="study.plan" context={{ subject: 'physics' }} onOpen={() => undefined} /> },
      { label: 'LIVE, no context', node: <HandoffKey label="Ask JARVIS" target="deck" onOpen={() => undefined} /> },
      { label: 'PLANNED (inert)', node: <HandoffKey label="Open Exam Season" target="study.plan" state="planned" reason="needs an exam window" onOpen={() => undefined} /> },
      { label: 'FAULT (inert)', node: <HandoffKey label="Ask JARVIS" target="deck" state="fault" reason="the deck did not load" onOpen={() => undefined} /> },
    ],
  },
]

export default entries
