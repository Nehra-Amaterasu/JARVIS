/**
 * Feature probe (plan 5.7.4 #9). `inert`, `content-visibility`, `animation-timeline` and
 * `document.startViewTransition` are Chromium features; the app runs in WebView2, whose runtime the
 * owner updates on its own schedule. Each is tested, never assumed, and each has a fallback that ends
 * in the same state:
 *   no inert              Drawer's focus trap + aria-hidden (kit/overlay.ts trapTab) still holds focus
 *   no view transition    the 160 ms fade on the centre (design/motion/transition.ts)
 *   no animation-timeline reading progress and reveals use the IntersectionObserver path
 * The Frame writes the result on its root as `data-feat` so a Playwright spec can read what the real
 * window supports, and the build note records the WebView2 runtime version next to it.
 */
export interface Features {
  inert: boolean
  viewTransition: boolean
  animationTimeline: boolean
  contentVisibility: boolean
  /** Chromium major from the user agent ("Edg/xxx" in WebView2, "Chrome/xxx" elsewhere), or null. */
  chromium: number | null
}

export function probeFeatures(): Features {
  const supports = (a: string, b?: string) => {
    try {
      return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && (b === undefined ? CSS.supports(a) : CSS.supports(a, b))
    } catch {
      return false
    }
  }
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const m = ua.match(/(?:Edg|Chrome)\/(\d+)/)
  return {
    inert: typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype,
    viewTransition: typeof document !== 'undefined' && typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function',
    animationTimeline: supports('animation-timeline: scroll()'),
    contentVisibility: supports('content-visibility', 'hidden'),
    chromium: m ? Number(m[1]) : null,
  }
}

/** The list written to `data-feat`: names of what IS present, so a missing attribute value reads as a gap. */
export function featureTokens(f: Features): string {
  return [f.inert && 'inert', f.viewTransition && 'view-transition', f.animationTimeline && 'animation-timeline', f.contentVisibility && 'content-visibility']
    .filter(Boolean)
    .join(' ')
}
