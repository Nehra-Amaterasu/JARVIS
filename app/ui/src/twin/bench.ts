/**
 * Frame-time bench for the Aankhen room twin (dev only: twin-bench.html, never built).
 *
 * A SYNTHETIC room and SYNTHETIC frames at 10 Hz (no hub, no API, no board) drive the
 * real SpatialTwin. The frames carry both the old learned-state fields and a `belief`
 * block, and cycle desk/typing -> floor/walking -> bed/still every 4 s, so whatever
 * draws "where I probably am" keeps moving.
 *
 * Measurement ("sync"): 600 frames driven back to back through the twin's own loop,
 * each followed by a 1-pixel readPixels (waits for the GPU), so a frame's time is its
 * full CPU + GPU cost. Run twice: with the estimate layer ON and OFF; the difference
 * is what the estimate drawing costs. ?w=&h= pin the canvas (default 1280x800).
 * Results go to #bench-result and window.__bench. Afterwards the frames keep coming
 * for a visual check; ?phase=0|1|2 pins desk / floor-walking / bed.
 */
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/aankhen.css'
import { SpatialTwin, type FrameMsg, type RoomSpec } from './SpatialTwin'

const q = new URLSearchParams(location.search)
const W = Number(q.get('w') ?? 1280)
const H = Number(q.get('h') ?? 800)
const FRAMES = Number(q.get('n') ?? 600)
const view = q.get('view') === 'plan' ? 'plan' : '3d'
const stage = document.getElementById('bench-stage')!
const out = document.getElementById('bench-result')!
Object.assign(document.body.style, { margin: '0', background: '#050506', overflow: 'hidden' })
Object.assign(stage.style, { position: 'fixed', left: '0', top: '0', width: `${W}px`, height: `${H}px` })
Object.assign(out.style, {
  position: 'fixed', left: '12px', bottom: '12px', margin: '0', padding: '10px 12px', zIndex: '10',
  font: '12px ui-monospace, monospace', color: '#ffb020', background: 'rgba(10,11,14,.85)', borderRadius: '10px',
})

// A made-up 4.2 x 3.2 m bedroom-study, not anyone's measured room.
const ROOM: RoomSpec = {
  name: 'bench room (synthetic)', width: 4.2, depth: 3.2, height: 2.7,
  zones: [
    { name: 'desk', polygon: [[0.4, 1.3], [1.2, 1.3], [1.2, 2.5], [0.4, 2.5]], posture: 'seated' },
    { name: 'bed', polygon: [[1.6, 0], [3.6, 0], [3.6, 2.0], [1.6, 2.0]], posture: 'lying' },
    { name: 'door', polygon: [[0.1, 0], [1.0, 0], [1.0, 0.7], [0.1, 0.7]], is_exit: true },
    { name: 'floor', polygon: [[0, 0.7], [1.6, 0.7], [1.6, 2.0], [4.2, 2.0], [4.2, 3.2], [0, 3.2]] },
  ],
  furniture: [
    { name: 'desk', x: 0, y: 1.25, w: 0.5, d: 1.4, h: 0.75 },
    { name: 'bed', x: 1.6, y: 0, w: 2.0, d: 2.0, h: 0.5 },
    { name: 'wardrobe', x: 0.05, y: 2.8, w: 1.4, d: 0.4, h: 2.4 },
  ],
  sensors: [{ id: 'esp32', kind: 'csi', x: 0.2, y: 2.0, z: 0.8, yaw_deg: 0, pitch_deg: 0, fov_deg: 120, range_m: 6 }],
  links: [],
}

const PHASES = [
  { state: 'desk', act: 'typing', motion: 0.3, zones: { desk: 0.62, floor: 0.2, bed: 0.08 } },
  { state: 'room', act: 'walking', motion: 0.9, zones: { floor: 0.55, desk: 0.2, door: 0.12 } },
  { state: 'bed', act: 'still', motion: 0.05, zones: { bed: 0.8, floor: 0.08 } },
] as const
const SPOT: Record<string, [number, number, number]> = { desk: [0.85, 1.9, 0.4], bed: [2.6, 1.0, 0.7], floor: [2.6, 2.6, 0.6], door: [0.55, 0.35, 0.3] }

function frame(i: number): FrameMsg {
  const t = i / 10
  const ph = PHASES[Math.floor(t / 4) % PHASES.length]
  const p: Record<string, number> = { empty: 0.05, outside: 0.05, room: 0, desk: 0, bed: 0 }
  p[ph.state] = 0.75
  return {
    type: 'frame', seq: i, source: 'simulator', t,
    tracks: [], motion: ph.motion, zones: {}, zone_seconds: {},
    presence: { state: 'occupied', p: 0.9, confidence: 0.8, count: 1, evidence: {}, reason: '' },
    motion_detail: { state: null, score: null, threshold: null, baseline: '', reason: '', breathing_bpm: null, breathing_conf: null, breathing_note: null,
      human_band: { energy: 1 + 20 * ph.motion, threshold: 1.6, ratio: null, recent: 1 + 20 * ph.motion, start_gate: 1.6 } },
    learned: { t, state: ph.state, p, occupied_p: 0.9, advisory: true, trained: 'bench',
      activity: { state: ph.act, p: { [ph.act]: 0.8 }, trained: 'bench' } },
    csi: { n_subcarriers: 0, rate_hz: 100, rssi: -50, fill_ratio: 1, amplitudes: [] },
    rates: { csi_hz: 100, radar_hz: 0 },
    events: [],
    // the hub's newer belief block (older twins ignore it; ?nobelief=1 leaves it out)
    ...(q.get('nobelief') ? {} : { belief: {
      state: 'in_room', confidence: 0.8, motion: ph.motion, activity: { state: ph.act, p: 0.8 }, updated: t,
      zones: Object.entries(ph.zones).map(([id, zp]) => ({ id, name: id, p: zp, x: SPOT[id][0], y: SPOT[id][1], r: SPOT[id][2] })),
    } }) as object,
  } as FrameMsg
}

const pct = (a: number[], k: number) => {
  const s = [...a].sort((x, y) => x - y)
  return +s[Math.min(s.length - 1, Math.floor(k * (s.length - 1)))].toFixed(2)
}

// The twin skips drawing while the page is hidden; this bench drives frames by hand, so
// it measures the same work whether or not the browser shows the page.
Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })

async function main() {
  const twin = new SpatialTwin(stage)
  twin.setRoom(ROOM)
  twin.setView(view)
  ;(window as unknown as { __twin: () => unknown }).__twin = () => twin.probe()
  // drive the twin's private loop by hand: cancel its own rAF chain after each call
  const tw = twin as unknown as { loop: (ts: number) => void; raf: number }
  cancelAnimationFrame(tw.raf)
  const canvas = stage.querySelector('canvas')!
  const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext
  const px = new Uint8Array(4)
  let ts = performance.now(), fi = 0
  const run = (n: number): number[] => {
    const times: number[] = []
    for (let i = 0; i < n; i++) {
      ts += 1000 / 60
      if (i % 6 === 0) twin.onFrame(frame(fi++))      // 10 Hz frames at 60 fps
      const a = performance.now()
      tw.loop(ts)
      cancelAnimationFrame(tw.raf)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      times.push(performance.now() - a)
    }
    return times
  }
  run(120)                                            // warm-up: shaders compiled, figure placed
  const on = run(FRAMES)
  const calls = (twin.probe() as { calls: number }).calls
  twin.setLayer('estimate', false)
  run(60)
  const off = run(FRAMES)
  const callsOff = (twin.probe() as { calls: number }).calls
  twin.setLayer('estimate', true)
  const sum = (a: number[]) => ({ mean: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2), p50: pct(a, 0.5), p95: pct(a, 0.95), max: pct(a, 1) })
  const res = {
    note: 'SYNTHETIC room and frames', view, canvas: `${canvas.width}x${canvas.height}`, frames: FRAMES,
    estimateOn: sum(on), estimateOff: sum(off), callsWithEstimate: calls, callsWithoutEstimate: callsOff,
    estimateCostMs: +((on.reduce((s, v) => s + v, 0) - off.reduce((s, v) => s + v, 0)) / FRAMES).toFixed(2),
  }
  ;(window as unknown as { __bench: unknown }).__bench = res
  out.textContent = JSON.stringify(res, null, 1)
  tw.loop(performance.now())                          // hand the loop back for a look
  // keep the synthetic frames coming, for a visual check (?phase= pins one phase)
  const pin = q.get('phase')
  setInterval(() => twin.onFrame(frame(pin !== null ? Number(pin) * 40 + 5 : fi++)), 100)
}
main()
