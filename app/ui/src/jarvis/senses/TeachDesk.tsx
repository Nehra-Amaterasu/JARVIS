// The Teach desk (spec 20.9.3, parity S03 and S05): the three ways to teach Aankhen your room and the one Train key, plus the
// learned model's advisory reading. The calls are lib/teachTrain.ts unchanged; only the drawing is new. Three tabs, one
// tab stop:
//   Mini drill       sit at the laptop, press Start, tap the place you are at as you move; the laptop keeps the clock
//   Phone recording  a longer drill recorded on the phone: pick its audio, and the narration becomes labels
//   Train            one key: the job's progress, then the report in plain words (balanced accuracy against always
//                    saying the commonest place, recall per place, seconds per place and what is missing)
// The model's reading is "predicting" until a held-out day has passed: the status word comes from the server and the
// learned rows show digits only after it says answering.
import { useCallback, useEffect, useState } from 'react'
import { Lamp, type LampReading } from '../../shared/lamp'
import {
  getMini, getNarrate, getNarrateJob, pct, placeButtons, secondsOf, startMini, startNarrate, startTrain, stopMini, tapMini,
  type AudioFile, type JobView, type MiniView, type NarrateSession, type NarrateSummary,
} from '../../lib/teachTrain'
import { learnedView } from '../../lib/roomMeasure'
import { Choice, KeyBtn, Panel, SensesSelect, effectiveSource } from './parts'
import type { SensesState, SensesStore } from './store'

type Toast = (m: string, tone?: 'live' | 'sim' | 'fault' | 'info') => void
type Tab = 'mini' | 'phone' | 'train'

const PLACE_WORD: Record<string, string> = { empty: 'Quiet', outside: 'Outside', room: 'In the room', desk: 'At the desk', bed: 'On the bed' }
const MOTION_WORD: Record<string, string> = { still: 'Still', typing: 'Typing', waving: 'Waving', walking: 'Walking' }
const STATES = ['empty', 'outside', 'room', 'desk', 'bed']

function Progress({ job }: { job: JobView }) {
  return (
    <div className="js-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.fraction * 100)} aria-label={job.stage || 'working'}>
      <div className="js-progress-head"><span>{job.stage || 'working'}</span><b>{Math.round(job.fraction * 100)} %</b></div>
      <div className="js-meter"><i style={{ width: `${job.fraction * 100}%` }} /></div>
    </div>
  )
}

/* ------------------------------------------------------------------ mini drill */
function MiniDrill({ state, toast }: { state: SensesState; toast?: Toast }) {
  const [v, setV] = useState<MiniView | null>(null)
  const recording = !!v?.recording
  const load = useCallback(async () => { try { setV(await getMini()) } catch { /* keep */ } }, [])
  useEffect(() => {
    void load()
    if (!recording) return
    const id = window.setInterval(load, 1000)
    return () => window.clearInterval(id)
  }, [recording, load])
  const run = async (fn: () => Promise<MiniView>) => { try { setV(await fn()) } catch (e) { toast?.((e as Error).message, 'fault') } }
  const { places, transit } = placeButtons(state.zones)
  const open = v?.open?.zone
  const live = state.latest?.source === 'hardware' && state.online
  // a fixed 4-column grid: the last tile takes the cells the row would leave empty, so no row ends in a hole
  const grid = (zs: { id: string; name: string }[], small: boolean) => zs.map((z, i) => tile(z, small, i === zs.length - 1 && zs.length % 4 ? 5 - (zs.length % 4) : 1))
  const tile = (z: { id: string; name: string }, small: boolean, span = 1) => (
    <button
      key={z.id} type="button" className="js-tile" data-small={small ? 'true' : undefined} aria-pressed={open === z.id}
      aria-disabled={!recording || undefined} style={span > 1 ? { gridColumn: `span ${span}` } : undefined} onClick={() => { if (recording) void run(() => tapMini(z.id)) }}
    >
      <span>{z.name}</span>
      <small>{open === z.id ? `now ${Math.round(v?.open?.seconds ?? 0)} s` : `${Math.round(v?.seconds?.[z.id] ?? 0)} s`}</small>
    </button>
  )
  return (
    <div className="js-tabbody">
      <p className="js-note">
        {recording ? 'Tap where you are each time you move. Each tap ends the last stretch and starts the next; Pause leaves the time unlabelled.' : 'Sit at the laptop and press Start: the board records, and you tap the place you are at as you move. The laptop keeps the time, so no chirp is needed.'}
      </p>
      {!state.zones.length && <p className="js-note">No zone map yet: the place buttons come from the room's zones.</p>}
      <div className="js-tiles">{grid(places, false)}</div>
      {transit.length > 0 && <><p className="js-eyebrow">on the way</p><div className="js-tiles">{grid(transit, true)}</div></>}
      <div className="js-action-row">
        <span className="js-note" data-testid="mini-reason">{recording ? `${v?.spans.length ?? 0} stretches saved${v?.dropped.length ? `, ${v.dropped.length} dropped (${v.dropped[v.dropped.length - 1].why})` : ''}` : live ? 'The board is live.' : 'Start the ESP32 in Presence first: a mini drill records the real board.'}</span>
        {recording ? (
          <span className="js-pair">
            <KeyBtn onClick={() => void run(() => tapMini(null))}>Pause</KeyBtn>
            <KeyBtn primary onClick={() => void run(stopMini)}>Stop and save</KeyBtn>
          </span>
        ) : (
          <KeyBtn primary disabledReason={live ? undefined : 'Needs frames from the board'} onClick={() => void run(() => startMini(null))}>Start</KeyBtn>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ phone recording */
function PhoneRecording({ toast }: { toast?: Toast }) {
  const [sessions, setSessions] = useState<NarrateSession[]>([])
  const [audio, setAudio] = useState<AudioFile[]>([])
  const [path, setPath] = useState('')
  const [session, setSession] = useState('latest')
  const [job, setJob] = useState<JobView | null>(null)
  const [summary, setSummary] = useState<NarrateSummary | null>(null)
  useEffect(() => { getNarrate().then((r) => { setSessions(r.sessions); setAudio(r.audio); setJob(r.job) }).catch(() => { /* none yet */ }) }, [])
  const running = job?.state === 'running'
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(async () => { try { const r = await getNarrateJob(); setJob(r.job); setSummary(r.summary) } catch { /* keep */ } }, 1500)
    return () => window.clearInterval(id)
  }, [running])
  useEffect(() => { if (job?.state === 'done' && !summary) getNarrateJob().then((r) => setSummary(r.summary)).catch(() => {}) }, [job?.state, summary])
  const go = async () => {
    try { const r = await startNarrate(path.trim(), session); setJob(r.job); setSummary(null) } catch (e) { toast?.((e as Error).message, 'fault') }
  }
  return (
    <div className="js-tabbody">
      <p className="js-note">A longer drill recorded on the phone: copy its audio file to the laptop, pick it here, and the narration becomes labels (the chirps line the phone up with the laptop, then Whisper hears the places).</p>
      <div className="js-form">
        <div className="js-field"><span className="js-field-label" aria-hidden="true">Session</span>
          <SensesSelect
            label="Narration session" placeholder="the latest" value={session} onChange={setSession} className="js-sel-wide"
            options={[{ id: 'latest', label: 'the latest' }, ...sessions.map((x) => ({ id: x.folder, label: `${x.day} ${x.session}${x.labelled ? ', labelled' : ''}` }))]}
          />
        </div>
        <label className="js-grow">Audio file
          <input className="js-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\...\recording.m4a" aria-label="Audio file path" spellCheck={false} />
        </label>
      </div>
      {audio.length > 0 && (
        <div className="js-chips">{audio.map((a) => <button key={a.path} type="button" className="js-chip" aria-pressed={path === a.path} onClick={() => setPath(a.path)} title={a.path}>{a.name}, {a.mb} MB</button>)}</div>
      )}
      {job && job.state === 'running' && <Progress job={job} />}
      {job?.state === 'error' && <p className="js-fault" role="alert"><Lamp reading={{ state: 'fault', since: null, reason: job.error ?? 'failed' }} /> {job.error}</p>}
      {job?.state === 'done' && summary && (
        <div className="js-report">
          <b>{summary.stretches} labelled stretches</b> from {summary.words} words{summary.clock ? `, ${summary.clock}` : ''}
          <p className="js-mono-dim">{Object.entries(summary.minutes).map(([z, m]) => `${z.replace(/_/g, ' ')} ${m.toFixed(1)} min`).join(' · ')}</p>
          {!summary.has_empty && <p className="js-note">No "leaving the room" stretch: this session has no quiet reference of its own.</p>}
        </div>
      )}
      <div className="js-action-row">
        <span className="js-note">Transcribing an hour takes a few minutes; the page can stay open or not.</span>
        <KeyBtn primary disabledReason={running ? 'Labelling is running' : !path.trim() ? 'Pick or type an audio file' : undefined} onClick={() => void go()}>{running ? 'Labelling...' : 'Label it'}</KeyBtn>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ train */
function TrainTab({ state, store, toast }: { state: SensesState; store: SensesStore; toast?: Toast }) {
  const v = state.train
  const job = v?.job
  const rep = v?.report
  const running = job?.state === 'running'
  const missing = v?.available?.missing ?? []
  const go = async () => { try { store.setTrain(await startTrain(30)) } catch (e) { toast?.((e as Error).message, 'fault') } }
  return (
    <div className="js-tabbody">
      <p className="js-status-line">
        <b className="js-status-word" data-answering={v?.status === 'answering' ? 'true' : undefined}>{(v?.status ?? 'predicting').toUpperCase()}</b>
        <span className="js-note">{v?.status === 'answering' ? 'It passed a held-out day: its place is shown as an answer.' : 'Until it passes a held-out day (after 4 to 5 days of drills) its place is shown as a prediction.'}</span>
      </p>
      {missing.length > 0 && <p className="js-fault" role="alert">Not in this build yet: {missing.join(', ')}.</p>}
      {job && running && <Progress job={job} />}
      {job?.state === 'error' && <p className="js-fault" role="alert">{job.error}</p>}
      {rep && (
        <div className="js-report">
          {rep.balanced != null && (
            <p className="js-score"><span>balanced accuracy <b>{pct(rep.balanced)}</b>{rep.interval && <small> ({pct(rep.interval[0])} to {pct(rep.interval[1])})</small>}</span><span>always the commonest <b>{pct(rep.baseline)}</b></span></p>
          )}
          {rep.lines.slice(0, 3).map((l, i) => <p key={i} className="js-note">{l}</p>)}
          {rep.recall.length > 0 && (
            <ul className="js-bars" aria-label="Recall per place">
              {rep.recall.map((r) => <li key={r.place}><span>{r.name}</span><span className="js-ev-bar" data-source="live"><i style={{ width: `${(r.recall ?? 0) * 100}%` }} /></span><em>{pct(r.recall)}</em></li>)}
            </ul>
          )}
          {rep.seconds.length > 0 && (
            <ul className="js-bars" aria-label="Seconds per place">
              {rep.seconds.map((s) => <li key={s.place}><span>{secondsOf(s.name, s.have, s.need)}</span><span className="js-ev-bar" data-source={s.missing > 0 ? 'simulated' : 'live'}><i style={{ width: `${Math.min(100, (s.have / Math.max(1, s.need)) * 100)}%` }} /></span><em>{s.missing > 0 ? `-${Math.round(s.missing)}` : 'ok'}</em></li>)}
            </ul>
          )}
        </div>
      )}
      <div className="js-action-row">
        <span className="js-note">{rep ? '' : 'Trains on every labelled stretch: mini drills, phone recordings, rights and corrections.'}</span>
        <KeyBtn primary disabledReason={running ? 'Training is running' : !v?.available?.train_job ? 'The training job is not in this build' : undefined} onClick={() => void go()}>{running ? 'Training...' : 'Train'}</KeyBtn>
      </div>
    </div>
  )
}

export function TeachDesk({ state, store, toast, fixture }: { state: SensesState; store: SensesStore; toast?: Toast; fixture?: boolean }) {
  const [tab, setTab] = useState<Tab>('mini')
  const training = state.train?.job.state === 'running'
  const src = effectiveSource(state)
  // the lamp follows the source: LIVE only for the board, SIMULATED for the simulation or a specimen, WAITING when nothing runs.
  // A running training job is the server's own work on stored labels, so it keeps its own reading (LIVE, SIMULATED in a specimen).
  const fromSource: LampReading['state'] = fixture || src === 'simulated' ? 'simulated' : src === 'live' ? 'live' : 'waiting'
  const lamp: LampReading = training
    ? { state: fixture ? 'simulated' : 'live', since: null, reason: 'a training job is running' }
    : fromSource !== 'waiting' && state.train
      ? { state: fromSource, since: null, reason: 'model status from the server' }
      : { state: 'waiting', since: null, reason: src === 'none' ? 'no source is running' : state.train ? 'no source is running' : 'model status not read yet' }
  return (
    <Panel
      tag="SEN" title="Teach desk" reading={lamp} className="js-p-desk"
      aside={<Choice label="Teach" value={tab} onChange={setTab} options={[{ id: 'mini', label: 'Mini drill' }, { id: 'phone', label: 'Phone', title: 'Phone recording' }, { id: 'train', label: training ? 'Training' : 'Train' }]} />}
    >
      {tab === 'mini' && <MiniDrill state={state} toast={toast} />}
      {tab === 'phone' && <PhoneRecording toast={toast} />}
      {tab === 'train' && <TrainTab state={state} store={store} toast={toast} />}
    </Panel>
  )
}

/* ------------------------------------------------------------------ the learned model */
export function LearnedPanel({ state, fixture }: { state: SensesState; fixture?: boolean }) {
  const l = state.latest?.learned
  const trusted = state.readiness?.zones_trusted === true
  const answering = state.train?.status === 'answering'
  const view = learnedView(l, trusted)
  const rows = trusted ? STATES : STATES.filter((s) => s !== 'desk' && s !== 'bed')
  const reading: LampReading = l ? { state: state.latest?.source === 'hardware' && !fixture ? 'live' : 'simulated', since: null, reason: 'advisory: shown, not used until it earns it' } : { state: 'waiting', since: null, reason: state.latest ? 'no trained model yet' : 'waiting for frames' }
  return (
    <Panel tag="MOD" title="Spatial model" reading={reading} className="js-p-learned" aside={<span className="js-chip-sim" data-quiet="true">advisory</span>}>
      {!l || !view ? <p className="js-note">{state.latest ? 'No trained model yet.' : 'Waiting for frames.'}</p> : (
        <>
          <p className="js-learned-top"><b>{!trusted && view.top === 'room' ? 'In the room, not sure where' : PLACE_WORD[view.top] ?? view.top}</b><span className="js-mono-dim">{answering ? 'answering' : 'predicting'}</span></p>
          <ul className="js-bars" aria-label="The model's belief per place">
            {rows.map((s) => {
              const p = view.rows.find((r) => r.id === s)?.p ?? 0
              return <li key={s} data-top={s === view.top ? 'true' : undefined}><span>{PLACE_WORD[s]}</span><span className="js-ev-bar" data-source={reading.state === 'live' ? 'live' : 'simulated'}><i style={{ width: `${p * 100}%` }} /></span><em>{answering ? `${Math.round(p * 100)}` : ''}</em></li>
            })}
          </ul>
          {l.activity && (
            <p className="js-readline">kind of motion, advisory: <b>{MOTION_WORD[l.activity.state] ?? l.activity.state}</b></p>
          )}
          <p className="js-readline js-mono-dim">trained: {l.trained ?? '--'}{l.reference ? `, reference ${l.reference}` : ''}</p>
        </>
      )}
    </Panel>
  )
}
