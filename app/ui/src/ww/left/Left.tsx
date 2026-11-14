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
import { useCallback, useEffect, useState } from 'react'
import { useShell } from '../../shell/store'
import { usePlan } from '../../germoney/game/plan'
import { useSeason } from './hooks'
import { L1Card } from './L1'
import { L2Card } from './L2'
import { L3Card } from './L3'
import { L4Card } from './L4'
import { L5Row } from './L5'
import { LeftRail } from './Rail'
import { useLeft } from './store'
import './left.css'

/** True when the frame is drawn inside shell v2: there the column is the one-instrument rail (D-V3-31). Read once at mount;
 *  the shell's DOM is committed before the lazy frame renders, and with the flag off nothing matches, so the classic cards
 *  below are drawn exactly as before. */
const inShell = (): boolean => typeof document !== 'undefined' && document.querySelector('[data-shell="v2"]') !== null

export function LeftColumn() {
  const [shell] = useState(inShell)
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
  const go = useCallback((section: string, view: string) => useShell.getState().go({ product: 'ww', section, view }), [])
  if (shell) return <LeftRail go={go} />
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
