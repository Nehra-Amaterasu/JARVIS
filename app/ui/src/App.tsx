import { lazy, Suspense, useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { Dialogs, FxLayer } from './germoney/ui'
import { GameFx } from './germoney/game/fx'
import { Dock, TitleBar, Ticker, Toasts, useHotkeys } from './components/Shell'
import { api } from './lib/api'
import { startMediaHost } from './lib/media'
import { startEventStream, useStore } from './lib/store'
import { CorePage } from './pages/Core'
import { PAGE_LOADERS, prefetchPages } from './pageLoaders'

// Core, the tab the window opens on, is the only page in the entry chunk; every other
// tab is its own chunk (pageLoaders.ts), so the window paints sooner.
const PAGES: Record<string, React.ComponentType> = {
  core: CorePage,
  ...Object.fromEntries(Object.entries(PAGE_LOADERS).filter(([k]) => k !== 'mission').map(([k, load]) => [k, lazy(load)])),
}
const MissionRoot = lazy(PAGE_LOADERS.mission)

export default function App() {
  const tab = useStore((s) => s.tab)
  const refreshVitals = useStore((s) => s.refreshVitals)
  const [serverUp, setServerUp] = useState<boolean | null>(null)
  useHotkeys()

  // The Mission game listens for JARVIS's voice actions and keeps his brief current
  // from any tab — loaded at idle so the first paint stays fast.
  useEffect(() => {
    const t = window.setTimeout(() => void import('./germoney/game/bridge').then((m) => m.startBridge()), 1500)
    return () => window.clearTimeout(t)
  }, [])

  // Songs from his music folder play in this window, whatever tab is open (lib/media.ts).
  useEffect(() => startMediaHost(), [])

  // After the first paint, the light tabs load in idle time so opening one is instant.
  useEffect(() => prefetchPages(), [])

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
      <GameFx />
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
