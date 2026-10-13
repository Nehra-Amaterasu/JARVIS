/**
 * Aankhen's eyes: what the ESP32's Wi-Fi channel actually sees, so I can watch my own
 * movements show up in the radio signal. Laid over the twin's stage, five parts:
 *
 *   header        what is measuring (LIVE · ESP32 or SIMULATION), packets/s, signal,
 *                 channel, and one line: what I see right now — always marked estimate
 *   THE RIPPLE    the hero: 51 subcarriers (y, 312.5 kHz apart) over the last 20 s (x,
 *                 now at the right). Colour = how far each one is from its own recent
 *                 past, in units of its noise. In simulation a quiet room is dark and
 *                 movement near the link lights it; on the real board (one session,
 *                 fan on) waving moved it only a little (mean |z| 1.39 vs 1.20 still).
 *                 It shows the measurement, nothing promised.
 *   PHASE RIPPLE  the same picture from the phase, after removing what the two
 *                 unsynchronised clocks scramble (aankhen/eyes.py says exactly what)
 *   THE RHYTHM    how fast the channel changes, 0.1-10 Hz on a log axis, against the
 *                 speeds of things people do, drawn for reference only; a peak is named
 *                 as "strongest rhythm (estimate)" and never as an activity. The strip
 *                 under it is the same spectrum's last 8 s, newest on top
 *   THE BODY      the learned models' guess as a figure: where and doing what — an
 *                 estimate from one Wi-Fi link, and labelled as one
 *   THE STAFF     JARVIS's crew narrating, and who is on duty
 *
 * Performance: the eyes stream (10 Hz) never re-renders React. Messages land in refs
 * through `sinkRef`; one requestAnimationFrame loop draws the WebGL waterfalls (heatgl)
 * and the 2D spectrum, and writes the few changing labels straight into the DOM. It
 * stops while the window is hidden; the device pixel ratio is capped at 2.
 */
import { Activity, Radio, ScanEye, Waves } from 'lucide-react'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { fmt } from '../lib/format'
import {
  ACTIVITY_BANDS, CLIP_Z, KNEE, POSES, RAMPS, Z_TOP, SPACING_KHZ, channelMHz, clockArrive, clockStep,
  fmtRhythm, freqToX, intensity, newClock, powerRange, provenanceOf, readBody, seeSentence, smoothPath,
  spectrumPoints, type BodyRead, type EyesMsg, type Provenance,
} from '../lib/eyes'
import { HeatGL } from '../lib/heatgl'
import { movementAgent } from '../lib/crew'
import { Ticker } from '../lib/motion'
import type { FrameMsg } from '../twin/SpatialTwin'
import { StaffFeed, StaffPill, StaffRoster, useCrew } from './Staff'
import '../styles/eyes.css'

const RIPPLE_S = 20              // seconds of history on screen
const STRIP_S = 8                // the spectrogram strip's depth
const RING = 256                 // ripple slots (>= 20 s at 10 columns/s, with room for lag)
const STRIP_RING = 128
// No message for this long: time without data is drawn as such. Not shorter: on a busy
// machine the server's 10 Hz tick was measured arriving 140 ms apart with gaps of
// 380 ms, and a 450 ms threshold painted those as missing data.
const STALL_MS = 1500
const SOURCE: Record<string, { label: string; cls: string }> = {
  hardware: { label: 'LIVE · ESP32', cls: 'live' },
  simulation: { label: 'SIMULATION', cls: 'sim' },
  replay: { label: 'REPLAY · recorded', cls: 'sim' },
}
const ACCENT: Record<Provenance, string> = { live: '92,225,255', sim: '255,176,32' }
const X_TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10]

type Props = {
  frame: FrameMsg | null
  online: boolean
  sinkRef: MutableRefObject<((m: EyesMsg) => void) | null>
  'data-presence'?: string                       // set by <Presence>: plays the exit animation
}

export function EyesView({ frame, online, sinkRef, 'data-presence': presence }: Props) {
  const crew = useCrew(2000, 8)
  const ripHost = useRef<HTMLDivElement>(null)
  const phHost = useRef<HTMLDivElement>(null)
  const stripHost = useRef<HTMLDivElement>(null)
  const specCanvas = useRef<HTMLCanvasElement>(null)
  const ripNow = useRef<HTMLCanvasElement>(null)
  const phNow = useRef<HTMLCanvasElement>(null)
  const peakEl = useRef<HTMLDivElement>(null)
  const bandsEl = useRef<HTMLDivElement>(null)
  const readoutEl = useRef<HTMLDivElement>(null)
  const waitEl = useRef<HTMLDivElement>(null)
  const legendEl = useRef<HTMLDivElement>(null)
  const prov: Provenance = provenanceOf(frame?.source)
  const onlineRef = useRef(online)
  onlineRef.current = online

  useEffect(() => {
    // Canvases are made here, not in JSX: each mount gets fresh ones, so a context
    // released on unmount (heatgl.dispose) is never asked to draw again.
    const mk = (host: HTMLDivElement | null) => {
      const c = document.createElement('canvas')
      c.className = 'heat-canvas'
      host?.appendChild(c)
      return c
    }
    const cAmp = mk(ripHost.current), cPh = mk(phHost.current), cStrip = mk(stripHost.current)
    const amp = new HeatGL(cAmp, { layout: 'columns', kind: 'z', ring: RING, size: 51 })
    const ph = new HeatGL(cPh, { layout: 'columns', kind: 'z', ring: RING, size: 51 })
    const strip = new HeatGL(cStrip, { layout: 'rows', kind: 'power', ring: STRIP_RING, size: 64, binHz: 0.15625 })
    const glOk = amp.ok && ph.ok && strip.ok
    const clock = newClock()
    const sclock = newClock()
    const st = {
      prov: 'sim' as Provenance,
      lastMsg: 0,
      nowA: new Float32Array(51), tgtA: new Float32Array(51),
      nowP: new Float32Array(51), tgtP: new Float32Array(51),
      hz: [] as number[], cur: new Float32Array(64), tgt: new Float32Array(64), nb: 0,
      hi: 2.4, show: 0, showTgt: 0,
      peak: null as number | null, peakX: 0, peakA: 0,
    }

    const take = (m: EyesMsg, now: number) => {
      const p = provenanceOf(m.source)
      if (p !== st.prov) {
        st.prov = p
        amp.setProvenance(p); ph.setProvenance(p); strip.setProvenance(p)
        if (legendEl.current) legendEl.current.style.setProperty('--ramp', rampCss(p))
      }
      amp.write(clock.count, m.column)
      ph.write(clock.count, m.phase_column)
      clockArrive(clock, now)
      if (m.column) for (let i = 0; i < 51; i++) st.tgtA[i] = intensity(m.column[i])
      else st.tgtA.fill(0)
      if (m.phase_column) for (let i = 0; i < 51; i++) st.tgtP[i] = intensity(m.phase_column[i])
      else st.tgtP.fill(0)
      const s = m.spectrum
      strip.write(sclock.count, s ? s.power : null)
      clockArrive(sclock, now)
      if (s) {
        st.hz = s.hz
        st.nb = Math.min(64, s.power.length)
        for (let i = 0; i < st.nb; i++) st.tgt[i] = s.power[i]
        st.showTgt = 1
        st.peak = s.peak_hz
        writeReadout(s, readoutEl.current)
        writePeak(s.peak_hz, peakEl.current)
      } else {
        st.showTgt = 0
        st.peak = null
        writePeak(null, peakEl.current)
      }
      if (waitEl.current && glOk) {
        waitEl.current.textContent = m.column ? '' : `listening… ${fmt(m.seconds, 1)} s`
        waitEl.current.classList.toggle('on', !m.column)
      }
      st.lastMsg = now
    }
    sinkRef.current = (m) => take(m, performance.now())

    const spec = specCanvas.current!
    const sctx = spec.getContext('2d')!
    const nowCtxA = ripNow.current!.getContext('2d')!
    const nowCtxP = phNow.current!.getContext('2d')!
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden) { last = now; return }
      const dt = Math.min(100, now - last)
      last = now
      // Time without data is drawn as time without data: a stalled stream writes
      // hatched columns at the measured rate instead of freezing the picture.
      if (clock.count > 0 && now - st.lastMsg > STALL_MS && now - clock.lastAt > clock.interval) {
        amp.write(clock.count, null); ph.write(clock.count, null); clockArrive(clock, now)
        strip.write(sclock.count, null); clockArrive(sclock, now)
        st.tgtA.fill(0); st.tgtP.fill(0); st.showTgt = 0
        if (waitEl.current && glOk) { waitEl.current.textContent = onlineRef.current ? 'no CSI arriving' : 'disconnected'; waitEl.current.classList.add('on') }
      }
      const span = (RIPPLE_S * 1000) / clock.interval
      const head = clockStep(clock, now, dt)
      amp.draw(head, span)
      ph.draw(head, span)
      strip.draw(clockStep(sclock, now, dt), (STRIP_S * 1000) / sclock.interval)
      const k = 1 - Math.exp(-dt / 90)
      for (let i = 0; i < 51; i++) { st.nowA[i] += (st.tgtA[i] - st.nowA[i]) * k; st.nowP[i] += (st.tgtP[i] - st.nowP[i]) * k }
      drawDots(nowCtxA, st.nowA, st.prov)
      drawDots(nowCtxP, st.nowP, st.prov)
      const ks = 1 - Math.exp(-dt / 140)
      for (let i = 0; i < st.nb; i++) st.cur[i] += (st.tgt[i] - st.cur[i]) * ks
      st.show += (st.showTgt - st.show) * (1 - Math.exp(-dt / 260))
      drawSpectrum(sctx, spec, st, dt, peakEl.current)
    }
    raf = requestAnimationFrame(loop)
    if (!glOk && waitEl.current) {
      waitEl.current.textContent = 'WebGL 2 is not available in this window: the waterfalls cannot be drawn.'
      waitEl.current.classList.add('on')
    }
    return () => {
      cancelAnimationFrame(raf)
      sinkRef.current = null
      amp.dispose(); ph.dispose(); strip.dispose()
      cAmp.remove(); cPh.remove(); cStrip.remove()
    }
  }, [])                                            // eslint-disable-line react-hooks/exhaustive-deps

  const src = SOURCE[frame?.source ?? ''] ?? { label: online ? 'NO SOURCE' : 'DISCONNECTED', cls: 'fault' }
  const body = readBody(frame?.learned)
  // The movement agent's own words while it is narrating; when it stands down (it
  // says nothing about a simulation) the line falls back to the models' estimate.
  const mover = movementAgent(crew.agents)
  const see = seeSentence({ staffSummary: mover?.state === 'running' ? mover.summary : null, learned: frame?.learned, presence: frame?.presence })
  const csi = frame?.csi
  const mhz = channelMHz(csi?.channel)
  const edge = (26 * SPACING_KHZ) / 1000
  return (
    <div className={`eyes is-${prov}`} data-presence={presence}>
      <header className="eyes-head rise">
        <div className="eh-title">
          <span className="mono ph-n">03</span>
          <h1 className="display chrome-text">Aankhen’s eyes</h1>
        </div>
        <div className="eh-pills">
          <span className={`pill ${src.cls} big`}><i className={`led ${online && src.cls !== 'fault' ? 'breathe' : ''}`} />{online ? src.label : 'DISCONNECTED'}</span>
          <span className="eh-stat" title="CSI packets a second from the router (measured)">
            <b className="dot"><Ticker value={csi?.rate_hz} fmt={(n) => String(Math.round(n))} /></b><em className="mono">pkt/s</em></span>
          <span className="eh-stat" title="Received signal strength of the last packet">
            <b className="dot">{csi?.rssi ?? '—'}</b><em className="mono">dBm</em></span>
          <span className="eh-stat" title={mhz ? `${(mhz / 1000).toFixed(3)} GHz` : 'Wi-Fi channel'}>
            <em className="mono">ch</em><b className="dot">{csi?.channel ?? '—'}</b></span>
        </div>
        <div className="eh-see">
          <span className="eyebrow">What I see right now</span>
          <span key={see.text} className="eh-see-text pop">{see.text}</span>
          {see.estimate && <span className="pill sim eh-est" title={see.from === 'staff' ? 'In the movement agent’s words' : 'From the learned models: one Wi-Fi link, not a camera'}>estimate</span>}
        </div>
      </header>

      <section className="eyes-body glass-thin rise" style={{ ['--i' as string]: 1 }}>
        <div className="sec-head"><span className="eyebrow"><Activity size={11} />The body</span>
          {body.zoneP != null && <span className="mono muted">{Math.round(body.zoneP * 100)}%</span>}</div>
        <BodyGlyph read={body} prov={prov} />
        <div className="eb-text">
          <div className="eb-zone">{cap(body.zoneText)}</div>
          <div className="eb-act mono">{body.pose === 'away' || body.pose === 'unknown' ? (body.pose === 'away' ? 'not in the room' : 'teach it on the 3D view')
            : <>{body.actText}{body.actP != null && <> · <Ticker value={body.actP * 100} fmt={(n) => `${Math.round(n)}%`} /></>}</>}</div>
        </div>
        <p className="eb-cap">estimate from one Wi-Fi link — not a camera</p>
      </section>

      <section className="eyes-instrument glass-thin rise" style={{ ['--i' as string]: 2 }}>
        <div className="ripple">
          <div className="sec-head">
            <span className="eyebrow"><Waves size={11} />The ripple</span>
            <span className="sec-cap">each subcarrier’s amplitude against its last ~10 s, in units of its own noise</span>
            <div ref={legendEl} className="ramp-legend" style={{ ['--ramp' as string]: rampCss(prov) }} title={`Colour = |deviation| in noise units: dark below ${KNEE}, white from ${Z_TOP} (data clipped at ${CLIP_Z})`}>
              <span className="mono">0</span><i /><span className="mono">{Z_TOP}+× noise</span></div>
          </div>
          <div className="wf wf-amp">
            <div className="wf-y mono" aria-hidden>
              <span style={{ bottom: '100%' }}>+26</span>
              <span className="dc" style={{ bottom: `${(26 / 51) * 100}%` }}>DC</span>
              <span style={{ bottom: '0%' }}>−26</span>
            </div>
            <div ref={ripHost} className="wf-plot">
              <i className="wf-dc" style={{ bottom: `${(26 / 51) * 100}%` }} />
              <div ref={waitEl} className="wf-wait mono" />
            </div>
            <canvas ref={ripNow} className="wf-now" aria-hidden />
          </div>
          <div className="wf-x mono" aria-hidden>
            {[20, 15, 10, 5].map((s) => <span key={s} style={{ left: `${(1 - s / RIPPLE_S) * 100}%` }}>{s} s</span>)}
            <span className="now" style={{ left: '100%' }}>now</span>
          </div>
          <div className="wf-cap mono">subcarrier −26 … +26 · {SPACING_KHZ} kHz apart · ±{edge.toFixed(1)} MHz{mhz ? ` around ${(mhz / 1000).toFixed(3)} GHz` : ''}</div>
        </div>

        <div className="ripple phase">
          <div className="sec-head">
            <span className="eyebrow"><Radio size={11} />Phase ripple</span>
            <span className="sec-cap">phase after removing what the unsynchronised clocks scramble</span>
          </div>
          <div className="wf wf-phase">
            <div className="wf-y mono" aria-hidden><span style={{ bottom: '100%' }}>+26</span><span style={{ bottom: '0%' }}>−26</span></div>
            <div ref={phHost} className="wf-plot" />
            <canvas ref={phNow} className="wf-now" aria-hidden />
          </div>
        </div>

        <div className="rhythm">
          <div className="sec-head">
            <span className="eyebrow"><ScanEye size={11} />The rhythm</span>
            <span className="sec-cap">how fast the channel changes · last 6.4 s · × its noise floor</span>
            <div ref={readoutEl} className="rh-readout mono" />
          </div>
          <div className="rh-frame">
            <div ref={bandsEl} className="rh-bands" aria-hidden>
              {ACTIVITY_BANDS.map((b) => (
                <span key={b.id} data-band={b.id} className={`rh-band lane-${b.lane}`} title={`${b.label}: ${b.lo}–${b.hi} Hz`}
                  style={{ left: `${pct(b.lo)}%`, width: `${pct(b.hi) - pct(b.lo)}%` }}><em data-long={b.label} data-short={b.short} /></span>
              ))}
            </div>
            <div className="rh-plot">
              <canvas ref={specCanvas} className="rh-canvas" />
              <div ref={peakEl} className="rh-peak"><b className="dot" /><em className="mono" /><i className="mono" /></div>
            </div>
            <div ref={stripHost} className="rh-strip" title="The same spectrum over the last 8 s, newest at the top" />
            <div className="rh-x mono" aria-hidden>
              {X_TICKS.map((f) => <span key={f} style={{ left: `${pct(f)}%` }}>{f}</span>)}
              <span className="unit" style={{ left: '100%' }}>Hz</span>
            </div>
          </div>
        </div>
      </section>

      <section className="eyes-staff glass-thin rise" style={{ ['--i' as string]: 3 }}>
        <div className="sec-head"><span className="eyebrow">The staff</span><StaffPill crew={crew} /></div>
        <StaffFeed crew={crew} />
        <div className="es-duty">
          <span className="eyebrow">Staff on duty</span>
          <StaffRoster crew={crew} />
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ helpers */
const pct = (f: number) => (freqToX(f, 100))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const rampCss = (p: Provenance) => `linear-gradient(90deg, ${RAMPS[p].map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(', ')})`

// The peak is named as a rhythm, never as an activity: on the real board the bands'
// speeds did not tell waving or walking from sitting still (audit, 2026-10-13).
function writePeak(hz: number | null, el: HTMLDivElement | null) {
  if (!el) return
  const r = fmtRhythm(hz)
  el.classList.toggle('on', !!r)
  if (!r) return
  ;(el.children[0] as HTMLElement).textContent = `${r.hz} Hz`
  ;(el.children[1] as HTMLElement).textContent = `${r.perMin}/min`
  ;(el.children[2] as HTMLElement).textContent = 'strongest rhythm · estimate'
}

function writeReadout(s: NonNullable<EyesMsg['spectrum']>, el: HTMLDivElement | null) {
  if (!el) return
  const b = s.bands
  const f = (v: number | null | undefined) => (v == null ? '—' : v >= 10 ? Math.round(v).toString() : v.toFixed(1))
  el.textContent = `slow ${f(b.breathing)}× · body ${f(b.body)}× · fast ${f(b.fast)}× · above ${f(b.above)}×`
}

/** The newest column as a dot column, Nothing-style: the unlit dots are the scale. */
function drawDots(ctx: CanvasRenderingContext2D, v: Float32Array, prov: Provenance) {
  const c = ctx.canvas
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr)
  if (!W || !H) return
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
  ctx.clearRect(0, 0, W, H)
  const n = v.length, step = H / n, r = Math.max(1, Math.min(step * 0.34, W * 0.32))
  const col = ACCENT[prov]
  for (let i = 0; i < n; i++) {
    const a = v[i]
    ctx.fillStyle = a > 0.02 ? `rgba(${col},${(0.25 + 0.75 * a).toFixed(3)})` : 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.arc(W / 2, H - (i + 0.5) * step, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

interface SpecState {
  prov: Provenance; hz: number[]; cur: Float32Array; nb: number; hi: number; show: number
  peak: number | null; peakX: number; peakA: number
}

/** The rhythm: a glowing line over a soft fill, on a log-frequency axis. */
function drawSpectrum(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, st: SpecState, dt: number, peakEl: HTMLElement | null) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = c.clientWidth, H = c.clientHeight
  if (!W || !H) return
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr) }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const col = ACCENT[st.prov]
  const top = 8, h = H - top - 2
  const cur = st.cur.subarray(0, st.nb)
  const [lo, hiT] = powerRange(cur)
  st.hi += (hiT - st.hi) * (1 - Math.exp(-dt / 400))
  const range: [number, number] = [lo, st.hi]
  const yOf = (v: number) => top + h - ((Math.min(range[1], Math.max(range[0], v)) - range[0]) / (range[1] - range[0])) * h
  // reference levels: the noise floor (what a still room is), 10x, 100x
  ctx.font = '9px "Geist Mono Variable", ui-monospace, monospace'
  ctx.textBaseline = 'bottom'
  for (const [v, label] of [[0, 'noise'], [1, '10×'], [2, '100×'], [3, '1000×']] as [number, string][]) {
    if (v > range[1] - 0.05) continue
    const y = Math.round(yOf(v)) + 0.5
    ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.055)'
    ctx.setLineDash(v === 0 ? [3, 4] : [])
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.32)'
    ctx.fillText(label, 4, y - 2)
  }
  ctx.setLineDash([])
  // the resolution, honestly: one dot per spectrum bin along the floor
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  for (let i = 0; i < st.nb; i++) {
    const x = freqToX(st.hz[i], W)
    ctx.fillRect(x - 0.5, H - 3, 1, 1)
  }
  if (st.show < 0.01 || st.nb < 2) return
  const pts = spectrumPoints(st.hz.slice(0, st.nb), cur, W, h, range).map((p) => ({ x: p.x, y: p.y + top }))
  const d = smoothPath(pts, top + h)
  const area = new Path2D(`${d} L${pts[pts.length - 1].x.toFixed(1)} ${top + h} L${pts[0].x.toFixed(1)} ${top + h} Z`)
  ctx.globalAlpha = st.show
  const g = ctx.createLinearGradient(0, top, 0, top + h)
  g.addColorStop(0, `rgba(${col},0.30)`)
  g.addColorStop(1, `rgba(${col},0)`)
  ctx.fillStyle = g
  ctx.fill(area)
  const line = new Path2D(d)
  ctx.shadowColor = `rgba(${col},0.75)`
  ctx.shadowBlur = 12
  ctx.strokeStyle = `rgba(${col},0.95)`
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.stroke(line)
  ctx.shadowBlur = 0
  // the peak: a hairline down to the floor and a dot on the curve
  const want = st.peak != null ? 1 : 0
  st.peakA += (want - st.peakA) * (1 - Math.exp(-dt / 180))
  if (st.peak != null) {
    const tx = freqToX(st.peak, W)
    st.peakX = st.peakA < 0.05 ? tx : st.peakX + (tx - st.peakX) * (1 - Math.exp(-dt / 160))
  }
  if (st.peakA > 0.02) {
    const x = st.peakX
    let y = top + h
    for (let i = 1; i < pts.length; i++) if (pts[i].x >= x) {
      const a = pts[i - 1], b = pts[i], t = (x - a.x) / Math.max(1e-6, b.x - a.x)
      y = a.y + (b.y - a.y) * t
      break
    }
    ctx.globalAlpha = st.show * st.peakA
    ctx.strokeStyle = `rgba(${col},0.55)`
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y); ctx.lineTo(Math.round(x) + 0.5, top + h); ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.shadowColor = `rgba(${col},1)`; ctx.shadowBlur = 10
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    if (peakEl) peakEl.style.transform = `translateX(${Math.min(W - 140, Math.max(0, x - 70)).toFixed(1)}px)`
  }
  ctx.globalAlpha = 1
}

/* ------------------------------------------------------------------ the body glyph */
/** An abstract figure in rounded strokes, posed by the activity estimate (lib/eyes
 *  POSES) and animated in CSS: breathing when still, hands bobbing when typing, a
 *  forearm waving, legs stepping. Poses change by transition, never by a jump. */
function BodyGlyph({ read, prov }: { read: BodyRead; prov: Provenance }) {
  const g = POSES[read.pose]
  const style = useMemo(() => ({
    '--shL': `${g.shL}deg`, '--elL': `${g.elL}deg`, '--shR': `${g.shR}deg`, '--elR': `${g.elR}deg`,
    '--hpL': `${g.hpL}deg`, '--knL': `${g.knL}deg`, '--hpR': `${g.hpR}deg`, '--knR': `${g.knR}deg`,
    '--thigh': g.thigh, '--foreL': g.foreL, '--foreR': g.foreR, '--drop': `${g.drop}px`, '--tilt': `${g.tilt}deg`,
  }) as React.CSSProperties, [g])
  const p = read.zoneP ?? 0
  const R = 92, C = 2 * Math.PI * R
  return (
    <div className={`glyph pose-${read.pose} ${prov}`}>
      {/* viewBox offset, not a translated group: the joints' transform-origins are in
          the SVG's root units (transform-box: view-box), so the figure must live there */}
      <svg viewBox="-20 -4 200 220" role="img" aria-label={`${read.zoneText}${read.activity ? `, ${read.actText}` : ''} (estimate)`}>
        <circle className="g-ring-track" cx="80" cy="106" r={R} />
        <circle className="g-ring" cx="80" cy="106" r={R} strokeDasharray={`${(p * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 80 106)" />
        {Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2, r1 = i % 4 ? 101 : 104
          return <line key={i} className="g-tick" x1={80 + Math.cos(a) * 99} y1={106 + Math.sin(a) * 99} x2={80 + Math.cos(a) * r1} y2={106 + Math.sin(a) * r1} />
        })}
        <line className="g-ground" x1="22" x2="138" y1="176" y2="176" />
        <line className="g-bed" x1="2" x2="158" y1="124" y2="124" />
        <line className="g-desk" x1="34" x2="126" y1="117" y2="117" />
        <g className="g-fig" style={style}>
          <g className="g-tiltwrap">
            <g className="g-bob">
              <g className="g-chest">
                <circle className="g-head" cx="80" cy="34" r="11" />
                <path className="g-limb" d="M80 49 L80 103" />
                <path className="g-limb" d="M66 56 L94 56" />
                <g className="g-arm l"><g className="g-swing l"><path className="g-limb" d="M66 56 L66 80" />
                  <g className="g-fore l"><g className="g-fore-s l"><g className="g-hand l"><path className="g-limb" d="M66 80 L66 102" /></g></g></g></g></g>
                <g className="g-arm r"><g className="g-swing r"><path className="g-limb" d="M94 56 L94 80" />
                  <g className="g-fore r"><g className="g-wave"><g className="g-fore-s r"><g className="g-hand r"><path className="g-limb" d="M94 80 L94 102" /></g></g></g></g></g></g>
              </g>
              <path className="g-limb" d="M72 103 L88 103" />
              <g className="g-leg l"><g className="g-step l">
                <g className="g-thigh l"><path className="g-limb" d="M73 104 L73 138" /></g>
                <g className="g-shinwrap"><g className="g-shin l"><path className="g-limb" d="M73 138 L73 172" /></g></g>
              </g></g>
              <g className="g-leg r"><g className="g-step r">
                <g className="g-thigh r"><path className="g-limb" d="M87 104 L87 138" /></g>
                <g className="g-shinwrap"><g className="g-shin r"><path className="g-limb" d="M87 138 L87 172" /></g></g>
              </g></g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  )
}

