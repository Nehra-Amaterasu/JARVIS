/**
 * The one reduced-motion switch for Well Wisher (plan 5.7.8), replacing today's four.
 *
 * <html data-motion="auto | full | calm">:
 *   auto  follows the OS flag (prefers-reduced-motion)
 *   calm  reduced even when the OS flag is off (Setup > Appearance)
 *   full  keeps travel even when the OS says reduce, for review only
 * The same attribute drives the CSS tokens (design/primitive.css), so JS and CSS cannot
 * disagree. Importing this module also registers the rule with lib/motion.tsx, so useSpring,
 * Ticker, Presence and switchView honour data-motion too.
 */
import { useSyncExternalStore } from 'react'
import { setReducedMotionResolver } from '../../lib/motion'

export type MotionMode = 'auto' | 'full' | 'calm'

export function motionMode(): MotionMode {
  if (typeof document === 'undefined') return 'auto'
  const m = document.documentElement.getAttribute('data-motion')
  return m === 'full' || m === 'calm' ? m : 'auto'
}

export function setMotionMode(mode: MotionMode): void {
  document.documentElement.setAttribute('data-motion', mode)
}

export function isReducedMotion(): boolean {
  const mode = motionMode()
  if (mode === 'calm') return true
  if (mode === 'full') return false
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function subscribe(onChange: () => void): () => void {
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  mq?.addEventListener?.('change', onChange)
  let mo: MutationObserver | null = null
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    mo = new MutationObserver(onChange)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
  }
  return () => {
    mq?.removeEventListener?.('change', onChange)
    mo?.disconnect()
  }
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, () => false)
}

setReducedMotionResolver(isReducedMotion)
