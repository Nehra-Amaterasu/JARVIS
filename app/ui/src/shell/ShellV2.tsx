/**
 * Shell v2 (A.B05, spec 3.1 to 3.4 and 4.2): one title bar (48 px), one rail (64 px), one canvas (1302 x 720 at
 * 1366 x 768). Mounted only when the app.shell flag is on (shell/flag.ts); App.tsx loads this module lazily, so
 * with the flag off none of this code or its CSS (the clay tokens included) is downloaded and today's frame
 * renders unchanged.
 *
 * One navigation: the rail lists the five sections of the active product in the 3.1.2 order, and the Well
 * Wisher frame's own workspace strip is hidden under this root (CSS, so ww/frame is not edited). Everything
 * the canvas shows is an existing page, the event log, a planned plate, or a "not built" plate (hosts.ts).
 */
import { AudioLines, BookOpen, BrainCircuit, Briefcase, CalendarDays, Gauge, Hand, Maximize2, MessageCircle, Minus, ScanEye, Sprout, Timer, X } from 'lucide-react'
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Toasts } from '../components/Shell'
import { clock, useNow } from '../lib/format'
import { useStore } from '../lib/store'
import { loadJarvisRegistry, loadWwShell, type WwShellBridge } from '../pageLoaders'
import { Annunciators, JARVIS_ANNUNCIATORS, WW_ANNUNCIATORS } from '../shared/lamp'
import { Lamp } from '../shared/lamp/Lamp'
import type { LampReading } from '../shared/lamp/types'
import { WhatIsComing } from '../shared/overlays/WhatIsComing'
import { setPlannedOpener } from '../shared/planned/open'
import { PlannedPlate } from '../shared/planned/PlannedPlate'
import type { Registry } from '../shared/planned/types'
import { PRODUCT_LABEL, VIEW_LABEL, sectionById, sectionsOf, viewId, type Place, type ProductId } from './ids'
import { HOSTS, placeOfFrame, type Host } from './hosts'
import { BINDINGS, comboText, hintFor, isTextTarget, matchBinding, sectionForSlot, slotBindingOf } from './keymap'
import { Palette } from './Palette'
import { getPort, subscribePorts } from './ports'
import { clearRecord, pillState, readRecord, resumeTarget } from './record'
import { PRODUCTS, currentPlace, useShell } from './store'
import type { Verb } from './commands'
import '../styles/design/clay/index.css'
import '../shared/kit/clay.css'
import '../shared/planned/planned.css'
import './shell.css'

export interface ShellV2Props {
  /** Legacy JARVIS pages by tab id (App.tsx's PAGES). */
  pages: Readonly<Record<string, ComponentType>>
  /** The Well Wisher root (MissionRoot), or null in a JARVIS-only build. */
  wwRoot: ComponentType | null
  verbs: readonly Verb[]
  serverUp: boolean | null
}

const SECTION_ICON: Record<string, typeof AudioLines> = {
  core: AudioLines, room: Hand, senses: ScanEye, memory: BrainCircuit, console: Gauge,
  day: CalendarDays, focus: Timer, study: BookOpen, tree: Sprout, career: Briefcase,
}

const THEME: Record<ProductId, string> = { jarvis: 'clay-dark', ww: 'clay-light' }

/** Re-render when an installed port changes (the composition root installs them after first paint). */
function usePorts() {
  const [, bump] = useState(0)
  useEffect(() => subscribePorts(() => bump((n) => n + 1)), [])
  return { voice: getPort('voice'), memory: getPort('memory') }
}

export default function ShellV2({ pages, wwRoot, verbs, serverUp }: ShellV2Props) {
  const product = useShell((s) => s.product)
  const place = useShell(currentPlace)
  const overlay = useShell((s) => s.overlay)
  const roadmapFocus = useShell((s) => s.roadmapFocus)
  const closeOverlay = useShell((s) => s.closeOverlay)
  const [registries, setRegistries] = useState<Registry[]>([])
  const [ww, setWw] = useState<WwShellBridge | null>(null)

  // ---- the clay theme and product belong to <html> (the token files are :root-scoped). Only this root sets
  //      them, and it takes them away on unmount, so the flag-off frame never sees a clay attribute. The Well
  //      Wisher frame applies its own theme to <html> when it mounts; the shell owns the root here and puts its
  //      own back (one observer on one attribute of one element, no timer).
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

  // ---- the registries and the Well Wisher bridge arrive lazily, only for the products this build has
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

  // ---- the shell is the one host of "What is coming": every planned plate, chip and palette row opens it here
  useEffect(() => setPlannedOpener((id) => useShell.getState().openOverlay('roadmap', id)), [])

  useShellKeys()

  // ---- focus goes back to whatever opened an overlay (the overlay that replaced another keeps the first opener)
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

  const items = product === 'jarvis' ? JARVIS_ANNUNCIATORS : WW_ANNUNCIATORS

  return (
    <div className="s2" data-shell="v2" data-product={product}>
      <TitleBar product={product} items={items} />
      {/* below 900 px the pill is its own 44 px row under the title bar (4.2.3); one of the two is display:none */}
      <div className="s2-pillrow"><ResumePill product={product} /></div>
      <Rail product={product} place={place} />
      <Canvas place={place} pages={pages} wwRoot={wwRoot} ww={ww} registries={registries} />
      <Toasts />
      {overlay === 'palette' && <Palette product={product} verbs={verbs} registries={registries} onClose={closeOverlay} />}
      {overlay === 'shortcuts' && <ShortcutsSheet onClose={closeOverlay} />}
      {overlay === 'roadmap' && (
        <div className="s2-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
          <WhatIsComing registries={registries} focusId={roadmapFocus ?? undefined} onClose={closeOverlay} />
        </div>
      )}
      {serverUp === false && (
        <div className="s2-scrim" role="alertdialog" aria-labelledby="s2-down-t">
          <div className="s2-sheet s2-down">
            <h2 id="s2-down-t">Server offline</h2>
            <p>The JARVIS server is not answering. Close this window and open JARVIS again.</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ keys */
/** One window listener in the capture phase, so the Well Wisher frame's own Alt+1..6 never fires under this
 *  shell (it would switch to the old workspace order). Every key comes from keymap.ts. */
function useShellKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      const s = useShell.getState()
      // "What is coming" handles its own Esc, Alt+Left and Tab wrap; it is modal, so nothing else runs.
      if (s.overlay === 'roadmap') return
      if (e.key === 'Escape') {
        if (s.overlay) {
          e.preventDefault()
          e.stopPropagation()
          s.closeOverlay()
        }
        return
      }
      const b = matchBinding(e, isTextTarget(e.target))
      if (!b) return
      if (s.overlay && b.action.kind !== 'palette' && b.action.kind !== 'shortcuts') return
      e.preventDefault()
      e.stopPropagation()
      const a = b.action
      switch (a.kind) {
        case 'slot': {
          const id = sectionForSlot(s.product, a.n)
          if (id) s.goSection(id)
          break
        }
        case 'swap-product':
          s.swapProduct()
          break
        case 'resume':
          s.go(resumeTarget(s.product, readRecord(s.product)))
          break
        case 'view-step':
          s.stepView(a.delta)
          break
        case 'back':
          s.back()
          break
        case 'palette':
          if (s.overlay === 'palette') s.closeOverlay()
          else s.openOverlay('palette')
          break
        case 'shortcuts':
          if (s.overlay === 'shortcuts') s.closeOverlay()
          else s.openOverlay('shortcuts')
          break
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Roving tabindex over the [data-rove] buttons of a group: one tab stop, arrows move, Home and End jump. */
function rove(e: ReactKeyboardEvent<HTMLElement>, vertical: boolean) {
  const keys = vertical ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft']
  const other = vertical ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp']
  const k = e.key
  if (![...keys, ...other, 'Home', 'End'].includes(k)) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-rove]')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  e.preventDefault()
  const next = k === 'Home' ? 0 : k === 'End' ? items.length - 1 : k === keys[0] || k === other[0] ? (i + 1) % items.length : (i - 1 + items.length) % items.length
  items.forEach((el, j) => el.setAttribute('tabindex', j === next ? '0' : '-1'))
  items[next].focus()
}

/* ------------------------------------------------------------------ title bar */
declare global {
  interface Window {
    pywebview?: { api: { minimize: () => void; toggle_maximize: () => Promise<boolean>; close: () => void } }
  }
}

function TitleBar({ product, items }: { product: ProductId; items: typeof JARVIS_ANNUNCIATORS }) {
  const readings = useStore((s) => s.readings)
  const now = useNow(30_000)
  const inApp = typeof window !== 'undefined' && !!window.pywebview
  const faults = items.filter((it) => readings[it.id]?.state === 'fault')
  return (
    <header className="s2-title pywebview-drag-region" data-focus-inset="">
      <span className="s2-wordmark" aria-hidden="true">{PRODUCT_LABEL[product]}</span>
      {PRODUCTS.length > 1 && <ProductSwitch product={product} />}
      <ResumePill product={product} />
      <div className="s2-lamps">
        <Annunciators items={items} readings={readings} compact />
      </div>
      {faults.length > 0 && <FaultChip product={product} names={faults.map((f) => f.label)} />}
      <time className="s2-clock" dateTime={new Date(now).toISOString()}>{clock(now / 1000).slice(0, 5)}</time>
      {inApp && (
        <div className="s2-win">
          <button type="button" aria-label="Minimise" onClick={() => window.pywebview?.api.minimize()}><Minus size={14} aria-hidden="true" /></button>
          <button type="button" aria-label="Maximise" onClick={() => void window.pywebview?.api.toggle_maximize()}><Maximize2 size={12} aria-hidden="true" /></button>
          <button type="button" aria-label="Close" onClick={() => window.pywebview?.api.close()}><X size={14} aria-hidden="true" /></button>
        </div>
      )}
    </header>
  )
}

function ProductSwitch({ product }: { product: ProductId }) {
  const swap = useShell((s) => s.swapProduct)
  const hint = hintFor('product.swap')
  return (
    <div className="s2-product" role="radiogroup" aria-label={`Product${hint ? ` (${hint})` : ''}`} onKeyDown={(e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        swap()
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.s2-product [aria-checked="true"]')?.focus())
      }
    }}>
      {PRODUCTS.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={p === product} tabIndex={p === product ? 0 : -1} data-product-option={p}
          onClick={() => p !== product && swap()}>
          {PRODUCT_LABEL[p]}
        </button>
      ))}
    </div>
  )
}

function ResumePill({ product }: { product: ProductId }) {
  const place = useShell(currentPlace)
  const go = useShell((s) => s.go)
  const [dropped, setDropped] = useState(0)
  // The record changes on every navigation; reading it in render is a localStorage read per render of this
  // pill only, which re-renders on navigation, not on a timer.
  const record = useMemo(() => readRecord(product), [product, place.section, place.view, dropped]) // eslint-disable-line react-hooks/exhaustive-deps
  const state = pillState(product, record, Date.now())
  const here = !!record && record.section === place.section && record.view === place.view
  const hint = hintFor('resume')
  if (state.kind === 'stale') {
    return (
      <div className="s2-pill" data-pill="stale" role="group" aria-label="Resume">
        <span className="s2-pill-text">{state.text}</span>
        <button type="button" className="s2-pill-act" onClick={() => go(resumeTarget(product, record))}>Pick up</button>
        <button type="button" className="s2-pill-act" onClick={() => { clearRecord(product); setDropped((n) => n + 1) }}>Drop it</button>
      </div>
    )
  }
  return (
    <button type="button" className="s2-pill" data-pill={state.kind} aria-current={here ? 'location' : undefined}
      aria-label={`${here ? 'Here' : 'Resume'}: ${state.text}${hint ? `, ${hint}` : ''}`}
      onClick={() => go(resumeTarget(product, record))}>
      <span className="s2-pill-text">{state.text}</span>
      {hint && <kbd className="s2-kbd" aria-hidden="true">{hint}</kbd>}
    </button>
  )
}

function FaultChip({ product, names }: { product: ProductId; names: string[] }) {
  const go = useShell((s) => s.go)
  const text = `Fault: ${names.join(', ')}`
  // JARVIS faults open Console / Health. Well Wisher's target (settings.data) is not built in this package,
  // so its chip states the fault and does not pretend to take you anywhere.
  if (product === 'jarvis')
    return <button type="button" className="s2-fault" onClick={() => go({ product, section: 'console', view: 'health' })}>{text}</button>
  return <span className="s2-fault" role="status">{text}</span>
}

/* ------------------------------------------------------------------ rail */
function Rail({ product, place }: { product: ProductId; place: Place }) {
  const goSection = useShell((s) => s.goSection)
  const openOverlay = useShell((s) => s.openOverlay)
  const { voice } = usePorts()
  const level = useStore((s) => (voice.present ? s.micLevel : 0))
  const live = voice.level()
  const sections = sectionsOf(product)
  return (
    <nav className="s2-rail" aria-label={`${PRODUCT_LABEL[product]} sections`} data-focus-inset="">
      <ul className="s2-rail-list" onKeyDown={(e) => rove(e, !window.matchMedia?.('(max-width: 899px)').matches)}>
        {sections.map((s) => {
          const Icon = SECTION_ICON[s.id]
          const on = s.id === place.section
          const hint = hintFor(slotBindingOf(product, s.id) ?? '')
          return (
            <li key={s.id}>
              <button type="button" className="s2-slot" data-rove="" data-slot={s.id} tabIndex={on ? 0 : -1}
                aria-current={on ? 'page' : undefined} aria-keyshortcuts={hint?.replace(' ', '+')}
                title={hint ? `${s.label} (${hint})` : s.label} onClick={() => goSection(s.id)}>
                <Icon size={20} strokeWidth={on ? 2.4 : 1.6} aria-hidden="true" />
                <span className="s2-slot-label">{s.label}</span>
              </button>
            </li>
          )
        })}
        <li className="s2-rail-air" aria-hidden="true" />
        <li>
          <button type="button" className="s2-slot s2-ask" data-rove="" tabIndex={-1} data-ask=""
            aria-label={voice.present ? 'Ask' : `Ask (${voice.absentText})`} title={hintFor('palette') ? `Ask (${hintFor('palette')})` : 'Ask'}
            onClick={() => openOverlay('palette')}>
            {/* the ring shows the real input level only when one exists; otherwise it is still */}
            <span className="s2-orb" data-level={live === null ? 'none' : 'live'} style={live === null ? undefined : { ['--lvl' as string]: Math.min(1, level * 8).toFixed(2) }} aria-hidden="true">
              <MessageCircle size={18} strokeWidth={1.8} />
            </span>
            <span className="s2-slot-label">Ask</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}

/* ------------------------------------------------------------------ canvas */
function Canvas({ place, pages, wwRoot, ww, registries }: { place: Place; pages: ShellV2Props['pages']; wwRoot: ComponentType | null; ww: WwShellBridge | null; registries: Registry[] }) {
  const id = viewId(place.section, place.view)
  const host = HOSTS[id] ?? { kind: 'none' }
  const section = sectionById(place.section)!
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)

  // ---- the legacy page key: the old pages and MissionRoot still read lib/store's `tab`
  useEffect(() => {
    if (host.kind === 'page' && tab !== host.tab) setTab(host.tab as never)
    // a Well Wisher tab is set once, so moving between its sections switches the frame instead of remounting it
    if (host.kind === 'ww' && !WW_TABS.has(tab)) setTab(host.tab as never)
  }, [host, tab, setTab])

  // ---- shell -> frame: a rail click or a view switch moves the Well Wisher frame
  useEffect(() => {
    if (host.kind !== 'ww' || !ww) return
    const cur = ww.current()
    if (cur.ws !== host.ws || (host.view !== null && cur.view !== host.view)) void ww.switchTo(host.ws, host.view)
  }, [host, ww])

  // ---- frame -> shell: a jump inside Well Wisher (Tree's "Study this node") moves the rail with it
  useEffect(() => {
    if (!ww) return
    return ww.subscribe((ws, view) => {
      const s = useShell.getState()
      const cur = s.places[s.product]
      const h = HOSTS[viewId(cur.section, cur.view)]
      if (s.product !== 'ww' || (h?.kind === 'ww' && h.ws === ws && (h.view === view || view === null))) return
      const target = placeOfFrame(ws, view)
      if (!target) return
      const [sec, v] = target.split('.')
      s.go({ product: 'ww', section: sec, view: v })
    })
  }, [ww])

  return (
    <main className="s2-canvas" aria-label={`${section.label} / ${VIEW_LABEL[place.view] ?? place.view}`}>
      {section.views.length > 1 && <ViewSwitch place={place} shared={'shared' in host && !!host.shared} />}
      <div className="s2-page" id="s2-panel" role={section.views.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={section.views.length > 1 ? `s2-view-${place.view}` : undefined}
        data-product={place.product} data-section={place.section} data-view={place.view}>
        <HostView host={host} place={place} pages={pages} wwRoot={wwRoot} registries={registries} />
      </div>
    </main>
  )
}

const WW_TABS = new Set(['mission', 'quests', 'campaign', 'trials', 'drill', 'armory', 'crucible', 'forge', 'syllabus', 'terminal', 'interrogation', 'proof', 'schedule', 'calibration', 'status'])

function HostView({ host, place, pages, wwRoot: WwRoot, registries }: { host: Host; place: Place; pages: ShellV2Props['pages']; wwRoot: ComponentType | null; registries: Registry[] }) {
  const fallback = <div className="s2-loading" role="status">Loading…</div>
  if (host.kind === 'page') {
    const Page = pages[host.tab]
    if (!Page) return <NotBuilt place={place} />
    return <Suspense fallback={fallback}><Page key={host.tab} /></Suspense>
  }
  if (host.kind === 'ww') return WwRoot ? <Suspense fallback={fallback}><WwRoot /></Suspense> : <NotBuilt place={place} />
  if (host.kind === 'events') return <EventsView />
  if (host.kind === 'planned') {
    const entry = registries.map((r) => r.byId(host.entry)).find(Boolean)
    if (!entry) return registries.length ? <NotBuilt place={place} /> : fallback
    return (
      <div className="s2-plate-wrap">
        <PlannedPlate entry={entry} onOpen={(id) => useShell.getState().openOverlay('roadmap', id)} />
      </div>
    )
  }
  return <NotBuilt place={place} />
}

function NotBuilt({ place }: { place: Place }) {
  const open = useShell((s) => s.openOverlay)
  const title = `${sectionById(place.section)?.label ?? place.section} / ${VIEW_LABEL[place.view] ?? place.view}`
  return (
    <section className="s2-notbuilt" aria-labelledby="s2-nb-t" data-notbuilt={viewId(place.section, place.view)}>
      <Lamp reading={PLANNED_READING} size={16} subject={title} />
      <h2 id="s2-nb-t">{title} has no page yet</h2>
      <p>It arrives with its section package. Nothing is shown here until then, so nothing here is a reading.</p>
      <button type="button" className="s2-btn" onClick={() => open('roadmap')}>What is coming</button>
    </section>
  )
}

const PLANNED_READING: LampReading = { state: 'planned', since: null, reason: 'not built' }

function ViewSwitch({ place, shared }: { place: Place; shared: boolean }) {
  const setView = useShell((s) => s.setView)
  const section = sectionById(place.section)!
  const choose = useCallback((v: string) => setView(v), [setView])
  return (
    <div className="s2-views" data-focus-inset="">
      <div className="s2-viewlist" role="tablist" aria-label={`${section.label} views`} onKeyDown={(e) => {
        const i = section.views.indexOf(place.view)
        const k = e.key
        const n = section.views.length
        const next = k === 'ArrowRight' ? (i + 1) % n : k === 'ArrowLeft' ? (i - 1 + n) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1
        if (next < 0) return
        e.preventDefault()
        choose(section.views[next])
        requestAnimationFrame(() => document.getElementById(`s2-view-${section.views[next]}`)?.focus())
      }}>
        {section.views.map((v) => (
          <button key={v} id={`s2-view-${v}`} type="button" role="tab" className="s2-view" aria-selected={v === place.view}
            aria-controls="s2-panel" tabIndex={v === place.view ? 0 : -1} onClick={() => choose(v)}>
            {VIEW_LABEL[v] ?? v}
          </button>
        ))}
      </div>
      {shared && <p className="s2-interim">This view shows today&rsquo;s page for {section.label} until its own layout is built.</p>}
    </div>
  )
}

/** Console / Events: the lines the ticker showed, from the same store (newest first, 14 a page). */
function EventsView() {
  const events = useStore((s) => s.events)
  const online = useStore((s) => s.eventsOnline)
  const [page, setPage] = useState(0)
  const recent = useMemo(() => events.slice().reverse(), [events])
  const pages = Math.max(1, Math.ceil(recent.length / 14))
  const p = Math.min(page, pages - 1)
  const rows = recent.slice(p * 14, p * 14 + 14)
  return (
    <section className="s2-events" aria-labelledby="s2-ev-t">
      <div className="s2-events-head">
        <h2 id="s2-ev-t">Events</h2>
        <Lamp reading={online ? { state: 'live', since: null, reason: 'event stream open' } : { state: 'waiting', since: null, reason: 'event stream closed' }} size={16} subject="Event stream" />
      </div>
      {rows.length === 0 ? <p className="s2-muted">Nothing has happened yet.</p> : (
        <ol className="s2-events-list">
          {rows.map((e) => (
            <li key={e.id} data-kind={e.kind}>
              <b>{e.source.toUpperCase()}</b>
              <span>{e.text}</span>
              {e.sim && <em className="k-stamp">SIMULATED</em>}
              <time>{clock(e.ts)}</time>
            </li>
          ))}
        </ol>
      )}
      {pages > 1 && (
        <div className="s2-pager">
          <button type="button" className="s2-btn" disabled={p === 0} onClick={() => setPage(p - 1)}>Newer</button>
          <span className="s2-muted">Page {p + 1} of {pages}</span>
          <button type="button" className="s2-btn" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Older</button>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ shortcuts sheet */
function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])
  const groups = ['Go', 'Views', 'Shell'] as const
  return (
    <div className="s2-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="s2-sheet" role="dialog" aria-modal="true" aria-labelledby="s2-keys-t" data-overlay="shortcuts"
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            close.current?.focus()
          }
        }}>
        <div className="s2-sheet-head">
          <h2 id="s2-keys-t">Keyboard shortcuts</h2>
          <button ref={close} type="button" className="s2-btn" onClick={onClose}>Close</button>
        </div>
        {groups.map((g) => (
          <section key={g} aria-labelledby={`s2-keys-${g}`}>
            <h3 id={`s2-keys-${g}`}>{g}</h3>
            <dl className="s2-keys">
              {BINDINGS.filter((b) => b.group === g).map((b) => (
                <div key={b.id} data-binding={b.id}>
                  <dt>{b.combos.map((c) => <kbd key={comboText(c)} className="s2-kbd">{comboText(c)}</kbd>)}</dt>
                  <dd>{b.label}</dd>
                </div>
              ))}
              {g === 'Shell' && <div><dt><kbd className="s2-kbd">Esc</kbd></dt><dd>Close the open overlay</dd></div>}
            </dl>
          </section>
        ))}
      </div>
    </div>
  )
}
