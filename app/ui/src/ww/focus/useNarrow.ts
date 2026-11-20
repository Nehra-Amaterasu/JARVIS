import { useEffect, useState } from 'react'

/**
 * True when the window is at most `maxPx` wide: 899 (the default) is the phone layout, the same break the stylesheet uses; 1099 is the compact
 * band where Start folds to one column. False where matchMedia is missing. Older WebKit only has addListener, so it is the fallback.
 */
export function useNarrow(maxPx = 899): boolean {
  const q = `(max-width: ${maxPx}px)`
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false)
  const [n, set] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const m = window.matchMedia(q)
    const on = () => set(m.matches)
    on()
    if (typeof m.addEventListener === 'function') {
      m.addEventListener('change', on)
      return () => m.removeEventListener('change', on)
    }
    m.addListener?.(on)
    return () => m.removeListener?.(on)
  }, [q])
  return n
}
