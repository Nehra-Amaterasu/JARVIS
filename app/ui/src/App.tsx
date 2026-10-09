import { lazy, Suspense, useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { Dialogs, FxLayer } from './germoney/ui'
import { Dock, TitleBar, Ticker, Toasts, useHotkeys } from './components/Shell'
import { api } from './lib/api'
import { startEventStream, useStore } from './lib/store'
import { ConnectPage } from './pages/Connect'
import { CorePage } from './pages/Core'
import { LimbsPage } from './pages/Limbs'
import { SystemPage } from './pages/System'
import { YaadashPage } from './pages/Yaadash'

// The 3D twin pulls in three.js (~600 kB); load it only when Aankhen is opened, so
// the window paints in a fraction of the time.
const AankhenPage = lazy(() => import('./pages/Aankhen').then((m) => ({ default: m.AankhenPage })))
// Mission Germoney carries its whole syllabus (~150 kB of content): loaded on first visit.
const MissionRoot = lazy(() => import('./germoney/MissionRoot').then((m) => ({ default: m.MissionRoot })))

const PAGES: Record<string, React.ComponentType> = {
  core: CorePage, yaadash: YaadashPage, aankhen: AankhenPage,
  limbs: LimbsPage, connect: ConnectPage, system: SystemPage,
}

export default function App() {
  const tab = useStore((s) => s.tab)
  const refreshVitals = useStore((s) => s.refreshVitals)
  const [serverUp, setServerUp] = useState<boolean | null>(null)
  useHotkeys()

  useEffect(() => {
    const stream = startEventStream()
    void refreshVitals()
    const id = window.setInterval(() => void refreshVitals(), 2000)
    const ping = async () => {
      try {
        await api('/api/health')
        setServerUp(true)
      } catch {
        setServerUp(false)
      }
    }
    void ping()
    const pid = window.setInterval(ping, 5000)
    return () => {
      stream.close()
      window.clearInterval(id)
      window.clearInterval(pid)
    }
  }, [refreshVitals])

  const Page = PAGES[tab] ?? MissionRoot
  return (
    <div className="app grain">
      <TitleBar />
      <Dock />
      <main className="main">
        <Suspense fallback={<div className="page"><div className="empty">Loading…</div></div>}>
          <Page key={tab} />
        </Suspense>
      </main>
      <Ticker />
      <Toasts />
      <CommandPalette />
      <FxLayer />
      <Dialogs />
      {serverUp === false && (
        <div className="server-down">
          <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 34, marginBottom: 10 }}>Server offline</div>
            <p className="muted">The JARVIS server isn’t answering. Close this window and open JARVIS again.</p>
          </div>
        </div>
      )}
    </div>
  )
}
