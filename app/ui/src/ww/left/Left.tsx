/**
 * The left column (plan 4.1): the same four cards on every page, in this order, plus the Phone pointer.
 * Frame mounts it once and never remounts it; this component subscribes to nothing but the season, so the
 * cards below it re-render only for their own data (each is memoised and selects its own slice).
 *
 *   L1 Countdown | Horizon     season
 *   L2 Now | Close the day     evening
 *   L3 Classes today
 *   L4 Counters
 *   L5 Phone pointer (a link row)
 *
 * The data are five reads that already exist (store.ts). They load on mount and again when the window
 * becomes visible after being hidden, so a class tapped on the phone shows here on return.
 */
import { useEffect } from 'react'
import { usePlan } from '../../germoney/game/plan'
import { useSeason } from './hooks'
import { L1Card } from './L1'
import { L2Card } from './L2'
import { L3Card } from './L3'
import { L4Card } from './L4'
import { L5Row } from './L5'
import { useLeft } from './store'
import './left.css'

export function LeftColumn() {
  const season = useSeason()
  useEffect(() => {
    void useLeft.getState().load()
    const again = () => {
      if (!document.hidden) void useLeft.getState().load()
    }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [])
  // Horizon shows the week's goal, which only the ladder route has; load it once when Horizon is on.
  const needLadder = season.left_top === 'horizon'
  useEffect(() => {
    if (needLadder && usePlan.getState().ladder === null) void usePlan.getState().loadLadder()
  }, [needLadder])
  return (
    <div className="ww-left-col" data-left="column" data-season={season.season}>
      <L1Card leftTop={season.left_top} />
      <L2Card nowCard={season.now_card} />
      <L3Card />
      <L4Card />
      <L5Row />
    </div>
  )
}
