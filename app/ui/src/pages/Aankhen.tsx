/**
 * Aankhen: the spatial twin, full-bleed, with its instruments laid over it.
 *
 *   presence core   72 ticks lit = P(someone is in the room); the three arcs are
 *                   the evidence RIGHT NOW — radar, Wi-Fi (both for presence) and
 *                   absence (against) — so you can see why it believes what it does
 *   Wi-Fi motion    the motion score over 30 s on a log scale, with the decision
 *                   threshold drawn, and the human-band test (body-speed movement)
 *                   as a meter against its own threshold
 *   spatial model   the learned model's belief over five states (advisory: it never
 *                   drives presence until its score on my own recordings earns it)
 *   teach           label what I am doing while Aankhen records; train; the score
 *                   is measured on time the model never saw
 *   channel         51 subcarrier amplitudes as a dot matrix (Nothing-style: the
 *                   unlit dots are the scale)
 *   sim check       only in simulation: live error between the tracked and the
 *                   true positions — the twin grades itself
 *   belief          the dot cloud in the twin is where movement / presence probably
 *                   is (twin/BeliefCloud.ts): dots per zone ∝ probability, no body,
 *                   because Aankhen sees none; the legend says so, and the zone map
 *                   (circles with names) shows the zones I train against
 *
 * Three views share the stage: 3D, Plan (the twin's two cameras) and Eyes
 * (components/EyesView: the Wi-Fi channel itself, as a waterfall and a spectrum). In
 * Eyes the twin stays mounted but paused and hidden, its HUD steps aside, and the
 * socket asks the hub for the "eyes" stream (hello want/drop), which it only sends
 * to viewers that ask.
 *
 * Colour is provenance everywhere: cyan measured by the ESP32, amber simulated.
 */
import { Box, Crosshair, GraduationCap, Home, Layers, Map as MapIcon, Pause, RotateCcw, ScanEye, Square, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, openSocket, post } from '../lib/api'
import { fmt, fmtDur } from '../lib/format'
import { Presence, Ticker } from '../lib/motion'
import { useStore, type Toast } from '../lib/store'
import type { EyesMsg } from '../lib/eyes'
import { EyesView } from '../components/EyesView'
import { FirstLightSheet } from '../components/FirstLight'
import { DEFAULT_LAYERS, LAYERS } from '../twin/layers'
import { SpatialTwin, type BeliefSummary, type FrameMsg, type Framing, type HeatMsg, type Layer, type RoomSpec } from '../twin/SpatialTwin'

type View = '3d' | 'plan' | 'eyes'
const VIEW_KEY = 'jarvis.aankhen.view'
const savedView = (): View => {
  try {
    const v = sessionStorage.getItem(VIEW_KEY)
    return v === 'plan' || v === 'eyes' ? v : '3d'
  } catch {
    return '3d'
  }
}

interface HubInfo { running: boolean; mode: string | null; kind: string | null; scenario: string | null; scenarios: string[]; baseline: string; error: string | null; layout?: string }
interface StatusMsg {
  type: 'status'; source: string
  sensors: Record<string, { state: string; detail: string }>
  link: { frames_ok?: number; crc_errors?: number; loss_ratio?: number; port?: string | null }
  room_measured: boolean
  hub?: HubInfo
  belief?: unknown
}
interface TeachStatus {
  recording: boolean; simulated: boolean
  current: { label: string; name: string; seconds: number } | null
  labels: Record<string, string>; totals: Record<string, number>
  training: { state: 'idle' | 'running' | 'done' | 'error'; step?: string; error?: string; occupancy_accuracy?: number; five_way_accuracy?: number; zone_accuracy?: number; held_out_windows?: number }
}

const SOURCE: Record<string, { label: string; cls: string }> = {
  hardware: { label: 'LIVE · ESP32 hardware', cls: 'live' },
  simulation: { label: 'SIMULATION · not measured', cls: 'sim' },
  replay: { label: 'REPLAY · recorded data', cls: 'sim' },
}
const LAYOUT: Record<string, { label: string; cls: string; hint: string }> = {
  measured: { label: 'Layout · measured', cls: 'live', hint: 'room.json measured with a tape' },
  estimated: { label: 'Layout · estimated', cls: 'sim', hint: 'read off a sketch and photos; measure it and set "measured": true' },
  default: { label: 'Layout · default 4×4 m', cls: '', hint: 'no room.json yet: copy aankhen/room.example.json to data/aankhen/room.json' },
}
// The learned model's five states, as I would say them.
const STATES: { id: string; name: string }[] = [
  { id: 'empty', name: 'Room empty' }, { id: 'outside', name: 'Outside my room' }, { id: 'room', name: 'In my room' },
  { id: 'desk', name: 'At my desk' }, { id: 'bed', name: 'In bed' },
]
const ACT_NAMES: Record<string, string> = { none: 'Not in the room', still: 'Still', typing: 'Typing', waving: 'Waving', walking: 'Walking' }
// Teach labels and their keys (teach.py LABELS).
const TEACH_KEYS: { id: string; key: string }[] = [
  { id: 'desk', key: 'D' }, { id: 'bed', key: 'B' }, { id: 'walk', key: 'W' }, { id: 'hallway', key: 'O' }, { id: 'empty', key: 'E' },
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
  const [view, setViewState] = useState<View>(savedView)
  const viewRef = useRef<View>(view)
  // The eyes stream (10 Hz) goes straight to EyesView's drawing loop, never through React state.
  const eyesSink = useRef<((m: EyesMsg) => void) | null>(null)
  const [framing, setFramingState] = useState<Framing>('room')
  const [heatLayer, setHeatLayer] = useState<'live' | 'learned'>('live')
  const [layers, setLayers] = useState<Record<Layer, boolean>>(DEFAULT_LAYERS)
  // What the belief cloud says ("probably: at the desk chair · 62 %"), or null with no belief.
  const [est, setEst] = useState<BeliefSummary | null>(null)
  const [hist, setHist] = useState<{ score: number; thr: number }[]>([])
  const [teachOpen, setTeachOpen] = useState(false)
  const [flOpen, setFlOpen] = useState(false)
  const lastUi = useRef(0)

  useEffect(() => {
    const t = new SpatialTwin(host.current!)
    twin.current = t
    t.onEstimate = setEst
    if (viewRef.current === 'plan') t.setView('plan')
    t.setPaused(viewRef.current === 'eyes')
    ;(window as unknown as { __twin: () => unknown }).__twin = () => t.probe()
    sock.current = openSocket('/ws/aankhen', (raw) => {
      const m = raw as { type: string }
      if (m.type === 'eyes') {
        eyesSink.current?.(m as EyesMsg)
      } else if (m.type === 'room') {
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
        const st = m as StatusMsg
        setStatus(st)
        if (st.belief) t.onBelief(st.belief, st.source)
      }
    }, (s) => {
      setOnline(s === 'open')
      // a reconnect starts a new subscription: ask for the eyes again if they are on screen
      if (s === 'open') sock.current?.send({ type: 'hello', want: viewRef.current === 'eyes' ? ['snapshot', 'eyes'] : 'snapshot', layer: 'live' })
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
  const switchView = (v: View) => {
    const was = viewRef.current
    if (v === was) return
    viewRef.current = v
    setViewState(v)
    try { sessionStorage.setItem(VIEW_KEY, v) } catch { /* private window: not remembered */ }
    twin.current?.setPaused(v === 'eyes')
    if (v !== 'eyes') twin.current?.setView(v)
    // The hub builds the eyes stream only for viewers that ask; stop asking when it is off screen.
    if (v === 'eyes') sock.current?.send({ type: 'hello', want: 'eyes' })
    else if (was === 'eyes') sock.current?.send({ type: 'hello', drop: 'eyes' })
  }
  const setFraming = (f: Framing) => { setFramingState(f); twin.current?.setFraming(f) }
  const switchHeat = (l: 'live' | 'learned') => { setHeatLayer(l); sock.current?.send({ type: 'hello', want: 'heatmap', layer: l }) }
  const startSource = async (body: Record<string, unknown>) => {
    try {
      await post('/api/aankhen/start', body)
      setHist([])
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }

  const teach = useTeach(teachOpen, toast)

  const src = SOURCE[frame?.source ?? status?.source ?? ''] ?? { label: online ? 'NO SOURCE' : 'DISCONNECTED', cls: 'fault' }
  const stale = !online
  const hub = status?.hub
  const sim = !!frame && frame.source !== 'hardware'
  const layout = LAYOUT[hub?.layout ?? (status?.room_measured ? 'measured' : 'default')] ?? LAYOUT.default
  const hasHouse = !!room?.house && (room.house.areas.length > 0 || room.house.fixtures.length > 0)
  const eyes = view === 'eyes'
  return (
    <div className={`page full aankhen-page fade-in ${sim ? 'is-sim' : 'is-live'} ${eyes ? 'view-eyes' : ''}`}>
      <div className="twin-stage">
        <div ref={host} className={`twin-host ${stale ? 'stale' : ''}`} aria-hidden={eyes} />
        <Presence show={eyes}>
          <EyesView frame={frame} online={online} sinkRef={eyesSink} />
        </Presence>

        <div className="hud hud-col-left">
          <div className="hud-title rise">
            <span className="mono ph-n">03</span>
            <h1 className="display chrome-text">Aankhen</h1>
          </div>
          <div className="hud-pills rise" style={{ ['--i' as string]: 1 }}>
            <span className={`pill ${src.cls} big`}><i className={`led ${!stale && src.cls !== 'fault' ? 'breathe' : ''}`} />{stale ? 'DISCONNECTED — showing last data' : src.label}</span>
            <span className={`pill ${layout.cls}`} title={layout.hint}>{layout.label}</span>
          </div>
          <SourceCard hub={hub} frame={frame} room={room} onStart={startSource} />
          <SensorsCard status={status} />
          <LearnedCard frame={frame} onTeach={() => setTeachOpen(true)} />
          {frame?.metrics && <SimCheck frame={frame} />}
        </div>

        <Presence show={!!est && layers.estimate && !eyes}>
          <div className="hud hud-tc">
            <div className={`est-legend ${est?.state ?? ''}`} role="note"
              title="Aankhen sees no body, only where movement probably is. Each zone gets dots in proportion to its probability; the cloud spreads and jitters with motion and fades when the model is unsure.">
              <i className="est-swatch" aria-hidden />
              <b>{est?.label}</b>
              <span>dots = probability, not a person{est?.fallback ? ' · from the learned states' : ''}</span>
            </div>
          </div>
        </Presence>

        <div className="hud hud-col-right">
          <PresenceCore frame={frame} />
          <MotionCard frame={frame} hist={hist} />
          <ChannelCard frame={frame} />
        </div>

        <div className="hud hud-bl">
          <div className="seg" role="tablist" aria-label="View">
            <button className={view === '3d' ? 'on' : ''} role="tab" aria-selected={view === '3d'} onClick={() => switchView('3d')}><Box size={13} style={{ marginRight: 6, verticalAlign: -2 }} />3D</button>
            <button className={view === 'plan' ? 'on' : ''} role="tab" aria-selected={view === 'plan'} onClick={() => switchView('plan')}><MapIcon size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Plan</button>
            <button className={view === 'eyes' ? 'on' : ''} role="tab" aria-selected={eyes} title="What the Wi-Fi channel itself sees" onClick={() => switchView('eyes')}><ScanEye size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Eyes</button>
          </div>
          {!eyes && <>
          {hasHouse && (
            <div className="seg">
              <button className={framing === 'room' ? 'on' : ''} onClick={() => setFraming('room')}>My room</button>
              <button className={framing === 'house' ? 'on' : ''} onClick={() => setFraming('house')}><Home size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Whole house</button>
            </div>
          )}
          <div className="seg">
            <button className={heatLayer === 'live' ? 'on' : ''} onClick={() => switchHeat('live')}>Live heat</button>
            <button className={heatLayer === 'learned' ? 'on' : ''} onClick={() => switchHeat('learned')}>Learned</button>
          </div>
          <div className="layer-chips">
            <Layers size={14} className="muted" />
            {LAYERS.filter((l) => l.id !== 'house' || hasHouse).map((l) => (
              <button key={l.id} className={`chip ${layers[l.id] ? 'on' : ''}`} onClick={() => toggleLayer(l.id)}>{l.label}</button>
            ))}
          </div>
          <button className="btn icon sm ghost" aria-label="Reset camera" title="Reset camera" onClick={() => twin.current?.resetCamera()}><RotateCcw size={14} /></button>
          <button className={`btn sm teach-btn ${frame?.source === 'hardware' ? 'live' : ''}`} onClick={() => { setTeachOpen(false); setFlOpen((o) => !o) }} aria-expanded={flOpen}>
            <Sparkles size={14} />First light
          </button>
          <button className={`btn sm ${teach.status?.recording ? 'recording-btn' : ''}`} onClick={() => { setFlOpen(false); setTeachOpen((o) => !o) }} aria-expanded={teachOpen}>
            {teach.status?.recording ? <i className="rec-dot" /> : <GraduationCap size={14} />}
            {teach.status?.recording ? 'Teaching' : 'Teach'}
          </button>
          </>}
        </div>

        <Presence show={!teachOpen && !flOpen && !eyes}>
          <div className="hud hud-bc">
            {(frame?.events ?? []).slice(-4).reverse().map((e, i) => (
              <div key={e.id} className={`twin-event ${i === 0 ? 'newest' : ''}`}>
                <Crosshair size={11} />{e.text}<time className="mono">{fmt(e.t % 1000, 0)}</time>
              </div>
            ))}
          </div>
        </Presence>
        <Presence show={teachOpen && !eyes}>
          <TeachSheet t={teach} onClose={() => setTeachOpen(false)} />
        </Presence>
        <Presence show={flOpen && !eyes}>
          <FirstLightSheet frame={frame} live={frame?.source === 'hardware' && online} onClose={() => setFlOpen(false)} toast={toast} />
        </Presence>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ teach state */
type Teach = ReturnType<typeof useTeach>
function useTeach(open: boolean, toast: (m: string, tone?: Toast['tone']) => void) {
  const [status, setStatus] = useState<TeachStatus | null>(null)
  const busy = !!status && (status.recording || status.training.state === 'running')
  const load = useCallback(async () => {
    try { setStatus(await api<TeachStatus>('/api/aankhen/teach')) } catch { /* keep the last */ }
  }, [])
  useEffect(() => {
    void load()
    if (!open && !busy) return
    const id = window.setInterval(load, 1000)
    return () => window.clearInterval(id)
  }, [open, busy, load])
  const act = useCallback(async (path: string, body: unknown = {}) => {
    try { setStatus(await post<TeachStatus>(path, body)) } catch (e) { toast((e as Error).message, 'fault') }
  }, [toast])
  const label = useCallback((l: string | null) => act('/api/aankhen/teach/label', { label: l }), [act])
  const stop = useCallback(() => act('/api/aankhen/teach/stop'), [act])
  const train = useCallback(async () => {
    try { await post('/api/aankhen/learn/train', { include_sim: true }); await load() } catch (e) { toast((e as Error).message, 'fault') }
  }, [load, toast])
  return { status, label, stop, train }
}

function TeachSheet({ t, onClose }: { t: Teach; onClose: () => void }) {
  const s = t.status
  const { label, stop } = t
  // Keys while the sheet is open: D B W O E label, P pauses, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest?.('input, textarea')) return
      const k = e.key.toUpperCase()
      const hit = TEACH_KEYS.find((x) => x.key === k)
      if (hit) { e.preventDefault(); void label(hit.id) }
      else if (k === 'P') { e.preventDefault(); void label(null) }
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [label, onClose])
  const tr = s?.training
  const learned = Object.values(s?.totals ?? {}).reduce((a, b) => a + b, 0)
  return (
    <div className="teach-sheet glass slide-up" role="dialog" aria-label="Teach Aankhen">
      <div className="ts-head">
        <div className="ts-title">
          {s?.recording ? <i className="rec-dot" /> : <GraduationCap size={16} />}
          <b>{s?.recording ? 'Recording what you label' : 'Teach Aankhen your room'}</b>
          {s?.simulated && <span className="pill sim" title="Sessions recorded from the simulator are named teach-sim-* and never trained on">Practice · simulator</span>}
        </div>
        <div className="ts-actions">
          {s?.recording && <button className="btn sm ghost" onClick={() => void stop()}><Square size={12} />End session</button>}
          <button className="btn icon sm ghost" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
      </div>
      <p className="ts-sub muted">Tap what you are doing right now, or press its key. Each label holds until the next; a few minutes of each, on different days, teaches it best.</p>
      <div className="ts-tiles">
        {TEACH_KEYS.map((k, i) => {
          const on = s?.current?.label === k.id
          return (
            <button key={k.id} className={`ts-tile pop ${on ? 'on' : ''}`} style={{ ['--i' as string]: i }} onClick={() => void label(on ? null : k.id)} aria-pressed={on}>
              <kbd>{k.key}</kbd>
              <span className="ts-name">{s?.labels?.[k.id] ?? k.id}</span>
              <span className="ts-time mono">
                {on ? <>now <Ticker value={s?.current?.seconds ?? 0} fmt={(n) => fmtDur(n)} /></> : <>learned <Ticker value={s?.totals?.[k.id] ?? 0} fmt={(n) => fmtDur(n)} /></>}
              </span>
              <i className="ts-fill" style={{ width: `${Math.min(100, ((s?.totals?.[k.id] ?? 0) / 600) * 100)}%` }} />
            </button>
          )
        })}
        <button className={`ts-tile pause pop ${s?.recording && !s.current ? 'on' : ''}`} style={{ ['--i' as string]: 5 }} onClick={() => void label(null)} disabled={!s?.recording}>
          <kbd>P</kbd><span className="ts-name"><Pause size={13} /> Pause</span><span className="ts-time mono">unlabelled</span>
        </button>
      </div>
      <div className="ts-train">
        <div className="ts-train-text">
          {tr?.state === 'running' && <span className="scan ts-step">{tr.step ?? 'training'}…</span>}
          {tr?.state === 'done' && (
            <span className="rise">Held-out score: occupancy <b className="dot"><Ticker value={(tr.occupancy_accuracy ?? 0) * 100} fmt={(n) => `${n.toFixed(1)}%`} /></b>
              {' · '}five states <b className="dot"><Ticker value={(tr.five_way_accuracy ?? 0) * 100} fmt={(n) => `${n.toFixed(1)}%`} /></b>
              <span className="muted"> on {tr.held_out_windows?.toLocaleString()} windows it never saw · now live</span></span>
          )}
          {tr?.state === 'error' && <span className="fault">{tr.error}</span>}
          {(!tr || tr.state === 'idle') && <span className="muted">{learned > 0 ? `${fmtDur(learned)} labelled in your room so far.` : 'Nothing labelled in your room yet — simulator practice never counts.'}</span>}
        </div>
        <button className="btn sm primary" disabled={tr?.state === 'running' || learned <= 0} onClick={() => void t.train()}>
          <Sparkles size={13} />{tr?.state === 'running' ? 'Training…' : 'Train on my labels'}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ source */
function SourceCard({ hub, frame, room, onStart }: { hub?: HubInfo; frame: FrameMsg | null; room: RoomSpec | null; onStart: (b: Record<string, unknown>) => void }) {
  const scen = hub?.scenarios ?? ['evening', 'walk', 'still', 'empty']
  return (
    <div className="hud-card glass-thin source-card rise" style={{ ['--i' as string]: 2 }}>
      <div className="hc-head"><span className="eyebrow">Source</span>
        <button className={`btn sm ${hub?.mode === 'hardware' ? 'live' : ''}`} onClick={() => onStart({ mode: 'hardware' })}>ESP32</button></div>
      <div className="chips-wrap">
        {scen.map((s) => (
          <button key={s} className={`chip ${hub?.mode === 'simulation' && hub.scenario === s ? 'on sim' : ''}`}
            onClick={() => onStart({ mode: 'simulation', scenario: s })}>{s}</button>
        ))}
      </div>
      {frame?.scenario && (
        <div className="mono muted scen-t">t <Ticker value={frame.scenario.t} /> s{frame.scenario.period_s ? ` / ${frame.scenario.period_s} s loop` : ''}
          {room && ` · ${room.width}×${room.depth} m`}</div>
      )}
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
    <div className={`presence-core rise ${tone}`}>
      <svg width={C * 2} height={C * 2} viewBox={`0 0 ${C * 2} ${C * 2}`}>
        {Array.from({ length: N }, (_, i) => {
          const a = -Math.PI / 2 + (i / N) * Math.PI * 2
          const long = i % 6 === 0
          const r0 = long ? R - 8 : R - 5
          return <line key={i} x1={C + Math.cos(a) * r0} y1={C + Math.sin(a) * r0} x2={C + Math.cos(a) * R} y2={C + Math.sin(a) * R}
            className={i < lit ? 'tick on' : 'tick'} style={{ transitionDelay: `${i * 4}ms` }} />
        })}
        {arcs.map((a) => {
          const v = Math.min(1, Math.abs(ev[a.k] ?? 0) / a.max)
          return (
            <g key={a.k}>
              <path d={arcPath(60, a.start + 6, a.start + 114)} className="ev-track" />
              <path d={arcPath(60, a.start + 6, a.start + 6 + 108 * Math.max(v, 0.001))} className={`ev ${a.against ? 'against' : ''}`} style={{ opacity: v > 0 ? 1 : 0 }} />
            </g>
          )
        })}
      </svg>
      <div className="pc-center">
        <div key={p?.state ?? '-'} className="display pc-state pop">{p ? p.state : '—'}</div>
        <div className="pc-count dot">{p?.count ?? '—'}</div>
        <div className="mono pc-sub">{p ? <>P <Ticker value={prob} fmt={(n) => n.toFixed(2)} /></> : 'no data'}</div>
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
  const hb = md?.human_band
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
    const x = (i: number) => (i / 299) * W
    g.beginPath()
    hist.forEach((h, i) => { const xi = x(i + 300 - hist.length); i ? g.lineTo(xi, y(h.score)) : g.moveTo(xi, y(h.score)) })
    g.strokeStyle = `rgba(${col},0.95)`; g.lineWidth = 1.6; g.stroke()
    g.lineTo(x(299), H); g.lineTo(x(300 - hist.length), H); g.closePath()
    const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, `rgba(${col},0.25)`); grad.addColorStop(1, `rgba(${col},0)`)
    g.fillStyle = grad; g.fill()
    // the newest sample, as a live dot
    const last = hist[hist.length - 1]
    g.fillStyle = `rgba(${col},1)`; g.beginPath(); g.arc(x(299), y(last.score), 2.6, 0, Math.PI * 2); g.fill()
  }, [hist, sim])
  // human band on a 0..3x-threshold scale: the threshold sits at a third
  // Calibrated: against its threshold (0..3x, threshold at a third). Before calibration:
  // against noise on a log scale (1x..50x), with the 1.6x start gate marked.
  const calibrated = hb?.ratio != null
  const hbPct = calibrated ? Math.min(100, (hb!.ratio! / 3) * 100)
    : hb ? Math.min(100, Math.max(0, Math.log(Math.max(hb.energy, 1)) / Math.log(50)) * 100) : 0
  const gatePct = calibrated ? 33.3 : hb ? (Math.log(hb.start_gate) / Math.log(50)) * 100 : 33.3
  return (
    <div className="hud-card glass-thin rise" style={{ ['--i' as string]: 1 }}>
      <div className="hc-head"><span className="eyebrow">Wi-Fi motion</span>
        <span key={md?.state ?? '-'} className={`pill pop ${md?.state === 'motion' ? (sim ? 'sim' : 'live') : ''}`}>{md?.state ?? '—'}</span></div>
      <div className="hc-big"><span className="dot"><Ticker value={md?.score} fmt={(n) => `${fmt(n, 1)}×`} /></span>
        <span className="muted mono">threshold {md?.threshold != null ? `${fmt(md.threshold, 2)}×` : '—'}</span></div>
      <canvas ref={ref} className="hc-chart" />
      <div className="hb" title="Human-band energy: power at body speeds (0.4–4 Hz) across smooth subcarrier patterns, in units of the window's own noise. It can start motion when the last second is above the start gate.">
        <div className="hb-head mono"><span>human band</span>
          <span>{calibrated ? <><Ticker value={hb!.ratio} fmt={(n) => `${n.toFixed(2)}×`} /> its threshold</>
            : hb ? <><Ticker value={hb.energy} fmt={(n) => `${n.toFixed(1)}×`} /> noise · uncalibrated</> : '—'}</span></div>
        <div className={`meter ${sim ? 'sim' : 'live'}`}><i style={{ width: `${hbPct}%` }} /><b style={{ left: `${gatePct}%` }} /></div>
        <div className="hb-foot mono muted">last 1 s {hb ? `${fmt(hb.recent, 2)}× noise` : '—'} · starts at {hb ? `${hb.start_gate}×` : '—'}</div>
      </div>
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

/* ------------------------------------------------------------------ the learned model */
function LearnedCard({ frame, onTeach }: { frame: FrameMsg | null; onTeach: () => void }) {
  const l = frame?.learned
  const sim = frame && frame.source !== 'hardware'
  const top = STATES.find((s) => s.id === l?.state)
  return (
    <div className="hud-card glass-thin learned-card rise" style={{ ['--i' as string]: 4 }}>
      <div className="hc-head"><span className="eyebrow">Spatial model</span>
        <span className="pill" title="Shown, not used: fusion ignores it until its score on my own recordings beats the engine">advisory</span></div>
      {!l ? (
        <div className="muted lc-empty">{frame ? 'No trained model yet.' : 'Waiting for data…'}</div>
      ) : (
        <>
          <div className="lc-top">
            <span key={l.state} className="display lc-state pop">{top?.name ?? l.state}</span>
            <span className="mono muted">occupied <b className="dot"><Ticker value={l.occupied_p * 100} fmt={(n) => `${Math.round(n)}%`} /></b></span>
          </div>
          <div className="lc-rows">
            {STATES.map((s) => {
              const p = l.p[s.id] ?? 0
              return (
                <div key={s.id} className={`lc-row ${s.id === l.state ? 'on' : ''}`}>
                  <span>{s.name}</span>
                  <div className={`bar ${s.id === l.state ? (sim ? 'sim' : 'live') : ''}`}><i style={{ width: `${p * 100}%` }} /></div>
                  <em className="mono">{Math.round(p * 100)}</em>
                </div>
              )
            })}
          </div>
          {l.activity && (
            <div className="lc-act">
              <span className="eyebrow">doing</span>
              <span key={l.activity.state} className={`lc-act-now pop act-${l.activity.state}`}>{ACT_NAMES[l.activity.state] ?? l.activity.state}</span>
              <div className="lc-act-bars">
                {Object.entries(l.activity.p).filter(([k]) => k !== 'none').map(([k, v]) => (
                  <span key={k} title={`${k} ${Math.round(v * 100)}%`} className={k === l.activity!.state ? 'on' : ''}>
                    <i style={{ height: `${Math.max(6, v * 100)}%` }} /><em className="mono">{k.slice(0, 4)}</em>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <div className="hc-foot mono muted">
        <span title="What it measures change against: the calibrated empty room, or — before calibration — whatever the first seconds saw">
          trained: {l?.trained ?? '—'}{l?.reference ? <> · ref: <b className={l.reference === 'calibrated' ? '' : 'sim'}>{l.reference}</b></> : null}
        </span>
        <button className="btn sm ghost" onClick={onTeach}><GraduationCap size={12} />Teach it my room</button>
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
    <div className="hud-card glass-thin rise" style={{ ['--i' as string]: 2 }}>
      <div className="hc-head"><span className="eyebrow">Channel · 51 subcarriers</span>
        <span className="mono muted">{frame ? `${fmt(frame.csi.rate_hz, 0)} Hz · ${frame.csi.rssi ?? '—'} dBm` : '—'}</span></div>
      <canvas ref={ref} className="hc-matrix" />
      <div className="hc-foot mono muted">{frame ? `${fmt(frame.csi.fill_ratio * 100, 1)}% gaps filled · radar ${fmt(frame.rates.radar_hz, 0)} Hz` : ''}</div>
    </div>
  )
}

function SensorsCard({ status }: { status: StatusMsg | null }) {
  return (
    <div className="hud-card glass-thin rise" style={{ ['--i' as string]: 3 }}>
      <div className="hc-head"><span className="eyebrow">Sensors</span></div>
      {!status && <div className="skeleton scan" style={{ height: 44 }} />}
      {Object.entries(status?.sensors ?? {}).map(([k, v]) => (
        <div key={k} className="hc-sensor">
          <i className={`led ${v.state}`} />
          <span>{k}</span>
          <em className="mono">{v.state}</em>
          <small className="mono muted">{v.detail}</small>
        </div>
      ))}
      {status?.link?.frames_ok !== undefined && (
        <div className="hc-foot mono muted"><span><Ticker value={status.link.frames_ok} fmt={(n) => Math.round(n).toLocaleString()} /> frames · {status.link.crc_errors} CRC rejected · {fmt((status.link.loss_ratio ?? 0) * 100, 1)}% lost</span></div>
      )}
    </div>
  )
}

function SimCheck({ frame }: { frame: FrameMsg }) {
  const m = frame.metrics!
  return (
    <div className="hud-card glass-thin simcheck rise" style={{ ['--i' as string]: 5 }}>
      <div className="hc-head"><span className="eyebrow sim">Simulation check</span><span className="pill sim">ground truth</span></div>
      <div className="hc-big"><span className="dot"><Ticker value={m.mean_error_m != null ? m.mean_error_m * 100 : null} /></span><span className="muted mono">cm tracking error now</span></div>
      <div className="kv" style={{ marginTop: 6 }}>
        <span>People (truth)</span><span className="mono">{m.truth_n}</span>
        <span>Tracked</span><span className="mono">{m.tracked_n}</span>
        {m.pairs.map((p) => [<span key={p.truth + 'a'}>{p.truth} → {p.track}</span>, <span key={p.truth + 'b'} className="mono">{Math.round(p.error_m * 100)} cm</span>])}
      </div>
    </div>
  )
}
