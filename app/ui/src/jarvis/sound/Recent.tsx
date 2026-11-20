// The Recent plays ledger (Sound's own form, the whole right column): the last five songs typed in this window, one row
// each, in tabular mono. Each row carries the server's own receipt as a lamp (confirmed = LIVE, opened but not confirmed =
// WAITING, failed = FAULT), the time of the answer, where it was sent and what was asked. Plays started by voice or in another
// window are not in it, and the card says so: it is a list of this window's presses, not of everything Windows played.
//
// Empty is ONE designed state, not five placeholder slabs: jury round 2 read the five `--:--` rows as loading. A recessed
// well holds a formed sigil mark, the sentence and the next step; the rows appear only when there are plays.
import { Lamp } from '../../shared/lamp'
import { receiptView, SOURCES } from './model'
import { HISTORY_ROWS, type PlayEntry } from './useSound'
import './sound.css'

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
const sourceLabel = (id: PlayEntry['source']) => SOURCES.find((s) => s.id === id)?.label ?? id

/** A formed mark of the cybersigil grammar (a ledger line under a closed bracket): an empty log, drawn, not written. */
function EmptyMark() {
  return (
    <svg className="sd-empty-mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M5 4H3V20H5M19 4H21V20H19M7 9H17M7 12H14M7 15H11" />
    </svg>
  )
}

export function RecentPlays({ history = [], simulated = false, now }: { history?: PlayEntry[]; simulated?: boolean; now?: number }) {
  const rows = history.slice(0, HISTORY_ROWS)
  return (
    <section className="sd-recent" aria-label="Recent plays" data-card="recent">
      <header className="sd-card-head">
        <h3><span className="sd-tag">[LOG]</span>Recent plays</h3>
        <span className="sd-cap">this window</span>
      </header>
      {rows.length ? (
        <>
          <ol className="sd-plays">
            {rows.map((p, i) => {
              const v = receiptView(p.receipt, simulated)
              return (
                <li key={`${p.at}-${i}`} className="sd-play-row" data-play="">
                  {v && <Lamp reading={{ state: v.state, since: p.at, reason: `${v.text}: ${v.why}` }} showLabel={false} subject="Play" now={now} />}
                  <time dateTime={new Date(p.at).toISOString()}>{clock(p.at)}</time>
                  <span className="sd-play-src">{sourceLabel(p.source)}</span>
                  <span className="sd-play-q">{p.query}</span>
                </li>
              )
            })}
          </ol>
          <p className="sd-note">Songs you typed here. Plays by voice are not listed.</p>
        </>
      ) : (
        <div className="sd-log-empty" data-empty-state="">
          <EmptyMark />
          <p className="sd-log-empty-line">No plays from this window yet</p>
          <p className="sd-log-empty-hint">Type a song to start</p>
        </div>
      )}
    </section>
  )
}
