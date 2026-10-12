/**
 * Motion primitives for values and lifecycles that CSS alone cannot animate
 * (styles/motion.css covers the rest).
 *
 *   useSpring(target)     a number that springs to its target instead of jumping
 *   <Ticker value fmt />  a number on screen that rolls to its new value and bumps
 *   <Presence show>       children animate in, and OUT, before they unmount
 *   switchView(fn)        a state change wrapped in a View Transition (page morphs)
 *
 * The spring is the same damped spring motion.css samples into linear(), so a bar
 * driven by CSS and a number driven by JS settle together.
 */
import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { flushSync } from 'react-dom'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Spring-follow a target. stiffness/damping in physical units (mass 1). */
export function useSpring(target: number, { stiffness = 170, damping = 22 }: { stiffness?: number; damping?: number } = {}): number {
  const [v, setV] = useState(target)
  const s = useRef({ x: target, v: 0, raf: 0, last: 0 })
  useEffect(() => {
    const st = s.current
    if (!Number.isFinite(target)) { st.x = target; setV(target); return }
    if (reduced() || !Number.isFinite(st.x)) { st.x = target; st.v = 0; setV(target); return }
    cancelAnimationFrame(st.raf)
    st.last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - st.last) / 1000)
      st.last = now
      // semi-implicit Euler, sub-stepped for stability at high stiffness
      for (let i = 0; i < 4; i++) {
        const h = dt / 4
        st.v += (-stiffness * (st.x - target) - damping * st.v) * h
        st.x += st.v * h
      }
      if (Math.abs(st.x - target) < 1e-3 * Math.max(1, Math.abs(target)) && Math.abs(st.v) < 1e-3) {
        st.x = target; st.v = 0; setV(target); return
      }
      setV(st.x)
      st.raf = requestAnimationFrame(step)
    }
    st.raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(st.raf)
  }, [target, stiffness, damping])
  return v
}

/** A number that rolls to its new value; the digits bump when it changes. */
export function Ticker({ value, fmt = (n) => String(Math.round(n)), className = '', title }: {
  value: number | null | undefined; fmt?: (n: number) => string; className?: string; title?: string
}) {
  const target = value ?? NaN
  const v = useSpring(Number.isFinite(target) ? target : 0)
  const el = useRef<HTMLSpanElement>(null)
  const prev = useRef(target)
  useEffect(() => {
    if (prev.current !== target && Number.isFinite(target) && el.current) {
      el.current.classList.remove('bump')
      void el.current.offsetWidth                   // restart the animation
      el.current.classList.add('bump')
    }
    prev.current = target
  }, [target])
  return <span ref={el} className={`ticker-num ${className}`} title={title}>{Number.isFinite(target) ? fmt(v) : '—'}</span>
}

/** Keep one element mounted while it animates out (motion.css [data-presence=exit]). */
export function Presence({ show, children, exitMs = 240 }: { show: boolean; children: ReactElement<Record<string, unknown>>; exitMs?: number }) {
  const [mounted, setMounted] = useState(show)
  const [leaving, setLeaving] = useState(false)
  useLayoutEffect(() => {
    if (show) { setMounted(true); setLeaving(false); return }
    if (!mounted) return
    setLeaving(true)
    const t = setTimeout(() => { setMounted(false); setLeaving(false) }, reduced() ? 0 : exitMs)
    return () => clearTimeout(t)
  }, [show])                                          // eslint-disable-line react-hooks/exhaustive-deps
  if (!mounted) return null
  return cloneElement(children, { 'data-presence': leaving ? 'exit' : 'enter' })
}

/** Run a state change inside a View Transition when the browser has them. */
export function switchView(change: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!d.startViewTransition || reduced()) { change(); return }
  d.startViewTransition(() => flushSync(change))
}
