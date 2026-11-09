// Shared stubs for the Well Wisher tests. A test that imports this file also proves that
// vitest collects .tsx tests (vitest.config.ts include is src/**/*.test.{ts,tsx}).
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Listener = () => void

/** Replace window.matchMedia: `queries` maps a substring of the query to its truth. */
export function stubMatchMedia(queries: Record<string, boolean>): () => void {
  const prev = window.matchMedia
  window.matchMedia = ((q: string) => {
    const hit = Object.entries(queries).find(([k]) => q.includes(k))
    const listeners = new Set<Listener>()
    return {
      matches: hit ? hit[1] : false,
      media: q,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }
  }) as typeof window.matchMedia
  return () => {
    window.matchMedia = prev
  }
}

export function setHtml(attrs: Record<string, string | null>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) document.documentElement.removeAttribute(k)
    else document.documentElement.setAttribute(k, v)
  }
}

export function resetHtml(): void {
  for (const a of ['data-ww', 'data-motion', 'data-motion-load', 'data-theme', 'data-vt']) document.documentElement.removeAttribute(a)
}

/** Mount a React element and return handles; updates go through render(). */
export function mount(el: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(el))
  return {
    container,
    render: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

export { createElement }
