/**
 * System: is JARVIS answering, and how fast. Everything here is about "I said Jarvis
 * and nothing happened":
 *   S1  can he hear "Hey Jarvis" right now; wake -> heard -> first word -> full reply,
 *       measured from his transcripts (median and p90, 7 days); every wake since the
 *       app started and what came of it
 *   S2  the fixes: restart the brain, free the GPU, run the steward's check; the
 *       steward's own health line; VRAM, small
 *   S3  his recent replies, timed; his process log (the errors are there)
 * Models on disk and the engineering log were here; they answered nothing about him
 * replying, so they went (models are on Connect, with what each can do).
 */
import { useEffect, useRef } from 'react'
import { Gauge as GaugeIcon, RotateCcw, ShieldCheck } from 'lucide-react'
import { api, post } from '../lib/api'
import { loadCrew, sinceTick, stateTone, type Agent } from '../lib/crew'
import { clock, fmtGb, usePoll, useNow } from '../lib/format'
import { useStore } from '../lib/store'
import { freeGpu, fmtS, hearingLine, loadLatency, OUTCOME, restartBrain, type Stat } from '../lib/settings'
import { PageHeader } from '../components/Shell'
import '../styles/connect.css'

export function SystemPage() {
  const vitals = useStore((s) => s.vitals)
  const refresh = useStore((s) => s.refreshVitals)
  const toast = useStore((s) => s.toast)
  const now = useNow(1000) / 1000
  const [lat, , reloadLat] = usePoll(loadLatency, 2000)
  const [crew, , reloadCrew] = usePoll(() => loadCrew(), 4000)
  const [logs] = usePoll(() => api<{ t: number; line: string }[]>('/api/core/logs?n=200'), 2500)
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [logs])

  const hear = hearingLine(lat?.core)
  const s = lat?.summary
  const lastWake = lat?.live.wakes[0]
  const steward: Agent | undefined = crew?.status === 'ok' ? crew.view.agents.find((a) => a.id === 'steward') : undefined
  const tick = steward ? sinceTick(steward.health, now) : null

  const gpu = vitals?.gpu
  const total = gpu?.mem_total_mb ?? 6144
  const llm = (vitals?.ollama ?? []).reduce((a, m) => a + m.vram_mb, 0)
  const used = gpu?.mem_used_mb ?? 0
  const other = Math.max(0, used - llm)

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast(ok, 'info')
    } catch (e) {
      toast((e as Error).message || 'That did not work.', 'fault')
    }
    reloadLat()
    reloadCrew()
    void refresh()
  }

  return (
    <div className="page fade-in">
      <PageHeader tab="system" />
      <div className="sys-grid">
        <section className="card span-8">
          <div className="card-head">
            <span className="card-title"><span className="track">S1</span>Answering you</span>
            <span className="mono muted">{s ? `${s.spoken} spoken repl${s.spoken === 1 ? 'y' : 'ies'} · 7 days` : 'reading transcripts…'}</span>
          </div>
          <div className={`sx-hear ${hear.tone}`}><i className="sx-led" />{hear.text}</div>
          {lat?.core.last_error && <p className="fault cx-small" style={{ margin: '8px 0 0' }}>Last error: {lat.core.last_error}</p>}

          <div className="sx-pipe">
            <div className="sx-stage">
              <span className="eyebrow">Wake</span>
              <span className={`sx-num${lastWake ? '' : ' dim'}`}>{lastWake?.score != null ? lastWake.score.toFixed(2) : '—'}</span>
              <span className="sx-sub">{lastWake ? `last “Hey Jarvis” ${Math.round(now - lastWake.t)} s ago` : 'no wake since the app opened'}</span>
            </div>
            <Stage label="Heard you" st={s?.heard} hint="silence waited + transcribing" />
            <Stage label="First word" st={s?.first_word} hint="you stop → his voice starts" />
            <Stage label="Full reply" st={s?.full} hint="you stop → reply written" />
          </div>
          <p className="muted cx-small" style={{ margin: '0 0 14px' }}>
            Medians (p90 underneath) from his own timings in the transcripts. Wake score: how sure the wake word was; it fires at {lat?.live.threshold ?? 0.35}.
          </p>

          <div className="sx-rows">
            <div className="sx-row head"><span>wake</span><span>score</span><span>outcome</span><span>first word</span><span>reply written</span><span>stopped talking</span></div>
            {lat?.live.wakes.length === 0 && <div className="muted cx-small" style={{ padding: '10px 0' }}>No “Hey Jarvis” since the app opened. Each one will appear here with what came of it.</div>}
            {lat?.live.wakes.slice(0, 8).map((w) => {
              const o = OUTCOME[w.outcome]
              return (
                <div key={w.t} className="sx-row">
                  <span className="mono">{clock(w.t)}</span>
                  <span className={`mono ${w.marginal ? 'sim' : ''}`}>{w.score != null ? w.score.toFixed(2) : '—'}</span>
                  <span><span className={`pill ${o.tone}`}>{o.label}</span></span>
                  <span className="mono">{fmtS(w.first_word)}</span>
                  <span className="mono">{fmtS(w.full)}</span>
                  <span className="mono">{fmtS(w.done_speaking)}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="card span-4">
          <div className="card-head"><span className="card-title"><span className="track">S2</span>Fix it</span>
            <span className="mono muted cx-small">{lat?.core.brain ?? lat?.core.chosen_brain ?? ''}</span></div>
          <div className="sx-actions">
            <button className="btn" onClick={() => void act(restartBrain, 'Restarting JARVIS…')}>
              <RotateCcw size={14} />{lat?.core.running ? 'Restart brain' : 'Start JARVIS (voice)'}
            </button>
            <button className="btn" onClick={() => void act(async () => {
              const r = await freeGpu()
              toast(`Freed ${r.freed_gb} GB: ${r.unloaded.join(', ') || 'nothing was loaded'}.`, 'info')
            }, 'GPU freed. The next question reloads the brain.')}>
              <GaugeIcon size={14} />Unload models
            </button>
            <button className="btn" onClick={() => void act(() => post('/api/crew/steward/run'), 'Steward checked everything.')}>
              <ShieldCheck size={14} />Run the steward check now
            </button>
          </div>

          <div className="eyebrow" style={{ margin: '18px 0 6px' }}>Steward</div>
          <div className="sx-steward">
            {steward ? (
              <>
                <span className={`pill ${stateTone(steward.state) === 'fault' ? 'fault' : stateTone(steward.state) === 'live' ? 'live' : ''}`} style={{ marginRight: 8 }}>
                  <i className="led" />{steward.state}</span>
                {steward.summary}
                <div className={`mono cx-small ${tick?.stale ? 'fault' : 'muted'}`} style={{ marginTop: 6 }}>
                  checked {tick?.text}{steward.health.errors ? ` · ${steward.health.errors} failed check(s)` : ''}
                </div>
              </>
            ) : <span className="muted">{crew?.status === 'error' ? `Staff unreachable: ${crew.message}` : 'The staff is not running yet.'}</span>}
          </div>

          <div className="eyebrow" style={{ margin: '18px 0 0' }}>GPU memory · {gpu?.name ?? 'not readable'}</div>
          <div className="vram-big vram-mini">
            <div className="vram-seg llm" style={{ width: `${(llm / total) * 100}%` }} />
            <div className="vram-seg other" style={{ width: `${(other / total) * 100}%` }} />
          </div>
          <div className="kv">
            <span>Used</span><span className="mono">{fmtGb(used, 1)} / {fmtGb(total, 1)} GB</span>
            {(vitals?.ollama ?? []).map((m) => [<span key={m.name + 'n'}>{m.name}</span>, <span key={m.name + 'v'} className="mono">{fmtGb(m.vram_mb)} GB</span>])}
            {vitals?.ollama?.length === 0 && [<span key="n">Ollama</span>, <span key="v" className="mono">nothing loaded</span>]}
          </div>
        </section>

        <section className="card span-6">
          <div className="card-head"><span className="card-title"><span className="track">S3</span>Recent replies</span>
            <span className="mono muted cx-small">from the transcripts</span></div>
          <div className="sx-rows">
            <div className="sx-row head" style={{ gridTemplateColumns: '120px 70px 1fr 1fr 1fr' }}><span>when</span><span>how</span><span>heard</span><span>first word</span><span>reply written</span></div>
            {lat?.recent.length === 0 && <div className="muted cx-small" style={{ padding: '10px 0' }}>No replies in the last 7 days.</div>}
            {lat?.recent.map((r) => (
              <div key={`${r.ts}`} className="sx-row" style={{ gridTemplateColumns: '120px 70px 1fr 1fr 1fr' }}>
                <span className="mono">{new Date(r.ts * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="muted">{r.spoken ? 'spoken' : 'typed'}</span>
                <span className="mono">{fmtS(r.heard)}</span>
                <span className={`mono ${r.first_word != null && s?.first_word && r.first_word > s.first_word.p90 ? 'sim' : ''}`}>{fmtS(r.first_word)}</span>
                <span className="mono">{fmtS(r.full)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card span-6">
          <div className="card-head"><span className="card-title"><span className="track">S4</span>JARVIS process log</span>
            <span className="mono muted cx-small">{logs?.length ? `${logs.length} lines` : 'empty'}</span></div>
          <div className="log sx-log" ref={logRef}>
            {!logs?.length && <span className="muted">JARVIS hasn’t run in this session.</span>}
            {logs?.map((l, i) => <div key={i} className="ln"><time>{clock(l.t)}</time>{l.line}</div>)}
          </div>
        </section>
      </div>
    </div>
  )
}

function Stage({ label, st, hint }: { label: string; st: Stat | null | undefined; hint: string }) {
  return (
    <div className="sx-stage">
      <span className="eyebrow">{label}</span>
      <span className={`sx-num${st ? '' : ' dim'}`}>{st ? `${st.median.toFixed(1)}s` : '—'}</span>
      <span className="sx-sub">{st ? `p90 ${st.p90.toFixed(1)} s · ${hint}` : hint}</span>
    </div>
  )
}
