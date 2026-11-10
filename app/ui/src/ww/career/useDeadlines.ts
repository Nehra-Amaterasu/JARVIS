import { useMemo } from 'react'
import { usePlan } from '../../germoney/game/plan'
import { useGame } from '../../germoney/game/store'
import { TRIALS } from '../../germoney/game/trials'
import { buildDeadlines, dueNowCount, type Due } from './model'

/** Every dated thing ahead, soonest first (model.buildDeadlines), read from the two stores. */
export function useDeadlines(): Due[] {
  const view = usePlan((s) => s.applications)
  const trials = useGame((s) => s.g.trials)
  const today = useGame((s) => s.today)
  return useMemo(() => buildDeadlines(view, TRIALS.map((t) => ({ id: t.id, name: t.name, date: trials[t.id]?.examDate })), today), [view, trials, today])
}

/**
 * The number for the Career tab badge (plan 4.7: "The tab badge is the due-now count"). The tab strip is
 * chunk 4's file, so this is exported from ww/career for it to call; until it does, the badge is not drawn
 * (reported in the build note).
 */
export function useDueNow(): number {
  return dueNowCount(useDeadlines())
}
