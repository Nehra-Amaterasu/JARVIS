/**
 * Past-paper sources on the harvester screen (engine requests R-44, R-53, R-54; plan 9.0, the harvest lines of 2026-11-25).
 *
 *   GET  /api/mission/harvest/sources             `paper_sources` (this file's PaperSource) and `pdf_reader.note`
 *   PUT  /api/mission/harvest/sources/{id}        {on?, local_copy?, address?} -> `paper_source`; 400 and 404 carry a sentence
 *   GET  /api/mission/harvest/sources/{id}/index  what the publisher lists: `items`, `listed`, `read_at`, `note`, and a state
 *   POST /api/mission/harvest/sources/{id}/fetch  {key} -> `entry` and `job`; a pointer only, unless the local copy is on
 *
 * Rules this screen keeps:
 *  - the terms note of a source is on screen, always, before any of its switches can be pressed: he reads, then decides;
 *  - "Use this source" and "Keep a local copy" are two switches; the second waits for the first, and when the engine
 *    refuses anything its own sentence is printed, never a paraphrase;
 *  - a source that is off asks nobody: no listing is read, and the screen never shows "0 papers" for an off source;
 *  - nothing is fetched by the screen itself: the listing is read only when he presses "Read the listing", and a paper
 *    stays a link unless the local copy is on and he presses Fetch;
 *  - a count is printed only under the state word the engine gave it (live), with the engine's own "of the N listed".
 */
import { useState } from 'react'
import { Check } from 'lucide-react'
import { api } from '../../lib/api'
import { Lamp, type LampState } from '../../shared/kit/Lamp'
import { Button, Chip, Field, Segmented } from '../kit'
import { PagerBar, usePaged } from './pager'

export interface PaperSource {
  id: string
  name: string
  kind: 'papers'
  rights: string
  terms_note: string
  hosts: string[]
  needs_address: boolean
  address: string | null
  on: boolean
  local_copy: boolean
  reason: string
}
export interface PaperItem { key: string; title: string; code: string; year: number | null; kind: 'paper' | 'key'; url: string; on_file: boolean }
export interface PaperIndex { state: string; reason: string; items: PaperItem[]; listed: number; read_at: string | null; note: string }
interface PaperSwitched { paper_source: PaperSource }
interface PaperFetched { state: string; reason: string; entry: { url?: string; sha256?: string | null; local?: string } | null; job: unknown }

const PATH = '/api/mission/harvest/sources'

const LAMP: Record<string, LampState> = { live: 'live', waiting: 'waiting', planned: 'planned', fault: 'fault', simulated: 'simulated' }
const lampOf = (s: string): LampState => LAMP[s] ?? 'waiting'

/** The state of a source in words: off is its own word, never a zero. */
export function sourceWord(s: PaperSource): string {
  if (!s.on) return 'Off'
  return s.local_copy ? 'On, keeps local copies' : 'On, links only'
}

/** A paper row's second line: only what the listing gave; an unstated year says so. */
export function itemMeta(i: PaperItem): string {
  const parts = [i.code || 'no code given', i.year === null ? 'year not stated' : String(i.year), i.kind === 'key' ? 'answer key' : 'paper']
  return parts.join(', ')
}

function Switch({ label, on, busy, reason, onPress }: { label: string; on: boolean; busy: boolean; reason?: string; onPress: () => void }) {
  return (
    <Button role="switch" aria-checked={on} className="su-ps-switch" data-on={on ? 'true' : undefined} disabled={busy} disabledReason={reason} onClick={onPress}>
      {on && <Check size={16} aria-hidden="true" />}
      <span>{label}</span>
      <span className="su-ps-switch-state">{on ? 'On' : 'Off'}</span>
    </Button>
  )
}

type Say = { text: string; tone: 'ok' | 'refused' } | null

function Card({ source, onChange }: { source: PaperSource; onChange: (s: PaperSource) => void }) {
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<Say>(null)
  const [draft, setDraft] = useState(source.address ?? '')
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState<PaperIndex | null>(null)
  const [reading, setReading] = useState(false)
  const [rowSay, setRowSay] = useState<Record<string, Say>>({})
  const [filed, setFiled] = useState<Record<string, boolean>>({})
  const [rowBusy, setRowBusy] = useState('')
  const pg = usePaged(idx?.items.length ?? 0, 3)

  const put = async (body: { on?: boolean; local_copy?: boolean; address?: string }) => {
    setBusy(true)
    try {
      const r = await api<PaperSwitched>(`${PATH}/${source.id}`, { method: 'PUT', body })
      onChange(r.paper_source)
      if (body.address !== undefined) setDraft(r.paper_source.address ?? '')
      // turning the source off or on makes the read listing stale: it is shown only for the state it was read under
      if (body.on !== undefined) setIdx(null)
      setSay(null) // the engine's reason for the new state is the card's own reason line; printing it twice only pushed the keys down
    } catch (e) {
      setSay({ text: (e as Error).message || 'The engine refused that.', tone: 'refused' })
    } finally { setBusy(false) }
  }

  const read = async () => {
    setReading(true)
    setSay(null)
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
      setIdx(await api<PaperIndex>(`${PATH}/${source.id}/index${qs}`))
    } catch (e) {
      setIdx(null)
      setSay({ text: (e as Error).message || 'The listing could not be read.', tone: 'refused' })
    } finally { setReading(false) }
  }

  const fetchOne = async (it: PaperItem, open: boolean) => {
    // the link opens from the press itself (a popup opened after an await is blocked); it is his browser, not this app, that goes to the site
    if (open && /^https?:\/\//i.test(it.url)) window.open(it.url, '_blank', 'noopener')
    setRowBusy(it.key)
    try {
      const r = await api<PaperFetched>(`${PATH}/${source.id}/fetch`, { method: 'POST', body: { key: it.key } })
      setRowSay((p) => ({ ...p, [it.key]: { text: r.reason, tone: r.state === 'fault' ? 'refused' : 'ok' } }))
      if (r.state !== 'fault' && r.entry?.sha256) setFiled((p) => ({ ...p, [it.key]: true }))
    } catch (e) {
      setRowSay((p) => ({ ...p, [it.key]: { text: (e as Error).message || 'The engine refused that.', tone: 'refused' } }))
    } finally { setRowBusy('') }
  }

  const needAddress = source.needs_address && !source.address
  const readReason = !source.on ? 'Switch "Use this source" on first.' : needAddress ? 'Save the listing address first.' : undefined
  const dirty = draft.trim() !== (source.address ?? '')
  const live = idx?.state === 'live'

  return (
    <section className="su-ps" data-paper-source={source.id} data-on={source.on ? 'true' : 'false'} aria-label={source.name}>
      <header className="su-ps-head">
        <h3 className="su-ps-name">{source.name}</h3>
        <Chip tone={source.on ? 'live' : 'neutral'}>{sourceWord(source)}</Chip>
      </header>
      <p className="su-ps-meta" data-rights="">{`Rights: ${source.rights}`}</p>
      <p className="su-ps-terms" data-terms="">{source.terms_note}</p>
      <p className="su-ps-meta" data-hosts="">{`Asks only: ${source.hosts.join(', ')}`}</p>
      <p className="su-ps-meta" data-reason="">{source.reason}</p>

      <div className="su-ps-switches" role="group" aria-label={`Switches for ${source.name}`}>
        <Switch label="Use this source" on={source.on} busy={busy} onPress={() => void put({ on: !source.on })} />
        <Switch label="Keep a local copy" on={source.local_copy} busy={busy}
          reason={!source.on && !source.local_copy ? 'Switch "Use this source" on first.' : undefined}
          onPress={() => void put({ local_copy: !source.local_copy })} />
      </div>

      {source.needs_address && (
        <div className="su-ps-address">
          <Field label="Address of the listing page" kind="text" value={draft} maxLength={500} inputMode="url" autoComplete="off"
            hint="Paste the page that lists the papers. The engine checks it." onChange={(e) => setDraft(e.target.value)} />
          <Button disabled={busy} disabledReason={!draft.trim() ? 'Paste an address first.' : !dirty ? 'This address is already saved.' : undefined}
            onClick={() => void put({ address: draft.trim() })}>Save the address</Button>
        </div>
      )}

      {say && <p className="su-ps-say" role="status" data-tone={say.tone} data-say="">{say.tone === 'refused' ? `Refused: ${say.text}` : say.text}</p>}

      <div className="su-ps-list" data-listing="">
        <div className="su-ps-readrow">
          <Field label="Search the listing" kind="text" value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} />
          <Button loading={reading} disabled={busy} disabledReason={readReason} onClick={() => void read()}>Read the listing</Button>
        </div>
        {!source.on && <p className="su-hint" data-off="">This source is off, so it is not asked and nothing is listed.</p>}
        {source.on && !idx && !reading && !say && <p className="su-hint">The listing is read only when you press the key above, and the engine asks the site at most once a day.</p>}
        {idx && (
          <div data-index-state={idx.state}>
            <p className="su-ps-count">
              <Lamp state={lampOf(idx.state)} reason={idx.reason} />
              <span data-index-reason="">{live ? `${idx.items.length} shown of the ${idx.listed} listed${idx.read_at ? `, read ${idx.read_at}` : ''}.` : idx.reason}</span>
            </p>
            {idx.note && <p className="su-ps-meta" data-index-note="">{idx.note}</p>}
            {live && idx.items.length === 0 && <p className="su-hint">Nothing in the listing matches that search.</p>}
            {live && !source.local_copy && idx.items.length > 0 && <p className="su-hint">The local copy is off, so each paper is a link to the publisher.</p>}
            {live && idx.items.length > 0 && (
              <ul className="su-ps-items" aria-label="Papers found">
                {pg.slice(idx.items).map(({ item: it }) => (
                  <li key={it.key} data-paper-key={it.key}>
                    <div className="su-ps-item-text">
                      <span className="su-ps-item-title">{it.title}</span>
                      <span className="su-ps-meta">{`${itemMeta(it)}${it.on_file || filed[it.key] ? ', on file' : ''}`}</span>
                      {rowSay[it.key] && <span className="su-ps-say" role="status" data-tone={rowSay[it.key]!.tone}>{rowSay[it.key]!.tone === 'refused' ? `Refused: ${rowSay[it.key]!.text}` : rowSay[it.key]!.text}</span>}
                    </div>
                    <div className="su-ps-item-keys">
                      <Button size="md" loading={rowBusy === it.key} disabled={!!rowBusy} aria-label={`Open the link for ${it.title}`} onClick={() => void fetchOne(it, true)}>Open the link</Button>
                      {source.local_copy && <Button size="md" loading={rowBusy === it.key} disabled={!!rowBusy} aria-label={`Fetch ${it.title}`} onClick={() => void fetchOne(it, false)}>Fetch</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <PagerBar p={pg} noun="papers" nounSingular="Paper" />
          </div>
        )}
      </div>
    </section>
  )
}

export function PaperSources({ sources, pdfNote, onChange }: { sources: PaperSource[]; pdfNote?: { available: boolean; note: string }; onChange: (s: PaperSource) => void }) {
  const [pick, setPick] = useState(sources[0]?.id ?? '')
  const cur = sources.find((s) => s.id === pick) ?? sources[0]
  if (!cur) return null
  return (
    <div className="su-pps" data-component="paper-sources">
      <p className="su-hint" data-nothing-by-itself="">Nothing here downloads by itself: a source that is off asks no one, and a paper stays a link unless you keep a local copy.</p>
      {sources.length > 1 && (
        <Segmented<string> label="Past-paper source" variant="choice" value={cur.id} onChange={setPick}
          options={sources.map((s) => ({ id: s.id, label: s.name }))} />
      )}
      <Card key={cur.id} source={cur} onChange={onChange} />
      {pdfNote && <p className="su-ps-meta" data-pdf-note="">{`PDF reading is ${pdfNote.available ? 'available' : 'not available'}. ${pdfNote.note}`}</p>}
    </div>
  )
}
