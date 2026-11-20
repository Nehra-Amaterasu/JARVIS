// The store "Plan tomorrow" saves into (package L03). The Day port's `logs` member carries no text, so a plan row (a cue, a step, minutes)
// cannot travel through it; until the intent store has a route this null object answers WAITING with the reason and the view says that nothing
// was saved. An adapter that fills `save` replaces it without a change to the view.
import { waiting } from '../adapters/types'
import type { LogResult, PortReply } from '../ports'
import type { PlanRow } from './model'

export interface PlanStore {
  save(date: string, rows: readonly PlanRow[]): Promise<PortReply<LogResult>>
}

export const NULL_PLAN: PlanStore = {
  save: async () => waiting('the intent store is not connected yet, so nothing was saved'),
}

export const PLAN_STORE: PlanStore = NULL_PLAN
