/**
 * The Mission section: loads every Germoney store once, shows the sub-navigation,
 * and renders the current Mission tab. Mounted for any tab in the 'mission' group.
 */
import { useEffect } from 'react'
import { useStore } from '../lib/store'
import { useGame } from './game/store'
import { useMissionLoaded } from './hooks'
import { ArmoryPage } from './pages/Armory'
import { CampaignPage } from './pages/Campaign'
import { DrillPage } from './pages/Drill'
import { TrialsPage } from './pages/Trials'
import { CalibrationPage } from './pages/CalibrationPage'
import { CommandPage } from './pages/Command'
import { CruciblePage } from './pages/Crucible'
import { ForgePage } from './pages/Forge'
import { InterrogationPage } from './pages/Interrogation'
import { ProofPage } from './pages/Proof'
import { QuestsPage } from './pages/Quests'
import { SchedulePage } from './pages/Schedule'
import { SyllabusPage } from './pages/Syllabus'
import { TerminalPage } from './pages/Terminal'
import { MissionNav } from './ui'

const PAGES: Record<string, React.ComponentType> = {
  mission: CommandPage, quests: QuestsPage, campaign: CampaignPage, trials: TrialsPage, drill: DrillPage, armory: ArmoryPage, crucible: CruciblePage, forge: ForgePage, syllabus: SyllabusPage,
  terminal: TerminalPage, interrogation: InterrogationPage, proof: ProofPage, schedule: SchedulePage,
  calibration: CalibrationPage,
}

export function MissionRoot() {
  const tab = useStore((s) => s.tab)
  const stores = useMissionLoaded()
  const game = useGame((s) => s.loaded)
  useEffect(() => { void useGame.getState().hydrate() }, [])
  const loaded = stores && game
  const Page = PAGES[tab] ?? CommandPage
  return (
    <div className="page mission fade-in">
      <MissionNav />
      {loaded ? <Page /> : <div className="empty">Loading your mission…</div>}
    </div>
  )
}
