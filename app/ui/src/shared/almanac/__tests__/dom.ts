// A small render kit for the L01 tests (the project has no testing-library): mount, unmount, click, key, and a button finder by
// accessible name. Everything goes through React act, so effects and state settle before a check.
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: { root: Root; el: HTMLElement }[] = []

export function render(ui: ReactElement): { container: HTMLElement } {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(ui))
  mounted.push({ root, el })
  return { container: el }
}

export function cleanup(): void {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount())
    m.el.remove()
  }
}

export function click(el: Element | null): void {
  if (!el) throw new Error('click: no element')
  act(() => (el as HTMLElement).click())
}

export function keyDown(target: EventTarget, key: string): void {
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
}

export function renderHook<T>(fn: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T }
  function Probe() {
    result.current = fn()
    return null
  }
  render(createElement(Probe))
  return { result }
}

/** The buttons whose accessible name (aria-label, else text) matches. */
export function buttons(root: ParentNode, name: RegExp | string): HTMLButtonElement[] {
  const test = (s: string) => (typeof name === 'string' ? s === name : name.test(s))
  return [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => test((b.getAttribute('aria-label') ?? b.textContent ?? '').trim()))
}

/** Let promises settle inside act (a port answers asynchronously). */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}
