/**
 * The Studio frame (plan 3, 4): tab strip on top, the Today column on the left (always mounted), one
 * workspace in the centre, the Proof column on the right, overlays and the Back chip above. Only the
 * centre moves on a switch (`ww-centre` carries the one view-transition-name), so the left column,
 * the strip and the rail are never re-mounted: their DOM nodes are the same before and after.
 *
 * Mounted only behind the flag (flag.ts) and loaded lazily by MissionRoot, so with the flag off this
 * file, its CSS and the whole design layer are never downloaded.
 *
 * What it does NOT do, on purpose: it does not call lib/store.ts's setTab (that would run Shell's
 * 560 ms page transition on `.main` over our 600 ms switch, and the store is the app-wide overhaul's),
 * and it does not touch Shell's Ctrl+1..6, which still leaves Well Wisher. Alt+1..6 is ours.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Button, Segmented, PrimaryOwner } from '../kit'
import { motionLoad, setMotionLoad } from '../design/motion/governor'
import { useWorkspaceTransition } from '../design/motion/transition'
import '../useReducedMotion' // registers data-motion with lib/motion.tsx (useSpring, Ticker, switchView)
import '../design/base.css'
import './frame.css'
import { BackChip } from './BackChip'
import { densityOf, proofModeOf, useContainerWidth } from './density'
import { featureTokens, probeFeatures } from './features'
import { useFrame, restoredWs, type Scene } from './frameStore'
import { LeftStub } from './LeftStub'
import { goBack, registerNav, switchWorkspace } from './navigate'
import { openOverlay } from './overlayRegistry'
import { OverlayHost } from './OverlayHost'
import { ProofRail } from './ProofRail'
import { resolveSeason, seasonAnnouncement, SEASON_MODES, type SeasonMode, type ServerSeason } from './season'
import { applyTheme, readTheme } from './theme'
import { WorkspaceTabs } from './WorkspaceTabs'
import { workspaceMemory } from './workspaceMemory'
import { destinationOf, WORKSPACES, wsLabel, type WsId } from './workspaces'

export interface FrameProps {
  /** The Germoney stores are loaded; until then the centre shows a loading line. */
  loaded: boolean
  /** One component per workspace. MissionRoot wraps the current pages in their error boundaries. */
  pages: Record<WsId, ComponentType>
  /** The `season` dict of /api/mission/today (server-computed once, ww_season.py). */
  server?: ServerSeason | null
  /** The app-level tab at mount: a legacy id deep-links to its destination (workspaces.ts LEGACY). */
  legacyTab?: string
  /** The left column; chunk 6 passes the real one. Default: an honest stub. */
  left?: ReactNode
  /** Right end of the strip: the old Settings button until Setup replaces it. */
  extras?: ReactNode
  /** The glass tier of the page, for the motion governor. */
  glass?: 'refract' | 'blur' | 'flat'
}

const SEASON_LABEL: Record<SeasonMode, string> = { auto: 'Auto', exams: 'Exams', normal: 'Normal' }

/** The tab the frame last resolved, so a later remount with the same tab restores the scene instead of re-deep-linking. */
let consumedTab: string | null = null
export const resetConsumedTabForTests = () => void (consumedTab = null)

export function Frame({ loaded, pages, server, legacyTab, left, extras, glass = 'flat' }: FrameProps) {
  const root = useRef<HTMLDivElement>(null)
  const centre = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const panelId = useId()
  const { run } = useWorkspaceTransition()

  const ws = useFrame((s) => s.ws)
  const chosen = useFrame((s) => s.chosen)
  const seasonMode = useFrame((s) => s.seasonMode)
  const season = useMemo(() => resolveSeason(server, seasonMode), [server, seasonMode])
  const features = useMemo(probeFeatures, [])
  const [ready, setReady] = useState(false)

  const width = useContainerWidth(root)
  const density = densityOf(width)
  const proofMode = proofModeOf(width)

  // ---- html attributes: data-ww scopes the design layer's html-level rules; the theme is the saved one
  useLayoutEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-ww', '')
    applyTheme(readTheme())
    return () => {
      html.removeAttribute('data-ww')
      html.removeAttribute('data-theme')
      html.removeAttribute('data-motion-load')
    }
  }, [])

  // ---- the first workspace: a legacy deep link, else the last one this session, else the season's
  useLayoutEffect(() => {
    const st = useFrame.getState()
    const dest = legacyTab && legacyTab !== 'mission' && legacyTab !== consumedTab ? destinationOf(legacyTab, season.firstWorkspace) : null
    consumedTab = legacyTab ?? null
    if (dest) {
      st.select(dest.ws, dest.view ?? null)
      if (dest.panel === 'proof') st.setProof(true)
      if (dest.overlay) openOverlay(dest.overlay)
    } else if (!st.chosen) {
      const back = restoredWs()
      if (back) st.select(back)
    }
    setReady(true)
    // mount only: later tab changes remount the page (App keys it by tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- until something chooses, the workspace follows the season (Study in exams, Life otherwise)
  useEffect(() => {
    if (ready && !chosen) useFrame.getState().setDefault(season.firstWorkspace)
  }, [ready, chosen, season.firstWorkspace])

  // ---- the motion governor: flat glass, a hidden tab or the owner's saver means "low"
  useEffect(() => {
    const apply = () => setMotionLoad(motionLoad({ tier: glass, hidden: document.hidden }))
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [glass])

  // ---- navigation: capture the scroll, then change inside the `switch` transition
  const capture = useCallback((): Scene => {
    const s = useFrame.getState()
    const top = scroller.current?.scrollTop ?? workspaceMemory.scroll(s.ws)
    workspaceMemory.setScroll(s.ws, top)
    return { ws: s.ws, view: s.view, scroll: top }
  }, [])
  // Only the newest navigation may commit. A second switch within 600 ms skips the first view transition, but the
  // skipped transition's change still runs AFTER the newer one (shared/motion/transition.ts), so without this the
  // frame landed on the older place and the shell followed it with no key pressed (A.N02 c; reproduced in
  // __tests__/shell/frameBridge.test.tsx). Each request takes a number; a change whose number is old is dropped.
  const navSeq = useRef(0)
  useEffect(() => {
    registerNav({
      switchTo: async (to, view = null, opts) => {
        const seq = ++navSeq.current
        const s = useFrame.getState()
        if (to === s.ws) {
          if (view !== s.view) s.select(to, view)
          return
        }
        capture()
        await run(() => {
          if (seq === navSeq.current) useFrame.getState().select(to, view)
        }, centre.current)
        if (opts?.focusHeading && seq === navSeq.current) heading.current?.focus({ preventScroll: true })
      },
      jumpTo: async (to, view = null) => {
        const seq = ++navSeq.current
        const from = capture()
        await run(() => {
          if (seq === navSeq.current) useFrame.getState().jump(to, view, from)
        }, centre.current)
        heading.current?.focus({ preventScroll: true })
      },
      back: async () => {
        if (!useFrame.getState().back) return
        const seq = ++navSeq.current
        capture()
        await run(() => {
          if (seq === navSeq.current) void useFrame.getState().returnBack()
        }, centre.current)
        heading.current?.focus({ preventScroll: true })
      },
    })
    return () => registerNav(null)
  }, [capture, run])

  // ---- restore the scene's scroll for the workspace now showing (not animated)
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = workspaceMemory.scroll(ws)
  }, [ws, loaded, ready])

  // ---- keys: Alt+1..6, Alt+Left, Esc (after popover and overlay, which stop it first)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return
        const t = e.target as HTMLElement | null
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
        const s = useFrame.getState()
        if (s.focus) {
          s.setFocus(false)
          e.preventDefault()
        } else if (s.back) {
          e.preventDefault()
          void goBack()
        }
        return
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowLeft' && useFrame.getState().back) {
        e.preventDefault()
        void goBack()
        return
      }
      const m = /^(?:Digit|Numpad)?([1-6])$/.exec(e.code) ?? /^([1-6])$/.exec(e.key)
      if (m && !e.shiftKey) {
        e.preventDefault()
        void switchWorkspace(WORKSPACES[Number(m[1]) - 1].id, null, { focusHeading: true })
      }
    }
    // window, in the bubbling phase: an open overlay or popover handles Esc on `document` and stops it first
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- the season pill announces itself once per change, never on first paint
  const [live, setLive] = useState('')
  const lastSeason = useRef(season.season)
  useEffect(() => {
    if (lastSeason.current !== season.season) {
      lastSeason.current = season.season
      setLive(seasonAnnouncement(season))
    }
  }, [season])

  // ---- legacy pages bring their own h1; the frame's heading is the one h1, so theirs read as h2
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const demote = () =>
      el.querySelectorAll('h1:not([data-ww-h1])').forEach((h) => {
        h.setAttribute('role', 'heading')
        h.setAttribute('aria-level', '2')
      })
    demote()
    const mo = new MutationObserver(demote)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  const Page = pages[ws]
  const label = wsLabel(ws)
  const leftNode = left ?? <LeftStub season={season} />

  return (
    <PrimaryOwner>
      <div
        ref={root}
        className="ww ww-frame"
        data-section="wellwisher"
        data-density={density}
        data-proof={proofMode}
        data-season={season.season}
        data-feat={featureTokens(features)}
        data-chromium={features.chromium ?? undefined}
      >
        <header className="ww-strip">
          <span className="ww-brand">well_wisher</span>
          <WorkspaceTabs ws={ws} panelId={panelId} />
          <div className="ww-strip-right">
            <Segmented<SeasonMode>
              label="Season"
              variant="compact"
              value={seasonMode}
              onChange={(m) => useFrame.getState().setSeasonMode(m)}
              options={SEASON_MODES.map((id) => ({ id, label: SEASON_LABEL[id] }))}
            />
            <Button size="sm" onClick={() => openOverlay('roadmap')} data-open="roadmap">Roadmap</Button>
            {extras}
          </div>
        </header>
        <aside className="ww-left" aria-label="Today" data-left-top={season.left_top}>
          {leftNode}
        </aside>
        <main className="ww-centre" data-ws={ws} ref={centre}>
          <div id={panelId} role="tabpanel" aria-labelledby={`ww-tab-${ws}`} className="page mission ww-scroll" data-glass={glass} ref={scroller}>
            <h1 ref={heading} tabIndex={-1} className="ww-sr-only" data-ww-h1="">
              {label}
            </h1>
            {ready && loaded ? <Page /> : <div className="empty">Loading Well Wisher…</div>}
          </div>
        </main>
        <ProofRail mode={proofMode} />
        <BackChip />
        <OverlayHost />
        <p className="ww-sr-only" role="status" aria-live="polite" data-season-live="">
          {live}
        </p>
      </div>
    </PrimaryOwner>
  )
}
