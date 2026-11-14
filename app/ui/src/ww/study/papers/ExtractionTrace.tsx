// ExtractionTrace (package Y01, spec 20.7.2): the log of one extraction run, drawn as a terminal frame. REAL EVENTS ONLY: the
// component prints exactly the events it is given, one line each, and nothing else (no "working..." filler, no invented
// progress). With no events it says there is no run, not that one is happening. Each line carries its own lamp state, so a
// fixture line reads SIMULATED and a line that waits on the local model reads WAITING.
import { TermLine, TermWell } from '../../../shared/grammar'
import type { TraceEvent } from '../ports'

export interface ExtractionTraceProps {
  events: readonly TraceEvent[]
  /** Lines kept on screen (the newest). The rest stay in the list the caller holds. Default 6. */
  max?: number
  label?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
/** The clock text of an event: the hour and minute it happened, local. */
export const eventClock = (at: number) => {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function ExtractionTrace({ events, max = 6, label = 'Extraction trace' }: ExtractionTraceProps) {
  const shown = events.slice(-max)
  const hidden = events.length - shown.length
  return (
    <div className="pp-trace" data-component="extraction-trace" data-count={events.length}>
      <TermWell prompt="ww study" label={label} cursor={false}>
        {events.length === 0 && <TermLine>no run yet: the trace lists what the reader did, and nothing else</TermLine>}
        {hidden > 0 && <TermLine>{`... ${hidden} earlier ${hidden === 1 ? 'event' : 'events'}`}</TermLine>}
        {shown.map((e) => (
          <TermLine key={e.id} tag={e.state}>{`${eventClock(e.at)} ${e.text}`}</TermLine>
        ))}
      </TermWell>
    </div>
  )
}
