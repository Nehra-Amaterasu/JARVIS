// The Detail pane of Memory / Recall (spec 20.9.4), 410 x 572: the selected node as plain text with Fix, Wrong and Delete, the
// reminders strip, and the capture line docked at the bottom. With nothing selected it shows what the store holds (the
// Holdings counts, each with its lamp) and the taste topics, so the pane is never empty.
//
//   Fix     turns the excerpt into a field with a two-line diff (old words struck, new words underlined) and Save. The
//           original stays in a local history row for seven days and Undo writes it back. The store has one way to take a
//           correction (POST /api/memory/teach), so a fix is stored as a correction and the archive line itself is not
//           altered: the echo line says so rather than claiming an edit.
//   Delete  opens the confirm that names the count. The store has no route that deletes one item, so with `port.remove`
//           null the key is drawn PLANNED, says why, and sends nothing; with a route it asks, then removes with no reward.
//   Wrong   needs a flag route per item; beliefs and learned facts have theirs on the Beliefs view. PLANNED here.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RetroDialog } from '../../shared/kit'
import { Lamp, PlannedGlyph, showsNumber, type LampReading } from '../../shared/lamp'
import { CaptureLine } from '../../shared/capture'
import type { Parsed } from '../../shared/capture'
import { useLoad, type FixHistory } from './hooks'
import { deleteLine, fixesFor, fmtDay, fmtN, groupWord, holdingsOf, parseTime, twoLineDiff, type Placed } from './model'
import type { RecallPort } from './port'
import type { GalaxyPayload, Loadable, NodeDetail, Stats, TasteView } from './types'
import { ReminderStrip, type ReminderStripProps } from './Reminders'

export interface EchoLine { id: number; state: 'live' | 'waiting' | 'fault' | 'simulated'; text: string }

/** `[MEM] ...` lines under the detail: what the last action really did. Two lines, newest last. */
export function Echo({ lines }: { lines: readonly EchoLine[] }) {
  if (!lines.length) return null
  return (
    <ol className="jm-echo" aria-label="What the last actions did" aria-live="polite" data-testid="echo">
      {lines.slice(-2).map((l) => (
        <li key={l.id}><span className="jm-tag">[MEM]</span> <Lamp reading={{ state: l.state, since: null, reason: l.text }} showLabel={false} subject="Memory" /> <span className="jm-echo-t">{l.text}</span></li>
      ))}
    </ol>
  )
}

function PlannedKey({ label, reason, onNote }: { label: string; reason: string; onNote: (r: string) => void }) {
  return (
    <button type="button" className="jm-key jm-key-planned" aria-disabled="true" onClick={() => onNote(reason)} data-planned={label.toLowerCase()}>
      <PlannedGlyph size={14} /> {label}<span className="jm-key-word">PLANNED</span>
    </button>
  )
}

/* ------------------------------------------------------------------ the selected node */
function NodeBody({ port, node, total, fixes, onEcho, onWritten, onRemoved, onSelect, ask }: {
  port: RecallPort
  node: Placed
  total: number | null
  fixes: FixHistory
  onEcho: (state: EchoLine['state'], text: string) => void
  onWritten: () => void
  onRemoved: (ids: string[]) => void
  onSelect: (id: string) => void
  ask: { id: string; k: number } | null
}) {
  const { v } = useLoad<NodeDetail>(() => port.detail(node.id), node.id)
  const d = v.data
  const links = (d?.links ?? []).map((l) => ({ id: l.id, label: l.label }))
  const excerpt = d?.snippet ?? node.label
  const [note, setNote] = useState('')
  const [fix, setFix] = useState(false)
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (fix) field.current?.focus() }, [fix])
  useEffect(() => { if (ask && ask.id === node.id && port.remove) setAsking(true) }, [ask, node.id, port])
  const diff = useMemo(() => twoLineDiff(excerpt, draft), [excerpt, draft])
  const mine = fixesFor(fixes.rows, node.id)
  const kindWord = node.kind === 'memory' ? 'Memory' : node.kind === 'person' ? 'Person' : node.kind === 'belief' ? 'Belief' : 'Taste topic'
  const simulated = port.simulated

  const save = async () => {
    const after = draft.trim()
    if (!after || after === excerpt.trim() || busy) return
    setBusy(true)
    try {
      const r = await port.fix(excerpt, after)
      const at = Date.now()
      fixes.add({ id: `${node.id}:${at}`, node: node.id, before: excerpt, after, at })
      onEcho(simulated ? 'simulated' : 'live', r.added ? 'fixed: stored as a correction; the archive line itself is unchanged; undo is kept 7 days' : 'already stored as that correction')
      setFix(false)
      onWritten()
    } catch (e) {
      onEcho('fault', `not fixed: ${(e as Error).message}`)
    } finally { setBusy(false) }
  }
  const undo = async (id: string, before: string, after: string) => {
    if (busy) return
    setBusy(true)
    try {
      await port.fix(after, before)
      fixes.remove(id)
      onEcho(simulated ? 'simulated' : 'live', 'undone: the old wording was written back as the newest correction')
      onWritten()
    } catch (e) {
      onEcho('fault', `not undone: ${(e as Error).message}`)
    } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!port.remove) return
    setBusy(true)
    try {
      await port.remove([node.id])
      setAsking(false)
      onRemoved([node.id]) // no animation reward: the node is simply gone from the next layout
      onEcho(simulated ? 'simulated' : 'live', 'removed 1 item')
    } catch (e) {
      onEcho('fault', `not removed: ${(e as Error).message}`)
      setAsking(false)
    } finally { setBusy(false) }
  }

  return (
    <div className="jm-node-body" data-testid="detail">
      <header className="jm-d-head">
        <span className="jm-tag">[{node.group.slice(0, 3).toUpperCase()}]</span>
        <h3 className="jm-d-title">{kindWord}</h3>
        <span className="jm-d-src">{groupWord(node.group)}</span>
      </header>
      {v.state === 'fault' && <p className="jm-note" role="alert">The full text did not load ({v.error}). The first words are shown.</p>}
      {!fix ? (
        <p className="jm-excerpt" data-testid="excerpt">{excerpt}</p>
      ) : (
        <div className="jm-fix" data-testid="fix">
          <label className="jm-sr" htmlFor="jm-fix-field">New wording</label>
          <textarea id="jm-fix-field" ref={field} className="jm-fix-field" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setFix(false) } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save() }} />
          <p className="jm-diff" aria-label="Old line"><span className="jm-diff-k">−</span>{diff.old.map((s, i) => <span key={i} data-k={s.k}>{s.t} </span>)}</p>
          <p className="jm-diff" aria-label="New line"><span className="jm-diff-k">+</span>{diff.next.map((s, i) => <span key={i} data-k={s.k}>{s.t} </span>)}</p>
          <div className="jm-row">
            <button type="button" className="jm-key jm-key-primary" onClick={() => void save()} aria-disabled={!draft.trim() || draft.trim() === excerpt.trim() || busy || undefined}>Save</button>
            <button type="button" className="jm-key" onClick={() => setFix(false)}>Cancel</button>
          </div>
        </div>
      )}
      <dl className="jm-facts-grid">
        <dt>Date</dt><dd>{fmtDay(parseTime(d?.date) ?? node.time)}</dd>
        {d?.status && <><dt>Status</dt><dd>{d.status}{d.confidence != null ? ` · ${Math.round(d.confidence * 100)}% sure` : ''}</dd></>}
      </dl>
      {links.length > 0 && (
        <div className="jm-links-row" aria-label="Linked items">
          {links.slice(0, 2).map((l) => <button key={l.id} type="button" className="jm-chip" onClick={() => onSelect(l.id)} title={l.label}>{l.label.length > 22 ? `${l.label.slice(0, 21)}…` : l.label}</button>)}
        </div>
      )}
      {!fix && (
        <div className="jm-row" role="group" aria-label="Fix, wrong or delete this item">
          <button type="button" className="jm-key" onClick={() => { setDraft(excerpt); setFix(true) }} data-testid="fix-key">Fix</button>
          <PlannedKey label="Wrong" reason="Wrong on one stored item needs a flag route the store does not have. Beliefs and learned facts have theirs on Beliefs." onNote={setNote} />
          {port.remove
            ? <button type="button" className="jm-key" onClick={() => setAsking(true)} data-testid="delete-key" aria-keyshortcuts="Delete">Delete</button>
            : <PlannedKey label="Delete" reason="Deleting one stored item is not built: the store has no route for it. Nothing was sent." onNote={setNote} />}
        </div>
      )}
      {note && <p className="jm-note" role="status" data-testid="note">{note}</p>}
      {mine.length > 0 && !fix && (
        <ul className="jm-history" aria-label="Fixes kept for 7 days">
          {mine.slice(0, 2).map((r) => (
            <li key={r.id}><span className="jm-dim">fixed {fmtDay(r.at)}</span> <button type="button" className="jm-key jm-key-sm" onClick={() => void undo(r.id, r.before, r.after)} data-testid="undo-fix">Undo</button></li>
          ))}
        </ul>
      )}
      <RetroDialog open={asking} title="Delete" destructive confirmLabel="Delete 1 item" onConfirm={() => void remove()} onCancel={() => setAsking(false)}>
        <p data-testid="delete-line">{deleteLine(1, total === null ? null : total - 1)}</p>
        <p className="jm-dim">{excerpt.length > 90 ? `${excerpt.slice(0, 89)}…` : excerpt}</p>
      </RetroDialog>
    </div>
  )
}

/* ------------------------------------------------------------------ nothing selected: holdings and taste */
function Idle({ stats, galaxy, taste, simulated }: { stats: Loadable<Stats>; galaxy: Loadable<GalaxyPayload>; taste: Loadable<TasteView>; simulated: boolean }) {
  const rows = holdingsOf(stats.data, galaxy.data)
  const reading: LampReading = stats.state === 'ready'
    ? { state: simulated ? 'simulated' : 'live', since: null, reason: simulated ? 'fixture, not the store' : 'counted by the store' }
    : stats.state === 'fault' ? { state: 'fault', since: null, reason: stats.error } : { state: 'waiting', since: null, reason: 'counting' }
  const topics = taste.data?.topics.slice(0, 4) ?? []
  return (
    <div className="jm-idle" data-testid="idle">
      <header className="jm-d-head"><span className="jm-tag">[MEM]</span><h3 className="jm-d-title">What JARVIS holds</h3><Lamp reading={reading} subject="Holdings" /></header>
      <dl className="jm-hold">
        {rows.map((r) => (
          <div key={r.id} className="jm-hold-row" data-id={r.id}>
            <dt>{r.label}</dt>
            <dd><b className={showsNumber(reading.state) ? 'jm-num' : 'jm-num jm-none'}>{showsNumber(reading.state) ? fmtN(r.n) : 'no reading'}</b><small>{showsNumber(reading.state) ? r.note : reading.reason}</small></dd>
          </div>
        ))}
      </dl>
      <h4 className="jm-h">Taste, over the years <span className="jm-origin" data-o="MODEL">MODEL</span></h4>
      {topics.length === 0 && <p className="jm-muted">{taste.state === 'fault' ? `Taste did not load (${taste.error}).` : taste.state === 'loading' ? 'Reading taste.' : 'No taste topics yet.'}</p>}
      <ul className="jm-taste">
        {topics.map((t) => {
          const years = Object.entries(t.by_year).sort(([a], [b]) => Number(a) - Number(b)).slice(-8)
          const mx = Math.max(...years.map(([, x]) => x), 1e-9)
          return (
            <li key={t.label}>
              <span className="jm-taste-l">{t.label}</span>
              <span className="jm-bars" aria-hidden="true">{years.map(([y, x]) => <i key={y} style={{ height: `${Math.max(12, (x / mx) * 100)}%` }} />)}</span>
              <span className="jm-taste-t">{t.trend}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export interface DetailProps {
  port: RecallPort
  selected: Placed | null
  ask: { id: string; k: number } | null
  stats: Loadable<Stats>
  galaxy: Loadable<GalaxyPayload>
  taste: Loadable<TasteView>
  fixes: FixHistory
  reminders: ReminderStripProps
  onSelect: (id: string) => void
  onWritten: () => void
  onRemoved: (ids: string[]) => void
  /** A fact was typed on the capture line; resolves when it is stored. */
  onRemember: (text: string) => Promise<void>
  onEcho: (state: EchoLine['state'], text: string) => void
  /** The v3 look splits the pane over two trays: `found` is the selected item, `holds` is what the store holds and the reminders. */
  part?: 'found' | 'holds'
}

export function Detail(p: DetailProps) {
  const [round, setRound] = useState(0)
  const total = p.galaxy.data ? p.galaxy.data.counts.memories + p.galaxy.data.counts.people + p.galaxy.data.counts.beliefs + p.galaxy.data.counts.topics : null
  const commit = (parsed: Parsed) => {
    if (parsed.grammar !== 'jarvis') return
    if (parsed.verb === 'help') { p.onEcho('waiting', 'remember <text> stores one fact. Search is the field above.'); return }
    if (parsed.verb === 'remember') { void p.onRemember(parsed.args).then(() => setRound((r) => r + 1)) }
  }
  if (p.part === 'found') {
    return p.selected ? (
      <div className="jm3-part" aria-label="Selected item" data-testid="detail-found">
        <NodeBody key={p.selected.id} port={p.port} node={p.selected} total={total} fixes={p.fixes} onEcho={p.onEcho}
          onWritten={p.onWritten} onRemoved={p.onRemoved} onSelect={p.onSelect} ask={p.ask} />
      </div>
    ) : null
  }
  if (p.part === 'holds') {
    return (
      <div className="jm3-part" aria-label="What is held">
        <Idle stats={p.stats} galaxy={p.galaxy} taste={p.taste} simulated={p.port.simulated} />
        <ReminderStrip {...p.reminders} />
      </div>
    )
  }
  return (
    <aside className="jm-detail" aria-label="Detail">
      <div className="jm-detail-main">
        {p.selected
          ? <NodeBody key={p.selected.id} port={p.port} node={p.selected} total={total} fixes={p.fixes} onEcho={p.onEcho}
              onWritten={p.onWritten} onRemoved={p.onRemoved} onSelect={p.onSelect} ask={p.ask} />
          : <Idle stats={p.stats} galaxy={p.galaxy} taste={p.taste} simulated={p.port.simulated} />}
      </div>
      <ReminderStrip {...p.reminders} />
      <div className="jm-dock">
        <CaptureLine key={round} grammar="jarvis" verbs={['remember']} label="remember: a fact JARVIS should keep" onCommit={commit} globalKey={false} />
      </div>
    </aside>
  )
}

export type { ReactNode }
