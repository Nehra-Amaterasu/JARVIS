/**
 * Teach and train Aankhen from the app (the owner's ask, 2026-10-27): three tabs, plain words.
 *
 *   Mini drill        sitting at the laptop: Start records the board; each tap on a place
 *                     ends the last stretch and starts the next, on the laptop's clock, so
 *                     no sync chirp is needed. Transit buttons ("beside the bed, desk side")
 *                     are for the walk between places.
 *   Phone recording   a major drill recorded on the phone: pick the audio file and the
 *                     narration session, and the narrate pipeline (chirps, Whisper, words to
 *                     places) runs in the background with its progress and a summary
 *   Train             one button: the new training job in the background with a progress
 *                     bar, then the report: balanced accuracy against always saying the
 *                     commonest place with its interval, recall per place, seconds per
 *                     place with what is missing, and the status word
 *
 * Every call is in lib/teachTrain.ts; the server side is routes_aankhen_train.py.
 */
import { Footprints, GraduationCap, Mic, Pause, Play, Sparkles, Square, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import {
  getMini, getNarrate, getNarrateJob, getTrain, pct, placeButtons, secondsOf, startMini, startNarrate, startTrain,
  stopMini, tapMini, type AudioFile, type JobView, type MiniView, type NarrateSession, type NarrateSummary,
  type TrainView, type ZoneLite,
} from '../lib/teachTrain'

type ToastFn = (m: string, tone?: 'live' | 'sim' | 'fault' | 'info') => void
type Tab = 'mini' | 'phone' | 'train'

/** The zone map once (GET /api/aankhen/zones), for the place buttons and the correction picker. */
export function useZones(): ZoneLite[] {
  const [zones, setZones] = useState<ZoneLite[]>([])
  useEffect(() => {
    let alive = true
    api<{ zones: ZoneLite[] }>('/api/aankhen/zones')
      .then((z) => { if (alive) setZones(Array.isArray(z.zones) ? z.zones : []) })
      .catch(() => { /* no zones: the buttons stay empty and say so */ })
    return () => { alive = false }
  }, [])
  return zones
}

/** The model status + training job: every 20 s, every second while the panel is open
 *  and a job runs. The prediction bar reads its status word from here. */
export function useTrain(open: boolean) {
  const [view, setView] = useState<TrainView | null>(null)
  const reload = useCallback(async () => {
    try { setView(await getTrain()) } catch { /* keep the last */ }
  }, [])
  const running = view?.job.state === 'running'
  useEffect(() => {
    void reload()
    const id = window.setInterval(reload, running || open ? (running ? 1000 : 5000) : 20000)
    return () => window.clearInterval(id)
  }, [open, running, reload])
  return { view, reload, setView }
}

function Progress({ job }: { job: JobView }) {
  return (
    <div className="tt-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.fraction * 100)}>
      <div className="tt-progress-head mono"><span>{job.stage || 'working'}</span><span>{Math.round(job.fraction * 100)} %</span></div>
      <div className="meter live"><i style={{ width: `${job.fraction * 100}%` }} /></div>
    </div>
  )
}

export function TeachTrainPanel({ zones, train, live, toast, onClose }: {
  zones: ZoneLite[]; train: ReturnType<typeof useTrain>; live: boolean; toast: ToastFn; onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('mini')
  return (
    <div className="teach-sheet tt-sheet glass slide-up" role="dialog" aria-label="Teach and train Aankhen">
      <div className="ts-head">
        <div className="ts-title"><GraduationCap size={16} /><b>Teach and train Aankhen</b></div>
        <div className="ts-actions">
          <div className="seg" role="tablist" aria-label="Teach">
            <button role="tab" aria-selected={tab === 'mini'} className={tab === 'mini' ? 'on' : ''} onClick={() => setTab('mini')}><Footprints size={12} /> Mini drill</button>
            <button role="tab" aria-selected={tab === 'phone'} className={tab === 'phone' ? 'on' : ''} onClick={() => setTab('phone')}><Mic size={12} /> Phone recording</button>
            <button role="tab" aria-selected={tab === 'train'} className={tab === 'train' ? 'on' : ''} onClick={() => setTab('train')}><Sparkles size={12} /> Train</button>
          </div>
          <button className="btn icon sm ghost" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
      </div>
      {tab === 'mini' && <MiniDrill zones={zones} live={live} toast={toast} />}
      {tab === 'phone' && <PhoneRecording toast={toast} />}
      {tab === 'train' && <TrainTab train={train} toast={toast} />}
    </div>
  )
}

/* ------------------------------------------------------------------ mini drill */
function MiniDrill({ zones, live, toast }: { zones: ZoneLite[]; live: boolean; toast: ToastFn }) {
  const [v, setV] = useState<MiniView | null>(null)
  const recording = !!v?.recording
  const load = useCallback(async () => { try { setV(await getMini()) } catch { /* keep */ } }, [])
  useEffect(() => {
    void load()
    if (!recording) return
    const id = window.setInterval(load, 1000)
    return () => window.clearInterval(id)
  }, [recording, load])
  const run = async (fn: () => Promise<MiniView>) => { try { setV(await fn()) } catch (e) { toast((e as Error).message, 'fault') } }
  const { places, transit } = placeButtons(zones)
  const openZone = v?.open?.zone
  const tile = (z: ZoneLite, small: boolean) => (
    <button key={z.id} className={`ts-tile ${small ? 'tt-transit' : ''} ${openZone === z.id ? 'on' : ''}`} aria-pressed={openZone === z.id}
      disabled={!recording} onClick={() => void run(() => tapMini(z.id))}>
      <span className="ts-name">{z.name}</span>
      <span className="ts-time mono">{openZone === z.id ? `now ${Math.round(v?.open?.seconds ?? 0)} s` : `${Math.round(v?.seconds?.[z.id] ?? 0)} s`}</span>
    </button>
  )
  return (
    <>
      <p className="ts-sub muted">
        {recording
          ? 'Tap where you are each time you move. Each tap ends the last stretch and starts the next; Pause leaves the time unlabelled.'
          : 'Sit at the laptop and press Start: the board records, and you tap the place you are at as you move. The laptop keeps the time, so no chirp is needed.'}
      </p>
      {!zones.length && <p className="muted">No zone map yet: the place buttons come from the room's zones.</p>}
      <div className="tt-places">{places.map((z) => tile(z, false))}</div>
      {transit.length > 0 && <>
        <div className="eyebrow tt-sub">on the way</div>
        <div className="tt-places tt-transit-row">{transit.map((z) => tile(z, true))}</div>
      </>}
      <div className="ts-train">
        <div className="ts-train-text">
          {recording
            ? <span>{v?.spans.length ?? 0} stretches saved{v?.dropped.length ? ` · ${v.dropped.length} dropped (${v.dropped[v.dropped.length - 1].why})` : ''}</span>
            : <span className="muted">{live ? 'The board is live.' : 'Start Aankhen on the ESP32 first: a mini drill records the real board.'}</span>}
        </div>
        {recording ? (
          <span className="ts-actions">
            <button className="btn sm ghost" onClick={() => void run(() => tapMini(null))}><Pause size={12} />Pause</button>
            <button className="btn sm primary" onClick={() => void run(stopMini)}><Square size={12} />Stop and save</button>
          </span>
        ) : (
          <button className="btn sm primary" disabled={!live} onClick={() => void run(() => startMini(null))}><Play size={12} />Start</button>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ phone recording */
function PhoneRecording({ toast }: { toast: ToastFn }) {
  const [sessions, setSessions] = useState<NarrateSession[]>([])
  const [audio, setAudio] = useState<AudioFile[]>([])
  const [path, setPath] = useState('')
  const [session, setSession] = useState('latest')
  const [job, setJob] = useState<JobView | null>(null)
  const [summary, setSummary] = useState<NarrateSummary | null>(null)
  useEffect(() => {
    getNarrate().then((r) => { setSessions(r.sessions); setAudio(r.audio); setJob(r.job) }).catch(() => { /* none yet */ })
  }, [])
  const running = job?.state === 'running'
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(async () => {
      try { const r = await getNarrateJob(); setJob(r.job); setSummary(r.summary) } catch { /* keep */ }
    }, 1500)
    return () => window.clearInterval(id)
  }, [running])
  useEffect(() => {
    if (job?.state === 'done' && !summary) getNarrateJob().then((r) => setSummary(r.summary)).catch(() => {})
  }, [job?.state, summary])
  const go = async () => {
    try { const r = await startNarrate(path.trim(), session); setJob(r.job); setSummary(null) } catch (e) { toast((e as Error).message, 'fault') }
  }
  return (
    <>
      <p className="ts-sub muted">A major drill recorded on the phone: copy its audio file to the laptop, pick it here, and the
        narration becomes labels (the chirps line the phone up with the laptop, then Whisper hears the places).</p>
      <div className="tt-form">
        <label className="tt-field"><span className="eyebrow">Session</span>
          <select value={session} onChange={(e) => setSession(e.target.value)} aria-label="Narration session">
            <option value="latest">the latest</option>
            {sessions.map((s) => <option key={s.folder} value={s.folder}>{s.day} {s.session}{s.labelled ? ' · labelled' : ''}</option>)}
          </select>
        </label>
        <label className="tt-field grow"><span className="eyebrow">Audio file</span>
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\…\recording.m4a" aria-label="Audio file path" spellCheck={false} />
        </label>
      </div>
      {audio.length > 0 && (
        <div className="chips-wrap tt-audio">
          {audio.map((a) => <button key={a.path} className={`chip ${path === a.path ? 'on' : ''}`} onClick={() => setPath(a.path)} title={a.path}>{a.name} · {a.mb} MB</button>)}
        </div>
      )}
      {job && job.state !== 'idle' && (
        <div className="tt-result">
          {job.state === 'running' && <Progress job={job} />}
          {job.state === 'error' && <div className="fault">{job.error}</div>}
          {job.state === 'done' && summary && (
            <div>
              <b>{summary.stretches} labelled stretches</b> from {summary.words} words · {summary.clock}
              <div className="tt-rows">
                {Object.entries(summary.minutes).map(([z, m]) => <span key={z} className="mono">{z.replace(/_/g, ' ')} {m.toFixed(1)} min</span>)}
              </div>
              {!summary.has_empty && <div className="muted">No "leaving the room" stretch: this session has no empty-room reference of its own.</div>}
            </div>
          )}
        </div>
      )}
      <div className="ts-train">
        <div className="ts-train-text muted">Transcribing an hour takes a few minutes; the page can stay open or not.</div>
        <button className="btn sm primary" disabled={running || !path.trim()} onClick={() => void go()}><Mic size={12} />{running ? 'Labelling…' : 'Label it'}</button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ train */
function TrainTab({ train, toast }: { train: ReturnType<typeof useTrain>; toast: ToastFn }) {
  const v = train.view
  const job = v?.job
  const rep = v?.report
  const running = job?.state === 'running'
  const missing = v?.available?.missing ?? []
  const go = async () => {
    try { train.setView(await startTrain(30)) } catch (e) { toast((e as Error).message, 'fault') }
  }
  return (
    <>
      <div className="tt-status">
        <span className={`pill ${v?.status === 'answering' ? 'live' : ''}`}>{v?.status ?? 'predicting'}</span>
        <span className="muted">{v?.status === 'answering'
          ? 'It passed a held-out day: its place is shown as an answer.'
          : 'Until it passes a held-out day (after 4-5 days of drills) its place is shown as a prediction.'}</span>
      </div>
      {missing.length > 0 && <p className="fault tt-missing">Not in this build yet: {missing.join(', ')}.</p>}
      {job && running && <Progress job={job} />}
      {job?.state === 'error' && <p className="fault">{job.error}</p>}
      {rep && (
        <div className="tt-report">
          {rep.balanced != null && (
            <div className="tt-score">
              <div><span className="eyebrow">balanced accuracy</span><b className="dot">{pct(rep.balanced)}</b>
                {rep.interval && <span className="mono muted">{pct(rep.interval[0])}–{pct(rep.interval[1])}</span>}</div>
              <div><span className="eyebrow">always the commonest</span><b className="dot muted">{pct(rep.baseline)}</b></div>
            </div>
          )}
          {rep.lines.map((l, i) => <p key={i} className="tt-line">{l}</p>)}
          {rep.recall.length > 0 && <>
            <div className="eyebrow tt-sub">recall per place</div>
            <div className="lc-rows">
              {rep.recall.map((r) => (
                <div key={r.place} className="lc-row"><span>{r.name}</span>
                  <div className="bar live"><i style={{ width: `${(r.recall ?? 0) * 100}%` }} /></div><em className="mono">{pct(r.recall)}</em></div>
              ))}
            </div>
          </>}
          {rep.seconds.length > 0 && <>
            <div className="eyebrow tt-sub">seconds per place</div>
            <div className="lc-rows">
              {rep.seconds.map((s) => (
                <div key={s.place} className={`lc-row ${s.missing > 0 ? '' : 'on'}`}><span>{secondsOf(s.name, s.have, s.need)}</span>
                  <div className={`bar ${s.missing > 0 ? 'sim' : 'live'}`}><i style={{ width: `${Math.min(100, (s.have / Math.max(1, s.need)) * 100)}%` }} /></div>
                  <em className="mono">{s.missing > 0 ? `−${Math.round(s.missing)}` : 'ok'}</em></div>
              ))}
            </div>
          </>}
        </div>
      )}
      <div className="ts-train">
        <div className="ts-train-text muted">{rep ? '' : 'Trains on every labelled stretch: mini drills, phone recordings, ✓ and corrections.'}</div>
        <button className="btn sm primary" disabled={running || !v?.available?.train_job} onClick={() => void go()}>
          <Sparkles size={13} />{running ? 'Training…' : 'Train'}
        </button>
      </div>
    </>
  )
}
