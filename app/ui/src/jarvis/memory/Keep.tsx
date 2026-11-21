// Memory / Keep, the vault (spec 20.16.3, parity O1, M08, M09). Four sealed plates, the Holdings table and the sources.
//
//   Export    "Share a review": the last 7 days of chats, flagged turns first, written as Markdown for the owner to hand to
//             Claude (the same route as Core's key, POST /api/transcripts/export). The app sends the file nowhere. The span
//             and format choice, a read route for outside assistants and a whole-chat rating are drawn PLANNED.
//   Snapshot  a copy of the store: not built, PLANNED.
//   Raw       "Delete raw signal now" and its retention: not built, PLANNED.
//   Heading   "Delete a namespace": the registry's own entry (jarvis.memory-delete-all), PLANNED.
//
// The destructive plates are planned, so no hold control is built here: when a route lands the plate gets the hold cursor
// and names the count first (the confirm of Recall already does). Holdings are the store's own counts, each with a lamp.
// The sources are the four export cards of the classic Connect page, moved: request, import from Downloads, drop or pick
// a file, a path, and what was read from each.
import { useRef, useState } from 'react'
import { Zones } from '../../shell/v3'
import { Lamp, PlannedGlyph, showsNumber, type LampReading, type LampState } from '../../shared/lamp'
import { AsciiBar } from '../../shared/grammar'
import { PlannedControl } from '../../shared/planned/PlannedControl'
import { jarvisRegistry } from '../planned'
import { REVIEW_DAYS, useShareReview, type ReviewApi, type ReviewPort } from '../core/ShareReview'
import { ago, exportState, fmtBytes, readLine, type ExportSource, type SourcesPort } from './port'
import { useLoad } from './hooks'
import { fmtN, holdingsOf } from './model'
import type { RecallPort } from './port'
import './memory.css'
import './memory-v3.css'

const TONE: Record<ReturnType<typeof exportState>['tone'], LampState> = { live: 'live', sim: 'waiting', planned: 'waiting', fault: 'fault', '': 'waiting' }

/** What the last press of "Share a review" really did, in one honest line. */
export function reviewLine(review: ReviewApi): { lamp: LampState; text: string } | null {
  const { state, simulated } = review
  if (state.phase === 'idle') return null
  const flagged = Object.entries(state.summary?.flags ?? {}).filter(([k]) => k !== 'good').reduce((a, [, n]) => a + n, 0)
  if (state.phase === 'waiting') return { lamp: 'waiting', text: `writing the review of the last ${REVIEW_DAYS} days` }
  if (state.phase === 'fault') return { lamp: 'fault', text: `not written: ${state.error}` }
  if (state.phase === 'empty') return { lamp: 'waiting', text: `nothing to write yet: no turns were recorded in the last ${REVIEW_DAYS} days` }
  return simulated
    ? { lamp: 'simulated', text: 'fixture: no file was written' }
    : { lamp: 'live', text: `written to the reviews folder as ${state.name}${state.summary ? `: ${state.summary.turns} turns, ${flagged} flagged, flagged first` : ''}` }
}

function Plate({ serial, name, lamp, children, planned }: { serial: string; name: string; lamp: LampReading; children: React.ReactNode; planned?: boolean }) {
  return (
    <section className="jm-plate" data-planned={planned ? 'true' : undefined} aria-label={name}>
      <header><span className="jm-serial">{serial}</span><h3>{name}</h3><Lamp reading={lamp} showLabel={false} subject={name} /></header>
      {children}
    </section>
  )
}

const plannedLamp = (reason: string): LampReading => ({ state: 'planned', since: null, reason })

function PlannedRow({ label, why }: { label: string; why: string }) {
  return (
    <p className="jm-prow" data-testid="planned-row"><PlannedGlyph size={14} /><span className="jm-prow-l">{label}</span><b className="jm-key-word">PLANNED</b><span className="jm-dim jm-prow-w">{why}</span></p>
  )
}

function SourceCard({ s, port, now, reload }: { s: ExportSource; port: SourcesPort; now: number; reload: () => void }) {
  const st = exportState(s)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [byPath, setByPath] = useState(false)
  const [path, setPath] = useState('')
  const pick = useRef<HTMLInputElement>(null)
  const run = async (k: string, fn: () => Promise<void>, ok: string) => {
    if (busy) return
    setBusy(k)
    setMsg(null)
    try { await fn(); setMsg({ ok: true, text: ok }); reload() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(null) }
  }
  const lamp: LampReading = { state: TONE[st.tone], since: null, reason: st.label }
  return (
    <section className="jm-src" aria-label={s.name} data-testid="source-card" data-state={s.state}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void run('upload', () => port.upload(s.id, f), `${f.name} saved. Reading it now.`) }}>
      <header><h4>{s.name}</h4><Lamp reading={lamp} subject={s.name} /></header>
      <p className="jm-src-ask jm-dim"><b>Ask for:</b> {s.ask}</p>
      <div className="jm-src-keys">
        <button type="button" className="jm-key jm-key-sm" aria-disabled={!!busy || undefined} onClick={() => void run('req', () => port.request(s.id), `${s.name}'s export page is open in your browser.`)}>Request export</button>
        <button type="button" className="jm-key jm-key-sm" aria-disabled={!!busy || undefined} onClick={() => pick.current?.click()}>Choose file</button>
        <button type="button" className="jm-key jm-key-sm" aria-expanded={byPath} onClick={() => setByPath((b) => !b)}>By path</button>
        {s.files.length > 0 && <button type="button" className="jm-key jm-key-sm" onClick={() => void run('open', () => port.open(s.id), 'Opened the folder.')}>Open folder</button>}
        <input ref={pick} type="file" accept=".zip,.json" hidden aria-label={`Choose the ${s.name} export file`} onChange={(e) => { const f = e.target.files?.[0]; if (f) void run('upload', () => port.upload(s.id, f), `${f.name} saved. Reading it now.`); e.target.value = '' }} />
      </div>
      {s.downloads.map((d) => (
        <p key={d.path} className="jm-src-found">In Downloads: <b>{d.name}</b> · {fmtBytes(d.size)} · {ago(d.mtime, now)}
          <button type="button" className="jm-key jm-key-sm" onClick={() => void run('copy', () => port.importPath(s.id, d.path), 'Copying it in.')}>Import</button></p>
      ))}
      {byPath && (
        <form className="jm-src-path" onSubmit={(e) => { e.preventDefault(); if (path.trim()) void run('path', () => port.importPath(s.id, path.trim()), 'Copying it in.').then(() => setPath('')) }}>
          <label className="jm-sr" htmlFor={`jm-path-${s.id}`}>Path of the {s.name} export</label>
          <input id={`jm-path-${s.id}`} className="jm-field" value={path} onChange={(e) => setPath(e.target.value)} placeholder="a path to the .zip" autoComplete="off" />
          <button type="submit" className="jm-key jm-key-sm" aria-disabled={!path.trim() || undefined}>Import</button>
        </form>
      )}
      {s.job && <p className={s.job.state === 'failed' ? 'jm-note jm-fault' : 'jm-note'}>{s.job.state} {s.job.file}{s.job.error ? `: ${s.job.error}` : '…'}</p>}
      {s.files.slice(0, 2).map((f) => <p key={f.name} className="jm-src-file jm-dim">{f.name} · {fmtBytes(f.size)} · {f.folder ? 'a folder, kept as it is' : readLine(s.id, f.read)}</p>)}
      {msg && <p className={msg.ok ? 'jm-note' : 'jm-note jm-fault'} role="status">{msg.text}</p>}
    </section>
  )
}

export interface KeepViewProps {
  recall: RecallPort
  sources: SourcesPort
  review: ReviewPort
  /** A fixture: the review is stamped and writes nothing. */
  simulated?: boolean
  now?: number
  /** The v3 look: EXPORT / DELETE / RECORDS on three trays. */
  v3?: boolean
}

export function KeepView({ recall, sources, review: reviewPort, simulated = false, now: nowS, v3 = false }: KeepViewProps) {
  const stats = useLoad(recall.stats)
  const src = useLoad(sources.list, null)
  const review = useShareReview(reviewPort, simulated)
  const rows = holdingsOf(stats.v.data, null)
  const reading: LampReading = stats.v.state === 'ready' ? { state: simulated ? 'simulated' : 'live', since: null, reason: simulated ? 'fixture, not the store' : 'counted by the store' }
    : stats.v.state === 'fault' ? { state: 'fault', since: null, reason: stats.v.error } : { state: 'waiting', since: null, reason: 'counting' }
  const line = reviewLine(review)
  const [clock] = useState(() => Math.floor(Date.now() / 1000))
  const now = nowS ?? clock
  const waiting = review.state.phase === 'waiting'
  const exportLamp: LampReading = { state: waiting ? 'waiting' : 'live', since: null, reason: waiting ? 'writing' : 'ready' }

  const plate01 = (
    <Plate serial="K-01" name="Export" lamp={simulated ? { state: 'simulated', since: null, reason: 'fixture' } : exportLamp}>
      <p className="jm-dim jm-plate-line">The last {REVIEW_DAYS} days of chats, flagged turns first, as a file you can hand to Claude. Nothing is sent anywhere.</p>
      <div className="jm-row">
        <button type="button" className="jm-key jm-key-primary" onClick={() => void review.run()} aria-busy={waiting || undefined} aria-disabled={waiting || review.nothingYet || undefined} data-testid="share-review">Share a review</button>
        {review.state.phase === 'done' && !simulated && <button type="button" className="jm-key" onClick={() => void review.openFolder()}>Open folder</button>}
      </div>
      {review.nothingYet && <p className="jm-note" role="status">Nothing to share yet: no turns in the last {REVIEW_DAYS} days.</p>}
      {line && <p className="jm-review" role="status" data-testid="review-line" data-phase={review.state.phase}><Lamp reading={{ state: line.lamp, since: null, reason: line.text }} showLabel={false} subject="Review" /> {line.text}</p>}
      <PlannedRow label="Span, format, one chat" why="the route takes days only" />
      <PlannedRow label="Assistants read chats" why="a read route is not built" />
    </Plate>
  )
  const plate02 = (
    <Plate serial="K-02" name="Snapshot" lamp={plannedLamp('not built')} planned>
      <p className="jm-dim jm-plate-line">A dated copy of everything JARVIS holds, kept in your own folder.</p>
      <PlannedRow label="Take a snapshot" why="no route copies the store" />
      <PlannedRow label="Backup count" why="nothing counts them yet" />
    </Plate>
  )
  const plate03 = (
    <Plate serial="K-03" name="Raw signal" lamp={plannedLamp('not built')} planned>
      <p className="jm-dim jm-plate-line">Delete the raw sensing recordings now, and see how long they are kept.</p>
      <PlannedRow label="Delete raw signal now" why="no route deletes them" />
      <PlannedRow label="Retention" why="the setting is not exposed" />
    </Plate>
  )
  const plate04 = (
    <Plate serial="K-04" name="A heading" lamp={plannedLamp('not built')} planned>
      <PlannedControl registry={jarvisRegistry} id="jarvis.memory-delete-all" />
    </Plate>
  )
  const holdings = (
    <section className="jm-well jm-hold-well" aria-label="Holdings" data-scene="immersive">
      <header className="jm-well-head"><span className="jm-tag">[MEM]</span><h2>Holdings</h2><Lamp reading={reading} subject="Holdings" /></header>
      <dl className="jm-hold" data-testid="holdings">
        {rows.map((r) => (
          <div key={r.id} className="jm-hold-row" data-id={r.id}>
            <dt>{r.label}</dt>
            <dd><b className={showsNumber(reading.state) ? 'jm-num' : 'jm-num jm-none'}>{showsNumber(reading.state) ? fmtN(r.n) : 'no reading'}</b><small>{showsNumber(reading.state) ? r.note : reading.reason}</small></dd>
          </div>
        ))}
      </dl>
      {stats.v.data?.beliefs && (() => {
        const b = stats.v.data.beliefs
        const total = Object.values(b).reduce((a, n) => a + n, 0)
        return (
          <div className="jm-bar" data-testid="belief-bar">
            <AsciiBar value={b.confirmed ?? 0} max={total} width={22} label="Beliefs you confirmed" state={reading.state}
              reading={<span className="jm-dim">{b.confirmed ?? 0} of {total} beliefs confirmed by you</span>} />
          </div>
        )
      })()}
      <p className="jm-foot jm-dim">These are the store's own counts. Recall draws the same numbers.</p>
    </section>
  )
  const sourcesEl = (
    <section className="jm-sources" aria-label="Sources you can bring in" data-scene="immersive">
      <header className="jm-well-head"><span className="jm-tag">[SRC]</span><h2>Bring in an export</h2>
        <Lamp reading={src.v.state === 'ready' ? { state: simulated ? 'simulated' : 'live', since: null, reason: simulated ? 'fixture' : 'looked in Downloads and the imports folder' } : src.v.state === 'fault' ? { state: 'fault', since: null, reason: src.v.error } : { state: 'waiting', since: null, reason: 'looking in Downloads' }} subject="Sources" />
      </header>
      {src.v.state === 'fault' && <p className="jm-note" role="alert">The sources did not load ({src.v.error}).</p>}
      <div className="jm-src-grid">
        {src.v.data?.map((s) => <SourceCard key={s.id} s={s} port={sources} now={now} reload={src.reload} />)}
      </div>
    </section>
  )

  if (v3) {
    const simState = simulated ? 'simulated' : 'live'
    return (
      <div className="jm jm3" data-view="keep" data-simulated={simulated ? 'true' : undefined}>
        <Zones
          first={{
            job: 'EXPORT',
            peek: { name: 'Export', lamp: simulated ? 'simulated' : waiting ? 'waiting' : 'live', note: waiting ? 'writing' : 'ready' },
            children: <div className="jm3-scroll jm3-plates" role="group" aria-label="The vault">{plate01}{sourcesEl}</div>,
          }}
          second={{
            job: 'DELETE',
            peek: { name: 'Delete and snapshot', lamp: 'planned', note: 'not built' },
            children: <div className="jm3-scroll jm3-plates">{plate02}{plate03}{plate04}</div>,
          }}
          third={{
            job: 'RECORDS',
            peek: { name: 'Records', lamp: stats.v.state === 'fault' ? 'fault' : stats.v.state === 'ready' ? simState : 'waiting', note: stats.v.state === 'ready' ? undefined : 'counting' },
            children: <div className="jm3-scroll">{holdings}</div>,
          }}
        />
      </div>
    )
  }

  return (
    <div className="jm jm-keep" data-view="keep" data-simulated={simulated ? 'true' : undefined}>
      <div className="jm-plates" role="group" aria-label="The vault">
        {plate01}
        {plate02}
        {plate03}
        {plate04}
      </div>

      <div className="jm-keep-low">
        {holdings}
        {sourcesEl}
      </div>
    </div>
  )
}
