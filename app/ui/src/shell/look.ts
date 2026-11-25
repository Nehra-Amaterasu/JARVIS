/**
 * The switch for the v3 look, "the frosted deck" (docs/design/design-language-v3.md, 8.3). Since 25 Nov 2026 it is the ONE look:
 * the owner had three looks on screen and asked for them to be merged into the new one ("keep on building on top"). Default
 * ON. The older frame stays in the code only as a fixture that about 3,900 unit tests and most browser specs were written
 * against (ShellV2.tsx still takes its old branch when this says no); no key of the interface switches to it any more.
 *
 * OFF only when one of these says so, checked in this order:
 *   1. the URL fragment carries `look=off` (or any value that is not on), as in `/#t=<token>&look=off`; it is written to
 *      localStorage so a reopen keeps it, and `look=v3` writes it back;
 *   2. localStorage key `app.look` is `off` (a stored `v3`, or a missing key, means on);
 *   3. the build says so: `VITE_LOOK_DEFAULT=off` at build time. Vitest and the Playwright bundle (dist-e2e) set it, because
 *      their specs are written against the older frame and rewriting them would cost far more than this one variable; the
 *      production build (plain `vite build`) does not set it and gets v3. Read at call time, not at import, so a test can
 *      stub it and prove both defaults.
 *
 * Read ONCE per page load and kept (a look flipped mid-session must not swap the whole frame under a half-typed form; same
 * rule as shell/flag.ts).
 *
 * The fragment is captured when this module is EVALUATED, not when the look is first asked (the rule of flag.ts):
 * lib/api.ts reads the `t=` token and then wipes the whole fragment with history.replaceState. flag.ts is imported by
 * App.tsx before api.ts for that reason; this module is only reached through the lazy ShellV2 chunk, which loads after
 * the wipe. So when location.hash is already empty the fragment is recovered from the navigation entry, whose `name` is
 * the URL the page was navigated to, fragment included, and replaceState never rewrites it (measured in Chromium, 20 Nov:
 * a goto of `/#t=x&look=v3` leaves location.hash empty after load and the navigation entry still holding it). Importing
 * this file early from App.tsx would make the entry unnecessary; that edit is outside this package and is listed in its
 * result.
 *
 * Glass is a second, smaller choice inside the look (spec 2.6): on unless the host or the stored choice says off.
 *   - the fragment `glass=off|on`, else localStorage `app.glass` (`off` | `on`), else the host's `window.jarvisHost.glass`
 *     (false means the window cannot be made transparent), else on.
 */
export const LOOK_KEY = 'app.look'
export const GLASS_KEY = 'app.glass'
const ON = new Set(['v3', 'on', '1', 'true'])

declare global {
  interface Window {
    /** Written by the desktop host (app/jarvis_app/desktop.py) before the page loads; absent in a plain browser. */
    jarvisHost?: { glass?: boolean; setGlass?: (on: boolean) => void }
  }
}

function fragmentAtLoad(): string {
  if (typeof location === 'undefined') return ''
  if (location.hash) return location.hash
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const i = nav?.name.indexOf('#') ?? -1
    return nav && i >= 0 ? nav.name.slice(i) : ''
  } catch {
    return ''
  }
}

let hashAtLoad = fragmentAtLoad()
let cachedLook: boolean | null = null
let cachedGlass: boolean | null = null

function fragmentValue(key: string): string | null {
  const m = hashAtLoad.match(new RegExp(`[#&]${key}=([^&]*)`))
  return m ? decodeURIComponent(m[1]).toLowerCase() : null
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage blocked: the fragment still decides this load */
  }
}

/** The build-time default: `VITE_LOOK_DEFAULT=off` keeps the older frame (tests, the e2e bundle); anything else is v3. */
function buildDefaultOn(): boolean {
  try {
    return (import.meta.env?.VITE_LOOK_DEFAULT ?? '').toString().toLowerCase() !== 'off'
  } catch {
    return true
  }
}

export function lookV3Enabled(): boolean {
  if (cachedLook !== null) return cachedLook
  let on = buildDefaultOn()
  try {
    const f = fragmentValue('look')
    if (f !== null) {
      on = ON.has(f)
      store(LOOK_KEY, on ? 'v3' : 'off')
    } else {
      const s = (localStorage.getItem(LOOK_KEY) ?? '').toLowerCase()
      // a stored choice wins over the build default in both directions; an empty or unknown value defers to the build
      if (ON.has(s)) on = true
      else if (s === 'off') on = false
    }
  } catch {
    /* storage blocked: the build default decides */
  }
  cachedLook = on
  return on
}

/** Frosted glass on or off for this load. Only meaningful when the look is v3. */
export function glassEnabled(): boolean {
  if (cachedGlass !== null) return cachedGlass
  let on = true
  try {
    const f = fragmentValue('glass')
    if (f === 'off' || f === 'on') {
      on = f === 'on'
      store(GLASS_KEY, f)
    } else {
      const s = (localStorage.getItem(GLASS_KEY) ?? '').toLowerCase()
      if (s === 'off') on = false
      else if (s === 'on') on = true
      else on = typeof window === 'undefined' || window.jarvisHost?.glass !== false
    }
  } catch {
    on = true
  }
  cachedGlass = on
  return on
}

/** The older frame's own key (ShellV2.tsx draws it only when the look is off, so no person reaches it from v3). The page reloads, because the look is read once per load. */
export function setLookV3(on: boolean): void {
  store(LOOK_KEY, on ? 'v3' : 'off')
  if (typeof location !== 'undefined') location.reload()
}

/** The Frosted switch in More: stored, written to the root by the caller, and told to the host when it listens. */
export function setGlass(on: boolean): void {
  cachedGlass = on
  store(GLASS_KEY, on ? 'on' : 'off')
  try {
    window.jarvisHost?.setGlass?.(on)
  } catch {
    /* the host has no glass call: the page tint alone changes */
  }
}

/** Tests only: forget the cached reads. */
export function resetLookForTests(): void {
  cachedLook = null
  cachedGlass = null
  hashAtLoad = typeof location !== 'undefined' ? location.hash : ''
}
