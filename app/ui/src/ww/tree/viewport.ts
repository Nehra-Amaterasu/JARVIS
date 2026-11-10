/**
 * Pan, zoom and the `glide` motion for the Tree canvas (plan 5.7.2 #4, 5.7.3 #7, 4.5).
 *
 * The view lives in a ref and the DOM is written straight to one <g> transform, at most once per
 * animation frame; React never re-renders on a pan, a zoom or a hover. Three things can keep a rAF
 * loop alive: a selection tween (240 ms), the wheel-zoom ease, and the inertia after a drag
 * (design/motion/glide.ts, tau 110 ms, at rest under 0.05 px/ms). Every loop stops itself, and the
 * moment the last one stops `rest()` runs: it writes data-moving="false" and data-frames on the stage
 * and hands the view to the scene memory. So an idle Tree costs 0 callbacks, and the Playwright spec
 * can read the count instead of guessing (a glide from the 3 px/ms cap is 450 ms, about 27 frames at 60 Hz).
 *
 * Nothing glides on a keyboard or reduced-motion path: a key, a button or reduced motion `jump`s
 * (or tweens for 0 ms) and never starts a loop.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react'
import { Glide, RESIST, releaseVelocity, V_REST, type Sample } from '../design/motion/glide'
import { isReducedMotion } from '../useReducedMotion'
import { tokenMs } from '../kit/util'

export interface Box { x: number; y: number; w: number; h: number }
export interface View { x: number; y: number; k: number }
export const parseBox = (vb: string): Box => {
  const [x, y, w, h] = vb.split(' ').map(Number)
  return { x, y, w, h }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const K_MAX = 2.4        // past 240 % a 34 px hexagon is bigger than the toolbar; nothing more to read
export const K_SEL = 1.15       // selecting a node brings the view to at least this: 11 px labels at about 13 px
export const K_FOCUS = 1.9      // double-click / Focus: close enough to read the label and its neighbours
export const LOD_K = 0.55       // 11 px labels x 0.55 is about 6 px: unreadable, so skip painting them
const TWEEN_FALLBACK_MS = 240   // --dur-enter; a selection pan is long enough to follow and short enough not to wait for
const BACK_MS = 400             // the rubber-band return is `heavy`: 400 ms settle (5.7.2 #1); --dur-sheet-in is 300, so no token fits
const EASE = 0.3                // wheel ease: share of the remaining gap closed per frame (95 % in 140 ms at 60 Hz)
export const PANEL = 404        // an overlaid inspector covers 380 px + 12 px inset + 12 px gap
export const WIDE = 760         // below this an overlaid inspector covers the whole stage

export interface ViewportOptions {
  bounds: Box
  /** True while an overlaid inspector covers the right of the stage. */
  occluded: MutableRefObject<boolean>
  sens: MutableRefObject<number>
  /** Called once when the last loop stops, with the view centre in layout units. */
  onRest?: (centre: { x: number; y: number; k: number }) => void
}

export function useViewport({ bounds, occluded, sens, onRest }: ViewportOptions) {
  const stage = useRef<HTMLDivElement | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  const g = useRef<SVGGElement | null>(null)
  const zoomText = useRef<HTMLSpanElement | null>(null)
  const view = useRef<View>({ x: 0, y: 0, k: 1 })
  const target = useRef<View>({ x: 0, y: 0, k: 1 })
  const size = useRef({ w: 0, h: 0 })
  const kMin = useRef(0.1)
  const frame = useRef(0)
  const tween = useRef(0)
  const ease = useRef(0)
  const inertia = useRef(new Glide())
  const frames = useRef(0)
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean; samples: Sample[] } | null>(null)
  const dragged = useRef(false)
  const restCb = useRef(onRest)
  restCb.current = onRest
  const [ready, setReady] = useState(false)

  const moving = (on: boolean) => stage.current?.setAttribute('data-moving', on ? 'true' : 'false')
  const busy = () => !!(frame.current || tween.current || ease.current || inertia.current.active || drag.current?.moved)

  const visible = useCallback((): Box => {
    const { w, h } = size.current
    const vw = occluded.current && w >= WIDE ? w - PANEL : w
    return { x: 0, y: 0, w: Math.max(1, vw), h: Math.max(1, h) }
  }, [occluded])

  const centreOf = useCallback((v: View) => {
    const r = visible()
    return { x: (r.x + r.w / 2 - v.x) / v.k, y: (r.y + r.h / 2 - v.y) / v.k, k: v.k }
  }, [visible])

  const rest = useCallback(() => {
    if (busy()) return
    moving(false)
    stage.current?.setAttribute('data-frames', String(frames.current))
    restCb.current?.(centreOf(view.current))
  }, [centreOf]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback(() => {
    frame.current = 0
    frames.current += 1
    const v = view.current
    g.current?.setAttribute('transform', `translate(${v.x.toFixed(1)},${v.y.toFixed(1)}) scale(${v.k.toFixed(4)})`)
    svg.current?.classList.toggle('lod-far', v.k < LOD_K)
    if (zoomText.current) zoomText.current.textContent = `${Math.round(v.k * 100)}%`
    // a plain write (drag, key, button) has no loop of its own: it is at rest as soon as it is painted
    if (!tween.current && !ease.current && !inertia.current.active && !drag.current?.moved) rest()
  }, [rest])
  const schedule = useCallback(() => {
    moving(true)
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }, [apply])
  const stopAnim = () => {
    if (tween.current) cancelAnimationFrame(tween.current)
    if (ease.current) cancelAnimationFrame(ease.current)
    inertia.current.stop()
    tween.current = 0
    ease.current = 0
  }
  /** Set the view now (drag, key, reduced motion): the target follows so a later ease starts from here. */
  const jump = useCallback((to: View) => {
    view.current = to
    target.current = { ...to }
    schedule()
  }, [schedule])

  const fitK = useCallback(() => {
    const r = visible()
    return clamp(Math.min((r.w - 32) / bounds.w, (r.h - 16) / bounds.h), 0.05, K_MAX)
  }, [bounds, visible])

  const animateTo = useCallback((to: View, ms?: number) => {
    stopAnim()
    if (isReducedMotion()) {
      jump(to)
      return
    }
    const dur = ms ?? tokenMs(stage.current, '--dur-enter', TWEEN_FALLBACK_MS)
    const from = { ...view.current }
    target.current = { ...to }
    const t0 = performance.now()
    moving(true)
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const e = 1 - (1 - p) ** 3   // ease-out cubic
      view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e }
      tween.current = p < 1 ? requestAnimationFrame(step) : 0
      apply()
    }
    tween.current = requestAnimationFrame(step)
  }, [apply, jump])

  const startEase = useCallback(() => {
    if (isReducedMotion()) {
      jump({ ...target.current })
      return
    }
    if (ease.current) return
    moving(true)
    const step = () => {
      const v = view.current
      const t = target.current
      const k = Math.exp(Math.log(v.k) + (Math.log(t.k) - Math.log(v.k)) * EASE)
      const x = v.x + (t.x - v.x) * EASE
      const y = v.y + (t.y - v.y) * EASE
      const done = Math.abs(t.x - x) < 0.5 && Math.abs(t.y - y) < 0.5 && Math.abs(t.k - k) < 0.0005
      view.current = done ? { ...t } : { x, y, k }
      ease.current = done ? 0 : requestAnimationFrame(step)
      apply()
    }
    ease.current = requestAnimationFrame(step)
  }, [apply, jump])

  const fit = useCallback((instant = false) => {
    const k = fitK()
    kMin.current = Math.min(k * 0.6, 0.3)
    const r = visible()
    const to = { k, x: r.x + (r.w - bounds.w * k) / 2 - bounds.x * k, y: r.y + (r.h - bounds.h * k) / 2 - bounds.y * k }
    if (instant) jump(to)
    else animateTo(to)
  }, [animateTo, bounds, fitK, jump, visible])

  /** Centre a layout point in the visible area at zoom k (default: keep the zoom, but at least readable). */
  const centerOn = useCallback((px: number, py: number, k?: number, instant = false) => {
    const kk = clamp(k ?? Math.max(target.current.k, K_SEL), kMin.current, K_MAX)
    const r = visible()
    const to = { k: kk, x: r.x + r.w / 2 - px * kk, y: r.y + r.h / 2 - py * kk }
    if (instant) jump(to)
    else animateTo(to)
  }, [animateTo, jump, visible])

  /** Fit a rectangle of layout units (a branch) into the visible area. */
  const fitBox = useCallback((b: Box) => {
    const r = visible()
    const k = clamp(Math.min((r.w - 48) / b.w, (r.h - 48) / b.h), kMin.current, K_MAX)
    centerOn(b.x + b.w / 2, b.y + b.h / 2, k)
  }, [centerOn, visible])

  /** Zoom around a stage point (the pointer), moving the target; the ease does the motion. */
  const zoomBy = useCallback((factor: number, sx?: number, sy?: number) => {
    if (tween.current) {
      cancelAnimationFrame(tween.current)
      tween.current = 0
      target.current = { ...view.current }
    }
    inertia.current.stop()
    const t = target.current
    const r = visible()
    const cx = sx ?? r.x + r.w / 2
    const cy = sy ?? r.y + r.h / 2
    const k = clamp(t.k * factor, kMin.current, K_MAX)
    const f = k / t.k
    target.current = { k, x: cx - (cx - t.x) * f, y: cy - (cy - t.y) * f }
    startEase()
  }, [startEase, visible])

  // size: the stage is sized by CSS; watch it so fit and centring use real pixels
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      size.current = { w, h }
      kMin.current = Math.min(fitK() * 0.6, 0.3)
      setReady(true)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitK])

  // React's onWheel is passive; a real listener lets preventDefault stop the page scrolling
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      // a mouse notch (about 100) zooms x0.86 at 1x sensitivity; a trackpad pinch (ctrl, 1-10 per event) stays smooth
      zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015) * sens.current), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy, sens])

  useEffect(() => () => {
    stopAnim()
    if (frame.current) cancelAnimationFrame(frame.current)
  }, [])

  /** The nearest view that keeps the graph's centre inside the stage, and how far outside `v` is. */
  const bound = useCallback((v: View) => {
    const { w, h } = size.current
    const cx = v.x + (bounds.x + bounds.w / 2) * v.k
    const cy = v.y + (bounds.y + bounds.h / 2) * v.k
    const ox = cx < 0 ? cx : cx > w ? cx - w : 0
    const oy = cy < 0 ? cy : cy > h ? cy - h : 0
    return { to: { ...v, x: v.x - ox, y: v.y - oy }, ox, oy }
  }, [bounds])

  /** Past the bound the drag is resisted (x0.35) and returns on `heavy`. */
  const resisted = (v: View): { v: View; over: boolean } => {
    const b = bound(v)
    if (!b.ox && !b.oy) return { v, over: false }
    return { v: { ...v, x: b.to.x + b.ox * RESIST, y: b.to.y + b.oy * RESIST }, over: true }
  }
  const settleBack = () => {
    const b = bound(view.current)
    if (b.ox || b.oy) animateTo(b.to, BACK_MS)
  }

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    stopAnim()
    target.current = { ...view.current }
    dragged.current = false
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y, moved: false, samples: [] }
  }
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      svg.current?.setPointerCapture?.(e.pointerId)
      svg.current?.classList.add('panning')
    }
    d.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY })
    if (d.samples.length > 12) d.samples.shift()
    jump(resisted({ ...view.current, x: d.vx + dx, y: d.vy + dy }).v)
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    svg.current?.classList.remove('panning')
    if (!d?.moved) return
    dragged.current = true
    const { vx, vy } = releaseVelocity(d.samples, performance.now())
    if (!isReducedMotion() && Math.hypot(vx, vy) > V_REST) {
      moving(true)
      inertia.current.start(vx, vy, (dx, dy) => {
        const next = resisted({ ...view.current, x: view.current.x + dx, y: view.current.y + dy })
        view.current = next.v
        target.current = { ...next.v }
        if (next.over) {
          inertia.current.stop()
          settleBack()
        }
        apply()
      }, () => {
        settleBack()
        rest()
      })
    } else {
      settleBack()
      schedule()
    }
  }
  // a drag must not also count as a click on the node under the pointer
  const onClickCapture = (e: RMouseEvent) => {
    if (dragged.current) {
      e.stopPropagation()
      e.preventDefault()
      dragged.current = false
    }
  }
  // no focus on mousedown: a drag that starts on a node must not open it. A real click focuses it.
  const onMouseDown = (e: RMouseEvent) => e.preventDefault()

  return {
    stage, svg, g, zoomText, ready, fit, fitBox, centerOn, centreOf, view,
    zoomIn: () => zoomBy(1.3),
    zoomOut: () => zoomBy(1 / 1.3),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture, onMouseDown },
  }
}
