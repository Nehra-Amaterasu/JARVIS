/**
 * Workspace switch and theme crossfade (plan 5.7.3 #2 and #12, 5.7.4).
 *
 * runSwitch(change): the new workspace's data-ws is set inside document.startViewTransition,
 * in one synchronous commit, so the browser cross-fades two snapshots of the centre (the only
 * element with view-transition-name, design/motion.css). Fallbacks, all ending in the same
 * state: no startViewTransition, reduced motion, or the low governor -> change() then a 160 ms
 * fade on the centre. A second switch inside 600 ms finishes the first at once
 * (skipTransition) and takes the fade: a new input is never queued behind an animation.
 *
 * runTint(change): the Appearance theme switch, a root view transition of 200 ms opacity;
 * the fallback is an instant swap.
 */
import { flushSync } from 'react-dom'
import { useCallback } from 'react'
import { isReducedMotion } from '../../useReducedMotion'

export const SWITCH_CAP_MS = 600
export const FAST_PATH_MS = 600

interface VT {
  finished: Promise<void>
  skipTransition: () => void
}
type Doc = Document & { startViewTransition?: (cb: () => void) => VT }

let current: VT | null = null
let lastStart = -Infinity

const isLow = () => document.documentElement.getAttribute('data-motion-load') === 'low'

function fade(centre: HTMLElement | null) {
  if (!centre) return
  centre.setAttribute('data-switch', 'fade')
  const clear = () => centre.removeAttribute('data-switch')
  centre.addEventListener('animationend', clear, { once: true })
  setTimeout(clear, 200)
}

export function runSwitch(change: () => void, centre: HTMLElement | null = null): Promise<void> {
  const d = document as Doc
  const now = performance.now()
  const rapid = now - lastStart < FAST_PATH_MS
  lastStart = now
  if (current) {
    current.skipTransition()
    current = null
  }
  if (!d.startViewTransition || isReducedMotion() || isLow() || rapid) {
    change()
    if (!isReducedMotion()) fade(centre)
    return Promise.resolve()
  }
  const vt = d.startViewTransition(() => flushSync(change))
  current = vt
  const done = () => {
    if (current === vt) current = null
  }
  return vt.finished.then(done, done)
}

export function runTint(change: () => void): Promise<void> {
  const d = document as Doc
  if (!d.startViewTransition || isReducedMotion()) {
    change()
    return Promise.resolve()
  }
  const root = document.documentElement
  root.setAttribute('data-vt', 'theme')
  const vt = d.startViewTransition(() => flushSync(change))
  const clear = () => root.removeAttribute('data-vt')
  return vt.finished.then(clear, clear)
}

/** Stable handles for components. */
export function useWorkspaceTransition() {
  const run = useCallback((change: () => void, centre?: HTMLElement | null) => runSwitch(change, centre ?? null), [])
  const tint = useCallback((change: () => void) => runTint(change), [])
  return { run, tint }
}
