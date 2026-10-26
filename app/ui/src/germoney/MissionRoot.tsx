/**
 * The Well Wisher section (was Mission Germoney): loads every Germoney store once,
 * shows the six-screen navigation, and renders the current screen. Mounted for any tab in the
 * 'mission' group; old tab ids land on the screen that absorbed them (ui.tsx).
 *
 *   Today   direction, today's 3, the day's blocks (contracts), building hours
 *   Study   internals, one node from resource to recall, the daily concept
 *   Life    the day in taps (counters, meals, media, reels), habits, quests
 *   Tree    the skill tree (a layered DAG you can pan, zoom and search), node details
 *   Focus   the Crucible and Drill
 *   Log     one log form, learning, the gym, "what got in the way", GitHub proof
 *   Road    plan, internships, certificates, Germany, money and rewards, the record
 *   Status  the System's window: stats from logged work, rank, optional quest lines
 *   (Settings in a drawer)
 *
 * Every screen sits in its own error boundary (Boundary.tsx), keyed by screen, so a
 * bug shows a readable card on that screen instead of blanking the app.
 */
import { useEffect } from 'react'
import { useGlassTier } from '../lib/liquidGlass'
import { useStore } from '../lib/store'
import { MissionBoundary } from './Boundary'
import { usePlan } from './game/plan'
import { useGame } from './game/store'
import { useMissionLoaded } from './hooks'
import { ReaderDrawer } from './Reader'
import { FocusPage } from './pages/Focus'
import { LifePage } from './pages/Life'
import { StudyPage } from './pages/Study'
import { LogPage } from './pages/Log'
import { RoadPage } from './pages/Road'
import { SettingsDrawer } from './pages/Settings'
import { StatusPage } from './pages/Status'
import { TodayPage } from './pages/Today'
import { TreePage } from './pages/Tree'
import { MissionNav, SCREEN_OF, type MissionScreen } from './ui'

const PAGES: Record<MissionScreen, React.ComponentType> = {
  today: TodayPage, study: StudyPage, life: LifePage, tree: TreePage, focus: FocusPage, log: LogPage, road: RoadPage, status: StatusPage,
}
const NAMES: Record<MissionScreen, string> = { today: 'Today', study: 'Study', life: 'Life', tree: 'Tree', focus: 'Focus', log: 'Log', road: 'Road', status: 'Status' }

export function MissionRoot() {
  const tab = useStore((s) => s.tab)
  const stores = useMissionLoaded()
  const game = useGame((s) => s.loaded)
  useEffect(() => {
    void useGame.getState().hydrate().then(() => usePlan.getState().refresh())
  }, [])
  const glass = useGlassTier()            // the same per-machine frame-rate verdict as Aankhen
  const loaded = stores && game
  const screen = SCREEN_OF[tab] ?? 'today'
  const Page = PAGES[screen]
  return (
    <div className="page mission fade-in" data-glass={glass}>
      <MissionNav />
      {loaded
        ? <MissionBoundary key={screen} name={NAMES[screen]}><Page /></MissionBoundary>
        : <div className="empty">Loading Well Wisher…</div>}
      <MissionBoundary name="Settings"><SettingsDrawer /></MissionBoundary>
      <MissionBoundary name="Reader"><ReaderDrawer /></MissionBoundary>
    </div>
  )
}
