// First, before anything that imports lib/api.ts: that module wipes the URL fragment on load, and the shell flag
// reads `shell=v2` from it (shell/flag.ts).
import { shellV2Enabled } from './shell/flag'
import { lazy, Suspense, useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { Dock, TitleBar, Ticker, Toasts, useHotkeys } from './components/Shell'
import { api } from './lib/api'
import { startMediaHost } from './lib/media'
import { startEventStream, useStore } from './lib/store'
import { CorePage } from './pages/Core'
import { PAGE_LOADERS, prefetchPages } from './pageLoaders'
import type { Verb } from './shell/commands'

// Core, the tab the window opens on, is the only page in the entry chunk; every other
// tab is its own chunk (pageLoaders.ts), so the window paints sooner.
const PAGES: Record<string, React.ComponentType> = {
  ...(import.meta.env.VITE_PRODUCT !== 'ww' ? { core: CorePage } : {}),
  ...Object.fromEntries(Object.entries(PAGE_LOADERS).filter(([k]) => k !== 'mission').map(([k, load]) => [k, lazy(load)])),
}
const MissionRoot = import.meta.env.VITE_PRODUCT !== 'jarvis' ? lazy(PAGE_LOADERS.mission) : null
// Shell v2 (A.B05) behind the app.shell flag, default off. A lazy chunk: with the flag off none of its code or
// CSS (the clay tokens included) is fetched, and App renders exactly the frame below.
const ShellV2 = lazy(() => import('./shell/ShellV2'))

export default function App() {
  return shellV2Enabled() ? <AppV2 /> : <AppLegacy />
}

/** What runs under either frame: the event stream, vitals, the health ping, the media host, the Well Wisher bridge. */
function useAppServices(): boolean | null {
  const refreshVitals = useStore((s) => s.refreshVitals)
  const [serverUp, setServerUp] = useState<boolean | null>(null)

  // The Mission game listens for JARVIS's voice actions and keeps his brief current
  // from any tab — loaded at idle so the first paint stays fast.
  useEffect(() => {
    if (import.meta.env.VITE_PRODUCT === 'jarvis') return
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
  return serverUp
}

/** The ports and verbs, installed only under the new shell and only for the products this build has. */
function AppV2() {
  const serverUp = useAppServices()
  const [verbs, setVerbs] = useState<readonly Verb[]>([])
  useEffect(() => {
    let undo: Array<() => void> = []
    let live = true
    void import('./shell/ports').then(({ installPort }) => {
      if (!live) return
      undo.push(installPort('notify', { present: true, absentText: 'no notifications', notify: (text, tone) => useStore.getState().toast(text, tone) }))
    })
    if (import.meta.env.VITE_PRODUCT !== 'ww') {
      void import('./jarvis/shellPorts').then((m) => {
        if (!live) return
        undo.push(m.installJarvisPorts())
        setVerbs(m.JARVIS_VERBS)
      })
    }
    return () => {
      live = false
      undo.forEach((u) => u())
      undo = []
    }
  }, [])
  return (
    <Suspense fallback={null}>
      <ShellV2 pages={PAGES} wwRoot={MissionRoot} verbs={verbs} serverUp={serverUp} />
    </Suspense>
  )
}

function AppLegacy() {
  const tab = useStore((s) => s.tab)
  const serverUp = useAppServices()
  useHotkeys()

  // A one-product build has no page for the other product's tabs; they land on what it does have.
  const Page = PAGES[tab] ?? MissionRoot ?? PAGES.core
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
