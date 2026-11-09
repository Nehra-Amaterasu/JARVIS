/**
 * `arrive` (plan 5.7.3 #1): a one-shot IntersectionObserver reveal.
 *
 * Nothing below the fold animates and nothing animates twice: an element gets
 * data-arrive="in" the first time 25 % of it is in view, then it is unobserved. The CSS
 * (design/motion.css) only has a `from` keyframe, so an element this never touches is already
 * in its finished state (rule 7: the end state is the default state).
 */
export const STAGGER_MS = 40
/** cap 3 at a workspace switch (the page title counts as one of them): 120 ms in total */
export const ARRIVE_CAP_SWITCH = 3
/** cap 6 for a group revealed by scrolling: 240 ms in total */
export const ARRIVE_CAP_SCROLL = 6
export const STAGGER_TOTAL_MAX_MS = 240
export const ARRIVE_THRESHOLD = 0.25
/** will-change is set only while a transition runs, on at most this many elements at once (5.8.2) */
export const MAX_WILL_CHANGE = 8

/** The --i of the n-th item of a batch: items past the cap share the last slot, so total stagger is bounded. */
export function staggerSlot(index: number, cap: number): number {
  return Math.min(Math.max(index, 0), cap - 1)
}

export function observeArrive(els: Element[], opts: { cap?: number; root?: Element | null } = {}): () => void {
  const cap = opts.cap ?? ARRIVE_CAP_SCROLL
  if (typeof IntersectionObserver === 'undefined') return () => {}
  const io = new IntersectionObserver(
    (entries) => {
      let n = 0
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const el = e.target as HTMLElement
        el.style.setProperty('--i', String(staggerSlot(n++, cap)))
        el.setAttribute('data-arrive', 'in')
        io.unobserve(el)
        el.addEventListener('animationend', () => el.style.removeProperty('--i'), { once: true })
      }
    },
    { threshold: ARRIVE_THRESHOLD, root: opts.root ?? null },
  )
  els.forEach((el) => io.observe(el))
  return () => io.disconnect()
}
