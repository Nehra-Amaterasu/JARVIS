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
 * Default is OFF. With it off MissionRoot renders exactly what it rendered before this chunk, and the
 * frame's code and CSS are never even downloaded (MissionRoot imports the frame lazily).
 */
export const FLAG_KEY = 'ww.workspace'
const ON = new Set(['frame', 'on', '1', 'true'])
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
      on = ON.has((localStorage.getItem(FLAG_KEY) ?? '').toLowerCase())
    }
  } catch {
    on = false
  }
  cached = on
  return on
}

/** Tests only: forget the cached read so the next call looks again. */
export function resetFrameFlagForTests(): void {
  cached = null
}
