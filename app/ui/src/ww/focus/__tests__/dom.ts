// A small render kit for the Y02 tests (the project has no testing-library): mount, unmount, click, key and a button finder.
// Everything goes through React's act, so effects and state settle before a check.
import { act, type ReactElement } from 'react'
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

export const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })

export function click(el: Element | null): void {
  if (!el) throw new Error('click: no element')
  act(() => (el as HTMLElement).click())
}

/** A key goes to the window, as a hand on the keyboard with nothing focused. */
export function key(k: string, target: EventTarget = window): void {
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
}

/** Types into an input the way React sees it. */
export function type(input: HTMLInputElement, value: string): void {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export function buttons(root: ParentNode, name: RegExp | string): HTMLButtonElement[] {
  const test = (s: string) => (typeof name === 'string' ? s === name : name.test(s))
  return [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => test((b.getAttribute('aria-label') ?? b.textContent ?? '').trim()))
}
