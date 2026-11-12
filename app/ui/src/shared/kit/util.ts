/** Small helpers shared by the kit. No DOM work at import time, so server rendering and tests are safe. */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Read a duration token (--dur-state ...) from the element's computed style, in ms. A timer that
 * outlives a CSS transition must use the same number the CSS uses, or the two drift apart when
 * reduced motion collapses the token (primitive.css sets it to 120 ms). `fallback` is the plan's
 * value, used where there is no layout engine (happy-dom).
 */
export function tokenMs(el: Element | null, name: string, fallback: number): number {
  if (!el || typeof getComputedStyle !== 'function') return fallback
  const raw = getComputedStyle(el).getPropertyValue(name).trim()
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : fallback
}

/** sessionStorage with the try/catch the plan requires: private windows and blocked storage throw. */
export const session = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value)
    } catch {
      /* storage blocked: the once-per-session rule then holds per mount only */
    }
  },
}
