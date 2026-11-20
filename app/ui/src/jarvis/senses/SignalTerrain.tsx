// SignalTerrain (spec 20.9.3): the one bounded 720 x 360 canvas of Senses. X = the 51 subcarriers, depth = the last 24
// frames (the latest in front), height = the amplitude normalised per column, drawn as ridge lines in four alpha
// buckets (one path each, as the voice hill does). The front row carries the provenance: cyan measured, amber simulated.
//
//   no frames   the same ridges as a fixed hollow 1 px mound under the words "NO SIGNAL: shape is a placeholder"
//   simulated   an amber ridge and the amber SIMULATED stamp in the corner (a DOM stamp, so it is text a reader can read)
//   paused      the last rows stay and a PAUSED stamp says whose pause it is
//
// It redraws only when its inputs change (a fresh frame, the cursor, the source), never on a timer, and under reduced
// motion at most four times a second. It is the only canvas of a Senses view: the 3D twin replaces it, never joins it.
import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { COLS, STAGE_H, STAGE_W, colAt, floorGrid, hollowMound, ridgeGeometry, terrainRows, type Frame, type Ridge, type Source } from './model'

export interface SignalTerrainProps {
  frames: Frame[]
  source: Source
  paused?: boolean
  /** The subcarrier under the pointer or the keys, or null. */
  cursor?: number | null
  onCursor?: (col: number | null) => void
  /** A click freezes the frame for inspection; Esc resumes. The caller owns the frozen rows. */
  frozen?: boolean
  onFreeze?: () => void
}

const REDUCED = '(prefers-reduced-motion: reduce)'
const MIN_GAP_REDUCED_MS = 250

function tokens(el: HTMLElement) {
  const cs = getComputedStyle(el)
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d
  return { measured: v('--state-measured', '#5ce1ff'), simulated: v('--state-simulated', '#ffb020'), ink2: v('--ink-2', '#999'), ink3: v('--ink-3', '#666'), edge: v('--edge-ui', '#444') }
}

/** Four strokes, one per alpha bucket, plus the front row on top. `hollow` draws one hairline in a neutral ink and no fill. */
export function drawTerrain(g: CanvasRenderingContext2D, ridges: Ridge[], source: Source, t: ReturnType<typeof tokens>, cursor: number | null, w = STAGE_W, h = STAGE_H): void {
  g.clearRect(0, 0, w, h)
  const grid = floorGrid(w, h)
  g.lineWidth = 1
  g.strokeStyle = t.edge
  g.globalAlpha = 0.45
  g.beginPath()
  for (const [x0, x1, y] of grid.depth) { g.moveTo(x0, y + 0.5); g.lineTo(x1, y + 0.5) }
  for (const [xb, yb, xf, yf] of grid.across) { g.moveTo(xb, yb); g.lineTo(xf, yf) }
  g.stroke()
  g.globalAlpha = 1
  if (cursor != null && ridges.length) {
    const front = ridges[ridges.length - 1].pts[cursor]
    const back = ridges[0].pts[cursor]
    g.strokeStyle = t.ink2
    g.setLineDash([3, 4])
    g.beginPath(); g.moveTo(back[0], h * 0.3); g.lineTo(front[0], h * 0.84); g.stroke()
    g.setLineDash([])
  }
  const color = source === 'live' ? t.measured : source === 'simulated' ? t.simulated : t.ink3
  const rest = ridges.filter((r) => !r.front)
  for (let b = 0; b < 4; b++) {
    const path = new Path2D()
    for (const r of rest) {
      if (Math.min(3, Math.floor(r.alpha * 4)) !== b) continue
      r.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)))
    }
    g.globalAlpha = 0.22 + 0.2 * b
    g.lineWidth = 1
    g.strokeStyle = source === 'none' ? t.ink3 : t.ink2
    g.stroke(path)
  }
  g.globalAlpha = 1
  const front = ridges.find((r) => r.front)
  if (front) {
    g.lineWidth = source === 'none' ? 1 : 2
    g.strokeStyle = color
    g.beginPath()
    front.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.stroke()
    if (cursor != null) {
      const [x, y] = front.pts[cursor]
      g.fillStyle = color
      g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill()
    }
  }
}

export function SignalTerrain({ frames, source, paused = false, cursor = null, onCursor, frozen = false, onFreeze }: SignalTerrainProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const last = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const ridges = useMemo(() => {
    if (source === 'none' || frames.length === 0) return hollowMound()
    return ridgeGeometry(terrainRows(frames))
  }, [frames, source])
  const hollow = source === 'none' || frames.length === 0

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const draw = () => {
      const g = c.getContext('2d')
      if (!g || typeof Path2D === 'undefined') return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (c.width !== STAGE_W * dpr) { c.width = STAGE_W * dpr; c.height = STAGE_H * dpr }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawTerrain(g, ridges, hollow ? 'none' : source, tokens(c), cursor)
      last.current = performance.now()
    }
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches
    const wait = reduced ? MIN_GAP_REDUCED_MS - (performance.now() - last.current) : 0
    window.clearTimeout(timer.current)
    if (wait > 0) timer.current = window.setTimeout(draw, wait)
    else draw()
    return () => window.clearTimeout(timer.current)
  }, [ridges, source, hollow, cursor])

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return colAt(((e.clientX - r.left) / r.width) * STAGE_W)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onCursor) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const at0 = cursor ?? Math.floor(COLS / 2)
      onCursor(Math.max(0, Math.min(COLS - 1, at0 + (e.key === 'ArrowRight' ? 1 : -1))))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onFreeze?.()
    }
  }
  return (
    <div
      className="js-terrain" data-source={hollow ? 'none' : source} data-frozen={frozen ? 'true' : undefined} role="group" tabIndex={0}
      aria-label="Signal terrain: 51 subcarriers by the last 24 frames. Left and Right move the cursor, Enter freezes the frame, Escape resumes."
      onKeyDown={onKey} onBlur={() => onCursor?.(null)}
    >
      <canvas
        ref={ref} width={STAGE_W} height={STAGE_H} className="js-terrain-canvas" aria-hidden="true"
        onPointerMove={(e) => onCursor?.(at(e))} onPointerLeave={() => onCursor?.(null)} onClick={() => onFreeze?.()}
      />
      {hollow && <p className="js-terrain-legend"><span>NO SIGNAL: shape is a placeholder</span></p>}
      {!hollow && source === 'simulated' && <span className="js-stamp js-stamp-sim" data-stamp="simulated">SIMULATED</span>}
      {(paused || frozen) && <span className="js-stamp js-stamp-paused" data-stamp="paused">{frozen ? 'PAUSED: Esc resumes' : 'PAUSED BY YOU'}</span>}
    </div>
  )
}
