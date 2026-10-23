/**
 * The Mission section: loads every Germoney store once, shows the five-screen
 * navigation, and renders the current screen. Mounted for any tab in the
 * 'mission' group; old tab ids land on the screen that absorbed them (ui.tsx).
 *
 *   Today   contracts + the day's blocks + the Floor + latest findings
 *   Tree    the skill tree (a DAG), career overlay, node details
 *   Focus   the Crucible and Drill
 *   Log     one log form, the gym, "what got in the way", GitHub
 *   Road    campaigns, certificates, the parking lot, trials, the War Chest
 *   (Settings in a drawer)
 */
import { useEffect } from 'react'
import { useStore } from '../lib/store'
import { usePlan } from './game/plan'
import { useGame } from './game/store'
import { useMissionLoaded } from './hooks'
import { FocusPage } from './pages/Focus'
import { LogPage } from './pages/Log'
import { RoadPage } from './pages/Road'
import { SettingsDrawer } from './pages/Settings'
import { TodayPage } from './pages/Today'
import { TreePage } from './pages/Tree'
import { MissionNav, SCREEN_OF, type MissionScreen } from './ui'

const PAGES: Record<MissionScreen, React.ComponentType> = {
  today: TodayPage, tree: TreePage, focus: FocusPage, log: LogPage, road: RoadPage,
}

export function MissionRoot() {
  const tab = useStore((s) => s.tab)
  const stores = useMissionLoaded()
  const game = useGame((s) => s.loaded)
  useEffect(() => {
    void useGame.getState().hydrate().then(() => usePlan.getState().refresh())
  }, [])
  const loaded = stores && game
  const Page = PAGES[SCREEN_OF[tab] ?? 'today']
  return (
    <div className="page mission fade-in">
      <MissionNav />
      {loaded ? <Page /> : <div className="empty">Loading your mission…</div>}
      <SettingsDrawer />
    </div>
  )
}
