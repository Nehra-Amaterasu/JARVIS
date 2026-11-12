// Shared hooks of the art components: the Calm switch, the roving tabindex of a ring or a strip, and the one
// bounded loop that the only moving piece here (the ASCII sweep) runs on.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react'
import { nextIndex } from './geometry'

// ---- Calm: the same rule as the app's motion switch (<html data-motion="auto | full | calm"> plus the OS flag),
// read here without importing Well Wisher (seam S1). `full` overrides the OS flag, for review only.

function calmNow(): boolean {
  if (typeof document === 'undefined') return true
  const m = document.documentElement.getAttribute('data-motion')
  if (m === 'calm') return true
  if (m === 'full') return false
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function subscribeCalm(cb: () => void): () => void {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  mq?.addEventListener?.('change', cb)
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
  return () => {
    mq?.removeEventListener?.('change', cb)
    mo.disconnect()
  }
}

/** True when motion must be the static form: Calm, or the OS asks for less, or no window to animate in. */
export function useCalm(): boolean {
  return useSyncExternalStore(subscribeCalm, calmNow, () => true)
}

// ---- Roving tabindex: one tab stop for the whole group, arrows move inside it (spec 7.4 rows 22, 23, 24, 29, 31).

export function useRoving(count: number, opts: { wrap?: boolean } = {}) {
  const [active, setActive] = useState(0)
  const refs = useRef<(Element | null)[]>([])
  const wrap = opts.wrap ?? true
  const at = Math.min(active, Math.max(0, count - 1))
  const props = useCallback(
    (i: number) => ({
      ref: (el: Element | null) => {
        refs.current[i] = el
      },
      tabIndex: i === at ? 0 : -1,
      onFocus: () => setActive(i),
      onKeyDown: (e: KeyboardEvent<Element>) => {
        const n = nextIndex(i, e.key, count, wrap)
        if (n === null) return
        e.preventDefault()
        setActive(n)
        ;(refs.current[n] as HTMLElement | SVGElement | null)?.focus()
      },
    }),
    [at, count, wrap],
  )
  return { active: at, props }
}

// ---- The bounded loop. A component that animates owns one timer; it stops after `maxMs` (the spec's "no loop
// longer than 5 s without Pause": a loader simply settles), on `visibilitychange`, and when scrolled out of view.
// Nothing runs unless `enabled`, and an effect cleanup always clears the timer, so no idle loop survives.

export function useBoundedLoop(enabled: boolean, intervalMs: number, maxMs: number, tick: (n: number) => void, el?: RefObject<Element | null>): void {
  const cb = useRef(tick)
  useEffect(() => {
    cb.current = tick
  })
  useEffect(() => {
    if (!enabled) return
    let n = 0
    let id: ReturnType<typeof setInterval> | null = null
    let visible = typeof document === 'undefined' ? true : !document.hidden
    let inView = true
    const stop = () => {
      if (id !== null) clearInterval(id)
      id = null
    }
    const start = () => {
      if (id !== null || !visible || !inView || (n + 1) * intervalMs > maxMs) return
      id = setInterval(() => {
        n += 1
        cb.current(n)
        if (n * intervalMs >= maxMs) stop() // settles on the last frame; the caller shows the static form after
      }, intervalMs)
    }
    const onVis = () => {
      visible = !document.hidden
      if (visible) start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVis)
    let io: IntersectionObserver | null = null
    if (el?.current && typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((es) => {
        inView = es[es.length - 1]?.isIntersecting ?? true
        if (inView) start()
        else stop()
      })
      io.observe(el.current)
    }
    start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      io?.disconnect()
    }
  }, [enabled, intervalMs, maxMs, el])
}
