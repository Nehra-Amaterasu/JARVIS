/**
 * Weekly operations: every Monday JARVIS offers three; you commit to one and stake
 * Marks on it. Choosing raises ownership; the stake makes the week cost something.
 * Most goals are measured from the ledger (no typing); a few need proof.
 */
import type { NpcId, Track } from './characters'
import { rngFor } from './util'

export type Metric =
  | 'floor.secured' | 'floor.silicon' | 'floor.deutsch' | 'floor.body'
  | 'focus.silicon' | 'focus.any'
  | 'contracts.silicon' | 'contracts.deutsch' | 'contracts.capital' | 'contracts.paper'
  | 'drill.deutsch' | 'drill.vlsi' | 'drill.any'

export interface OperationDef {
  id: string
  npc: NpcId
  track: Track
  title: string
  brief: string
  goal: { metric: Metric; n: number; unit: string } | null
  reward: { xp: number; marks: number }
}

export const STAKE = 50

export const OPERATIONS: OperationDef[] = [
  { id: 'op-deep', npc: 'kruger', track: 'silicon', title: 'Operation Deep Silicon', brief: '6 hours of Silicon in the Crucible this week.', goal: { metric: 'focus.silicon', n: 360, unit: 'min' }, reward: { xp: 300, marks: 250 } },
  { id: 'op-killer', npc: 'kruger', track: 'silicon', title: 'Operation Contract Killer', brief: 'Finish 8 Silicon contracts this week.', goal: { metric: 'contracts.silicon', n: 8, unit: 'contracts' }, reward: { xp: 300, marks: 250 } },
  { id: 'op-ship', npc: 'kruger', track: 'silicon', title: 'Operation Ship It', brief: 'Push one complete step of this month\'s boss deliverable to GitHub. Proof: the commit link.', goal: null, reward: { xp: 350, marks: 300 } },
  { id: 'op-seven', npc: 'jarvis', track: 'body', title: 'Operation Seven Days', brief: 'Secure the floor every day this week (the rest day counts).', goal: { metric: 'floor.secured', n: 7, unit: 'days' }, reward: { xp: 350, marks: 300 } },
  { id: 'op-wort', npc: 'weiss', track: 'deutsch', title: 'Operation Wortschatz', brief: 'Review 150 German drill cards this week.', goal: { metric: 'drill.deutsch', n: 150, unit: 'cards' }, reward: { xp: 250, marks: 200 } },
  { id: 'op-funf', npc: 'weiss', track: 'deutsch', title: 'Operation Fünf', brief: 'Finish 5 German contracts this week.', goal: { metric: 'contracts.deutsch', n: 5, unit: 'contracts' }, reward: { xp: 250, marks: 200 } },
  { id: 'op-stimme', npc: 'weiss', track: 'deutsch', title: 'Operation Stimme', brief: 'Record three 60-second German speaking clips this week. Proof: the files or a note.', goal: null, reward: { xp: 250, marks: 200 } },
  { id: 'op-outreach', npc: 'rhea', track: 'capital', title: 'Operation Outreach', brief: 'Finish 3 Capital contracts this week (applications, referrals, CV).', goal: { metric: 'contracts.capital', n: 3, unit: 'contracts' }, reward: { xp: 250, marks: 250 } },
  { id: 'op-interview', npc: 'rhea', track: 'capital', title: 'Operation Interview', brief: 'Review 60 VLSI interview cards this week.', goal: { metric: 'drill.vlsi', n: 60, unit: 'cards' }, reward: { xp: 250, marks: 200 } },
  { id: 'op-paper', npc: 'chancellor', track: 'paper', title: 'Operation Paper Trail', brief: 'Finish 2 Paperwork contracts this week.', goal: { metric: 'contracts.paper', n: 2, unit: 'contracts' }, reward: { xp: 200, marks: 200 } },
  { id: 'op-iron', npc: 'brandt', track: 'body', title: 'Operation Iron', brief: 'Five training sessions this week.', goal: { metric: 'floor.body', n: 5, unit: 'sessions' }, reward: { xp: 200, marks: 200 } },
]

/** Three offers for a week: one Silicon, one Deutsch, one of the rest. Seeded by the week. */
export function weeklyOffers(weekKey: string): OperationDef[] {
  const rand = rngFor(`ops|${weekKey}`)
  const pickFrom = (pool: OperationDef[]) => pool[Math.floor(rand() * pool.length) % pool.length]
  return [
    pickFrom(OPERATIONS.filter((o) => o.track === 'silicon')),
    pickFrom(OPERATIONS.filter((o) => o.track === 'deutsch')),
    pickFrom(OPERATIONS.filter((o) => o.track !== 'silicon' && o.track !== 'deutsch')),
  ]
}

export const OPERATION_BY_ID: Record<string, OperationDef> = Object.fromEntries(OPERATIONS.map((o) => [o.id, o]))
