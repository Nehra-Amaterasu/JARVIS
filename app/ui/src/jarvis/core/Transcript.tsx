// The transcript strata (spec 20.9.1): each turn is a terminal row inside a TermWell, `[YOU]` or `[JRV]`, its time,
// its lamp, its text, and a 12 px margin sigil drawn from the turn's intent class (a guess from the words, so it is
// decoration with a name, never printed as a fact). The newest FIT turns stay on screen; older ones go to Earlier.
//
// Keys, only while focus is inside the list (WCAG 2.1.4): J and K (or Down and Up) move between turns, Home and End
// jump, F opens the flag dock on the focused turn, Esc closes it. The dock is docked over the prompt line, so opening
// it never reflows the rows. The four flags are the legacy page's: Good, Wrong, Slow for a reply, Misheard for you.
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { Turn } from '../../lib/api'
import { Lamp, LAMP_SPECS, showsNumber, type LampReading } from '../../shared/lamp'
import { Sigil, TermWell } from '../../shared/grammar'
import { HandoffChip } from '../handoff'
import { INTENT_WORD, cleanText, handoffOf, intentOf, tagOf, turnLamp, turnTime } from './model'
import type { Verdict } from './useCoreLive'

export interface TranscriptProps {
  /** The fitted turns, oldest first. */
  turns: Turn[]
  /** All turns, to find the question a reply answered (for Teach). */
  all: Turn[]
  running: boolean
  /** A fixture: every LIVE lamp is drawn SIMULATED. */
  simulated?: boolean
  notifyPresent: boolean
  onFlag?: (turn: Turn, verdict: Verdict, expected?: string, question?: string, teach?: boolean) => Promise<string>
  onHandoff?: (place: { product: 'ww'; section: string; view: string }) => void
  /** Rendered under the rows, above the prompt (the Earlier key). */
  footer?: ReactNode
}

const asSim = (r: LampReading, sim: boolean): LampReading => (sim && r.state === 'live' ? { ...r, state: 'simulated', reason: 'fixture turn, not a recording' } : r)

export function TurnRow({ turn, simulated = false, notifyPresent, onHandoff, focusable, tabIndex, onFocus }: {
  turn: Turn
  simulated?: boolean
  notifyPresent: boolean
  onHandoff?: TranscriptProps['onHandoff']
  focusable?: boolean
  tabIndex?: number
  onFocus?: () => void
}) {
  const tag = tagOf(turn)
  const lamp = asSim(turnLamp(turn), simulated)
  const text = cleanText(turn.text)
  const intent = intentOf(text)
  const h = handoffOf(turn)
  const secs = tag === 'JRV' && typeof turn.seconds === 'number' && showsNumber(lamp.state) ? `${turn.seconds.toFixed(1)} s` : null
  return (
    <li
      className="jc-turn" data-tag={tag} data-state={lamp.state} data-turn={turn.id}
      tabIndex={focusable ? tabIndex : undefined} onFocus={onFocus}
      aria-label={`${tag === 'YOU' ? 'You' : 'JARVIS'} at ${turnTime(turn.t)}: ${text || 'no text yet'}. ${LAMP_SPECS[lamp.state].label}${secs ? `, reply took ${secs}` : ''}`}
    >
      <span className="jc-turn-glyph" title={`intent guess: ${INTENT_WORD[intent]}`}>
        <Sigil seed={`jarvis.core.intent.${intent}`} size={16} fold={intent === 'command' ? 4 : intent === 'memory' ? 6 : intent === 'ask' ? 2 : 8} />
      </span>
      <div className="jc-turn-head" aria-hidden="true">
        <b className="jc-tag">[{tag}]</b>
        <time className="jc-turn-time">{turnTime(turn.t)}</time>
        <Lamp reading={lamp} showLabel={false} />
        {secs && <span className="jc-turn-secs">{secs}</span>}
        {!showsNumber(lamp.state) && <span className="jc-turn-why">{lamp.reason}</span>}
      </div>
      <p className="jc-turn-text" aria-hidden="true">{text || '…'}</p>
      {h && (
        <div className="jc-turn-hand">
          <HandoffChip product="ww" target={h.target} label={h.label} notifyPresent={notifyPresent} onOpen={onHandoff} />
        </div>
      )}
    </li>
  )
}

function FlagDock({ turn, question, onFlag, onClose }: {
  turn: Turn
  question: string
  onFlag: NonNullable<TranscriptProps['onFlag']>
  onClose: () => void
}) {
  const tag = tagOf(turn)
  const [asking, setAsking] = useState<Verdict | null>(null)
  const [expected, setExpected] = useState('')
  const [teach, setTeach] = useState(true)
  const [said, setSaid] = useState<string | null>(null)
  const first = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const fieldId = useId()
  useEffect(() => { first.current?.focus() }, [])
  useEffect(() => { if (asking) field.current?.focus() }, [asking])
  const send = async (v: Verdict, exp = '') => {
    try {
      setSaid(await onFlag(turn, v, exp, question, teach))
      setAsking(null)
    } catch (e) {
      setSaid(`not flagged: ${(e as Error).message}`)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (asking) void send(asking, expected)
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }
  const canFlag = turn.done && !!(turn as Turn & { session?: string }).session
  return (
    <form className="jc-dock" onSubmit={submit} onKeyDown={key} aria-label={`Flag the ${tag === 'YOU' ? 'line you said' : 'reply'} at ${turnTime(turn.t)}`}>
      <span className="jc-dock-ps" aria-hidden="true">flag&gt; [{tag}] {turnTime(turn.t)}</span>
      {said ? (
        <span className="jc-dock-said" role="status">{said}</span>
      ) : !canFlag ? (
        <span className="jc-dock-said" role="status">{turn.done ? 'not saved to a transcript, so it cannot be flagged' : 'still writing'}</span>
      ) : asking ? (
        <>
          <label className="jc-sr" htmlFor={fieldId}>{tag === 'JRV' ? 'What should he have said? (optional)' : 'What did you actually say? (optional)'}</label>
          <input id={fieldId} ref={field} className="jc-dock-field" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder={tag === 'JRV' ? 'what he should have said' : 'what you said'} />
          {tag === 'JRV' && expected.trim() && (
            <label className="jc-dock-teach"><input type="checkbox" checked={teach} onChange={(e) => setTeach(e.target.checked)} />Teach</label>
          )}
          <button type="submit" className="jc-key jc-key-sm">Flag</button>
        </>
      ) : tag === 'JRV' ? (
        <>
          <button ref={first} type="button" className="jc-key jc-key-sm" onClick={() => void send('good')}>Good</button>
          <button type="button" className="jc-key jc-key-sm" onClick={() => setAsking('wrong')}>Wrong</button>
          <button type="button" className="jc-key jc-key-sm" onClick={() => void send('slow')}>Slow</button>
        </>
      ) : (
        <button ref={first} type="button" className="jc-key jc-key-sm" onClick={() => setAsking('misheard')}>Misheard</button>
      )}
      <button ref={said || !canFlag ? first : undefined} type="button" className="jc-key jc-key-sm jc-dock-x" onClick={onClose}>Close</button>
    </form>
  )
}

export function Transcript({ turns, all, running, simulated = false, notifyPresent, onFlag, onHandoff, footer }: TranscriptProps) {
  const list = useRef<HTMLOListElement>(null)
  const [cur, setCur] = useState(Math.max(0, turns.length - 1))
  const [dock, setDock] = useState<number | null>(null)
  const idx = Math.min(cur, Math.max(0, turns.length - 1))
  const focusRow = (i: number) => {
    const rows = list.current?.querySelectorAll<HTMLElement>('.jc-turn')
    const n = rows?.length ?? 0
    if (!n) return
    const j = Math.max(0, Math.min(n - 1, i))
    setCur(j)
    rows![j].focus()
  }
  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === 'j' || k === 'J' || k === 'ArrowDown') { e.preventDefault(); focusRow(idx + 1) }
    else if (k === 'k' || k === 'K' || k === 'ArrowUp') { e.preventDefault(); focusRow(idx - 1) }
    else if (k === 'Home') { e.preventDefault(); focusRow(0) }
    else if (k === 'End') { e.preventDefault(); focusRow(turns.length - 1) }
    else if ((k === 'f' || k === 'F') && onFlag && turns[idx]) { e.preventDefault(); setDock(turns[idx].id) }
  }
  const docked = dock === null ? null : turns.find((t) => t.id === dock) ?? null
  const question = (t: Turn) => {
    const i = all.findIndex((x) => x.id === t.id)
    return t.role === 'jarvis' ? all.slice(0, Math.max(0, i)).reverse().find((p) => p.role === 'you')?.text ?? '' : ''
  }
  const closeDock = () => {
    setDock(null)
    requestAnimationFrame(() => focusRow(idx))
  }
  return (
    <div className="jc-strata" data-dock={docked ? 'open' : undefined}>
      <TermWell prompt="jarvis core.talk" label="Transcript" cursor={!docked}>
        {turns.length === 0 ? (
          <div className="jc-strata-empty">
            {/* the well's emblem: the Core's own generic sigil, decoration with a name, never a reading */}
            <div className="jc-strata-mark" aria-hidden="true"><Sigil seed="jarvis.core.talk" size={88} fold={8} /></div>
            <div className="g-line" data-kind="out">[JRV] {running ? 'listening. Say "Hey Jarvis", or type below.' : 'asleep. Wake JARVIS, or type.'}</div>
            <div className="g-line">no turns in this run yet</div>
          </div>
        ) : (
          <ol ref={list} className="jc-turns" aria-label={`Last ${turns.length} turns. J and K move, F flags the focused turn`} onKeyDown={onKey}>
            {turns.map((t, i) => (
              <TurnRow
                key={t.id} turn={t} simulated={simulated} notifyPresent={notifyPresent} onHandoff={onHandoff}
                focusable tabIndex={i === idx ? 0 : -1} onFocus={() => setCur(i)}
              />
            ))}
          </ol>
        )}
        {footer}
        {docked && onFlag && <FlagDock key={docked.id} turn={docked} question={question(docked)} onFlag={onFlag} onClose={closeDock} />}
      </TermWell>
    </div>
  )
}
