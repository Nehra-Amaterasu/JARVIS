/**
 * Shared overlay mechanics for Drawer, Sheet and Popover (plan 5.5, 5.7.6): one Esc stack, an inert
 * background, a focus trap and focus return. Kept out of the components so they stay about markup.
 */
import { useEffect, useRef } from 'react'

/** Open overlays, newest last. Esc closes only the top one ("Esc closes the top overlay first"). */
const stack: symbol[] = []

export function useEscStack(open: boolean, onEscape: () => void): void {
  const cb = useRef(onEscape)
  cb.current = onEscape
  useEffect(() => {
    if (!open) return
    const me = Symbol('overlay')
    stack.push(me)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== me) return
      e.stopPropagation()
      cb.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.indexOf(me)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open])
}

/** Elements made inert, with how many overlays asked: a second drawer opening over the first must not release it early. */
const inerted = new Map<Element, number>()

/**
 * Make every other child of <body> inert while an overlay is open: the background cannot be tabbed
 * to, clicked or read by a screen reader. Returns the release. `except` is the overlay's own portal.
 */
export function lockBackground(except: Element): () => void {
  const mine: Element[] = []
  for (const el of Array.from(document.body.children)) {
    if (el === except || el.contains(except)) continue
    const n = inerted.get(el) ?? 0
    if (n === 0) el.setAttribute('inert', '')
    inerted.set(el, n + 1)
    mine.push(el)
  }
  return () => {
    for (const el of mine) {
      const n = (inerted.get(el) ?? 1) - 1
      if (n <= 0) {
        inerted.delete(el)
        el.removeAttribute('inert')
      } else inerted.set(el, n)
    }
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
export const focusables = (root: Element): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => !e.hasAttribute('inert') && e.getAttribute('aria-hidden') !== 'true')

/** Tab and Shift+Tab wrap inside `root`: the trap for browsers or tools that ignore `inert`. */
export function trapTab(e: KeyboardEvent | React.KeyboardEvent, root: Element): void {
  if (e.key !== 'Tab') return
  const items = focusables(root)
  if (items.length === 0) {
    e.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}
