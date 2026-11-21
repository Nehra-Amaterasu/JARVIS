// Memory / Recall (spec 20.9.4, A.J04): what JARVIS holds, recalled, fixed and deleted. One canvas, no document scroll at
// 1366 x 768: the content box is 1286 x 652.
//
//   search bar   1286 x 64   the recall field, its one accent key, the view switch (Constellation, Strata, Trail, Results)
//   stage         860 x 572  the picture, its toolbar and its foot line (counts, sample, letters)
//   detail        410 x 572  the selected item, the reminders strip, the `remember>` capture line
//
// Every number on screen is a count the store reported (Holdings = stats + the layout payload); the constellation is a pure
// function of that payload. A recall lights the nodes whose text is a returned fact and draws one dotted path through them
// in rank order (240 ms; still and numbered under reduced motion). The classic 3D galaxy is retired: this is its replacement.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyEvent } from 'react'
import { Drawer } from '../../shared/kit'
import { Zones, useViewChrome, type ViewChromeSpec } from '../../shell/v3'
import { Lamp, showsNumber, type LampReading } from '../../shared/lamp'
import { AsciiSweep } from '../../shared/art'
import { sparkline } from '../../shared/grammar'
import { MemoryConstellation } from './Constellation'
import { Detail, Echo, type EchoLine } from './Detail'
import { RemindersDrawer } from './Reminders'
import { Results } from './Results'
import { StrataBands } from './Strata'
import { Trail } from './Trail'
import { recallStore, useFixHistory, useLoad, useRecalls } from './hooks'
import {
  groupLetter, groupWord, layoutOf, litFromFacts, sampleLine, strataOf, type Layout, type Placed,
} from './model'
import type { RecallPort, RemindersPort } from './port'
import type { GalaxyPayload, SearchRes } from './types'
import './memory.css'
import './memory-v3.css'

export type RecallTab = 'const' | 'strata' | 'trail' | 'results'
const SUGGEST = ['what did I say about the trip', 'my notes folder', 'who I talked to last spring']

/** The text list that is the keyboard equivalent of the picture: every drawn node, or every cluster, as a button. */
export function NodeList({ layout, selected, onSelect, onZoom }: { layout: Layout; selected: string | null; onSelect: (id: string) => void; onZoom: (g: string) => void }) {
  if (layout.mode === 'clusters') {
    return (
      <ul className="jm-list" data-testid="node-list">
        {layout.clusters.map((c) => (
          <li key={c.group}><button type="button" className="jm-list-row" onClick={() => onZoom(c.group)}>
            <span className="jm-tag">[{groupLetter(c.group)}]</span><span className="jm-list-t">{groupWord(c.group)}</span><span className="jm-mono jm-dim">{c.count.toLocaleString('en-IN')} items</span>
          </button></li>
        ))}
      </ul>
    )
  }
  return (
    <ul className="jm-list" data-testid="node-list">
      {layout.placed.map((p) => (
        <li key={p.id}><button type="button" className="jm-list-row" aria-current={selected === p.id || undefined} onClick={() => onSelect(p.id)}>
          <span className="jm-tag">[{groupLetter(p.group)}]</span><span className="jm-list-t">{p.label}</span>
        </button></li>
      ))}
    </ul>
  )
}

export interface RecallViewProps {
  port: RecallPort
  reminders: RemindersPort
  /** A query to run on arrival (the palette's `search` verb leaves it in the store). */
  initialQuery?: string | null
  onQueryTaken?: () => void
  /** Tests and the gallery: open on this tab. */
  tab?: RecallTab
  /** The clock for the reminders strip, epoch seconds (a fixture passes a fixed one). */
  now?: number
  /** The v3 look: three trays on `<Zones>`, the recall and capture lines in the dock. Set once by the live wrapper. */
  v3?: boolean
}

/** The view switch: a radio group of raised clay keys. The selected one is a pressed slab, never the accent (the one accent of
 *  the screen is the Recall key). Arrow keys move and select; one tab stop. */
function ViewSwitch<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: ReactKeyEvent) => {
    const i = options.findIndex((o) => o.id === value)
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % options.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + options.length) % options.length : e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    onChange(options[to].id)
    refs.current[to]?.focus()
  }
  return (
    <div className="jm-seg" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o, i) => (
        <button key={o.id} ref={(el) => { refs.current[i] = el }} type="button" role="radio" aria-checked={value === o.id} tabIndex={value === o.id ? 0 : -1} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}

const sourceLine = (g: GalaxyPayload): string => Object.entries(g.sources).map(([k, v]) => `${groupLetter(k)} ${groupWord(k)} ${v}`).join(' · ')

export function RecallView({ port, reminders, initialQuery = null, onQueryTaken, tab: tab0 = 'const', now: nowS, v3 = false }: RecallViewProps) {
  const sL = useLoad(port.stats)
  const gL = useLoad(port.galaxy, null, (g) => (g.stale ? 4000 : null))
  const tL = useLoad(port.taste)
  const rL = useLoad(reminders.view)
  const { v: stats } = sL
  const { v: galaxy } = gL
  const { v: taste } = tL
  const { v: rem } = rL
  const fixes = useFixHistory()
  const recalls = useRecalls()
  const [tab, setTab] = useState<RecallTab>(tab0)
  const [zoom, setZoom] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<SearchRes | null>(null)
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [litKey, setLitKey] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [list, setList] = useState(false)
  const [remDrawer, setRemDrawer] = useState(false)
  const [echo, setEcho] = useState<EchoLine[]>([])
  const [ask, setAsk] = useState<{ id: string; k: number } | null>(null)
  const nextEcho = useRef(1)
  const pendingFlash = useRef<string | null>(null)

  const layout = useMemo<Layout | null>(() => (galaxy.data ? layoutOf(galaxy.data, { zoom }) : null), [galaxy.data, zoom])
  const strata = useMemo(() => strataOf(galaxy.data?.nodes ?? []), [galaxy.data])
  // the nodes a recall lit are a function of what it returned and of the drawn layout (a zoom changes them, nothing is stored)
  const lit = useMemo(() => (layout && res ? litFromFacts(layout.placed, res.facts) : []), [layout, res])
  const selNode: Placed | null = useMemo(() => layout?.placed.find((p) => p.id === selected) ?? null, [layout, selected])

  const addEcho = useCallback((state: EchoLine['state'], text: string) => setEcho((cur) => [...cur, { id: nextEcho.current++, state, text }].slice(-6)), [])

  // a node just written lights once: find the new node whose text starts with what was typed
  useEffect(() => {
    const want = pendingFlash.current
    if (!want || !layout) return
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 30)
    const hit = layout.placed.find((p) => norm(p.label).startsWith(norm(want)))
    if (hit) {
      pendingFlash.current = null
      setFlash(hit.id)
      const t = setTimeout(() => setFlash(null), 400)
      return () => clearTimeout(t)
    }
  }, [layout])

  const run = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    setQ(t)
    setSearching(true)
    setErr(null)
    try {
      const r = await port.search(t)
      setRes(r)
      recallStore.push(t, r.facts.length + r.excerpts.length)
      setLitKey((k) => k + 1)
    } catch (e) {
      setErr((e as Error).message || 'the route did not answer')
      setRes(null)
    } finally {
      setSearching(false)
    }
  }, [port])

  const took = useRef(false)
  useEffect(() => {
    if (initialQuery && !took.current && galaxy.state !== 'loading') { took.current = true; void run(initialQuery); onQueryTaken?.() }
  }, [initialQuery, run, onQueryTaken, galaxy.state])

  const submit = (e: FormEvent) => { e.preventDefault(); void run(q) }
  const remember = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    try {
      const r = await port.capture(t)
      addEcho(port.simulated ? 'simulated' : 'live', r.added ? 'stored, source: typed' : 'already stored, nothing added')
      if (r.added) pendingFlash.current = t
      gL.reload()
      sL.reload()
    } catch (e) {
      addEcho('fault', `not stored: ${(e as Error).message}`)
    }
  }, [port, addEcho, gL, sL])

  const written = useCallback(() => { gL.reload(); sL.reload() }, [gL, sL])
  const removed = useCallback((ids: string[]) => { void ids; setSelected(null); written() }, [written])
  const onDelete = useCallback((id: string) => {
    setSelected(id)
    if (!port.remove) { addEcho('waiting', 'delete is PLANNED: the store has no route that deletes one item, nothing was sent'); return }
    setAsk((cur) => ({ id, k: (cur?.k ?? 0) + 1 }))
  }, [port, addEcho])
  const zoomTo = useCallback((g: string) => { setZoom(g); setSelected(null); setList(false) }, [])
  const open = useCallback((id: string) => { setSelected(id); setList(false) }, [])

  const gReading: LampReading = galaxy.state === 'ready'
    ? { state: port.simulated ? 'simulated' : 'live', since: null, reason: port.simulated ? 'fixture, not the store' : galaxy.data.stale ? 'laid out from the last state, rebuilding' : 'laid out from the store' }
    : galaxy.state === 'fault' ? { state: 'fault', since: null, reason: galaxy.error } : { state: 'waiting', since: null, reason: 'laying out the store' }
  const g = galaxy.data
  const sample = g ? sampleLine(g) : null
  const [clock] = useState(() => Math.floor(Date.now() / 1000))
  const nowSec = nowS ?? clock
  const hollow = galaxy.state !== 'ready' || (g?.nodes.length ?? 0) === 0
  const hollowReason = galaxy.state === 'fault' ? `the layout did not load: ${galaxy.error}` : galaxy.state === 'loading' ? 'laying out the store' : 'nothing is stored yet, so there is nothing to draw'
  const options = useMemo(() => [
    { id: 'const' as const, label: 'Constellation' }, { id: 'strata' as const, label: 'Strata' }, { id: 'trail' as const, label: 'Trail' },
    { id: 'results' as const, label: res ? `Results ${res.facts.length + res.excerpts.length}` : 'Results' },
  ], [res])

  const eff: RecallTab = v3 && tab === 'results' ? 'const' : tab
  const handlers = useRef({ run, remember })
  handlers.current = { run, remember }
  const chrome = useMemo<ViewChromeSpec | null>(() => (v3 ? {
    dock: {
      modes: [
        { id: 'recall', label: 'Search', prefix: 'recall>', example: 'a moment, a person, a fact', action: 'Recall' },
        { id: 'remember', label: 'Remember', prefix: 'remember>', example: 'a fact JARVIS should keep', action: 'Keep' },
      ],
      onSubmit: (mode, text) => (mode === 'remember' ? handlers.current.remember(text) : handlers.current.run(text)),
    },
    more: [
      { id: 'text-list', label: 'Everything on the map, as text', onSelect: () => setList(true) },
      { id: 'reminders', label: 'All reminders', onSelect: () => setRemDrawer(true) },
    ],
  } : null), [v3])
  useViewChrome(chrome)

  const canvasEl = (
    <div className="jm-canvas" data-tab={eff}>
      {eff === 'const' && (
        <>
          <MemoryConstellation
            layout={layout ?? EMPTY_LAYOUT} selected={selected} onSelect={open} onDelete={onDelete} onZoom={zoomTo} onZoomOut={() => setZoom(null)}
            lit={lit} litKey={litKey} flash={flash} hollow={hollow} hollowReason={hollowReason} simulated={port.simulated} art={galaxy.state === 'ready'}
          />
          {(galaxy.state === 'loading' || searching) && <div className="jm-sweep"><AsciiSweep verb={searching ? 'reading memory' : 'laying out the store'} rows={3} cols={14} /></div>}
          {/* the phone has no room for a picture: the list is the form there (spec 20.9.4, Mobile) */}
          {layout && <div className="jm-phone-list"><NodeList layout={layout} selected={selected} onSelect={open} onZoom={zoomTo} /></div>}
        </>
      )}
      {eff === 'strata' && <StrataBands strata={strata} nodes={g?.nodes ?? []} recalls={recalls.length} emptyReason={galaxy.state === 'fault' ? hollowReason : undefined} />}
      {eff === 'trail' && <Trail recalls={recalls} />}
      {eff === 'results' && <Results res={res} searching={searching} error={err} suggest={SUGGEST} onSuggest={(t) => void run(t)} />}
    </div>
  )
  const footEl = (
    <footer className="jm-foot-line" data-testid="stage-foot">
      {galaxy.state === 'ready' && showsNumber(gReading.state) && g ? (
        <>
          <span className="jm-mono" data-testid="count-line">
            {layout?.mode === 'clusters' ? `${layout.clusters.length} sources, ${layout.total.toLocaleString('en-IN')} items` : `${layout?.drawn ?? 0} drawn${layout && layout.hidden ? `, ${layout.hidden} older not drawn` : ''} of ${layout?.zoom ? layout.groups.find((x) => x.group === layout.zoom)?.count ?? 0 : layout?.total ?? 0} laid out`}
          </span>
          <span className="jm-dim">{sample ?? `all ${g.counts.memories.toLocaleString('en-IN')} memories`} · centre is newest · size is weight · lines are links</span>
          <span className="jm-dim jm-legend">{sourceLine(g)}</span>
          {recalls.length > 1 && <span className="jm-dim jm-trace" aria-label={`Items returned by the last ${recalls.length} recalls`}>recalls <span aria-hidden="true">{sparkline(recalls.map((r) => r.hits))}</span></span>}
        </>
      ) : <span className="jm-dim">{gReading.reason}. No count is drawn without a reading.</span>}
    </footer>
  )
  const drawers = (
    <>
      <Drawer open={list} onClose={() => setList(false)} title="Everything on the map, as text">
        <div className="jm-drawer">{layout ? <NodeList layout={layout} selected={selected} onSelect={open} onZoom={zoomTo} /> : <p className="jm-muted">The map has not loaded.</p>}</div>
      </Drawer>
      <RemindersDrawer open={remDrawer} onClose={() => setRemDrawer(false)} port={reminders} view={rem} now={nowSec} reload={rL.reload} />
    </>
  )

  if (v3) {
    const returned = res ? res.facts.length + res.excerpts.length : 0
    const simState = port.simulated ? 'simulated' : 'live'
    const detail = { port, selected: selNode, ask, stats, galaxy, taste, fixes, reminders: { view: rem, now: nowSec, onAll: () => setRemDrawer(true), simulated: reminders.simulated }, onSelect: open, onWritten: written, onRemoved: removed, onRemember: remember, onEcho: addEcho }
    return (
      <div className="jm jm3" data-view="recall" data-simulated={port.simulated ? 'true' : undefined}>
        <Zones
          first={{
            job: 'ASK',
            children: (
              <div className="jm3-stage" aria-label="Memory">
                <div className="jm3-bar">
                  <ViewSwitch options={options.filter((o) => o.id !== 'results')} value={eff} onChange={setTab} label="Memory view" />
                  <Lamp reading={gReading} subject="Map" />
                  {zoom ? <button type="button" className="jm-key jm-key-sm" onClick={() => setZoom(null)} data-testid="zoom-out">All sources<span aria-hidden="true"> ›</span> {groupWord(zoom)}</button> : <span className="jm-crumb">All sources</span>}
                </div>
                {canvasEl}
                {footEl}
                {eff === 'const' && !hollow && layout && <p className="jm-keys jm-dim" aria-hidden="true">Tab enters the map · arrows step · Enter opens · Delete asks · + − zoom · 1 2 3 rings</p>}
              </div>
            ),
          }}
          second={{
            job: 'FOUND',
            peek: { name: 'Found', lamp: res ? simState : 'waiting', note: res ? `${returned} returned` : 'nothing asked yet' },
            children: (
              <div className="jm3-scroll" data-testid="found">
                {selNode && <Detail {...detail} part="found" />}
                <Results res={res} searching={searching} error={err} suggest={SUGGEST} onSuggest={(t) => void run(t)} where="in the line at the foot" />
                {echo.length > 0 && <Echo lines={echo} />}
              </div>
            ),
          }}
          third={{
            job: 'HOLDS',
            peek: { name: 'Holds', lamp: stats.state === 'ready' ? simState : stats.state === 'fault' ? 'fault' : 'waiting', note: stats.state === 'ready' ? undefined : 'counting' },
            children: <div className="jm3-scroll"><Detail {...detail} part="holds" /></div>,
          }}
        />
        {drawers}
      </div>
    )
  }

  return (
    <div className="jm" data-view="recall" data-simulated={port.simulated ? 'true' : undefined}>
      <form className="jm-search" onSubmit={submit} role="search" aria-label="Recall">
        <label className="jm-ps" htmlFor="jm-q">recall&gt;</label>
        <input id="jm-q" className="jm-q-field" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Ask your memory: a moment, a person, a fact" />
        <button type="submit" className="jm-key jm-key-primary" aria-disabled={searching || !q.trim() || undefined} data-testid="recall-key">{searching ? 'Recalling' : 'Recall'}</button>
        <div className="jm-switch">
          <ViewSwitch options={options} value={tab} onChange={setTab} label="Memory view" />
        </div>
        <span className="jm-embed" title="Search by meaning, not just words, is not built; search by words works now."><span className="jm-embed-dash" aria-hidden="true" /><span>Meaning search</span><b>PLANNED</b></span>
      </form>

      <section className="jm-stage" aria-label="Memory" data-scene="immersive">
        <header className="jm-toolbar">
          <Lamp reading={gReading} subject="Map" />
          {zoom ? (
            <button type="button" className="jm-key jm-key-sm" onClick={() => setZoom(null)} data-testid="zoom-out">All sources<span aria-hidden="true"> ›</span> {groupWord(zoom)}</button>
          ) : <span className="jm-crumb">All sources</span>}
          <span className="jm-sp" />
          <button type="button" className="jm-key jm-key-sm" onClick={() => setList(true)} aria-disabled={!layout || undefined} data-testid="list-key">Text list</button>
        </header>
        <div className="jm-canvas" data-tab={tab}>
          {tab === 'const' && (
            <>
              <MemoryConstellation
                layout={layout ?? EMPTY_LAYOUT} selected={selected} onSelect={open} onDelete={onDelete} onZoom={zoomTo} onZoomOut={() => setZoom(null)}
                lit={lit} litKey={litKey} flash={flash} hollow={hollow} hollowReason={hollowReason} simulated={port.simulated} art={galaxy.state === 'ready'}
              />
              {(galaxy.state === 'loading' || searching) && <div className="jm-sweep"><AsciiSweep verb={searching ? 'reading memory' : 'laying out the store'} rows={3} cols={14} /></div>}
              {/* the phone has no room for a picture: the list is the form there (spec 20.9.4, Mobile) */}
              {layout && <div className="jm-phone-list"><NodeList layout={layout} selected={selected} onSelect={open} onZoom={zoomTo} /></div>}
            </>
          )}
          {tab === 'strata' && <StrataBands strata={strata} nodes={g?.nodes ?? []} recalls={recalls.length} emptyReason={galaxy.state === 'fault' ? hollowReason : undefined} />}
          {tab === 'trail' && <Trail recalls={recalls} />}
          {tab === 'results' && <Results res={res} searching={searching} error={err} suggest={SUGGEST} onSuggest={(t) => void run(t)} />}
        </div>
        <footer className="jm-foot-line" data-testid="stage-foot">
          {galaxy.state === 'ready' && showsNumber(gReading.state) && g ? (
            <>
              <span className="jm-mono" data-testid="count-line">
                {layout?.mode === 'clusters' ? `${layout.clusters.length} sources, ${layout.total.toLocaleString('en-IN')} items` : `${layout?.drawn ?? 0} drawn${layout && layout.hidden ? `, ${layout.hidden} older not drawn` : ''} of ${layout?.zoom ? layout.groups.find((x) => x.group === layout.zoom)?.count ?? 0 : layout?.total ?? 0} laid out`}
              </span>
              <span className="jm-dim">{sample ?? `all ${g.counts.memories.toLocaleString('en-IN')} memories`} · centre is newest · size is weight · lines are links</span>
              <span className="jm-dim jm-legend">{sourceLine(g)}</span>
              {recalls.length > 1 && <span className="jm-dim jm-trace" aria-label={`Items returned by the last ${recalls.length} recalls`}>recalls <span aria-hidden="true">{sparkline(recalls.map((r) => r.hits))}</span></span>}
            </>
          ) : <span className="jm-dim">{gReading.reason}. No count is drawn without a reading.</span>}
        </footer>
        {echo.length > 0
          ? <Echo lines={echo} />
          : tab === 'const' && !hollow && layout && <p className="jm-keys jm-dim" aria-hidden="true">Tab enters the map · arrows step · Enter opens · Delete asks · + − zoom · 1 2 3 rings</p>}
      </section>

      <Detail
        port={port} selected={selNode} ask={ask} stats={stats} galaxy={galaxy} taste={taste} fixes={fixes}
        reminders={{ view: rem, now: nowSec, onAll: () => setRemDrawer(true), simulated: reminders.simulated }}
        onSelect={open} onWritten={written} onRemoved={removed} onRemember={remember} onEcho={addEcho}
      />

      <Drawer open={list} onClose={() => setList(false)} title="Everything on the map, as text">
        <div className="jm-drawer">{layout ? <NodeList layout={layout} selected={selected} onSelect={open} onZoom={zoomTo} /> : <p className="jm-muted">The map has not loaded.</p>}</div>
      </Drawer>
      <RemindersDrawer open={remDrawer} onClose={() => setRemDrawer(false)} port={reminders} view={rem} now={nowSec} reload={rL.reload} />
    </div>
  )
}

const EMPTY_LAYOUT: Layout = { mode: 'nodes', placed: [], clusters: [], links: [], groups: [], total: 0, drawn: 0, hidden: 0, zoom: null }
