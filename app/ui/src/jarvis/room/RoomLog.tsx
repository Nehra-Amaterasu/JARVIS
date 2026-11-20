// "What just happened" (A.J02, spec 20.9.2): the room's last lines as a terminal well, each with the [ROM] tag, the time and
// the lamp of what the board said: asked (WAITING), confirmed (LIVE), asked and never reported (FAULT). Lines come only from
// presses made in this window and from the board's answer to them; nothing is replayed from before and nothing is invented.
import { useId, useState } from 'react'
import { LampGlyph, LAMP_WORD } from '../../shared/kit'
import { TermWell } from '../../shared/grammar'
import { clock24, type KeySlot, type LogLine } from './model'
import './room.css'

/** A text ruler with a caret that sweeps it: decoration that says the log is listening. Aria-hidden; still under reduced motion. */
function Ruler() {
  return (
    <span className="jr-ruler" aria-hidden="true">
      {"|''''|''''|''''|''''|''''|''''|''''|''''|"}
      <br /><span className="jr-ruler-caret">^</span>
    </span>
  )
}

const LEGEND = '# on . off ? no report - free'

/** The eight channels as text blocks, from the board's own report: a block on, a dot off, ? no report, - free. */
export function channelStrip(slots: KeySlot[]): string {
  return slots.map((s) => (!s.present ? '-' : s.reported === null ? '?' : s.reported ? '#' : '.')).join(' ')
}

/**
 * Three lines at rest (the channel numbers, the board's strip, the latest event), the whole log once the terminal button is
 * pressed (click, Enter or Space; Escape closes). Ctrl+K is the shell's palette, so the terminal never uses that chord.
 */
export function RoomLog({ lines, max = 4, slots }: { lines: LogLine[]; max?: number; slots?: KeySlot[] }) {
  // one piece of state, flipped by a real button (click, Enter or Space) and closed by Escape; focus alone never opens it,
  // so tabbing past the terminal changes no layout
  const [open, setOpen] = useState(false)
  const wellId = useId()
  // `lines` is newest first (RoomSwitches prepends), so the one line at rest is the latest event
  const shown = lines.slice(0, open ? max : 1)
  return (
    <div className="jr-term" data-open={open ? 'true' : 'false'}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}>
      <button type="button" className="jr-term-toggle" aria-expanded={open} aria-controls={wellId}
        aria-label={open ? 'Show the latest line only' : 'Show the full log of what just happened'} onClick={() => setOpen((o) => !o)} />
      <div id={wellId} className="jr-term-well">
      <TermWell prompt="jarvis room" label="What just happened in the room">
        {slots && (
          <>
            <div className="g-line jr-strip" data-kind="out">[ROM] CH{'  '}1 2 3 4 5 6 7 8</div>
            <div className="g-line jr-strip" data-kind="out" title={LEGEND} aria-label={`Channels by the board's report: ${LEGEND}`}>[ROM]{'     '}{channelStrip(slots)}</div>
            {open && <div className="g-line jr-strip jr-strip-legend" data-kind="out">[ROM] {LEGEND}</div>}
          </>
        )}
        {shown.length === 0 && (
          <div className="g-line jr-log-empty" data-kind="out">[ROM] nothing yet: press a key and the board's answer lands here.</div>
        )}
        {shown.map((l) => (
          <div key={l.id} className="g-line jr-log-line" data-kind="log" data-state={l.state}>
            <span className="jr-log-tag">[ROM]</span> <time>{clock24(l.at)}</time> <span className="jr-log-text">{l.text}</span>{' '}
            <span className="jr-log-lamp"><LampGlyph state={l.state} size={11} /> {LAMP_WORD[l.state]}</span>
          </div>
        ))}
        {!open && <Ruler />}
      </TermWell>
      </div>
    </div>
  )
}
