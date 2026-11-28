/**
 * Prepare (board requests 21 and 23; queue rows R34 and V8): the face of Study > Papers that prepares his real question store for the
 * study screens. On 28 Nov his store held 880 questions, all pending, none tagged, so every loop screen waited on his data. Three trays:
 *   1 WHERE IT STANDS  R-65's counts, totals then per subject, each with the state word of the answer, under one sentence built only
 *                      from those counts ("880 questions, 0 accepted: nothing can be ranked or put on a sheet yet.").
 *   2 PREPARE          the four steps as switches he sets, a subject, the model tick (locked with R-64's reason when no model can be
 *                      asked); "See what it would do" asks each single-step route with apply false and prints its answer; Run starts
 *                      R-72 and R-73 is polled every 2.5 s only while it runs; Stop is R-74. Per subject: Accept (R-70), Take back (R-71).
 *   3 WHO DECIDES      the model switch (R-64) and the acceptance policy (R-69), each with its sentence on screen before it is pressed.
 * Nothing here writes on mount, on a timer or as a side effect of opening the face: the reads on mount are four GETs. Every engine
 * sentence is printed as sent beside its state word; a refused change keeps the old value on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Field, Lamp, LAMP_WORD, PrimaryButton, Segmented, Switch, type LampState } from '../../../shared/kit'
import { PhonePeeks, Zones } from '../../../shell/v3'
import {
  CLAUDE_MODELS, prepClient, PROVIDERS, STEPS, type ClaudeModel, type ModelInfo, type PolicyInfo, type PrepClient, type PrepCounts, type Provider, type RunInfo, type Step,
} from '../adapters/pyqPrep'
import type { ClientReply } from '../adapters/types'
import type { PaperRow } from '../ports'
import {
  BEFORE_NOW, countText, END_WORD, LOOK_MODEL_LIMIT, MEASURED, missingSentence, plural, POLICY_OFF, POLICY_ON, PROVIDER_WORD, providerSentence, runWords, SAFE_MEANS,
  STEP_WORDS, subjectRows, totalRows, type CountRow,
} from './prepModel'
import './prep.css'

/** R-73 is read this often while a run goes; the engine plan asks for 2 to 3 s. */
export const POLL_MS = 2500
const MAX_LINES = 6

interface Note { state: LampState; text: string }

/** The answer to a press lands below the keys, where a long tray may have scrolled it out of sight: bring it into view, never past the tray. */
function useReveal<T extends HTMLElement>(on: boolean, key: unknown) {
  const ref = useRef<T>(null)
  useEffect(() => { if (on) ref.current?.scrollIntoView?.({ block: 'nearest' }) }, [on, key])
  return ref
}

/** An engine sentence beside its lamp. A sentence is never printed without the state it came with. */
function Line({ state, text, id, role = 'status', reveal }: { state: LampState; text: string; id?: string; role?: 'status' | 'alert'; reveal?: boolean }) {
  const ref = useReveal<HTMLParagraphElement>(!!reveal, text)
  return (
    <p ref={ref} className="prp-said" role={role} data-state={state} data-said={id ?? ''}>
      <Lamp state={state} bare />
      <span><span className="prp-word">{LAMP_WORD[state]}</span> {text}</span>
    </p>
  )
}

function CountList({ rows, state, label }: { rows: CountRow[]; state: LampState; label: string }) {
  return (
    <dl className="prp-counts" aria-label={label}>
      {rows.map((r) => (
        <div key={r.key} className="prp-count" data-count={r.key}>
          <dt>{r.label}{r.note && <span className="prp-note">{r.note}</span>}</dt>
          <dd><span className="prp-num">{countText(r.value)}</span><span className="prp-word">{LAMP_WORD[state]}</span></dd>
        </div>
      ))}
    </dl>
  )
}

// ------------------------------------------------------------------------------------------------ 1 WHERE IT STANDS
function Standing({ reply, reading, onRead, faceSwitch }: { reply: ClientReply<PrepCounts> | null; reading: boolean; onRead: () => void; faceSwitch?: ReactNode }) {
  const c = reply?.data ?? null
  const state: LampState = reply?.state ?? 'waiting'
  return (
    <div className="prp-col" data-tray="standing">
      {faceSwitch}
      <p className="prp-lead" data-lead="">{reply ? missingSentence(c) : 'Reading the counts…'}</p>
      {reply && <Line state={state} text={reply.reason} id="counts" />}
      {/* on the phone the two pills (Prepare, Who decides) stand here, under the sentence, not under the long list of counts */}
      <PhonePeeks />
      {c && (
        <section className="prp-block" aria-label="Totals">
          <h3 className="prp-h">Totals</h3>
          <CountList rows={totalRows(c)} state={state} label="Totals" />
          {c.courses && (
            <p className="prp-line" data-courses="">
              Classroom courses: {c.courses.mapped === null ? 'not reported' : `${c.courses.mapped} mapped to a subject, ${c.courses.unmapped ?? 0} not mapped`}
              {' '}<span className="prp-word">{LAMP_WORD[c.courses.state ?? state]}</span>{c.courses.reason ? ` ${c.courses.reason}` : ''}
            </p>
          )}
        </section>
      )}
      {c && c.bySubject.length > 0 && (
        <section className="prp-block" aria-label="By subject">
          <h3 className="prp-h">By subject</h3>
          {c.bySubject.map((s) => (
            <div key={s.subject} className="prp-subject" data-subject={s.subject}>
              <h4 className="prp-sh">{s.name}</h4>
              <CountList rows={subjectRows(s)} state={state} label={s.name} />
            </div>
          ))}
        </section>
      )}
      <div className="prp-acts">
        <Button size="md" grouped loading={reading} onClick={onRead} data-key="read-counts">Read the counts again</Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ 2 PREPARE
interface Look { step: Step; subject?: string; state: LampState; reason: string; lines: string[] }

/** Why the model cannot be ticked now, in R-64's own words; undefined when it can. */
export function modelLock(model: ClientReply<ModelInfo> | null): string | undefined {
  const m = model?.data
  if (!model || !m) return model ? `The model's state is not known: ${model.reason}` : 'The model answer has not been read yet.'
  if (m.provider === 'off') return 'The model is off (rules only): choose one under Who decides first.'
  if (m.provider === 'local' && m.available.local !== true) return model.reason
  if (m.provider === 'claude' && m.available.claude !== true) return model.reason
  return undefined
}

interface PrepareProps {
  client: PrepClient
  counts: ClientReply<PrepCounts> | null
  model: ClientReply<ModelInfo> | null
  policy: ClientReply<PolicyInfo> | null
  run: ClientReply<RunInfo | null> | null
  setRun: (r: ClientReply<RunInfo | null>) => void
  papers: readonly PaperRow[]
  onChanged: () => void
}

function Prepare({ client, counts, model, policy, run, setRun, papers, onChanged }: PrepareProps) {
  const [steps, setSteps] = useState<Record<Step, boolean>>({ subjects: false, reread: false, tags: false, accept: false })
  const [subject, setSubject] = useState('')
  const [useModel, setUseModel] = useState(false)
  const [looks, setLooks] = useState<Look[]>([])
  const [looking, setLooking] = useState<string | null>(null)
  const [said, setSaid] = useState<Note | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [perSubject, setPerSubject] = useState<Record<string, Note>>({})
  // the run panel is brought into view only after his own press of Run, not when the face opens on an earlier run
  const [pressed, setPressed] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const c = counts?.data ?? null
  const subjects = c?.bySubject ?? []
  const lock = modelLock(model)
  const withModel = useModel && !lock
  const chosen = STEPS.filter((s) => steps[s])
  const job = run?.data ?? null
  const running = job?.status === 'running'
  const autoAccept = policy?.data?.autoAccept ?? null
  const nameOf = (id: string) => subjects.find((s) => s.subject === id)?.name ?? id
  const m = model?.data ?? null
  const modelName = m ? (m.provider === 'claude' ? `Claude ${m.claudeModel ?? ''}`.trim() : m.name || PROVIDER_WORD[m.provider]) : ''
  const busyRun = running ? 'A preparation run is going; wait for it or stop it.' : undefined

  const look = async () => {
    setLooks([])
    setSaid(null)
    const out: Look[] = []
    const push = (l: Look) => { out.push(l); if (alive.current) setLooks([...out]) }
    for (const step of chosen) {
      if (!alive.current) return
      setLooking(STEP_WORDS[step].label)
      if (step === 'subjects') {
        const r = await client.subjects({ apply: false, useModel: withModel, ...(withModel ? { limit: LOOK_MODEL_LIMIT } : {}) })
        const items = r.data?.items ?? []
        push({ step, state: r.state, reason: r.reason, lines: [...items.slice(0, MAX_LINES).map((i) => `${i.title || i.paper}: ${i.reason}`), ...(items.length > MAX_LINES ? [`and ${plural(items.length - MAX_LINES, 'more paper', 'more papers')}`] : [])] })
      } else if (step === 'reread') {
        const ids = subject ? papers.filter((p) => p.subject === subject).map((p) => p.id) : undefined
        if (ids && !ids.length) { push({ step, state: 'waiting', reason: `No paper of ${nameOf(subject)} is on the desk, so nothing was read again.`, lines: [] }); continue }
        const r = await client.reread({ apply: false, papers: ids })
        const rows = r.data?.items ?? []
        const telling = rows.filter((x) => x.changed || x.failed)
        const shown = (telling.length ? telling : rows).slice(0, MAX_LINES)
        push({ step, state: r.state, reason: r.reason, lines: [...shown.map((x) => `${x.title || x.paper}: ${x.reason}`), ...(telling.length > MAX_LINES ? [`and ${plural(telling.length - MAX_LINES, 'more paper', 'more papers')} would change`] : [])] })
      } else if (step === 'tags') {
        for (const sid of subject ? [subject] : subjects.map((s) => s.subject)) {
          const r = await client.tags({ subject: sid, apply: false, useModel: withModel, ...(withModel ? { limit: LOOK_MODEL_LIMIT } : {}) })
          push({ step, subject: sid, state: r.state, reason: r.reason, lines: [] })
        }
      } else {
        // R-70 has no apply false: it writes when pressed. What a look can say is the policy that decides whether it accepts anything.
        push({ step, state: policy?.state ?? 'waiting', reason: `Accept has no look of its own: it writes when it runs. ${autoAccept ? POLICY_ON : POLICY_OFF}`, lines: [] })
      }
    }
    if (alive.current) setLooking(null)
  }

  const start = async () => {
    setBusy('run')
    setSaid(null)
    setPressed(true)
    const r = await client.runStart({ steps: chosen, subjects: subject ? [subject] : undefined, useModel: withModel })
    if (!alive.current) return
    setBusy(null)
    if (r.data) setRun(r)
    else setSaid({ state: r.state, text: r.reason })
  }
  const stop = async () => {
    setBusy('stop')
    const r = await client.runStop()
    if (!alive.current) return
    setBusy(null)
    if (r.data) setRun(r)
    else setSaid({ state: r.state, text: r.reason })
  }
  const decide = async (sid: string, how: 'accept' | 'unaccept') => {
    setBusy(`${how}:${sid}`)
    const r = how === 'accept' ? await client.accept(sid) : await client.unaccept(sid)
    if (!alive.current) return
    setBusy(null)
    setPerSubject((x) => ({ ...x, [sid]: { state: r.state, text: r.reason } }))
    onChanged()
  }

  const looksRef = useReveal<HTMLOListElement>(looks.length > 0, looks.length)
  const runText = runWords(chosen, subject ? nameOf(subject) : null, { on: withModel, name: modelName, sendsOut: withModel && m?.sendsOut === true })
  const runLock = busyRun ?? (chosen.length ? undefined : 'Tick at least one step first.')
  const lookLock = busyRun ?? (chosen.length ? (looking ? 'A look is being asked now.' : undefined) : 'Tick at least one step first.')

  return (
    <div className="prp-col" data-tray="prepare">
      <p className="prp-line">Set the steps you want, then see what they would do. Nothing is written until you press Run.</p>
      <fieldset className="prp-steps" aria-label="Steps">
        {STEPS.map((s) => (
          <div key={s} className="prp-step" data-step={s}>
            <Switch checked={steps[s]} onChange={(v) => setSteps((x) => ({ ...x, [s]: v }))} label={STEP_WORDS[s].label} disabledReason={busyRun} />
            <p className="prp-note">{STEP_WORDS[s].does}{s === 'accept' && autoAccept === false ? ' Your policy is off now, so this step accepts nothing.' : ''}</p>
          </div>
        ))}
      </fieldset>
      <Field kind="select" label="On which papers" value={subject} onChange={(e) => setSubject((e.target as unknown as HTMLSelectElement).value)} disabled={running}>
        <option value="">Every subject, and the papers without one</option>
        {subjects.map((s) => <option key={s.subject} value={s.subject}>{s.name}</option>)}
      </Field>
      <div className="prp-step" data-step="model">
        <Switch checked={withModel} onChange={setUseModel} label="Use the model" disabledReason={lock ?? busyRun} />
        <p className="prp-note">{lock ? 'Rules only.' : m?.sendsOut ? `${model?.reason}` : `The model (${modelName}) picks a subject or a topic where no rule spoke; its picks say they are the model's.`}</p>
      </div>
      <p className="prp-note" data-measured="">{MEASURED} A look reads the papers again just as a run does; with the model ticked it asks the model about {LOOK_MODEL_LIMIT} papers or questions a step{m?.sendsOut ? ', and that text leaves this PC too' : ''}.</p>
      <div className="prp-acts">
        <Button size="lg" loading={!!looking} disabledReason={lookLock} onClick={() => void look()} data-key="look">See what it would do</Button>
      </div>
      {looking && <p className="prp-line" role="status" data-looking="">Asking the engine: {looking}…</p>}
      {looks.length > 0 && (
        <ol ref={looksRef} className="prp-looks" aria-label="What each step would do">
          {looks.map((l, i) => (
            <li key={`${l.step}-${l.subject ?? ''}-${i}`} className="prp-look" data-look={l.step}>
              <p className="prp-sh">{STEP_WORDS[l.step].label}{l.subject ? `: ${nameOf(l.subject)}` : ''}</p>
              <Line state={l.state} text={l.reason} />
              {l.lines.length > 0 && <ul className="prp-lines">{l.lines.map((x, k) => <li key={k}>{x}</li>)}</ul>}
            </li>
          ))}
        </ol>
      )}
      <p className="prp-line" data-run-words="">{runText}</p>
      <div className="prp-acts">
        <PrimaryButton claimId="prep-run" rank="workspace" size="lg" loading={busy === 'run'} disabledReason={runLock} onClick={() => void start()} data-key="run">Run</PrimaryButton>
      </div>
      {said && <Line state={said.state} text={said.text} id="run-said" role={said.state === 'fault' ? 'alert' : 'status'} reveal />}
      {job && run && <RunPanel run={run} job={job} stopping={busy === 'stop'} onStop={() => void stop()} reveal={pressed} />}
      {subjects.length > 0 && (
        <section className="prp-block" aria-label="Accept by subject">
          <h3 className="prp-h">Accept by subject</h3>
          <p className="prp-note">{autoAccept ? POLICY_ON : `${POLICY_OFF} Turn it on under Who decides to accept by rule.`} Take back returns every question the rule accepted in that subject to pending.</p>
          {subjects.map((s) => (
            <div key={s.subject} className="prp-accept" data-accept={s.subject}>
              <p className="prp-sh">{s.name}: {countText(s.accepted)} accepted of {countText(s.questions)}</p>
              <div className="prp-acts">
                <Button size="md" grouped loading={busy === `accept:${s.subject}`} disabledReason={busyRun ?? (autoAccept ? undefined : 'Acceptance by rule is off; only you can turn it on.')} onClick={() => void decide(s.subject, 'accept')} data-key="accept">Accept</Button>
                <Button size="md" grouped loading={busy === `unaccept:${s.subject}`} disabledReason={busyRun} onClick={() => void decide(s.subject, 'unaccept')} data-key="take-back">Take back</Button>
              </div>
              {perSubject[s.subject] && <Line state={perSubject[s.subject].state} text={perSubject[s.subject].text} id={`accept-${s.subject}`} reveal />}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function RunPanel({ run, job, stopping, onStop, reveal }: { run: ClientReply<RunInfo | null>; job: RunInfo; stopping: boolean; onStop: () => void; reveal: boolean }) {
  const live = job.status === 'running'
  // a run that starts or ends is brought into view once, so the step in hand and the end word are seen without scrolling
  const ref = useReveal<HTMLElement>(reveal, `${job.id}:${job.status}`)
  const step = (STEP_WORDS as Record<string, { label: string }>)[job.step]?.label ?? job.step
  return (
    <section ref={ref} className="prp-run" data-run={job.status} aria-label="The preparation run">
      <p className="prp-runhead"><strong>{live ? `Step in hand: ${step}` : END_WORD[job.status as keyof typeof END_WORD]}</strong></p>
      {live && (
        <p className="prp-line" data-progress="">
          <span className="prp-num">{job.total ? `${countText(job.done)} of ${job.total}` : countText(job.done)}</span> {job.unit || 'done'}{job.total ? ' done' : ''}; <span className="prp-num">{countText(job.seconds)} s</span> so far.
        </p>
      )}
      {!live && <p className="prp-line"><span className="prp-num">{countText(job.seconds)} s</span>, steps {job.steps.map((s) => STEP_WORDS[s].label.toLowerCase()).join(', ')}{job.model ? `, with ${job.model}` : ', rules only'}.</p>}
      <Line state={run.state} text={run.reason} id="run" />
      <table className="prp-bn" aria-label="Counts before the run and now">
        <thead><tr><th scope="col">Count</th><th scope="col">Before</th><th scope="col">Now</th></tr></thead>
        <tbody>
          {BEFORE_NOW.map((r) => (
            <tr key={r.key} data-bn={r.key}>
              <th scope="row">{r.label}</th>
              <td className="prp-num">{countText(job.countsBefore?.[r.key] as number | null | undefined)}</td>
              <td className="prp-num">{countText(job.countsNow?.[r.key] as number | null | undefined)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="prp-line" data-failures="">Failures: <span className="prp-num">{countText(job.failures)}</span>{job.error ? `. ${job.error}` : ''}</p>
      {job.notes.length > 0 && <ul className="prp-lines" aria-label="The engine's lines on this run">{job.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {live && (
        <div className="prp-acts">
          <Button size="lg" loading={stopping} onClick={onStop} data-key="stop">Stop</Button>
          <span className="prp-note">Stops after the batch in hand, so no batch is half written and no paper half replaced.</span>
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ 3 WHO DECIDES
interface DecidersProps {
  client: PrepClient
  model: ClientReply<ModelInfo> | null
  setModel: (r: ClientReply<ModelInfo>) => void
  policy: ClientReply<PolicyInfo> | null
  setPolicy: (r: ClientReply<PolicyInfo>) => void
  locked?: string
}

const yesNo = (b: boolean | null | undefined, yes = 'yes', no = 'no') => (b === true ? yes : b === false ? no : 'not reported')

function Deciders({ client, model, setModel, policy, setPolicy, locked }: DecidersProps) {
  const info = model?.data ?? null
  const [confirm, setConfirm] = useState(false)
  const [cm, setCm] = useState<ClaudeModel>(info?.claudeModel ?? 'sonnet')
  const [said, setSaid] = useState<Note | null>(null)
  const [polSaid, setPolSaid] = useState<Note | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (info?.claudeModel) setCm(info.claudeModel) }, [info?.claudeModel])

  const put = async (p: Provider, m?: ClaudeModel) => {
    setBusy('model')
    const r = await client.setModel(p, m)
    setBusy(null)
    // a refused change (400 "The Claude tool is not found on this PC...") keeps the value on file on screen; only an answer with the model moves it
    // the answer that moved it replaces the line of the model on file, so it is said once; a refusal is said under the switch
    if (r.data && r.state !== 'fault') { setModel(r); setConfirm(false); setSaid(null) } else setSaid({ state: r.state, text: r.reason })
  }
  const confirmRef = useReveal<HTMLDivElement>(confirm, confirm)
  const choose = (p: Provider) => {
    if (!info || p === info.provider) { setConfirm(false); return }
    // a run is going: the choice is not taken, and the reason is said (a disabled option would hide which one is on file)
    if (locked) { setSaid({ state: 'waiting', text: locked }); return }
    if (p === 'claude') { setConfirm(true); setSaid(null); return }
    setConfirm(false)
    void put(p)
  }
  const setPol = async (on: boolean) => {
    setBusy('policy')
    const r = await client.setPolicy(on)
    setBusy(null)
    if (r.data && r.state !== 'fault') { setPolicy(r); setPolSaid(null) } else setPolSaid({ state: r.state, text: r.reason })
  }

  const auto = policy?.data?.autoAccept ?? null
  return (
    <div className="prp-col" data-tray="deciders">
      <section className="prp-block" aria-label="The model">
        <h3 className="prp-h">The model</h3>
        {!model && <p className="prp-line">Reading which model may be asked…</p>}
        {model && <Line state={model.state} text={model.reason} id="model" />}
        {info && (
          <dl className="prp-counts" aria-label="The model on file">
            <div className="prp-count"><dt>On file</dt><dd><span>{PROVIDER_WORD[info.provider]}{info.provider === 'claude' && info.claudeModel ? ` (${info.claudeModel})` : ''}</span></dd></div>
            <div className="prp-count" data-count="sends_out"><dt>Your text leaves this PC</dt><dd><span className="prp-num">{yesNo(info.sendsOut)}</span></dd></div>
            <div className="prp-count"><dt>Local model running</dt><dd><span className="prp-num">{yesNo(info.available.local)}</span></dd></div>
            <div className="prp-count"><dt>Claude tool found</dt><dd><span className="prp-num">{yesNo(info.available.claude)}</span></dd></div>
          </dl>
        )}
        <ul className="prp-lines prp-choices" aria-label="What each choice means">
          {PROVIDERS.map((p) => <li key={p} data-choice={p}><strong>{PROVIDER_WORD[p]}:</strong> {providerSentence(p, p === 'claude' ? cm : null)}</li>)}
        </ul>
        {info && (
          <Segmented<Provider>
            variant="choice"
            label="Which model may be asked"
            value={info.provider}
            onChange={choose}
            options={PROVIDERS.map((p) => ({
              id: p, label: PROVIDER_WORD[p],
              disabledReason: p === 'claude' && info.available.claude === false ? 'The Claude tool is not found on this PC, so Claude cannot be chosen.' : undefined,
            }))}
          />
        )}
        {info && confirm && (
          <div ref={confirmRef} className="prp-confirm" role="group" aria-label="Switch to Claude">
            <p className="prp-line" data-claude-sentence="">{providerSentence('claude', cm)}</p>
            <Segmented<ClaudeModel> variant="choice" label="Which Claude model" value={cm} onChange={setCm} options={CLAUDE_MODELS.map((x) => ({ id: x, label: x }))} />
            <div className="prp-acts">
              <Button size="md" grouped loading={busy === 'model'} onClick={() => void put('claude', cm)} data-key="switch-claude">Switch to Claude ({cm})</Button>
              <Button size="md" grouped onClick={() => setConfirm(false)} data-key="keep-model">Keep {PROVIDER_WORD[info.provider].toLowerCase()}</Button>
            </div>
          </div>
        )}
        {info && info.provider === 'claude' && !confirm && (
          <Segmented<ClaudeModel> variant="choice" label="Which Claude model" value={info.claudeModel ?? 'sonnet'}
            onChange={(x) => { if (x === info.claudeModel) return; if (locked) setSaid({ state: 'waiting', text: locked }); else void put('claude', x) }}
            options={CLAUDE_MODELS.map((x) => ({ id: x, label: x }))} />
        )}
        {said && <Line state={said.state} text={said.text} id="model-said" role={said.state === 'fault' ? 'alert' : 'status'} reveal />}
      </section>

      <section className="prp-block" aria-label="Acceptance by rule">
        <h3 className="prp-h">Acceptance by rule</h3>
        {policy && <Line state={policy.state} text={policy.reason} id="policy" />}
        <p className="prp-line" data-policy-sentence="">{auto ? `Turning it off: ${POLICY_OFF}` : `Turning it on: ${POLICY_ON}`} {SAFE_MEANS}</p>
        {auto !== null && (
          <Switch checked={auto} onChange={(v) => void setPol(v)} label="Accept safe questions by rule" loading={busy === 'policy'} disabledReason={locked} />
        )}
        {polSaid && <Line state={polSaid.state} text={polSaid.text} id="policy-said" role={polSaid.state === 'fault' ? 'alert' : 'status'} reveal />}
      </section>
      <p className="prp-note">Both are yours: nothing here changes without your press, and the engine's defaults are rules only and acceptance off.</p>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ the face
export interface PrepFaceProps {
  client?: PrepClient
  /** The desk's face switch, drawn at the top of the first tray. */
  faceSwitch?: ReactNode
  /** The papers on the desk: a look at reading again for one subject sends only that subject's papers. */
  papers?: readonly PaperRow[]
  /** A run ended, or a subject was accepted or taken back: the desk reads its papers and questions again. */
  onChanged?: () => void
  pollMs?: number
}

export function PrepFace({ client = prepClient, faceSwitch, papers = [], onChanged, pollMs = POLL_MS }: PrepFaceProps) {
  const [counts, setCounts] = useState<ClientReply<PrepCounts> | null>(null)
  const [model, setModel] = useState<ClientReply<ModelInfo> | null>(null)
  const [policy, setPolicy] = useState<ClientReply<PolicyInfo> | null>(null)
  const [run, setRun] = useState<ClientReply<RunInfo | null> | null>(null)
  const [reading, setReading] = useState(false)
  // one tick per answer, so every poll answer arms the next timer (as OcrPanel does)
  const [tick, setTick] = useState(0)
  const seen = useRef<string | null>(null)
  const alive = useRef(true)
  const changed = useRef(onChanged)
  changed.current = onChanged

  const readCounts = useCallback(async () => {
    setReading(true)
    const r = await client.counts()
    if (alive.current) { setCounts(r); setReading(false) }
  }, [client])

  // four reads on mount, and no write: a run already going (started in an earlier visit) is found by R-73
  useEffect(() => {
    alive.current = true
    void readCounts()
    void client.model().then((r) => { if (alive.current) setModel(r) })
    void client.policy().then((r) => { if (alive.current) setPolicy(r) })
    void client.runStatus().then((r) => { if (alive.current) setRun(r) })
    return () => { alive.current = false; client.abortAll() }
  }, [client, readCounts])

  const job = run?.data ?? null
  const running = job?.status === 'running'
  // poll R-73 only while a run goes; every answer re-arms the next timer, and the cleanup is the stop (unmount, or a run that ended)
  useEffect(() => {
    if (!running) return
    let live = true
    const t = setTimeout(() => { void client.runStatus().then((r) => { if (live) { setRun(r); setTick((n) => n + 1) } }) }, pollMs)
    return () => { live = false; clearTimeout(t) }
  }, [client, running, tick, pollMs])

  // a run seen running and then not running ended while he looked: tray 1 and the desk read again
  useEffect(() => {
    if (!job) return
    if (job.status === 'running') { seen.current = job.id; return }
    if (seen.current === job.id) { seen.current = null; void readCounts(); changed.current?.() }
  }, [job, readCounts])

  const afterDecide = useCallback(() => { void readCounts(); changed.current?.() }, [readCounts])
  const state: LampState = counts?.state ?? 'waiting'
  const runNote = useMemo(() => (job ? (job.status === 'running' ? `running: ${job.step}` : END_WORD[job.status as keyof typeof END_WORD].toLowerCase()) : 'no run yet'), [job])

  return (
    <div className="prp-face" data-component="prep-face" data-state={state}>
      <Zones
        ratio={[1.3, 1.4, 1.0]}
        first={{ job: 'WHERE IT STANDS', chip: <Lamp state={state} reason={counts?.reason} />, children: <Standing reply={counts} reading={reading} onRead={() => void readCounts()} faceSwitch={faceSwitch} /> }}
        second={{
          job: 'PREPARE',
          peek: { name: 'Prepare', lamp: running ? 'live' : (run?.state ?? 'waiting'), note: runNote },
          children: <Prepare client={client} counts={counts} model={model} policy={policy} run={run} setRun={setRun} papers={papers} onChanged={afterDecide} />,
        }}
        third={{
          job: 'WHO DECIDES',
          peek: { name: 'Who decides', lamp: model?.state ?? 'waiting', note: model?.data ? `model: ${PROVIDER_WORD[model.data.provider].toLowerCase()}; acceptance ${policy?.data?.autoAccept ? 'on' : 'off'}` : 'not read yet' },
          children: <Deciders client={client} model={model} setModel={setModel} policy={policy} setPolicy={setPolicy} locked={running ? 'A preparation run is going; wait for it or stop it.' : undefined} />,
        }}
      />
    </div>
  )
}

export default PrepFace
