/**
 * Shell v3, "the frosted deck" (design-language-v3.md 3 and 8.3). ShellV2.tsx renders this, and returns, when the look is
 * v3 (shell/look.ts); with the look off none of this code or its CSS is downloaded. It replaces the title bar, the rail and
 * the view strip with TWO pieces that are always visible: the spine on the left and the top plate above the canvas, and it
 * adds the dock below. Everything the canvas shows is unchanged: views still come from shell/views (collectViews) and mount in
 * the same Canvas the current shell uses, the store, the key table and the ids are the same, the root keeps data-shell="v2"
 * and data-product, the page wrapper keeps `s2-page` with data-section and data-view, the scroller keeps `s2-canvas`.
 *
 * The ground is a SIBLING behind the content, never its parent (spec 2.1): an opacity, filter, mask or transform on a
 * wrapper that held both would make a new backdrop root and the blur would see nothing. Only the ground blurs; the spine, the
 * top plate, the trays and the dock carry a tint.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Toasts } from '../../components/Shell'
import { useNow } from '../../lib/format'
import { useStore } from '../../lib/store'
import { loadJarvisRegistry, loadWwShell, type WwShellBridge } from '../../pageLoaders'
import { WhatIsComing } from '../../shared/overlays/WhatIsComing'
import { openPlanned, setPlannedOpener } from '../../shared/planned/open'
import type { Registry } from '../../shared/planned/types'
import { isAppPlace, type Place, type ProductId } from '../ids'
import { glassEnabled, setGlass } from '../look'
import { Palette } from '../Palette'
import { confirmRecord, readRecord } from '../record'
import { SkipLink } from '../SkipLink'
import { Slot } from '../slots'
import { currentPlace, touchRecord, useShell } from '../store'
import type { ShellV2Props } from '../ShellV2'
import { ChromeProvider, useChromeSpec, type MoreAction } from './contract'
import { Dock } from './Dock'
import { collectLamps } from './lamps'
import { Spine, TabBar } from './Spine'
import { hashOfPlace, placeOfHash, stepSection, stepViewOf, subProjectOfSection } from './subprojects'
import { TopPlate } from './TopPlate'
import '../../styles/design/clay/index.css'
import '../../shared/kit/clay.css'
import '../../shared/planned/planned.css'
import '../shell.css'
import './shell-v3-tokens.css'
import './shell-v3.css'

/** The pieces of the current frame that v3 reuses as they are. ShellV2.tsx passes them in, so nothing there is exported or edited. */
export interface ShellFrameParts {
  Canvas: ComponentType<{ place: Place; pages: ShellV2Props['pages']; wwRoot: ComponentType | null; ww: WwShellBridge | null; registries: Registry[] }>
  useShellKeys: () => void
  ShortcutsSheet: ComponentType<{ onClose: () => void }>
}

export type ShellV3Props = ShellV2Props & { frame: ShellFrameParts }

const THEME: Record<ProductId, string> = { jarvis: 'clay-dark', ww: 'clay-light' }

/** The spine's fold (168 px full, 64 px icon rail) is a per-person convenience: kept in localStorage, never needed to render. */
export const SPINE_KEY = 'app.spine'
function spineFolded(): boolean {
  try {
    return localStorage.getItem(SPINE_KEY) === 'rail'
  } catch {
    return false
  }
}

/** Alt with the arrows (3.5): Up and Down walk the ten sections in spine order, Left and Right the views of the section.
 *  It registers BEFORE the current key handler and claims these four combinations, so the Back binding on Alt+Left does not
 *  win under this look (the spec gives Alt+Left to the views). Every other key is left to keymap.ts. */
export function useV3Keys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const k = e.key
      if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight') return
      const s = useShell.getState()
      if (s.overlay) return
      const cur = currentPlace(s)
      if (isAppPlace(cur)) return
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        const next = stepSection(cur.section, k === 'ArrowDown' ? 1 : -1)
        if (!next) return
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        s.goSection(next)
        return
      }
      const view = stepViewOf(cur.section, cur.view, k === 'ArrowRight' ? 1 : -1)
      if (!view) return // a one-view section: Alt+Left stays the old Back
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      s.setView(view)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** `#section/view` onto the place store and back (3.4). The store stays the one place model. */
function useHashRoute(place: Place): void {
  useEffect(() => {
    const apply = () => {
      const p = placeOfHash(location.hash)
      if (p) useShell.getState().go(p)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])
  useEffect(() => {
    if (isAppPlace(place)) return
    const h = hashOfPlace(place)
    if (location.hash === h) return
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}${h}`)
    } catch {
      /* a sandboxed frame without history: the place still lives in the store */
    }
  }, [place.section, place.view]) // eslint-disable-line react-hooks/exhaustive-deps
}

export default function ShellV3(props: ShellV3Props) {
  return (
    <ChromeProvider>
      <Frame {...props} />
    </ChromeProvider>
  )
}

function Frame({ pages, wwRoot, verbs, serverUp, frame }: ShellV3Props) {
  const { Canvas, ShortcutsSheet } = frame
  const product = useShell((s) => s.product)
  const place = useShell(currentPlace)
  const overlay = useShell((s) => s.overlay)
  const roadmapFocus = useShell((s) => s.roadmapFocus)
  const closeOverlay = useShell((s) => s.closeOverlay)
  const goSection = useShell((s) => s.goSection)
  const setView = useShell((s) => s.setView)
  const readings = useStore((s) => s.readings)
  const chrome = useChromeSpec()
  const [registries, setRegistries] = useState<Registry[]>([])
  const [ww, setWw] = useState<WwShellBridge | null>(null)
  const [glass, setGlassOn] = useState(glassEnabled)
  const [deck, setDeck] = useState(false)
  const [folded, setFolded] = useState(spineFolded)
  const now = useNow(15_000)
  const open = subProjectOfSection(place.section)
  const ground = open?.ground ?? (product === 'ww' ? 'light' : 'dark')
  // the open project's hue: on the root so portals (popovers, sheets, the planned pose) read the same accent as the shell
  const hue = open?.id ?? (product === 'ww' ? 'wellwisher' : 'jarvis')

  // the root of the page carries the look and the glass choice (2.6: one attribute turns the whole look on and off)
  useLayoutEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-look', 'v3')
    html.setAttribute('data-glass', glass ? 'on' : 'off')
    if (window.pywebview) html.setAttribute('data-host', 'desktop')
    return () => {
      html.removeAttribute('data-look')
      html.removeAttribute('data-glass')
      html.removeAttribute('data-host')
    }
  }, [glass])

  useLayoutEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-hue', hue)
    return () => html.removeAttribute('data-hue')
  }, [hue])

  const onFold = useCallback((on: boolean) => {
    setFolded(on)
    try {
      localStorage.setItem(SPINE_KEY, on ? 'rail' : 'full')
    } catch {
      /* storage blocked: the fold still holds for this load */
    }
  }, [])

  // the clay theme and product belong to <html>, as in the current shell (same observer, same reason)
  useLayoutEffect(() => {
    const html = document.documentElement
    const apply = () => {
      if (html.getAttribute('data-theme') !== THEME[product]) html.setAttribute('data-theme', THEME[product])
      if (html.getAttribute('data-product') !== product) html.setAttribute('data-product', product)
    }
    apply()
    const mo = new MutationObserver(apply)
    mo.observe(html, { attributes: true, attributeFilter: ['data-theme', 'data-product'] })
    return () => {
      mo.disconnect()
      html.removeAttribute('data-theme')
      html.removeAttribute('data-product')
    }
  }, [product])

  useEffect(() => {
    let live = true
    void Promise.all([loadJarvisRegistry?.() ?? null, loadWwShell?.() ?? null]).then(([j, w]) => {
      if (!live) return
      setRegistries([j, w?.registry ?? null].filter((r): r is Registry => !!r))
      setWw(w)
    }).catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  useEffect(() => setPlannedOpener((id) => useShell.getState().openOverlay('roadmap', id)), [])

  useV3Keys() // before the current handler, so it claims Alt with the arrows first
  frame.useShellKeys()
  useHashRoute(place)

  // focus goes back to whatever opened an overlay
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    if (overlay && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null
    if (!overlay && wasOpen.current) {
      const back = opener.current
      opener.current = null
      if (back && document.contains(back)) back.focus()
    }
    wasOpen.current = !!overlay
  }, [overlay])

  // the open view stays confirmed, as in the current shell (the resume record keeps working for the palette and Alt+R)
  useEffect(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (isAppPlace(place)) return
    const r = readRecord(place.product)
    if (!r || r.section !== place.section || r.view !== place.view) touchRecord(place)
    else confirmRecord(place.product, place.section, place.view, now)
  }, [now, place.product, place.section, place.view]) // eslint-disable-line react-hooks/exhaustive-deps

  // the phone's project sheet closes when the place changes and on Escape
  useEffect(() => setDeck(false), [place.section, place.view])
  // the sheet is modal: focus moves to its first key on open, Tab wraps inside it, and closing returns focus to the Projects tab
  const deckWas = useRef(false)
  useEffect(() => {
    if (!deck) {
      if (deckWas.current) document.querySelector<HTMLElement>('.s3-tabbar .s3-tab')?.focus()
      deckWas.current = false
      return
    }
    deckWas.current = true
    const spine = document.getElementById('s3-spine')
    // the fold key is hidden on the phone, so it is not a stop of the sheet
    const keys = () => [...(spine?.querySelectorAll<HTMLElement>('button:not([disabled]):not(.s3-fold)') ?? [])]
    keys()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setDeck(false)
        return
      }
      if (e.key !== 'Tab') return
      const ks = keys()
      if (!ks.length) return
      const at = document.activeElement as HTMLElement | null
      const inside = !!at && !!spine?.contains(at)
      if (e.shiftKey && (!inside || at === ks[0])) {
        e.preventDefault()
        ks[ks.length - 1].focus()
      } else if (!e.shiftKey && (!inside || at === ks[ks.length - 1])) {
        e.preventDefault()
        ks[0].focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deck])

  const rows = useMemo(() => collectLamps(readings), [readings])
  const onGlass = useCallback((on: boolean) => {
    setGlass(on)
    setGlassOn(on)
  }, [])
  // one look (25 Nov): the older frame has no key here, so More holds only what the open view registers; the way back is the
  // fragment look=off, kept for tests and for the owner's own debugging
  const more = useMemo<MoreAction[]>(() => [...(chrome?.more ?? [])], [chrome?.more])
  const windowKeys = typeof window !== 'undefined' && !!window.pywebview
  return (
    <div className="s2 s3" data-shell="v2" data-product={product} data-project={hue} data-ground={ground} data-glass={glass ? 'on' : 'off'} data-deck={deck ? 'open' : 'closed'} data-spine={folded ? 'rail' : 'full'}>
      <div className="s3-ground" aria-hidden="true"
        style={glass ? { backdropFilter: 'var(--glass-filter, none)', WebkitBackdropFilter: 'var(--glass-filter, none)' } : undefined} />
      <SkipLink />
      <Slot name="boot" />
      <Spine place={place} rows={rows} now={now} onGoSection={goSection} onPlanned={openPlanned} folded={folded} onFold={onFold} onChoose={() => setDeck(false)} />
      <div className="s3-main">
        <TopPlate place={place} rows={rows} more={more} glass={glass} onGlass={onGlass} onGoSection={goSection} onSetView={setView}
          onShortcuts={() => useShell.getState().openOverlay('shortcuts')} windowKeys={windowKeys} />
        <div className="s3-stage">
          <Canvas place={place} pages={pages} wwRoot={wwRoot} ww={ww} registries={registries} />
        </div>
        <Dock spec={chrome?.dock ?? null} onAsk={() => useShell.getState().openOverlay('palette')} />
      </div>
      <TabBar place={place} deckOpen={deck} onDeck={setDeck} onGoSection={goSection} />
      <div className="s3-deckscrim" aria-hidden="true" onClick={() => setDeck(false)} />
      <Toasts />
      <Slot name="notify" />
      <Slot name="cursor-root" />
      {overlay === 'palette' && <Palette product={product} verbs={verbs} registries={registries} onClose={closeOverlay} />}
      {overlay === 'shortcuts' && <ShortcutsSheet onClose={closeOverlay} />}
      {overlay === 'roadmap' && (
        <div className="s2-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
          <WhatIsComing registries={registries} focusId={roadmapFocus ?? undefined} onClose={closeOverlay} />
        </div>
      )}
      {serverUp === false && (
        <div className="s2-scrim" role="alertdialog" aria-labelledby="s3-down-t">
          <div className="s2-sheet s2-down">
            <h2 id="s3-down-t">Server offline</h2>
            <p>The JARVIS server is not answering. Close this window and open JARVIS again.</p>
          </div>
        </div>
      )}
    </div>
  )
}
