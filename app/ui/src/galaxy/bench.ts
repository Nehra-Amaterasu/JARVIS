/**
 * Frame-rate bench for the memory galaxy (dev only: galaxy-bench.html, never built).
 *
 * Renders a SYNTHETIC payload of ?n= nodes (default 10,000; lib/galaxy synthPayload)
 * through the real GalaxyScene with everything that costs per frame switched on:
 * auto-rotation, the month uniform sweeping so nodes keep popping in, the edges, and
 * the pointer parked over the stage so hover-picking runs every frame.
 *
 * Two measurements:
 *   raf    frame intervals from requestAnimationFrame over ?s= seconds after a 2 s
 *          warm-up — the real thing, but only when the page is visible (a hidden or
 *          background tab is throttled, and then this phase is skipped and says so).
 *   sync   600 frames driven back to back, each followed by a GPU flush (readPixels
 *          waits for the GPU), so the time is the full CPU + GPU cost of a frame. This
 *          works whether or not the page is visible; 60 fps needs p95 under 16.7 ms.
 * Results go to #bench-result and window.__bench.
 */
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/galaxy.css'
import { synthPayload } from '../lib/galaxy'
import { GalaxyScene } from './GalaxyScene'

const q = new URLSearchParams(location.search)
const n = Number(q.get('n') ?? 10000)
const seconds = Number(q.get('s') ?? 8)
const SYNC_FRAMES = 600
const stage = document.getElementById('bench-stage')!
const out = document.getElementById('bench-result')!
Object.assign(document.body.style, { margin: '0', background: '#050506', overflow: 'hidden' })
// ?w=&h= pins the canvas size (CSS px), so a run in a hidden or tiny window still
// fills a realistic number of pixels; by default the stage fills the window.
const W = Number(q.get('w') ?? 0)
const H = Number(q.get('h') ?? 0)
Object.assign(stage.style, W && H
  ? { position: 'fixed', left: '0', top: '0', width: `${W}px`, height: `${H}px` }
  : { position: 'fixed', inset: '0' })
Object.assign(out.style, {
  position: 'fixed', left: '12px', bottom: '12px', margin: '0', padding: '10px 12px', zIndex: '10',
  font: '12px ui-monospace, monospace', color: '#ffb020', background: 'rgba(10,11,14,.85)', borderRadius: '10px',
})

const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y)
  return +s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))].toFixed(2)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const p = synthPayload(n, 11)
  const scene = new GalaxyScene(stage)
  const t0 = performance.now()
  scene.setData(p, 'provenance')
  const setupMs = Math.round(performance.now() - t0)
  const M = p.growth.months.length
  scene.setPopMonths((M / seconds) * 0.45)
  const canvas = stage.querySelector('canvas')!
  const r = canvas.getBoundingClientRect()
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
  const res: Record<string, unknown> = {
    note: 'SYNTHETIC nodes, not memory data', nodes: n, edges: scene.probe().edges, setupMs,
    canvas: `${canvas.width}x${canvas.height}`, renderer: scene.rendererName,
  }
  out.textContent = `SYNTHETIC ${n.toLocaleString()} nodes — measuring…`

  // ---- raf phase (only meaningful when visible)
  if (!document.hidden) {
    const start = performance.now()
    let on = true
    const sweep = () => {
      const t = (performance.now() - start) / 1000
      scene.setMonth(((t % seconds) / seconds) * (M + 1))
      if (on) requestAnimationFrame(sweep)
    }
    requestAnimationFrame(sweep)
    await wait(2000)
    scene.resetStats()
    await wait(seconds * 1000)
    on = false
    const s = scene.stats()
    res.raf = document.hidden ? 'page became hidden during the run; discarded' : {
      frames: s.frames, fpsMedian: +s.fps.toFixed(1), frameMsP50: +s.frameP50.toFixed(2),
      frameMsP95: +s.frameP95.toFixed(2), workMsP50: +s.workP50.toFixed(2), workMsP95: +s.workP95.toFixed(2),
    }
  } else {
    res.raf = 'skipped: page hidden, requestAnimationFrame is throttled'
  }

  // ---- sync phase: full frame cost including the GPU
  scene.pause()
  const times: number[] = []
  let ts = performance.now()
  for (let i = 0; i < SYNC_FRAMES; i++) {
    ts += 1000 / 60
    scene.setMonth(((i % 240) / 240) * (M + 1))
    const a = performance.now()
    scene.frame(ts)
    scene.flush()
    times.push(performance.now() - a)
    if (i % 30 === 29) await wait(0)            // let the page breathe between batches
  }
  res.sync = {
    frames: SYNC_FRAMES, msP50: pct(times, 0.5), msP95: pct(times, 0.95), msP99: pct(times, 0.99),
    msMax: +Math.max(...times).toFixed(2), drawCalls: scene.probe().calls,
    fpsAtP95: +Math.min(1000 / pct(times, 0.95), 999).toFixed(0),
  }
  ;(window as unknown as { __bench: unknown }).__bench = res
  out.textContent = JSON.stringify(res, null, 1)
}

void main()
