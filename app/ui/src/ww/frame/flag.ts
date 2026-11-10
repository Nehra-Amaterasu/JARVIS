/**
 * The switch for the new Well Wisher frame (plan 9.0: the whole workspace ships behind a flag so the
 * current UI keeps working through the exams; the owner flips it, not a chunk).
 *
 * ON when either holds, read ONCE per page load and kept (so a flag flipped mid-session cannot swap the
 * UI under a half-typed form):
 *   - localStorage key `ww.workspace` is `frame` (also `on`, `1`, `true`), or
 *   - the URL fragment has `ww=frame`, as in `/#t=<token>&ww=frame`. A fragment is read, not just
 *     consulted: it is written to localStorage, so the choice survives the window reopening without
 *     the fragment. `ww=off` writes `off` and turns it back.
 *
 * Default: ON in the app since 10 Nov (the owner asked for the visible change; chunks 4 to 12 are merged),
 * OFF under vitest so the old pages' suites keep testing the old pages. `off` in storage or `ww=off` in the
 * fragment brings the old layout back, and both layouts carry a button that flips it (setFrameFlag).
 * With it off MissionRoot renders exactly what it rendered before chunk 4, and the frame's code and CSS
 * are never downloaded (MissionRoot imports the frame lazily).
 */
export const FLAG_KEY = 'ww.workspace'
const ON = new Set(['frame', 'on', '1', 'true'])
const OFF = new Set(['off', '0', 'false', 'old'])
// vitest runs with MODE 'test'; the built app is 'production' (or 'development' under vite dev)
const DEFAULT_ON = import.meta.env.MODE !== 'test'
let cached: boolean | null = null

export function wwFrameEnabled(): boolean {
  if (cached !== null) return cached
  let on = false
  try {
    const m = typeof location !== 'undefined' ? location.hash.match(/[#&]ww=([^&]*)/) : null
    if (m) {
      on = ON.has(decodeURIComponent(m[1]).toLowerCase())
      try {
        localStorage.setItem(FLAG_KEY, on ? 'frame' : 'off')
      } catch {
        /* storage blocked: the fragment still decides for this load */
      }
    } else {
      const v = (localStorage.getItem(FLAG_KEY) ?? '').toLowerCase()
      on = ON.has(v) ? true : OFF.has(v) ? false : DEFAULT_ON
    }
  } catch {
    on = DEFAULT_ON
  }
  cached = on
  return on
}

/** The two layout buttons: store the choice and reload, since the flag is read once per load on purpose. */
export function setFrameFlag(on: boolean): void {
  try {
    localStorage.setItem(FLAG_KEY, on ? 'frame' : 'off')
  } catch {
    /* storage blocked: the fragment below still decides this load */
  }
  // Only a ww= already in the fragment is rewritten (it would override storage on reload); the rest of the
  // fragment, such as the #t= token the window opens with, is kept as it is.
  const h = location.hash
  if (/[#&]ww=/.test(h)) location.hash = h.replace(/([#&])ww=[^&]*/, `$1ww=${on ? 'frame' : 'off'}`)
  location.reload()
}

/** Tests only: forget the cached read so the next call looks again. */
export function resetFrameFlagForTests(): void {
  cached = null
}
