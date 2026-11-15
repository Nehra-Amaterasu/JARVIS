/**
 * Focus > Drill, the new face (A.Y02, 20.7.7): one question at a time with honest feedback and calm recovery. The question Panel on
 * the left (the stem, the answer entry, the result); on the right the progress dots, the topics touched, a small telemetry rail
 * (elapsed minutes, hints logged, the Pause key) and the Park shelf; under both, one 24 px terminal strip that changes only on a
 * real event.
 *
 * The rules are in model.ts, pure, and tested there: a hint reveal is logged and lowers nothing; a miss says "Not yet. Worked answer
 * below" in the same ink as everything else; the set ends with counts only. The questions and the writes go through the FocusPort,
 * so the classic cards (adapters/legacyBank) and the engine's store arrive behind the same type. Keys: Enter checks, j and k step,
 * h opens the next hint rung, s skips, x parks a thought, p pauses, e ends the set.
 * No requestAnimationFrame is used anywhere: the one clock is a timeout per minute, and it stops while paused or ended.
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import { Button, Chip, Field, Lamp, PrimaryButton, Skeleton, TelemetryRail, type RailRow } from '../../shared/kit'
import { DrillDots } from './DrillDots'
import { ParkField } from './ParkField'
import { counts, countsLine, current, initialState, MAX_RUNGS, reduce, weekdayOf, type Act, type DrillState } from './model'
import { activeFocusPort, type DrillQuestion, type DrillSet, type FocusPort } from './ports'
import { goFocus, goPapers, type FocusView } from './nav'
import './adapters'
import './views/focus-views.css'

/** One timeout per whole minute while running; stops while paused, ended or hidden by a fixed value (the gallery draws a still). */
export function useElapsedMin(running: boolean, fixed?: number): number {
  const acc = useRef(0)
  const since = useRef<number | null>(null)
  const [, bump] = useState(0)
  useEffect(() => {
    if (fixed !== undefined || !running) return
    since.current = Date.now()
    let id = 0
    const arm = () => {
      const total = acc.current + (Date.now() - (since.current ?? Date.now()))
      id = window.setTimeout(() => { bump((n) => n + 1); arm() }, 60_000 - (total % 60_000))
    }
    arm()
    return () => {
      window.clearTimeout(id)
      acc.current += Date.now() - (since.current ?? Date.now())
      since.current = null
    }
  }, [running, fixed])
  if (fixed !== undefined) return fixed
  const total = acc.current + (since.current !== null ? Date.now() - since.current : 0)
  return Math.floor(total / 60_000)
}

export interface DrillProps {
  port?: FocusPort
  /** The gallery and the tests start from a prepared state; a real set always starts from its first question. */
  initial?: DrillState
  /** A still reading of the elapsed minutes (the gallery); without it the clock runs. */
  elapsedMin?: number
  onGo?: (to: FocusView | 'papers') => void
}

export function Drill({ port, initial, elapsedMin, onGo }: DrillProps) {
  const p = port ?? activeFocusPort()
  const [set, setSet] = useState<DrillSet | null>(initial ? { title: 'set', state: 'simulated', questions: initial.qs } : null)
  useEffect(() => {
    if (initial) return
    let live = true
    void p.loadSet().then((s) => { if (live) setSet(s) })
    return () => { live = false }
  }, [p, initial])
  if (!set) return <div className="fv dr-wait"><Skeleton /></div>
  if (set.questions.length === 0) return <DrillEmpty set={set} onGo={onGo} />
  return <DrillBody set={set} port={p} initial={initial} elapsedMin={elapsedMin} onGo={onGo} />
}

function go(onGo: DrillProps['onGo'], to: FocusView | 'papers') {
  if (onGo) return onGo(to)
  if (to === 'papers') goPapers()
  else goFocus(to)
}

/** Nothing queued: an ASCII frame, the reason in words, and one button to the desk. Never an invented question. */
function DrillEmpty({ set, onGo }: { set: DrillSet; onGo: DrillProps['onGo'] }) {
  return (
    <section className="fv dr dr-empty" aria-label="Drill">
      <div className="dr-empty-in">
        <pre className="dr-ascii" aria-hidden="true">{'+----------------------+\n|                      |\n|    Nothing queued    |\n|                      |\n+----------------------+'}</pre>
        <p className="dr-empty-title" role="status">{set.title}</p>
        <p className="dr-empty-why"><Lamp state={set.state} reason={set.reason} /><span className="dr-empty-reason">{set.reason}</span></p>
        <div className="dr-empty-act"><Button size="lg" onClick={() => go(onGo, 'papers')}>Open the paper desk</Button></div>
      </div>
      <p className="dr-strip" aria-live="off">{'> nothing queued'}</p>
    </section>
  )
}

function DrillBody({ set, port, initial, elapsedMin, onGo }: { set: DrillSet; port: FocusPort } & Pick<DrillProps, 'initial' | 'elapsedMin' | 'onGo'>) {
  const [s, dispatch] = useReducer(reduce, undefined, () => initial ?? initialState(set.questions, set.title.toLowerCase()))
  const [back, setBack] = useState<Record<string, string | undefined>>({})
  const [parkOpen, setParkOpen] = useState(false)
  const root = useRef<HTMLElement>(null)
  const parkKey = useRef<HTMLButtonElement>(null)
  const mins = useElapsedMin(!s.paused && !s.ended, elapsedMin)
  const q = current(s)
  const r = q ? s.res[q.id] : undefined
  const c = counts(s)

  /** One way in for every action: the pure reducer decides; a newly settled question is handed to the port once. */
  const apply = (a: Act) => {
    const was = q ? s.res[q.id] : undefined
    const next = reduce(s, a)
    dispatch(a)
    const now = q ? next.res[q.id] : undefined
    if (q && now && !was) {
      void port.record({ questionId: q.id, result: now.state, hintsUsed: now.hints, shown: now.shown, markedBy: now.markedBy, marks: now.marks, at: Date.now() })
        .then((x) => { if (x && x.nextOn) setBack((b) => ({ ...b, [q.id]: x.nextOn })) })
    }
  }
  const file = (text: string) => { void port.park(text).then((x) => dispatch({ t: 'park', text, stored: x.stored })) }
  const stepOrEnd = () => (s.i >= s.qs.length - 1 ? apply({ t: 'end' }) : apply({ t: 'step', d: 1 }))

  // keys: not while a field or a button holds the focus, so typing an answer and pressing Space on a control stay ordinary
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || s.ended) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === 'Enter') {
        if (t && /^(BUTTON|A|SUMMARY)$/.test(t.tagName)) return
        if (!q) return
        e.preventDefault()
        if (r) stepOrEnd()
        else apply({ t: 'check' })
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'j') apply({ t: 'step', d: 1 })
      else if (k === 'k') apply({ t: 'step', d: -1 })
      else if (k === 'h') apply({ t: 'hint' })
      else if (k === 's') apply({ t: 'skip' })
      else if (k === 'p') apply({ t: 'pause', on: !s.paused })
      else if (k === 'e') apply({ t: 'end' })
      else if (k === 'x') { e.preventDefault(); setParkOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const topics = [...new Set(s.qs.filter((x) => s.res[x.id]).map((x) => x.topic))]
  const rungs = q ? s.rungs[q.id] ?? 0 : 0
  const rail: RailRow[] = [
    { id: 'elapsed', label: 'Elapsed', value: `${mins} min`, state: 'live' },
    { id: 'hints', label: 'Hints logged', value: s.hintLog.length, state: 'live' },
    { id: 'pause', label: s.paused ? 'Held. Resume (p)' : 'Pause (p)', value: s.paused ? 'held' : 'running', state: 'live', onPress: () => apply({ t: 'pause', on: !s.paused }) },
  ]

  if (s.ended) {
    return (
      <section className="fv dr" aria-label="Drill" data-phase="end" ref={root}>
        <div className="dr-main">
          <article className="dr-q dr-end" aria-label="Set finished">
            <p className="dr-kick">Set finished{s.early ? ', ended early' : ''}</p>
            <p className="dr-counts" role="status">{countsLine(c)}</p>
            <p className="dr-sub">
              {s.hintLog.length ? `${s.hintLog.length} hint${s.hintLog.length === 1 ? '' : 's'} opened and logged. They changed no count. ` : ''}
              {c.skipped ? `${c.skipped} skipped. ` : ''}
              {s.parked.length ? `${s.parked.length} thought${s.parked.length === 1 ? '' : 's'} parked.` : ''}
            </p>
            <div className="dr-actions">
              <PrimaryButton claimId="drill-again" rank="workspace" size="lg" when={c.shelf > 0} disabledReason={c.shelf ? undefined : 'Nothing is on the shelf.'}
                onClick={() => apply({ t: 'again' })}>{`Go again on the shelf (${c.shelf})`}</PrimaryButton>
              <Button size="lg" onClick={() => go(onGo, 'start')}>Done</Button>
            </div>
            <p className="dr-fine">Done has no penalty. Nothing here is a grade.</p>
          </article>
          <aside className="dr-rail" aria-label="This set">
            <DrillDots qs={s.qs} res={s.res} current={-1} onJump={() => {}} early={s.early} />
          </aside>
        </div>
        <p className="dr-strip" aria-live="off">{s.strip}</p>
      </section>
    )
  }

  const last = s.i >= s.qs.length - 1
  const rungText = q ? (rungs >= MAX_RUNGS(q) ? 'worked answer open' : `hint ${rungs} of ${MAX_RUNGS(q) - 1} open`) : ''
  return (
    <section className="fv dr" aria-label="Drill" data-phase={r ? 'checked' : 'ask'} ref={root}>
      <div className="dr-main">
        <article className="dr-q" aria-label={`Question ${s.i + 1} of ${s.qs.length}`}>
          <header className="dr-head">
            <p className="dr-kick">Question {s.i + 1} of {s.qs.length}</p>
            <Chip>{q?.topic ?? ''}</Chip>
            <span className="dr-lamp"><Lamp state={set.state} reason={set.reason} /></span>
          </header>
          {q && (
            <>
              <div className="dr-body">
                <p className="dr-stem" id="dr-stem">{q.stem}</p>
                <Answer q={q} s={s} apply={apply} onEnter={() => (r ? stepOrEnd() : apply({ t: 'check' }))} />
                <Feedback q={q} s={s} r={r} nextOn={back[q.id]} />
              </div>
              <div className="dr-actions">
                {r ? (
                  <PrimaryButton claimId="drill-next" rank="workspace" size="lg" onClick={stepOrEnd}>{last ? 'Finish set' : 'Next question'}</PrimaryButton>
                ) : q.kind === 'recall' && s.revealed[q.id] ? (
                  <>
                    <PrimaryButton claimId="drill-had" rank="workspace" size="lg" onClick={() => apply({ t: 'mark', ok: true })}>I had it</PrimaryButton>
                    <Button size="lg" onClick={() => apply({ t: 'mark', ok: false })}>Not yet</Button>
                  </>
                ) : (
                  <PrimaryButton claimId="drill-check" rank="workspace" size="lg"
                    disabledReason={q.kind === 'numeric' && !(s.answers[q.id] ?? '').trim() ? 'Type an answer first.' : undefined}
                    onClick={() => apply({ t: 'check' })}>{q.kind === 'recall' ? 'Show the answer' : q.kind === 'written' ? 'Done marking' : 'Check'}</PrimaryButton>
                )}
                {!r && <Button size="lg" onClick={() => apply({ t: 'hint' })} disabledReason={rungs >= MAX_RUNGS(q) ? 'The worked answer is already open.' : undefined}>Hint (h)</Button>}
                {!r && <Button size="lg" onClick={() => apply({ t: 'skip' })}>Skip (s)</Button>}
              </div>
              <p className="dr-fine" aria-live="off">
                {rungs ? `${rungText}. A hint is logged and lowers nothing; the worked answer moves this one to the shelf.` : 'Enter checks. Esc leaves the field; then j and k step, h opens a hint, x parks a thought.'}
              </p>
            </>
          )}
        </article>
        <aside className="dr-rail" aria-label="This set">
          <DrillDots qs={s.qs} res={s.res} current={s.i} onJump={(i) => apply({ t: 'jump', i })} />
          <p className="dr-topics" aria-label="Topics touched">
            {topics.length ? topics.map((t) => <Chip key={t}>{t}</Chip>) : <span className="dr-none">No topic touched yet</span>}
          </p>
          <TelemetryRail label="This set" rows={rail} />
          <p className="dr-rail-state"><Lamp state="live" reason="this window's clock and this set's log" /></p>
          <div className="dr-park">
            <p className="dr-kick">Park shelf</p>
            {s.parked.length ? (
              <ul className="dr-park-list" aria-label="Parked thoughts">
                {s.parked.slice(-3).map((x, i) => <li key={`${i}-${x.text}`} data-kept={x.stored ? 'true' : 'false'}>{x.text}<span className="dr-park-where">{x.stored ? 'in Parking' : 'this page only'}</span></li>)}
              </ul>
            ) : null}
            <ParkField open={parkOpen} onClose={() => setParkOpen(false)} onFile={file} returnTo={() => parkKey.current} />
            {!parkOpen && <Button ref={parkKey} size="md" onClick={() => setParkOpen(true)}>Park a thought (x)</Button>}
          </div>
          <Button size="md" onClick={() => apply({ t: 'end' })}>End set (e)</Button>
        </aside>
      </div>
      <p className="dr-strip" aria-live="off">{s.strip}</p>
    </section>
  )
}

/** The answer entry of one question: a numeric field with its unit chip, a recall prompt, or the rubric points to tick. */
function Answer({ q, s, apply, onEnter }: { q: DrillQuestion; s: DrillState; apply: (a: Act) => void; onEnter: () => void }) {
  const res = s.res[q.id]
  if (q.kind === 'numeric') {
    return (
      <div className="dr-answer">
        <Field key={q.id} label="Your answer" kind="text" inputMode="decimal" unit={q.unit} autoComplete="off" autoFocus disabled={!!res}
          value={s.answers[q.id] ?? ''} hint="Any usual form is read: 1,5 or 1.5 or 1.5e0."
          onChange={(e) => apply({ t: 'input', v: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onEnter() }
            // Escape leaves the field, so h, j, k, s and x are keys again (in a field a letter is a letter)
            else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() }
          }} />
      </div>
    )
  }
  if (q.kind === 'written') {
    const ticks = s.ticks[q.id] ?? []
    return (
      <div className="dr-answer">
        <p className="dr-fine">Answer in your head or on paper, then tick the points your answer made. The total is your own count: marked by you.</p>
        <div className="dr-rubric" role="group" aria-label="Rubric points">
          {(q.rubric ?? []).map((pt, i) => (
            <Chip key={pt} selected={ticks.includes(i)} grouped onClick={res ? undefined : () => apply({ t: 'tick', idx: i })}>{pt}</Chip>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="dr-answer">
      <p className="dr-fine">{s.revealed[q.id] || res ? 'Say whether you had it. This one is marked by you.' : 'Say it in your head first, then show the answer.'}</p>
    </div>
  )
}

/** What the question says back: the hints opened, the worked answer, and the calm miss. No red, no mistakes total. */
function Feedback({ q, s, r, nextOn }: { q: DrillQuestion; s: DrillState; r: DrillState['res'][string] | undefined; nextOn?: string }) {
  const rungs = s.rungs[q.id] ?? 0
  const hints = q.hints.slice(0, 2)
  const worked = rungs >= MAX_RUNGS(q) || (r && r.state !== 'matched') || s.revealed[q.id] || r?.state === 'matched'
  const day = weekdayOf(nextOn)
  return (
    <div className="dr-fb" aria-live="polite">
      {hints.slice(0, Math.min(rungs, hints.length)).map((h, i) => <p className="dr-hint" key={i}><span className="dr-hint-n">Hint {i + 1}</span>{h}</p>)}
      {r?.state === 'matched' && <p className="dr-result" data-result="matched">Matches the key.{r.marks ? ` ${r.marks.got} of ${r.marks.of}, marked by you.` : ''}</p>}
      {r?.state === 'missed' && <p className="dr-result" data-result="missed">Not yet. Worked answer below{r.marks ? ` (${r.marks.got} of ${r.marks.of}, marked by you)` : ''}</p>}
      {r?.state === 'skipped' && <p className="dr-result" data-result="skipped">Skipped. It waits on the shelf.</p>}
      {worked && (
        <div className="dr-worked" aria-label="Worked answer">
          <p className="dr-key"><span className="dr-hint-n">Key</span>{q.key}</p>
          {(q.working ?? []).map((l, i) => <p className="dr-step" key={i}>{l}</p>)}
        </div>
      )}
      {r?.state === 'missed' && <p className="dr-again">{day ? `Seen again on ${day}.` : 'On the shelf for this set.'}</p>}
    </div>
  )
}
