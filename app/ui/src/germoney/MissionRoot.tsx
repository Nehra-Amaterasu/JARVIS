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
import { lazy, Suspense, useEffect } from 'react'
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
import { MissionNav, SCREEN_OF, useDrawer, type MissionScreen } from './ui'
import { wwFrameEnabled } from '../ww/frame/flag'
import type { ServerSeason } from '../ww/frame/season'
import { Calibration } from './pages/Calibration'
// Last, so the Well Wisher tokens and card system sit after every page's own sheet.
import './theme.css'

// The new Well Wisher frame (docs/design/well-wisher-ui.md chunk 4), behind the flag in ww/frame/flag.ts
// (`#ww=frame` in the URL fragment or localStorage `ww.workspace` = frame; default off). It is imported
// lazily so with the flag off none of its code or CSS is ever downloaded.
// Chunk 5 rides in the same lazy load: importing the Roadmap overlay registers it (ww/overlays/Roadmap.tsx).
const WwFrame = lazy(() => Promise.all([import('../ww/frame/Frame'), import('../ww/overlays/Roadmap')]).then(([m]) => ({ default: m.Frame })))
// Chunk 8: the Life workspace, loaded with the frame's other lazy parts; its own Suspense keeps the frame on screen while it loads.
const WwLife = lazy(() => import('../ww/life').then((m) => ({ default: m.LifeWorkspace })))
function WwLifeLazy() { return <Suspense fallback={<div className="empty">Loading Life…</div>}><WwLife /></Suspense> }
function SetupBridge() { return <Calibration onDone={() => {}} /> }
const inBoundary = (name: string, P: React.ComponentType) => () => <MissionBoundary name={name}><P /></MissionBoundary>
const FRAME_PAGES = {
  study: inBoundary('Study', StudyPage), tree: inBoundary('Tree', TreePage), life: inBoundary('Life', WwLifeLazy),
  career: inBoundary('Career', RoadPage), focus: inBoundary('Focus', FocusPage), setup: inBoundary('Setup', SetupBridge),
}

const PAGES: Record<MissionScreen, React.ComponentType> = {
  today: TodayPage, study: StudyPage, life: LifePage, tree: TreePage, focus: FocusPage, log: LogPage, road: RoadPage, status: StatusPage,
}
const NAMES: Record<MissionScreen, string> = { today: 'Today', study: 'Study', life: 'Life', tree: 'Tree', focus: 'Focus', log: 'Log', road: 'Career', status: 'Status' }

export function MissionRoot() {
  const tab = useStore((s) => s.tab)
  const stores = useMissionLoaded()
  const game = useGame((s) => s.loaded)
  useEffect(() => {
    void useGame.getState().hydrate().then(() => usePlan.getState().refresh())
  }, [])
  const glass = useGlassTier()            // the same per-machine frame-rate verdict as Aankhen
  const loaded = stores && game
  const season = usePlan((s) => (s.today as { season?: ServerSeason } | null)?.season ?? null)
  const toggleSettings = useDrawer((s) => s.toggle)
  if (wwFrameEnabled()) {
    return (
      <>
        <Suspense fallback={<div className="page"><div className="empty">Loading Well Wisher…</div></div>}>
          <WwFrame loaded={!!loaded} pages={FRAME_PAGES} server={season} legacyTab={tab} glass={glass}
            extras={<button type="button" className="ww-tap" onClick={() => toggleSettings()} aria-label="Well Wisher settings">Settings</button>} />
        </Suspense>
        <MissionBoundary name="Settings"><SettingsDrawer /></MissionBoundary>
        <MissionBoundary name="Reader"><ReaderDrawer /></MissionBoundary>
      </>
    )
  }
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
