/**
 * First light: the voice-guided tests that prove the real board sees a real person,
 * run from the Aankhen tab (server: aankhen/firstlight.py Guided, routes_firstlight.py).
 *
 *   test       still / move / walk / type, 20 s each; the laptop speaks every step,
 *              the result is human-band energy per step against the still one
 *   calibrate  you leave the room; 70 s of it empty become the motion baseline and
 *              the spatial model's reference
 */
import { Activity, Footprints, Play, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../lib/api'
import { fmt } from '../lib/format'
import { Ticker } from '../lib/motion'
import type { FrameMsg } from '../twin/SpatialTwin'

interface StepReport { windows: number; hbe_median: number | null; hbe_p90: number | null; mvs_median: number | null; hbe_vs_still?: number }
interface Status {
  state: 'idle' | 'running' | 'done' | 'error'
  kind?: 'test' | 'calibrate'
  step?: string | null; left?: number | null; seconds?: number; index?: number; total?: number; instruction?: string
  report?: Record<string, StepReport>; seen?: number | null; verdict?: string | null; recording?: string
  baseline?: { windows: number; mvs_q: number; hbe_q: number | null; reference: boolean }
  error?: string
}

const STEP_NAMES: Record<string, string> = {
  starting: 'Getting ready', still: 'Sit still', move: 'Move', walk: 'Walk around', type: 'Type',
  leave: 'Leave the room', empty: 'Room empty', analysing: 'Analysing',
}

export function FirstLightSheet({ frame, live, onClose, toast }: {
  frame: FrameMsg | null; live: boolean; onClose: () => void; toast: (m: string, tone?: 'fault' | 'live' | 'sim' | 'info') => void
}) {
  const [s, setS] = useState<Status>({ state: 'idle' })
  useEffect(() => {
    let alive = true
    const load = async () => { try { const v = await api<Status>('/api/aankhen/firstlight'); if (alive) setS(v) } catch { /* keep */ } }
    void load()
    const id = window.setInterval(load, 400)
    return () => { alive = false; window.clearInterval(id) }
  }, [])
  const start = async (kind: 'test' | 'calibrate') => {
    try { setS(await post<Status>('/api/aankhen/firstlight/start', { kind })) } catch (e) { toast((e as Error).message, 'fault') }
  }
  const hb = frame?.motion_detail.human_band
  const energyPct = hb ? Math.min(100, Math.max(0, Math.log(Math.max(hb.energy, 1)) / Math.log(50)) * 100) : 0
  const running = s.state === 'running'
  const rep = s.report ?? {}
  const maxX = Math.max(1, ...Object.values(rep).map((r) => r.hbe_vs_still ?? 1))
  return (
    <div className="teach-sheet fl-sheet glass slide-up" role="dialog" aria-label="First light">
      <div className="ts-head">
        <div className="ts-title">
          {running ? <i className="rec-dot" /> : <Sparkles size={16} />}
          <b>{running ? (s.kind === 'calibrate' ? 'Calibrating the empty room' : 'First light — follow the voice') : 'First light'}</b>
          <span className={`pill ${live ? 'live' : 'fault'}`}>{live ? 'ESP32 live' : 'board not live'}</span>
        </div>
        <button className="btn icon sm ghost" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>

      {s.state === 'running' && (
        <div className="fl-run">
          <div key={s.step ?? '-'} className="fl-step pop">
            <span className="mono muted">{s.index != null && s.total ? `${s.index + 1} / ${s.total}` : ''}</span>
            <span className="display">{STEP_NAMES[s.step ?? ''] ?? s.step}</span>
          </div>
          <div className="fl-left dot">{s.left != null ? <Ticker value={Math.ceil(s.left)} /> : '—'}<em className="mono">s</em></div>
          <p className="ts-sub muted fl-instr">{s.instruction ?? 'Listen to the laptop.'}</p>
          <div className="fl-live">
            <span className="mono">you, right now</span>
            <div className="meter live"><i style={{ width: `${energyPct}%` }} /><b style={{ left: `${(Math.log(1.6) / Math.log(50)) * 100}%` }} /></div>
            <span className="mono">{hb ? `${fmt(hb.energy, 1)}× noise` : '—'}</span>
          </div>
        </div>
      )}

      {s.state === 'done' && s.kind === 'test' && (
        <div className="fl-result rise">
          <div className="fl-verdict">
            <span className={`pill ${s.verdict === 'clearly seen' ? 'live' : s.verdict === 'weakly seen' ? 'sim' : 'fault'} big`}>{s.verdict ?? 'no verdict'}</span>
            {s.seen != null && <span className="mono muted">moving = <b className="dot"><Ticker value={s.seen} fmt={(n) => `${n.toFixed(1)}×`} /></b> the still level</span>}
          </div>
          <div className="fl-rows">
            {Object.entries(rep).map(([step, r], i) => (
              <div key={step} className="fl-row rise" style={{ ['--i' as string]: i }}>
                <span>{STEP_NAMES[step] ?? step}</span>
                <div className="bar live"><i style={{ width: `${((r.hbe_vs_still ?? 1) / maxX) * 100}%` }} /></div>
                <em className="mono">{fmt(r.hbe_median, 2)}</em>
                <em className="mono muted">{r.hbe_vs_still ? `${fmt(r.hbe_vs_still, 1)}×` : '—'}</em>
              </div>
            ))}
          </div>
          <p className="ts-sub muted">Human-band energy per step (≈1 is noise alone). Saved as {s.recording} — real labelled data for the model.</p>
        </div>
      )}
      {s.state === 'done' && s.kind === 'calibrate' && s.baseline && (
        <div className="fl-result rise">
          <div className="fl-verdict"><span className="pill live big">calibrated</span>
            <span className="mono muted"><Ticker value={s.baseline.windows} /> empty-room windows · reference {s.baseline.reference ? 'recorded' : 'missing'}</span></div>
          <p className="ts-sub muted">Motion now has a measured threshold (human band {fmt(s.baseline.hbe_q, 2)}× noise) and the spatial model measures change against your empty room.</p>
        </div>
      )}
      {s.state === 'error' && <p className="fault fl-err">{s.error}</p>}

      {!running && (
        <div className="fl-actions">
          <button className="fl-tile press" disabled={!live} onClick={() => void start('test')}>
            <Activity size={18} /><b>Two-minute test</b><span className="muted">Still, move, walk, type. The laptop speaks each step; shows whether the board sees you.</span>
            <i className="btn sm primary"><Play size={12} />Run</i>
          </button>
          <button className="fl-tile press" disabled={!live} onClick={() => void start('calibrate')}>
            <Footprints size={18} /><b>Calibrate the empty room</b><span className="muted">You leave for about 90 s. Sets the motion threshold and the model's reference.</span>
            <i className="btn sm"><Play size={12} />Start</i>
          </button>
        </div>
      )}
    </div>
  )
}
