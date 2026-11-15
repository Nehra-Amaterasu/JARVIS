// Memory / Beliefs, the Belief board (spec 20.16.3, parity M02 and M03). Two terminal wells of `[MEM]` rows.
//
//   Is this true?   what JARVIS inferred and wants confirmed: the claim, where it came from, how sure it is, and the keys
//                   True, Used to be, Wrong and Correct. A Wrong row is struck in place, never hidden. Three sockets show
//                   how many questions are on the board (at most three at a time); a socket with no question is dashed.
//   Learned lately  what JARVIS kept from recent chats, Keep or Wrong each (Wrong takes effect at once: it is not used again).
//
// Every row carries a chip of origin (RULE, MODEL or HAND, model.ts originOf) and an amber "unconfirmed" lamp until it is
// answered, because an inference is not a fact. Nothing here is a fixture unless the port says so, and then the stamp says it.
import { useState } from 'react'
import { Lamp, type LampReading } from '../../shared/lamp'
import { ago, kindLabel, type LearnedItem, type Verdict } from '../../lib/learned'
import { useLoad } from './hooks'
import { originOf } from './model'
import type { BeliefPort, BeliefVerdict } from './port'
import type { Belief, Loadable, Origin } from './types'
import './memory.css'

export const BOARD_SOCKETS = 3

const unconfirmed: LampReading = { state: 'waiting', since: null, reason: 'unconfirmed: an inference is not a fact' }

export function OriginChip({ o }: { o: Origin }) {
  const word = o === 'RULE' ? 'written by a rule' : o === 'MODEL' ? 'inferred by the local model' : 'confirmed or typed by you'
  return <span className="jm-origin" data-o={o} title={word} aria-label={word}>{o}</span>
}

type Answered = { verdict: BeliefVerdict; correction?: string }

function BeliefRow({ b, done, busy, simulated, onAnswer }: { b: Belief; done: Answered | undefined; busy: boolean; simulated: boolean; onAnswer: (v: BeliefVerdict, correction?: string) => void }) {
  const [correcting, setCorrecting] = useState(false)
  const [text, setText] = useState('')
  const lamp: LampReading = !done ? unconfirmed
    : done.verdict === 'confirmed' ? { state: simulated ? 'simulated' : 'live', since: null, reason: 'confirmed by you' }
      : { state: 'waiting', since: null, reason: done.verdict === 'rejected' ? (done.correction ? 'corrected, the old claim is never surfaced again' : 'wrong, never surfaced again') : 'kept as the past, not the present' }
  const struck = done?.verdict === 'rejected'
  return (
    <li className="jm-row-b" data-state={done ? done.verdict : 'open'} data-testid="belief-row">
      <div className="jm-b-main">
        <p className="jm-b-claim" data-struck={struck ? 'true' : undefined}><span className="jm-tag">[MEM]</span> I think: {b.claim}</p>
        <p className="jm-b-meta jm-dim">
          <OriginChip o={originOf({ source: b.source, status: done?.verdict === 'confirmed' ? 'confirmed' : 'unconfirmed' })} />
          <span>{b.category}</span><span>{b.era}</span><span>from {b.source}{b.support > 1 ? `, ${b.support} messages agree` : ''}</span>
          <span className="jm-conf" aria-label={`${Math.round(b.confidence * 100)} percent sure`}><i style={{ width: `${Math.round(b.confidence * 100)}%` }} /></span>
          <span className="jm-mono">{Math.round(b.confidence * 100)}%</span>
        </p>
        <p className="jm-b-state"><Lamp reading={lamp} subject="Belief" />{done?.correction && <span className="jm-dim"> now: {done.correction}</span>}</p>
      </div>
      {!done && (
        <div className="jm-b-keys" role="group" aria-label={`Answer: ${b.claim}`}>
          <button type="button" className="jm-key" onClick={() => onAnswer('confirmed')} aria-disabled={busy || undefined} data-testid="belief-true">True</button>
          <button type="button" className="jm-key" onClick={() => onAnswer('outdated')} aria-disabled={busy || undefined}>Used to be</button>
          <button type="button" className="jm-key" onClick={() => onAnswer('rejected')} aria-disabled={busy || undefined} data-testid="belief-wrong">Wrong</button>
          <button type="button" className="jm-key jm-key-quiet" onClick={() => setCorrecting((c) => !c)} aria-expanded={correcting}>Correct</button>
        </div>
      )}
      {!done && correcting && (
        <form className="jm-b-correct" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onAnswer('rejected', text.trim()) }}>
          <label className="jm-sr" htmlFor={`jm-c-${b.id}`}>What is actually true</label>
          <input id={`jm-c-${b.id}`} className="jm-field" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What is actually true?" autoComplete="off" />
          <button type="submit" className="jm-key jm-key-primary" aria-disabled={!text.trim() || undefined}>Save</button>
        </form>
      )}
    </li>
  )
}

function LearnedRow({ m, done, busy, now, onJudge }: { m: LearnedItem; done: Verdict | undefined; busy: boolean; now: number; onJudge: (v: Verdict) => void }) {
  const lamp: LampReading = !done ? unconfirmed
    : done === 'keep' ? { state: 'live', since: null, reason: 'kept: JARVIS goes on using it' } : { state: 'waiting', since: null, reason: 'wrong: JARVIS will not use it again' }
  return (
    <li className="jm-row-b jm-row-l" data-state={done ?? 'open'} data-testid="learned-row">
      <div className="jm-b-main">
        <p className="jm-b-claim" data-struck={done === 'wrong' ? 'true' : undefined}><span className="jm-tag">[MEM]</span> {m.text}</p>
        <p className="jm-b-meta jm-dim">
          <OriginChip o={originOf({ by: m.by, kind: m.kind })} /><span>{kindLabel(m.kind)}</span><span>{ago(m.first_seen, now)}</span><span className="jm-mono">{Math.round(m.confidence * 100)}%</span>
          {m.support > 1 && <span>said {m.support} times</span>}
        </p>
        <p className="jm-b-state"><Lamp reading={lamp} subject="Learned fact" /></p>
      </div>
      {!done && (
        <div className="jm-b-keys" role="group" aria-label={`Judge: ${m.text}`}>
          <button type="button" className="jm-key" onClick={() => onJudge('keep')} aria-disabled={busy || undefined} data-testid="learned-keep">Keep</button>
          <button type="button" className="jm-key" onClick={() => onJudge('wrong')} aria-disabled={busy || undefined} data-testid="learned-wrong">Wrong</button>
        </div>
      )}
    </li>
  )
}

export interface BeliefsViewProps {
  port: BeliefPort
  /** Epoch seconds for "5 h ago" (a fixture passes a fixed one). */
  now?: number
}

export function BeliefsView({ port, now }: BeliefsViewProps) {
  const qs = useLoad<Belief[]>(() => port.questions(BOARD_SOCKETS), null)
  const lr = useLoad(() => port.learned(4), null)
  const cf = useLoad(() => port.confirmed(5), null)
  const [answered, setAnswered] = useState<Record<string, Answered>>({})
  const [judged, setJudged] = useState<Record<string, Verdict>>({})
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<{ ok: boolean; text: string } | null>(null)
  const [clock] = useState(() => Math.floor(Date.now() / 1000))
  const nowS = now ?? clock

  const answer = async (b: Belief, verdict: BeliefVerdict, correction?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await port.answer(b.id, verdict, correction)
      setAnswered((a) => ({ ...a, [b.id]: { verdict, correction } }))
      if (verdict === 'confirmed') cf.reload()
      setSay({ ok: true, text: verdict === 'confirmed' ? 'Confirmed: JARVIS will state it as fact.' : verdict === 'rejected' ? 'Marked wrong: never surfaced again.' : 'Kept as the past, not the present.' })
    } catch (e) { setSay({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const judge = async (m: LearnedItem, v: Verdict) => {
    if (busy) return
    setBusy(true)
    try {
      await port.review(m.id, v)
      setJudged((j) => ({ ...j, [m.id]: v }))
      setSay({ ok: true, text: v === 'keep' ? 'Kept: JARVIS goes on using it.' : 'Marked wrong: JARVIS will not use it again.' })
    } catch (e) { setSay({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const more = () => { setAnswered({}); qs.reload() }
  const items = qs.v.data ?? []
  const open = items.filter((b) => !answered[b.id]).length
  const learned = lr.v.data
  const moved = Object.values(judged)
  const pending = learned ? Math.max(0, learned.pending - moved.length) : null
  const qLamp: LampReading = qs.v.state === 'fault' ? { state: 'fault', since: null, reason: qs.v.error }
    : qs.v.state === 'loading' ? { state: 'waiting', since: null, reason: 'reading the board' } : { state: port.simulated ? 'simulated' : 'live', since: null, reason: port.simulated ? 'fixture' : 'from the store' }

  return (
    <div className="jm jm-two" data-view="beliefs" data-simulated={port.simulated ? 'true' : undefined}>
      <section className="jm-well jm-well-main" aria-label="Is this true?" data-scene="immersive">
        <header className="jm-well-head">
          <span className="jm-tag">[MEM]</span><h2>Is this true?</h2><Lamp reading={qLamp} subject="Board" />
          <span className="jm-sockets" role="img" aria-label={`${items.length} of ${BOARD_SOCKETS} questions on the board`} data-testid="sockets">
            {Array.from({ length: BOARD_SOCKETS }, (_, i) => <i key={i} data-on={i < items.length ? 'true' : undefined} data-done={items[i] && answered[items[i].id] ? 'true' : undefined} />)}
          </span>
        </header>
        <p className="jm-lead">What JARVIS inferred and wants you to confirm. An inference is not a fact until you say so; at most three questions are asked at a time.</p>
        {qs.v.state === 'fault' && <p className="jm-note" role="alert">The board did not load ({qs.v.error}). Nothing is shown as confirmed.</p>}
        {qs.v.state === 'ready' && items.length === 0 && (
          <div className="jm-empty-in"><pre className="jm-ascii" aria-hidden="true">{'  ○  ○  ○\n [   ][   ][   ]\n  nothing to ask'}</pre><p className="jm-muted">Nothing to confirm. JARVIS has no open question.</p></div>
        )}
        <ul className="jm-b-list">
          {items.map((b) => <BeliefRow key={b.id} b={b} done={answered[b.id]} busy={busy} simulated={port.simulated} onAnswer={(v, c) => void answer(b, v, c)} />)}
        </ul>
        {qs.v.state === 'ready' && items.length > 0 && open === 0 && (
          <div className="jm-row"><button type="button" className="jm-key" onClick={more} data-testid="ask-more">Ask the next</button></div>
        )}
        <h3 className="jm-h jm-fact-h">Stated as fact{cf.v.data ? ` · ${cf.v.data.length}` : ''}</h3>
        {cf.v.state === 'fault' && <p className="jm-note" role="alert">The confirmed list did not load ({cf.v.error}).</p>}
        {cf.v.state === 'ready' && cf.v.data.length === 0 && <p className="jm-muted">Nothing is stated as fact yet. Answer True above and it appears here.</p>}
        <ul className="jm-cf-list" data-testid="confirmed-list">
          {cf.v.data?.map((c) => (
            <li key={c.id}><OriginChip o="HAND" /><span className="jm-cf-t">{c.claim}</span><span className="jm-dim jm-mono">{c.category}</span></li>
          ))}
        </ul>
      </section>

      <section className="jm-well jm-well-side" aria-label="Learned lately" data-scene="immersive">
        <header className="jm-well-head">
          <span className="jm-tag">[MEM]</span><h2>Learned lately</h2>
          <span className="jm-mono jm-dim" data-testid="learned-count">{learned ? `${pending} to check · ${learned.kept + moved.filter((v) => v === 'keep').length} kept · ${learned.wrong + moved.filter((v) => v === 'wrong').length} wrong` : lr.v.state === 'fault' ? 'no reading' : '…'}</span>
        </header>
        <p className="jm-lead">What JARVIS kept from recent chats. Wrong takes effect at once.</p>
        {lr.v.state === 'fault' && <p className="jm-note" role="alert">Learned memory did not answer ({lr.v.error}).</p>}
        {learned && learned.items.length === 0 && <p className="jm-muted">Nothing new to check. What JARVIS learns from your chats shows up here.</p>}
        <ul className="jm-b-list">
          {learned?.items.map((m) => <LearnedRow key={m.id} m={m} done={judged[m.id]} busy={busy} now={nowS} onJudge={(v) => void judge(m, v)} />)}
        </ul>
      </section>
      {say && <p className={say.ok ? 'jm-toast' : 'jm-toast jm-fault'} role="status" data-testid="board-say">{say.text}</p>}
    </div>
  )
}

export type { Loadable }
