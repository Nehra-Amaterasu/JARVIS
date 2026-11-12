/**
 * The switch for Shell v2 (A.B05, docs/design/jarvis-product-overhaul.md 3.1 to 3.4). Default OFF:
 * with it off the app renders today's title bar, dock, ticker and pages unchanged, byte for byte.
 *
 * ON when either holds, read ONCE per page load and kept (a flag flipped mid-session must not swap
 * the whole frame under a half-typed form; same rule as ww/frame/flag.ts):
 *   - localStorage key `app.shell` is `v2` (also `on`, `1`, `true`), or
 *   - the URL fragment carries `shell=v2`, as in `/#t=<token>&shell=v2`. The fragment is written to
 *     localStorage so the choice survives a reopen; `shell=off` turns it back.
 * Playwright sets it with the fragment (e2e/shell-v2.spec.ts), the same path a person would use.
 *
 * The fragment is captured when this module is EVALUATED, not when the flag is first asked: lib/api.ts reads the
 * `t=` token at its own evaluation and then wipes the whole fragment (history.replaceState), so a later read finds
 * nothing. App.tsx imports this module first for that reason (measured 13 Nov: with the import after the
 * palette's, `shell=v2` was gone before App rendered and all ten flag-on specs saw the old frame).
 */
export const SHELL_FLAG_KEY = 'app.shell'
const ON = new Set(['v2', 'on', '1', 'true'])
let cached: boolean | null = null
let hashAtLoad = typeof location !== 'undefined' ? location.hash : ''

export function shellV2Enabled(): boolean {
  if (cached !== null) return cached
  let on = false
  try {
    const m = hashAtLoad.match(/[#&]shell=([^&]*)/)
    if (m) {
      on = ON.has(decodeURIComponent(m[1]).toLowerCase())
      try {
        localStorage.setItem(SHELL_FLAG_KEY, on ? 'v2' : 'off')
      } catch {
        /* storage blocked: the fragment still decides this load */
      }
    } else {
      on = ON.has((localStorage.getItem(SHELL_FLAG_KEY) ?? '').toLowerCase())
    }
  } catch {
    on = false
  }
  cached = on
  return on
}

/** Tests only: forget the cached read. */
export function resetShellFlagForTests(): void {
  cached = null
  hashAtLoad = typeof location !== 'undefined' ? location.hash : ''
}
