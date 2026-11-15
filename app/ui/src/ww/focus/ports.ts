/**
 * The Focus port (package Y02): everything the Drill and the Start screen need from outside the screen, behind one type, so the
 * views never call a route. The null port answers honestly ("nothing queued", WAITING) until an adapter registers itself; the
 * legacy-bank adapter (adapters/legacyBank.register.ts) puts the game store's Leitner cards behind the same type, and the engine
 * lane's question store arrives the same way later. Route shapes are written once, in docs/design/well-wisher-engine-plan.md.
 */
import type { LampState } from '../../shared/kit'

export type QuestionKind = 'recall' | 'numeric' | 'written'

export interface DrillQuestion {
  id: string
  stem: string
  topic: string
  kind: QuestionKind
  /** What the key says, in words (the answer shown after a check). */
  key: string
  /** numeric: the key as a number, the unit it is asked in and the relative tolerance (default 1 percent). */
  keyNumber?: number
  unit?: string
  tolerance?: number
  /** The worked answer, one line per step. */
  working?: string[]
  /** Reworded hints, easiest first (at most two). The worked answer is always the last rung. */
  hints: string[]
  /** written: the key's rubric points; the student ticks the ones the answer made, and the total is the student's own count. */
  rubric?: string[]
}

export interface DrillSet {
  title: string
  /** SIMULATED for fixtures, LIVE when the questions come from the student's own bank, WAITING when there is none. */
  state: LampState
  reason?: string
  questions: DrillQuestion[]
}

export type AttemptResult = 'matched' | 'missed' | 'skipped'

export interface Attempt {
  questionId: string
  result: AttemptResult
  /** Hint rungs the student opened for this question (the worked answer is rung 3). A reveal is logged and lowers nothing. */
  hintsUsed: number
  /** The worked answer was opened before the result: the question goes to the shelf, whatever was typed. */
  shown: boolean
  markedBy: 'check' | 'you'
  marks?: { got: number; of: number }
  at: number
}

/** The top item of the Next three card with the three terms of its rule (printed, never hidden). */
export interface PickItem {
  id: string
  title: string
  reason: string
  terms: { name: string; value: number }[]
  state: LampState
}

export interface FocusPort {
  id: string
  loadSet(): Promise<DrillSet>
  /** Hands a result to the store behind the port; says on which day the question comes back, when the store schedules one. */
  record(a: Attempt): Promise<{ nextOn?: string } | void>
  /** Files an unsolicited thought to Parking and says whether it was kept beyond this page. */
  park(text: string): Promise<{ stored: boolean }>
  pick(): Promise<PickItem | null>
}

export const nullFocusPort: FocusPort = {
  id: 'null',
  loadSet: async () => ({ title: 'Nothing queued', state: 'waiting', reason: 'no question bank is connected yet', questions: [] }),
  record: async () => undefined,
  park: async () => ({ stored: false }),
  pick: async () => null,
}

const ports = new Map<string, FocusPort>()

/** An adapter file (adapters/*.register.ts) calls this once on import; the last one registered is the one in use. */
export function registerFocusPort(p: FocusPort): void {
  ports.delete(p.id)
  ports.set(p.id, p)
}

export function activeFocusPort(): FocusPort {
  let last: FocusPort = nullFocusPort
  for (const p of ports.values()) last = p
  return last
}

/** Tests only. */
export function clearFocusPorts(): void {
  ports.clear()
}
