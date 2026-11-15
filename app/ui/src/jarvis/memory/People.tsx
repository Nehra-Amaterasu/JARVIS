// Memory / People, the People ring (spec 20.16.3, parity M04). An alphabetical ring of initials, never ranked by closeness (the
// classic list sorted by it; the owner's principle 19 says a person is not a score). A seed glyph per person, a framed ASCII
// portrait of the initials for the one selected (never a face), and a last-mentioned bar on a 36-month ruler. The list beside
// the ring is the same people as text, in the same order, and is the keyboard path.
//
// Fix and Delete for a person need routes the store does not have; they are drawn PLANNED and send nothing. A person with no
// last-mentioned date in the store gets a dashed empty bar that says so, never a guess.
import { useMemo, useState } from 'react'
import { AsciiPortrait, Sigil, cleanInitials } from '../../shared/grammar'
import { Lamp, PlannedGlyph, type LampReading } from '../../shared/lamp'
import { useLoad } from './hooks'
import { fmtN, monthLabel, parseTime, ymOf } from './model'
import type { PeoplePort } from './port'
import type { Person } from './types'
import './memory.css'

export const RING_MAX = 24
export const MONTHS_SPAN = 36

/** Months between a date and now (0 = this month), or null with no date. */
export function monthsAgo(iso: string | null | undefined, now: number): number | null {
  const t = parseTime(iso)
  if (t === null) return null
  const a = new Date(now)
  const b = new Date(t)
  return Math.max(0, (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + a.getUTCMonth() - b.getUTCMonth())
}

/** Alphabetical by name, ties by name again so the order is the same on every machine. Closeness is never read. */
export const alphabetical = (people: readonly Person[]): Person[] =>
  [...people].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.name < b.name ? -1 : 1))

export const initialsOf = (name: string): string => cleanInitials(name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('')) || '?'

/** The ruler: 36 cells, the lit one is the month of the last mention (newest on the right). */
function LastBar({ p, now }: { p: Person; now: number }) {
  const m = monthsAgo(p.last_iso, now)
  if (m === null) return <span className="jm-last" data-empty="true" aria-label="no last-mentioned date in the store"><span className="jm-dim">no date in the store</span></span>
  const at = Math.min(MONTHS_SPAN - 1, m)
  const t = parseTime(p.last_iso)!
  return (
    <span className="jm-last" aria-label={`last mentioned ${monthLabel(ymOf(t))}, ${m} months ago`}>
      <span className="jm-last-track" aria-hidden="true">{Array.from({ length: MONTHS_SPAN }, (_, i) => <i key={i} data-on={i === MONTHS_SPAN - 1 - at ? 'true' : undefined} />)}</span>
      <span className="jm-mono jm-dim">{monthLabel(ymOf(t))}{m >= MONTHS_SPAN ? ' (older than the ruler)' : ''}</span>
    </span>
  )
}

export interface PeopleViewProps { port: PeoplePort; now?: number }

export function PeopleView({ port, now: nowMs }: PeopleViewProps) {
  const { v } = useLoad(() => port.people(60), null)
  const [clock] = useState(() => Date.now())
  const now = nowMs ?? clock
  const people = useMemo(() => alphabetical(v.data ?? []), [v.data])
  const [sel, setSel] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const shown = people.slice(0, RING_MAX)
  const cur = people.find((p) => p.name === sel) ?? null
  const lamp: LampReading = v.state === 'fault' ? { state: 'fault', since: null, reason: v.error }
    : v.state === 'loading' ? { state: 'waiting', since: null, reason: 'reading people' } : { state: port.simulated ? 'simulated' : 'live', since: null, reason: port.simulated ? 'fixture, invented names' : 'from the store' }
  const R = 232

  return (
    <div className="jm jm-two jm-people" data-view="people" data-simulated={port.simulated ? 'true' : undefined}>
      <section className="jm-ringwrap" aria-label="People ring" data-scene="immersive">
        <header className="jm-well-head"><span className="jm-tag">[MEM]</span><h2>People</h2><Lamp reading={lamp} subject="People" /><span className="jm-dim">alphabetical, never ranked</span></header>
        {v.state === 'fault' && <p className="jm-note" role="alert">People did not load ({v.error}).</p>}
        {v.state === 'ready' && people.length === 0 && <div className="jm-empty-in"><pre className="jm-ascii" aria-hidden="true">{'   .--.\n  (    )\n   \'--\'\n no people yet'}</pre><p className="jm-muted">No people are stored yet. They appear when a message archive is imported.</p></div>}
        <div className="jm-ring" data-testid="people-ring">
          {shown.map((p, i) => {
            const a = (i / shown.length) * Math.PI * 2 - Math.PI / 2
            return (
              <button key={p.name} type="button" className="jm-bead" aria-pressed={sel === p.name} aria-label={`${p.name}`} title={p.name}
                style={{ left: `calc(50% + ${Math.cos(a) * R}px)`, top: `calc(50% + ${Math.sin(a) * R * 0.86}px)` }} onClick={() => setSel(p.name)}>
                <span className="jm-bead-i">{initialsOf(p.name)}</span>
              </button>
            )
          })}
          <div className="jm-ring-core" data-testid="person-card" aria-live="polite">
            {cur ? (
              <>
                <AsciiPortrait initials={initialsOf(cur.name)} />
                <h3 className="jm-p-name">{cur.name}</h3>
                <p className="jm-dim jm-mono">{fmtN(cur.n_msgs)} messages · {(cur.span_days / 365).toFixed(1)} years{cur.calls ? ` · ${cur.calls} calls` : ''}</p>
                <LastBar p={cur} now={now} />
                <span className="jm-seed"><Sigil seed={cur.name} size={24} label={`Seed glyph of ${cur.name}`} /></span>
                <div className="jm-row">
                  <button type="button" className="jm-key jm-key-planned" aria-disabled="true" onClick={() => setNote('Fixing a person needs a route the store does not have. Nothing was sent.')}><PlannedGlyph size={14} /> Fix<span className="jm-key-word">PLANNED</span></button>
                  <button type="button" className="jm-key jm-key-planned" aria-disabled="true" onClick={() => setNote('Deleting a person needs a route the store does not have. Nothing was sent.')}><PlannedGlyph size={14} /> Delete<span className="jm-key-word">PLANNED</span></button>
                </div>
                {note && <p className="jm-note" role="status">{note}</p>}
              </>
            ) : <p className="jm-muted jm-ring-hint">{people.length ? 'Pick a bead or a name.' : ''}</p>}
          </div>
        </div>
        {people.length > RING_MAX && <p className="jm-dim jm-ring-more">{people.length - RING_MAX} more in the list.</p>}
      </section>
      <section className="jm-well jm-well-side" aria-label="People as a list" data-scene="immersive">
        <header className="jm-well-head"><span className="jm-tag">[MEM]</span><h2>As a list</h2><span className="jm-mono jm-dim">{people.length ? `${people.length} people` : 'no reading'}</span></header>
        <ul className="jm-plist" data-testid="people-list">
          {people.map((p) => (
            <li key={p.name}>
              <button type="button" className="jm-list-row" aria-current={sel === p.name || undefined} onClick={() => setSel(p.name)}>
                <span className="jm-tag">{initialsOf(p.name)}</span><span className="jm-list-t">{p.name}</span><LastBar p={p} now={now} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
