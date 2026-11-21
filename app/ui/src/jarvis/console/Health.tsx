// Console, Health (A.J05, spec 20.9.5): the machine as a terminal, in the same family as Core and Today. A charcoal terminal
// frame on the left (bracket-tagged rows with a lamp and a reason each, the process log tail, the wakes and the replies,
// the command line at the foot); on the right the GPU dial as the centrepiece instrument with callouts, the fix keys, the
// job board and the timings as ASCII ridges. 1286 x 652 at 1366 x 768, no document scroll; one column at 390 px.
//
// Honest by construction: every row is a lamp and its reason (model.ts); a bar fills only to a reported fraction; the log
// tail is the real stream (/api/core/logs) or says there is none; a failure is the amber triangle and the word FAULT.
import { useMemo, useRef, useState } from 'react'
import { Gauge, RotateCcw, ShieldCheck } from 'lucide-react'
import { clock } from '../../lib/format'
import { OUTCOME, fmtS } from '../../lib/settings'
import { TermWell, sparkline } from '../../shared/grammar'
import { Chip } from '../../shared/kit/v3'
import { Lamp, showsNumber, type LampReading } from '../../shared/lamp'
import { useShell } from '../../shell/store'
import { Zones, lookV3Enabled, useViewChrome, type ViewChromeSpec } from '../../shell/v3'
import { JARVIS_PLANNED } from '../planned'
import { CommandDeck } from './CommandDeck'
import { CommandAnswers, useCommandRunner } from './CommandRunner'
import type { CommandContext } from './commands'
import { PartHead, ConsoleRow, ConsoleTabs, JobBoard, AsciiRuler, ConsoleKey, GuardKey, VramDial, LampLine } from './parts'
import { gb, gpuModel, healthRows, jobBoard, replySeries, type ConsoleRowData, type JobSpec } from './model'
import { useHealthLive, type HealthLive } from './useConsole'
import './console.css'
import './console-v3.css'

type Pane = 'log' | 'wakes' | 'replies'

export interface HealthViewProps {
  live: HealthLive
  /** A fixture (gallery, jury bench): every LIVE is drawn SIMULATED and the frame is stamped. */
  simulated?: boolean
  /** Null until a route writes the memory export: `export memory` then answers PLANNED. */
  exportMemory?: (() => Promise<string>) | null
  onPlan?: () => void
  initialPane?: Pane
}

const LOG_SHOWN = 40
const JOBS_SHOWN = 4

export function HealthView({ live, simulated = false, exportMemory = null, onPlan, initialPane = 'log' }: HealthViewProps) {
  const { lat, vitals, logs, board, now, actions } = live
  const [pane, setPane] = useState<Pane>(initialPane)
  const [note, setNote] = useState<{ text: string; state: 'live' | 'fault' } | null>(null)
  const rows: ConsoleRowData[] = useMemo(
    () => healthRows({ online: live.online, lat, crew: live.crew, vitals, now, simulated }),
    [live.online, lat, live.crew, vitals, now, simulated],
  )
  const gpu = useMemo(() => gpuModel(vitals), [vitals])
  const jobs: JobSpec[] = useMemo(
    () => jobBoard({ bootStep: live.bootStep, booting: live.coreBooting, board, local: live.jobs }),
    [live.bootStep, live.coreBooting, board, live.jobs],
  )
  const ctx: CommandContext = useMemo(() => ({
    rows: () => rows, jobs: () => jobs, plan: () => JARVIS_PLANNED,
    restartBrain: actions.restartBrain, freeGpu: actions.freeGpu, exportMemory, openPlan: onPlan,
  }), [rows, jobs, actions, exportMemory, onPlan])

  // v3: the command line is the dock's (mode Command); the answers come back into the Activity tray
  const v3 = lookV3Enabled()
  const runner = useCommandRunner(ctx)
  const runnerRef = useRef(runner)
  runnerRef.current = runner
  const chrome = useMemo<ViewChromeSpec>(() => ({
    dock: {
      modes: [{ id: 'command', label: 'Command', prefix: 'jrv>', example: 'restart brain · export memory · test hearing · free gpu · status · jobs', action: 'Run' }],
      onSubmit: (_mode, text) => runnerRef.current.submit(text),
    },
  }), [])
  useViewChrome(v3 ? chrome : null)
  const [selTag, setSelTag] = useState<string | null>(null)
  const [v3Pane, setV3Pane] = useState<'jobs' | Pane>('jobs')

  const say = async (fn: () => Promise<string>) => {
    try { setNote({ text: await fn(), state: 'live' }) } catch (e) { setNote({ text: (e as Error).message || 'that did not work', state: 'fault' }) }
  }
  const running = live.coreRunning
  const appLamp: LampReading = rows[rows.length - 1].reading
  const first = replySeries(lat, 'first_word')
  const full = replySeries(lat, 'full')
  const heard = replySeries(lat, 'heard')
  const hasSeries = [first, full, heard].some((s) => s.some((n) => Number.isFinite(n)))
  const sum = lat?.summary
  const tabs = [{ id: 'log', label: 'Log' }, { id: 'wakes', label: 'Wakes', count: lat?.live.wakes.length }, { id: 'replies', label: 'Replies', count: lat?.recent.length }]

  if (v3) {
    const ordered = [...rows.filter((r) => r.reading.state === 'fault'), ...rows.filter((r) => r.reading.state !== 'fault')]
    const faults = rows.filter((r) => r.reading.state === 'fault').length
    const worst = faults ? 'fault' : rows.some((r) => r.reading.state === 'waiting') ? 'waiting' : simulated ? 'simulated' : 'live'
    const cur = ordered.find((r) => r.tag === selTag) ?? ordered[0]
    const v3Tabs = [{ id: 'jobs', label: 'Jobs', count: jobs.length }, { id: 'log', label: 'Log' }, { id: 'wakes', label: 'Wakes', count: lat?.live.wakes.length }, { id: 'replies', label: 'Replies', count: lat?.recent.length }]
    const jobsState: LampReading = jobs.length ? { state: simulated ? 'simulated' : 'live', since: null, reason: 'jobs the app knows of' } : { state: 'waiting', since: null, reason: 'nothing is running' }
    return (
      <div className="jx jx3" data-view="health" data-simulated={simulated ? 'true' : undefined}>
        <Zones
          ratio="console"
          first={{
            job: 'FIX FIRST', chip: <Chip state={worst}>{faults ? `${faults} to fix` : undefined}</Chip>,
            children: (
              <ul className="jx3-rows" aria-label="Health rows, faults first">
                {ordered.map((r) => (
                  <li key={r.tag}>
                    <button type="button" className="jx3-row" data-state={r.reading.state} aria-pressed={r.tag === cur.tag} onClick={() => setSelTag(r.tag)}>
                      <span className="jx-tag">[{r.tag}]</span>
                      <span className="jx3-row-body">
                        <span className="jx3-row-text">{r.text}</span>
                        {r.reading.reason && !showsNumber(r.reading.state) && <span className="jx3-row-why">{r.reading.reason}</span>}
                      </span>
                      <span className="jx3-row-lamp"><Lamp reading={r.reading} subject={r.tag} now={now * 1000} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            ),
          }}
          second={{
            job: 'DETAIL', chip: <Chip state={cur.reading.state} reason={cur.reading.reason} />,
            peek: { name: 'Detail', lamp: cur.reading.state, note: cur.tag },
            children: (
              <>
                <article className="jx3-detail" aria-label={`Detail of ${cur.tag}`}>
                  <h3 className="jx3-detail-head"><span className="jx-tag">[{cur.tag}]</span> {cur.text}</h3>
                  <p className="jx3-detail-why">{cur.reading.reason ?? 'no reason reported'}</p>
                  {cur.tag === 'GPU' && <div className="jx3-gpu"><VramDial model={gpu} /></div>}
                  {(cur.tag === 'GPU' || cur.tag === 'BRN') && (
                    <dl className="jx-callouts">
                      <div className="jx-callout"><dt>Brain</dt><dd>{lat?.core.brain ?? lat?.core.chosen_brain ?? '--'}</dd></div>
                      {cur.tag === 'GPU' && <div className="jx-callout"><dt>Heat</dt><dd>{gpu.tempC == null ? '--' : `${Math.round(gpu.tempC)} C`}</dd></div>}
                      <div className="jx-callout"><dt>Models</dt><dd>{gpu.models.length ? gpu.models.map((m) => `${m.name} ${gb(m.mb)} GB`).join(', ') : gpu.fraction === null ? '--' : 'none loaded'}</dd></div>
                    </dl>
                  )}
                  {cur.tag === 'TIM' && (hasSeries ? (
                    <ul className="jx-ridge-list" aria-label="Reply timings">
                      <Ridge label="heard" series={heard} median={sum?.heard?.median} />
                      <Ridge label="first word" series={first} median={sum?.first_word?.median} />
                      <Ridge label="full reply" series={full} median={sum?.full?.median} />
                    </ul>
                  ) : <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'no timed reply yet' }} subject="Timings" /></p>)}
                </article>
                <div className="jx3-keys" role="group" aria-label="Fix it">
                  <GuardKey
                    label={running ? 'Restart brain' : 'Start JARVIS'} armedLabel={running ? 'Restart now?' : 'Start now?'} accent icon={<RotateCcw size={16} />}
                    onConfirm={() => void say(actions.restartBrain)}
                  />
                  <GuardKey label="Unload models" armedLabel="Unload now?" icon={<Gauge size={16} />} onConfirm={() => void say(actions.freeGpu)} />
                  <ConsoleKey label="Steward check" icon={<ShieldCheck size={16} />} onPress={() => void say(actions.steward)} />
                </div>
                <p className="jx-note" role="status" aria-live="polite" data-state={note?.state}>{note ? <><span className="jx-tag">[SYS]</span> {note.text}</> : ' '}</p>
              </>
            ),
          }}
          third={{
            job: 'ACTIVITY', chip: <Chip state={jobsState.state} reason={jobsState.reason} />,
            peek: { name: 'Activity', lamp: jobsState.state, note: jobsState.reason },
            children: (
              <>
                <CommandAnswers runner={runner} />
                <ConsoleTabs tabs={v3Tabs} value={v3Pane} onChange={(id) => setV3Pane(id as 'jobs' | Pane)} label="Jobs, log, wakes and replies" className="jx3-tabs" />
                <div className="jx3-pane" role="tabpanel" aria-label={`${v3Pane} pane`} data-pane={v3Pane}>
                  {v3Pane === 'jobs' && (
                    <>
                      <JobBoard jobs={jobs.slice(0, JOBS_SHOWN)} empty="nothing is running in this session" />
                      {jobs.length > JOBS_SHOWN && <p className="jx-dim">{jobs.length - JOBS_SHOWN} more: type jobs</p>}
                    </>
                  )}
                  {v3Pane === 'log' && <LogTail logs={logs} />}
                  {v3Pane === 'wakes' && <WakeList lat={lat} />}
                  {v3Pane === 'replies' && <ReplyList lat={lat} />}
                </div>
              </>
            ),
          }}
        />
      </div>
    )
  }

  return (
    <div className="jx" data-view="health"data-simulated={simulated ? 'true' : undefined}>
      <section className="jx-left" aria-label="Health terminal">
        <div className="jx-well">
          <TermWell prompt="jarvis console.health" label="Health terminal" cursor={false}>
            <PartHead tag="SYS" title="Health" stamp={simulated} seed="jarvis.console.health" right={<><AsciiRuler cols={30} /><Lamp reading={appLamp} showLabel size={12} subject="Server" /></>} />
            <ul className="jx-rows" aria-label="Health rows">
              {rows.map((r) => <ConsoleRow key={r.tag} row={r} now={now * 1000} />)}
            </ul>
            <ConsoleTabs tabs={tabs} value={pane} onChange={(id) => setPane(id as Pane)} label="Log, wakes and replies" />
            <div className="jx-pane" role="tabpanel" aria-label={`${pane} pane`} data-pane={pane}>
              {pane === 'log' && <LogTail logs={logs} />}
              {pane === 'wakes' && <Wakes lat={lat} />}
              {pane === 'replies' && <Replies lat={lat} />}
            </div>
            <CommandDeck ctx={ctx} />
          </TermWell>
        </div>
      </section>

      <section className="jx-right" aria-label="Instruments">
        <div className="jx-card jx-gpu" aria-label="GPU memory">
          <PartHead tag="GPU" title="Memory" seed="jarvis.console.gpu" />
          <div className="jx-gpu-body">
            <VramDial model={gpu} />
            <dl className="jx-callouts">
              <div className="jx-callout"><dt>Brain</dt><dd>{lat?.core.brain ?? lat?.core.chosen_brain ?? '--'}</dd></div>
              <div className="jx-callout"><dt>Heat</dt><dd>{gpu.tempC == null ? '--' : `${Math.round(gpu.tempC)} C`}</dd></div>
              <div className="jx-callout"><dt>Models</dt><dd>{gpu.models.length ? gpu.models.map((m) => `${m.name} ${gb(m.mb)} GB`).join(', ') : gpu.fraction === null ? '--' : 'none loaded'}</dd></div>
            </dl>
          </div>
          <div className="jx-keys" role="group" aria-label="Fix it">
            <GuardKey
              label={running ? 'Restart brain' : 'Start JARVIS'} armedLabel={running ? 'Restart now?' : 'Start now?'} accent icon={<RotateCcw size={16} />}
              onConfirm={() => void say(actions.restartBrain)}
            />
            <GuardKey label="Unload models" armedLabel="Unload now?" icon={<Gauge size={16} />} onConfirm={() => void say(actions.freeGpu)} />
            <ConsoleKey label="Steward check" icon={<ShieldCheck size={16} />} onPress={() => void say(actions.steward)} />
          </div>
          <p className="jx-note" role="status" aria-live="polite" data-state={note?.state}>{note ? <><span className="jx-tag">[SYS]</span> {note.text}</> : ' '}</p>
        </div>

        <div className="jx-card jx-jobs-card">
          <PartHead tag="SYS" title="Jobs" seed="jarvis.console.jobs" />
          <JobBoard jobs={jobs.slice(0, JOBS_SHOWN)} />
          {jobs.length > JOBS_SHOWN && <p className="jx-dim">{jobs.length - JOBS_SHOWN} more: type jobs</p>}
        </div>

        <div className="jx-card jx-ridges">
          <PartHead tag="TIM" title="Timings" seed="jarvis.console.timings" right={<span className="jx-dim">last replies, oldest left</span>} />
          {hasSeries ? (
            <ul className="jx-ridge-list" aria-label="Reply timings">
              <Ridge label="heard" series={heard} median={sum?.heard?.median} />
              <Ridge label="first word" series={first} median={sum?.first_word?.median} />
              <Ridge label="full reply" series={full} median={sum?.full?.median} />
            </ul>
          ) : (
            <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'no timed reply yet' }} subject="Timings" /></p>
          )}
        </div>
      </section>
    </div>
  )
}

function Ridge({ label, series, median }: { label: string; series: number[]; median?: number }) {
  const n = series.filter((x) => Number.isFinite(x)).length
  return (
    <li className="jx-ridge" data-empty={n ? undefined : 'true'}>
      <span className="jx-ridge-label">{label}</span>
      <span className="jx-ridge-trace" aria-hidden="true">{sparkline(series)}</span>
      <span className="jx-ridge-med">{median == null ? '--' : fmtS(median)}</span>
      <span className="jx-sr">{n ? `${label}: ${n} replies, median ${median == null ? 'unknown' : fmtS(median)}` : `${label}: no replies timed`}</span>
    </li>
  )
}

function LogTail({ logs }: { logs: HealthLive['logs'] }) {
  if (logs === null) return <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'the log has not answered' }} subject="Log" /></p>
  if (!logs.length) return <p className="jx-empty"><span className="jx-tag">[SYS]</span> JARVIS has not run in this session, so there is no log yet.</p>
  const tail = logs.slice(-LOG_SHOWN)
  return (
    <ol className="jx-log" aria-label={`Process log, last ${tail.length} of ${logs.length} lines`}>
      {tail.map((l, i) => <li key={`${l.t}-${i}`} className="jx-logline"><time>{clock(l.t)}</time><span>{l.line}</span></li>)}
    </ol>
  )
}

function Wakes({ lat }: { lat: HealthLive['lat'] }) {
  if (!lat) return <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'not read yet' }} subject="Wakes" /></p>
  if (!lat.live.wakes.length) return <p className="jx-empty"><span className="jx-tag">[WAK]</span> no "Hey Jarvis" since the app opened; each one will appear here with what came of it.</p>
  return (
    <table className="jx-table" aria-label="Wakes since the app opened">
      <thead><tr><th scope="col">wake</th><th scope="col">score</th><th scope="col">outcome</th><th scope="col">first word</th><th scope="col">reply</th></tr></thead>
      <tbody>
        {lat.live.wakes.slice(0, 6).map((w) => {
          const o = OUTCOME[w.outcome]
          const state = w.outcome === 'error' ? 'fault' : w.outcome === 'heard_nothing' ? 'waiting' : 'live'
          return (
            <tr key={w.t}>
              <td>{clock(w.t)}</td>
              <td>{w.score != null ? w.score.toFixed(2) : '--'}</td>
              <td><Lamp reading={{ state, since: null, reason: o.label }} showLabel={false} subject="Outcome" /> {o.label}</td>
              <td>{fmtS(w.first_word)}</td>
              <td>{fmtS(w.full)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Replies({ lat }: { lat: HealthLive['lat'] }) {
  if (!lat) return <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'not read yet' }} subject="Replies" /></p>
  if (!lat.recent.length) return <p className="jx-empty"><span className="jx-tag">[TIM]</span> no replies in the last 7 days.</p>
  return (
    <table className="jx-table" aria-label="Recent replies, timed from the transcripts">
      <thead><tr><th scope="col">when</th><th scope="col">how</th><th scope="col">heard</th><th scope="col">first word</th><th scope="col">reply</th></tr></thead>
      <tbody>
        {lat.recent.slice(0, 6).map((r) => (
          <tr key={r.ts}>
            <td>{new Date(r.ts * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td>
            <td>{r.spoken ? 'spoken' : 'typed'}</td>
            <td>{fmtS(r.heard)}</td>
            <td>{fmtS(r.first_word)}</td>
            <td>{fmtS(r.full)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** v3: the wakes as a list a narrow tray can hold (the table above is five columns wide). */
function WakeList({ lat }: { lat: HealthLive['lat'] }) {
  if (!lat) return <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'not read yet' }} subject="Wakes" /></p>
  if (!lat.live.wakes.length) return <p className="jx-empty"><span className="jx-tag">[WAK]</span> no "Hey Jarvis" since the app opened; each one will appear here with what came of it.</p>
  return (
    <ul className="jx3-list" aria-label="Wakes since the app opened">
      {lat.live.wakes.slice(0, 8).map((w) => {
        const o = OUTCOME[w.outcome]
        const state = w.outcome === 'error' ? 'fault' : w.outcome === 'heard_nothing' ? 'waiting' : 'live'
        return (
          <li key={w.t} className="jx3-item">
            <span className="jx3-item-head"><time>{clock(w.t)}</time><Lamp reading={{ state, since: null, reason: o.label }} subject="Outcome" /><span>{o.label}</span></span>
            <span className="jx-dim">score {w.score != null ? w.score.toFixed(2) : '--'} · first word {fmtS(w.first_word)} · reply {fmtS(w.full)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function ReplyList({ lat }: { lat: HealthLive['lat'] }) {
  if (!lat) return <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'not read yet' }} subject="Replies" /></p>
  if (!lat.recent.length) return <p className="jx-empty"><span className="jx-tag">[TIM]</span> no replies in the last 7 days.</p>
  return (
    <ul className="jx3-list" aria-label="Recent replies, timed from the transcripts">
      {lat.recent.slice(0, 8).map((r) => (
        <li key={r.ts} className="jx3-item">
          <span className="jx3-item-head"><time>{new Date(r.ts * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</time><span>{r.spoken ? 'spoken' : 'typed'}</span></span>
          <span className="jx-dim">heard {fmtS(r.heard)} · first word {fmtS(r.first_word)} · reply {fmtS(r.full)}</span>
        </li>
      ))}
    </ul>
  )
}

/** The registered view (shell/views/console-health.view.ts): the live data and the roadmap overlay for `plan`. */
export default function Health() {
  const live = useHealthLive()
  return <HealthView live={live} onPlan={() => useShell.getState().openOverlay('roadmap')} />
}
