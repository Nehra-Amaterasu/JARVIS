// "What just happened" (A.J02, spec 20.9.2): the room's last lines as a terminal well, each with the [ROM] tag, the time and
// the lamp of what the board said: asked (WAITING), confirmed (LIVE), asked and never reported (FAULT). Lines come only from
// presses made in this window and from the board's answer to them; nothing is replayed from before and nothing is invented.
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

/** The eight channels as text blocks, from the board's own report: a block on, a dot off, ? no report, - free. */
export function channelStrip(slots: KeySlot[]): string {
  return slots.map((s) => (!s.present ? '-' : s.reported === null ? '?' : s.reported ? '#' : '.')).join(' ')
}

export function RoomLog({ lines, max = 6, slots }: { lines: LogLine[]; max?: number; slots?: KeySlot[] }) {
  const shown = lines.slice(0, max)
  return (
    <TermWell prompt="jarvis room" label="What just happened in the room">
      {slots && (
        <>
          <div className="g-line jr-strip" data-kind="out">[ROM] CH{'  '}1 2 3 4 5 6 7 8</div>
          <div className="g-line jr-strip" data-kind="out" aria-label="Channels by the board's report">[ROM]{'     '}{channelStrip(slots)}</div>
          <div className="g-line jr-strip jr-strip-legend" data-kind="out">[ROM] # on . off ? no report - free</div>
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
      <Ruler />
    </TermWell>
  )
}
