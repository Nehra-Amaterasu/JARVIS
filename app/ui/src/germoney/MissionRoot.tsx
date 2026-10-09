/**
 * The Mission section: loads every Germoney store once, shows the sub-navigation,
 * and renders the current Mission tab. Mounted for any tab in the 'mission' group.
 */
import { useStore } from '../lib/store'
import { useMissionLoaded } from './hooks'
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
  mission: CommandPage, quests: QuestsPage, crucible: CruciblePage, forge: ForgePage, syllabus: SyllabusPage,
  terminal: TerminalPage, interrogation: InterrogationPage, proof: ProofPage, schedule: SchedulePage,
  calibration: CalibrationPage,
}

export function MissionRoot() {
  const tab = useStore((s) => s.tab)
  const loaded = useMissionLoaded()
  const Page = PAGES[tab] ?? CommandPage
  return (
    <div className="page mission fade-in">
      <MissionNav />
      {loaded ? <Page /> : <div className="empty">Loading your mission…</div>}
    </div>
  )
}
