/**
 * Aankhen: the spatial twin, full-bleed, with its instruments laid over it.
 *
 *   presence core   72 ticks lit = P(someone is in the room); the three arcs are
 *                   the evidence RIGHT NOW — radar, Wi-Fi (both for presence) and
 *                   absence (against) — so you can see why it believes what it does
 *   Wi-Fi motion    the motion score over 30 s on a log scale, with the decision
 *                   threshold drawn: every "motion" call is explainable
 *   channel         51 subcarrier amplitudes as a dot matrix (Nothing-style: the
 *                   unlit dots are the scale)
 *   sim check       only in simulation: live error between the tracked and the
 *                   true positions — the twin grades itself
 */
import { Box, Crosshair, Layers, Map as MapIcon, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { openSocket, post } from '../lib/api'
import { fmt, fmtDur } from '../lib/format'
import { useStore } from '../lib/store'
import { SpatialTwin, type FrameMsg, type HeatMsg, type Layer, type RoomSpec } from '../twin/SpatialTwin'

interface StatusMsg {
  type: 'status'; source: string
  sensors: Record<string, { state: string; detail: string }>
  link: { frames_ok?: number; crc_errors?: number; loss_ratio?: number; port?: string | null }
  room_measured: boolean
  hub?: { running: boolean; mode: string | null; kind: string | null; scenario: string | null; scenarios: string[]; baseline: string; error: string | null }
}

const SOURCE: Record<string, { label: string; cls: string }> = {
  hardware: { label: 'LIVE · ESP32 hardware', cls: 'live' },
  simulation: { label: 'SIMULATION · not measured', cls: 'sim' },
  replay: { label: 'REPLAY · recorded data', cls: 'sim' },
}
const LAYERS: { id: Layer; label: string }[] = [
  { id: 'walls', label: 'Walls' }, { id: 'heat', label: 'Heat' }, { id: 'fov', label: 'Radar' },
  { id: 'fresnel', label: 'Wi-Fi zone' }, { id: 'trails', label: 'Trails' }, { id: 'labels', label: 'Labels' },
  { id: 'truth', label: 'Truth' },
]

export function AankhenPage() {
  const host = useRef<HTMLDivElement>(null)
  const twin = useRef<SpatialTwin | null>(null)
  const sock = useRef<ReturnType<typeof openSocket> | null>(null)
  const toast = useStore((s) => s.toast)
  const [frame, setFrame] = useState<FrameMsg | null>(null)
  const [status, setStatus] = useState<StatusMsg | null>(null)
  const [room, setRoom] = useState<RoomSpec | null>(null)
  const [online, setOnline] = useState(false)
  const [view, setView] = useState<'3d' | 'plan'>('3d')
  const [heatLayer, setHeatLayer] = useState<'live' | 'learned'>('live')
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ walls: true, heat: true, fov: true, fresnel: true, trails: true, labels: true, truth: true })
  const [hist, setHist] = useState<{ score: number; thr: number }[]>([])
  const lastUi = useRef(0)

  useEffect(() => {
    const t = new SpatialTwin(host.current!)
    twin.current = t
    ;(window as unknown as { __twin: () => unknown }).__twin = () => t.probe()
    sock.current = openSocket('/ws/aankhen', (raw) => {
      const m = raw as { type: string }
      if (m.type === 'room') {
        const r = (m as unknown as { room: RoomSpec }).room
        t.setRoom(r)
        setRoom(r)
      } else if (m.type === 'frame') {
        const f = m as FrameMsg
        t.onFrame(f)
        const sc = f.motion_detail.score
        if (sc !== null && sc !== undefined) {
          setHist((h) => [...h.slice(-299), { score: sc, thr: f.motion_detail.threshold ?? 0 }])
        }
        const now = performance.now()
        if (now - lastUi.current > 180) { lastUi.current = now; setFrame(f) }   // HUD at ~5 Hz
      } else if (m.type === 'heatmap') {
        t.onHeatmap(m as HeatMsg)
      } else if (m.type === 'status') {
        setStatus(m as StatusMsg)
      }
    }, (s) => {
      setOnline(s === 'open')
      if (s === 'open') sock.current?.send({ type: 'hello', want: 'snapshot', layer: 'live' })
    })
    return () => {
      sock.current?.close()
      t.dispose()
      twin.current = null
    }
  }, [])

  const toggleLayer = (l: Layer) => {
    const on = !layers[l]
    setLayers({ ...layers, [l]: on })
    twin.current?.setLayer(l, on)
  }
  const switchView = (v: '3d' | 'plan') => { setView(v); twin.current?.setView(v) }
  const switchHeat = (l: 'live' | 'learned') => { setHeatLayer(l); sock.current?.send({ type: 'hello', want: 'heatmap', layer: l }) }
  const startSource = async (body: Record<string, unknown>) => {
    try {
      await post('/api/aankhen/start', body)
      setHist([])
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }

  const src = SOURCE[frame?.source ?? status?.source ?? ''] ?? { label: online ? 'NO SOURCE' : 'DISCONNECTED', cls: 'fault' }
  const stale = !online
  const hub = status?.hub
  return (
    <div className="page full aankhen-page fade-in">
      <div className="twin-stage">
        <div ref={host} className={`twin-host ${stale ? 'stale' : ''}`} />

        <div className="hud hud-tl">
          <div className="hud-title">
            <span className="mono ph-n">03</span>
            <h1 className="display chrome-text">Aankhen</h1>
          </div>
          <span className={`pill ${src.cls} big`}><i className="led" />{stale ? 'DISCONNECTED — showing last data' : src.label}</span>
          <div className="hud-card glass-thin source-card">
            <span className="eyebrow">Source</span>
            <div className="seg sm">
              {(hub?.scenarios ?? ['evening', 'walk', 'still', 'empty']).map((s) => (
                <button key={s} className={hub?.mode === 'simulation' && hub.scenario === s ? 'on' : ''}
                  onClick={() => void startSource({ mode: 'simulation', scenario: s })}>{s}</button>
              ))}
            </div>
            <button className={`btn sm ${hub?.mode === 'hardware' ? 'live' : ''}`} onClick={() => void startSource({ mode: 'hardware' })}>ESP32</button>
            {frame?.scenario && (
              <div className="mono muted scen-t">t {fmt(frame.scenario.t, 0)} s{frame.scenario.period_s ? ` / ${frame.scenario.period_s} s loop` : ''}
                {room && ` · ${room.width}×${room.depth} m${status?.room_measured ? '' : ' (default layout)'}`}</div>
            )}
          </div>
        </div>

        <div className="hud hud-tr">
          <PresenceCore frame={frame} />
        </div>

        <div className="hud hud-right">
          <MotionCard frame={frame} hist={hist} />
          <ChannelCard frame={frame} />
          <PeopleCard frame={frame} />
        </div>

        <div className="hud hud-left">
          <SensorsCard status={status} />
          {frame?.metrics && <SimCheck frame={frame} />}
        </div>

        <div className="hud hud-bl">
          <div className="seg">
            <button className={view === '3d' ? 'on' : ''} onClick={() => switchView('3d')}><Box size={13} style={{ marginRight: 6, verticalAlign: -2 }} />3D</button>
            <button className={view === 'plan' ? 'on' : ''} onClick={() => switchView('plan')}><MapIcon size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Plan</button>
          </div>
          <div className="seg">
            <button className={heatLayer === 'live' ? 'on' : ''} onClick={() => switchHeat('live')}>Live heat</button>
            <button className={heatLayer === 'learned' ? 'on' : ''} onClick={() => switchHeat('learned')}>Learned</button>
          </div>
          <div className="layer-chips">
            <Layers size={14} className="muted" />
            {LAYERS.map((l) => (
              <button key={l.id} className={`chip ${layers[l.id] ? 'on' : ''}`} onClick={() => toggleLayer(l.id)}>{l.label}</button>
            ))}
          </div>
          <button className="btn icon sm ghost" aria-label="Reset camera" onClick={() => twin.current?.resetCamera()}><RotateCcw size={14} /></button>
        </div>

        <div className="hud hud-bc">
          {(frame?.events ?? []).slice(-4).reverse().map((e, i) => (
            <div key={e.id} className={`twin-event ${i === 0 ? 'newest' : ''}`}>
              <Crosshair size={11} />{e.text}<time className="mono">{fmt(e.t % 1000, 0)}</time>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ presence core */
function PresenceCore({ frame }: { frame: FrameMsg | null }) {
  const p = frame?.presence
  const prob = p?.p ?? 0
  const N = 72, R = 76, C = 92
  const lit = Math.round(prob * N)
  const ev = p?.evidence ?? {}
  const arcs = [
    { k: 'radar', label: 'RADAR', max: 4, start: -150, against: false },
    { k: 'wifi', label: 'WI-FI', max: 1, start: -30, against: false },
    { k: 'absence', label: 'QUIET', max: 0.15, start: 90, against: true },
  ]
  const sim = frame && frame.source !== 'hardware'
  const tone = !p ? 'off' : p.state === 'empty' ? 'empty' : p.state === 'uncertain' ? 'unsure' : sim ? 'sim' : 'live'
  const arcPath = (r: number, a0: number, a1: number) => {
    const rad = (d: number) => (d * Math.PI) / 180
    const x0 = C + r * Math.cos(rad(a0)), y0 = C + r * Math.sin(rad(a0))
    const x1 = C + r * Math.cos(rad(a1)), y1 = C + r * Math.sin(rad(a1))
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
  }
  return (
    <div className={`presence-core ${tone}`}>
      <svg width={C * 2} height={C * 2} viewBox={`0 0 ${C * 2} ${C * 2}`}>
        {Array.from({ length: N }, (_, i) => {
          const a = -Math.PI / 2 + (i / N) * Math.PI * 2
          const long = i % 6 === 0
          const r0 = long ? R - 8 : R - 5
          return <line key={i} x1={C + Math.cos(a) * r0} y1={C + Math.sin(a) * r0} x2={C + Math.cos(a) * R} y2={C + Math.sin(a) * R}
            className={i < lit ? 'tick on' : 'tick'} />
        })}
        {arcs.map((a) => {
          const v = Math.min(1, Math.abs(ev[a.k] ?? 0) / a.max)
          return (
            <g key={a.k}>
              <path d={arcPath(60, a.start + 6, a.start + 114)} className="ev-track" />
              <path d={arcPath(60, a.start + 6, a.start + 6 + 108 * v)} className={`ev ${a.against ? 'against' : ''}`} style={{ opacity: v > 0 ? 1 : 0 }} />
            </g>
          )
        })}
      </svg>
      <div className="pc-center">
        <div className="display pc-state">{p ? p.state : '—'}</div>
        <div className="pc-count dot">{p?.count ?? '—'}</div>
        <div className="mono pc-sub">{p ? `P ${prob.toFixed(2)}` : 'no data'}</div>
      </div>
      <div className="pc-legend mono">
        <span className={(ev.radar ?? 0) > 0 ? 'on' : ''}>RADAR</span>
        <span className={(ev.wifi ?? 0) > 0 ? 'on' : ''}>WI-FI</span>
        <span className={(ev.absence ?? 0) < 0 ? 'against' : ''}>QUIET</span>
      </div>
      {p?.reason && <div className="pc-reason">{p.reason}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ Wi-Fi motion */
function MotionCard({ frame, hist }: { frame: FrameMsg | null; hist: { score: number; thr: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const md = frame?.motion_detail
  const sim = frame && frame.source !== 'hardware'
  useEffect(() => {
    const c = ref.current!
    const dpr = Math.min(devicePixelRatio, 2)
    const W = c.clientWidth, H = c.clientHeight
    c.width = W * dpr; c.height = H * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, W, H)
    if (!hist.length) {
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.font = '12px Inter Variable'; g.fillText('waiting for CSI…', 8, H / 2); return
    }
    // log scale: the empty room (1×) and a walking person (50×+) both stay readable
    const lo = Math.log10(0.5), hi = Math.log10(Math.max(20, ...hist.map((h) => h.score)) * 1.2)
    const y = (v: number) => H - ((Math.log10(Math.max(v, 0.5)) - lo) / (hi - lo)) * (H - 6) - 3
    for (const ref1 of [1, 10, 100]) {
      if (Math.log10(ref1) > hi) break
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.moveTo(0, y(ref1)); g.lineTo(W, y(ref1)); g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.font = '9px Geist Mono Variable'; g.fillText(`${ref1}×`, 3, y(ref1) - 3)
    }
    const thr = hist[hist.length - 1].thr
    if (thr) {
      g.strokeStyle = 'rgba(255,176,32,0.9)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(0, y(thr)); g.lineTo(W, y(thr)); g.stroke(); g.setLineDash([])
    }
    const col = sim ? '255,176,32' : '92,225,255'
    const x = (i: number) => (i / 299) * W + (W - (hist.length / 300) * W) * 0
    g.beginPath()
    hist.forEach((h, i) => { const xi = x(i + 300 - hist.length); i ? g.lineTo(xi, y(h.score)) : g.moveTo(xi, y(h.score)) })
    g.strokeStyle = `rgba(${col},0.95)`; g.lineWidth = 1.6; g.stroke()
    g.lineTo(x(299), H); g.lineTo(x(300 - hist.length), H); g.closePath()
    const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, `rgba(${col},0.25)`); grad.addColorStop(1, `rgba(${col},0)`)
    g.fillStyle = grad; g.fill()
  }, [hist, sim])
  return (
    <div className="hud-card glass-thin">
      <div className="hc-head"><span className="eyebrow">Wi-Fi motion</span>
        <span className={`pill ${md?.state === 'motion' ? (sim ? 'sim' : 'live') : ''}`}>{md?.state ?? '—'}</span></div>
      <div className="hc-big"><span className="dot">{md?.score != null ? `${fmt(md.score, 1)}×` : '—'}</span>
        <span className="muted mono">threshold {md?.threshold != null ? `${fmt(md.threshold, 2)}×` : '—'}</span></div>
      <canvas ref={ref} className="hc-chart" />
      <div className="hc-foot mono muted">
        baseline: {md?.baseline ?? '—'}
        <span className="breath">
          breathing {md?.breathing_bpm ? `${fmt(md.breathing_bpm, 1)}/min` : '—'}
          <span className="sticker"><b>Experimental</b><i><span>lab grade</span></i></span>
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ channel (CSI) */
function ChannelCard({ frame }: { frame: FrameMsg | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const amps = frame?.csi.amplitudes ?? []
  const sim = frame && frame.source !== 'hardware'
  useEffect(() => {
    const c = ref.current!
    const dpr = Math.min(devicePixelRatio, 2)
    const W = c.clientWidth, H = c.clientHeight
    c.width = W * dpr; c.height = H * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, W, H)
    const cols = 51, rows = 9
    const cw = W / cols, rh = H / rows, r = Math.min(cw, rh) * 0.32
    const mx = Math.max(1e-9, ...amps)
    for (let i = 0; i < cols; i++) {
      const lit = amps.length ? Math.round((amps[i] / mx) * rows) : 0
      for (let j = 0; j < rows; j++) {
        const on = j < lit
        g.fillStyle = on ? (sim ? `rgba(255,176,32,${0.45 + 0.55 * j / rows})` : `rgba(92,225,255,${0.45 + 0.55 * j / rows})`) : 'rgba(255,255,255,0.07)'
        g.beginPath(); g.arc(i * cw + cw / 2, H - (j * rh + rh / 2), r, 0, Math.PI * 2); g.fill()
      }
    }
  }, [amps, sim])
  return (
    <div className="hud-card glass-thin">
      <div className="hc-head"><span className="eyebrow">Channel · 51 subcarriers</span>
        <span className="mono muted">{frame ? `${fmt(frame.csi.rate_hz, 0)} Hz · ${frame.csi.rssi ?? '—'} dBm` : '—'}</span></div>
      <canvas ref={ref} className="hc-matrix" />
      <div className="hc-foot mono muted">{frame ? `${fmt(frame.csi.fill_ratio * 100, 1)}% gaps filled · radar ${fmt(frame.rates.radar_hz, 0)} Hz` : ''}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ people + zones */
function PeopleCard({ frame }: { frame: FrameMsg | null }) {
  const sim = frame && frame.source !== 'hardware'
  const zones = Object.entries(frame?.zone_seconds ?? {})
  return (
    <div className="hud-card glass-thin">
      <div className="hc-head"><span className="eyebrow">People · radar</span><span className="mono muted">{frame?.tracks.length ?? 0} tracked</span></div>
      {!frame?.tracks.length && <div className="muted" style={{ fontSize: 12 }}>No confirmed tracks.</div>}
      {frame?.tracks.map((t) => (
        <div key={t.id} className="hc-person">
          <b className={sim ? 'sim' : 'live'}>{t.id}</b>
          <span>{t.zone ?? 'unzoned'}</span>
          <span className="mono">{t.still ? 'still' : `${fmt(t.speed, 1)} m/s`}</span>
          <div className="bar" title="track confidence"><i style={{ width: `${t.conf * 100}%` }} /></div>
        </div>
      ))}
      <div className="hc-zones">
        {zones.map(([z, s]) => (
          <span key={z} className={frame?.zones[z] ? 'on' : ''}>{z}<em className="mono">{fmtDur(s)}</em></span>
        ))}
      </div>
    </div>
  )
}

function SensorsCard({ status }: { status: StatusMsg | null }) {
  return (
    <div className="hud-card glass-thin">
      <div className="hc-head"><span className="eyebrow">Sensors</span></div>
      {Object.entries(status?.sensors ?? {}).map(([k, v]) => (
        <div key={k} className="hc-sensor">
          <i className={`led ${v.state}`} />
          <span>{k}</span>
          <em className="mono">{v.state}</em>
          <small className="mono muted">{v.detail}</small>
        </div>
      ))}
      {status?.link?.frames_ok !== undefined && (
        <div className="hc-foot mono muted">{status.link.frames_ok?.toLocaleString()} frames · {status.link.crc_errors} CRC rejected · {fmt((status.link.loss_ratio ?? 0) * 100, 1)}% lost</div>
      )}
    </div>
  )
}

function SimCheck({ frame }: { frame: FrameMsg }) {
  const m = frame.metrics!
  return (
    <div className="hud-card glass-thin simcheck">
      <div className="hc-head"><span className="eyebrow sim">Simulation check</span><span className="pill sim">ground truth</span></div>
      <div className="hc-big"><span className="dot">{m.mean_error_m != null ? `${Math.round(m.mean_error_m * 100)}` : '—'}</span><span className="muted mono">cm tracking error now</span></div>
      <div className="kv" style={{ marginTop: 6 }}>
        <span>People (truth)</span><span className="mono">{m.truth_n}</span>
        <span>Tracked</span><span className="mono">{m.tracked_n}</span>
        {m.pairs.map((p) => [<span key={p.truth + 'a'}>{p.truth} → {p.track}</span>, <span key={p.truth + 'b'} className="mono">{Math.round(p.error_m * 100)} cm</span>])}
      </div>
    </div>
  )
}
