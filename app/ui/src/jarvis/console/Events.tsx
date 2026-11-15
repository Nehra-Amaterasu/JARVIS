// Console, Events (A.J05, spec 20.9.5): the event log with a filter grammar in a 44 px field, `core !sim since:1h`: a bare
// word includes a tag, `!word` excludes it, `since:` limits the age. It is the same stream the ticker and the Alt+L
// overlay read (lib/store events, newest last), so nothing here is a second source and no line is invented. The list shows
// as many whole rows as fit the frame (no inner scrollbar); Older and Newer page through the rest.
import { useEffect, useMemo, useRef, useState } from 'react'
import { clock } from '../../lib/format'
import type { BusEvent } from '../../lib/api'
import { TermWell, barTrack, sparkline } from '../../shared/grammar'
import { Lamp, LampGlyph, type LampReading } from '../../shared/lamp'
import { applyFilter, densityBuckets, eventLamp, parseFilter, sourceCounts, tagWord } from './model'
import { AsciiRuler, ConsoleKey, PartHead, LampLine } from './parts'
import { useEventsLive } from './useConsole'
import './console.css'
import './views.css'

const ROW_PX = 26
const FALLBACK_ROWS = 14

export interface EventsViewProps {
  events: readonly BusEvent[]
  online: boolean
  /** Epoch seconds, for `since:`. */
  now: number
  initialFilter?: string
  simulated?: boolean
}

export function EventsView({ events, online, now, initialFilter = '', simulated = false }: EventsViewProps) {
  const [text, setText] = useState(initialFilter)
  const [page, setPage] = useState(0)
  const [fit, setFit] = useState(FALLBACK_ROWS)
  const list = useRef<HTMLOListElement>(null)
  const filter = useMemo(() => parseFilter(text), [text])
  const all = useMemo(() => events.slice(), [events])
  const hits = useMemo(() => applyFilter(all, filter, now), [all, filter, now])
  const counts = useMemo(() => sourceCounts(all), [all])
  const top = counts[0]?.n ?? 1
  const density = useMemo(() => densityBuckets(hits, now, 48), [hits, now])

  useEffect(() => {
    const el = list.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setFit(Math.max(3, Math.floor(el.clientHeight / ROW_PX))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => setPage(0), [text])

  const pages = Math.max(1, Math.ceil(hits.length / fit))
  const p = Math.min(page, pages - 1)
  const end = hits.length - p * fit
  const shown = hits.slice(Math.max(0, end - fit), end)
  const stream: LampReading = online ? { state: simulated ? 'simulated' : 'live', since: null, reason: 'event stream open' } : { state: 'waiting', since: null, reason: 'event stream closed' }
  const words = [...filter.include, ...filter.exclude.map((w) => `!${w}`), ...(filter.sinceS !== null ? [`since:${text.match(/since:(\S+)/i)?.[1] ?? ''}`] : [])]
  const toggle = (source: string) => {
    const has = filter.include.includes(source)
    const next = has ? text.split(/\s+/).filter((w) => w && w.toLowerCase() !== source).join(' ') : `${text.trim()} ${source}`.trim()
    setText(next)
  }

  return (
    <div className="jx jx-events" data-view="events" data-simulated={simulated ? 'true' : undefined}>
      <section className="jx-left" aria-label="Event log">
        <div className="jx-well">
          <TermWell prompt="jarvis console.events" label="Event log" cursor={false}>
            <PartHead tag="SYS" title="Events" stamp={simulated} seed="jarvis.console.events" right={<><AsciiRuler cols={24} /><Lamp reading={stream} showLabel size={12} subject="Event stream" /></>} />
            <div className="jx-filter">
              <label className="jx-ps" htmlFor="jx-filter">filter&gt;</label>
              <input
                id="jx-filter" className="jx-filter-in" value={text} spellCheck={false} autoComplete="off" autoCapitalize="off" maxLength={80}
                placeholder="core !sim since:1h" aria-describedby="jx-filter-say" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && text) { e.preventDefault(); e.stopPropagation(); setText('') } }}
              />
              {text && <ConsoleKey label="Clear" quiet onPress={() => setText('')} />}
            </div>
            <p className="jx-filter-say" id="jx-filter-say" data-problem={filter.problems.length ? 'true' : undefined}>
              {filter.problems.length
                ? <><LampGlyph state="fault" size={12} /> {filter.problems[0]}</>
                : words.length
                  ? <>showing {hits.length} of {all.length}: {words.join(' · ')}</>
                  : <>{all.length} event{all.length === 1 ? '' : 's'}; try a tag such as <code>core</code>, <code>!sim</code> or <code>since:1h</code></>}
            </p>
            <div className="jx-density" data-empty={density === null ? 'true' : undefined}>
              <span>density</span>
              <span className="jx-density-trace" aria-hidden="true">{density ? sparkline(density) : '░'.repeat(24)}</span>
              <span className="jx-sr">{density ? `events over time: ${hits.length} events, oldest left, now right` : 'not enough events for a density trace'}</span>
              <span>{density ? 'now' : '--'}</span>
            </div>
            <ol className="jx-events-list" ref={list} aria-label={`Events, ${shown.length} of ${hits.length} shown, newest last`}>
              {shown.length === 0 && (
                <li className="jx-empty">
                  <span className="jx-tag">[SYS]</span>
                  {all.length === 0 ? 'nothing has happened yet' : 'no event matches this filter'}
                </li>
              )}
              {shown.map((e) => {
                const state = eventLamp(e)
                return (
                  <li key={e.id} className="jx-ev" data-state={state} data-kind={e.kind}>
                    <span className="jx-tag">[{tagWord(e.source)}]</span>
                    <LampGlyph state={state} size={12} className="jx-out-lamp" />
                    <span className="jx-ev-text" title={e.text}>{e.text}</span>
                    {e.sim && <em className="jx-ev-sim">SIMULATED</em>}
                    <time>{clock(e.ts)}</time>
                  </li>
                )
              })}
            </ol>
            <div className="jx-pager">
              <ConsoleKey label="Older" onPress={() => setPage(Math.min(pages - 1, p + 1))} disabledReason={p >= pages - 1 ? 'this is the oldest page' : undefined} keys="PageUp" />
              <span className="jx-dim" aria-live="polite">{hits.length ? `page ${p + 1} of ${pages}` : 'no page'}</span>
              <ConsoleKey label="Newer" onPress={() => setPage(Math.max(0, p - 1))} disabledReason={p <= 0 ? 'this is the newest page' : undefined} keys="PageDown" />
            </div>
          </TermWell>
        </div>
      </section>

      <section className="jx-right" aria-label="Sources">
        <div className="jx-card">
          <PartHead tag="SYS" title="Sources" seed="jarvis.console.sources" />
          {counts.length === 0 ? (
            <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'no event yet' }} subject="Sources" /></p>
          ) : (
            <ul className="jx-sources" aria-label="Events by source, press one to filter">
              {counts.map((c) => (
                <li key={c.source}>
                  <button type="button" className="jx-source" aria-pressed={filter.include.includes(c.source)} onClick={() => toggle(c.source)}>
                    <span className="jx-tag">[{tagWord(c.source)}]</span>
                    <span className="jx-source-bar" role="img" aria-label={`${c.source}: ${c.n} of ${all.length} events`}>
                      <span aria-hidden="true">[{barTrack(c.n / top, 10).fill}{barTrack(c.n / top, 10).empty}]</span>
                      <span className="jx-dim" aria-hidden="true">{c.n}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="jx-card jx-hint">
          <p className="jx-dim"><b>Same list as Alt+L.</b> The stream keeps the latest 80 events; a line marked SIMULATED was generated, not measured. A failed action is a FAULT line with its reason.</p>
        </div>
      </section>
    </div>
  )
}

/** The registered view (shell/views/console-events.view.ts): the store's event stream. */
export default function Events() {
  const live = useEventsLive()
  return <EventsView {...live} />
}
