/**
 * `hold` (plan 5.7.3 #10): press-and-hold for destructive or costly actions only.
 *
 * The fill itself is CSS (data-hold on the control, .ww-hold-fill in motion.css); this
 * controller only owns the 400 ms timer, so it needs no requestAnimationFrame at all.
 * Released early: the fill reverses in 120 ms and nothing happens. Reduced motion, and
 * Enter or Space on the focused control: no hold, a plain confirm dialog instead, so the
 * hold is never the only way to do anything.
 */
export const HOLD_MS = 400

export interface HoldOptions {
  el: HTMLElement
  onConfirm: () => void
  /** reduced motion or keyboard: ask with a dialog instead */
  onNeedConfirm: () => void
  reduced: () => boolean
  ms?: number
}

export interface Hold {
  start: () => void
  release: () => void
  /** Enter or Space */
  key: () => void
  dispose: () => void
}

export function createHold(o: HoldOptions): Hold {
  let timer: ReturnType<typeof setTimeout> | null = null
  const set = (s: string | null) => (s ? o.el.setAttribute('data-hold', s) : o.el.removeAttribute('data-hold'))
  return {
    start() {
      if (o.reduced()) {
        o.onNeedConfirm()
        return
      }
      set('holding')
      timer = setTimeout(() => {
        timer = null
        set(null)
        o.onConfirm()
      }, o.ms ?? HOLD_MS)
    },
    release() {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
      set('released')
    },
    key() {
      o.onNeedConfirm()
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      set(null)
    },
  }
}
