/**
 * Appearance settings that live on this machine (plan 4.9 SU17). Theme has its own mechanism in
 * frame/theme.ts (the `tint` motion). Motion and tab badges are a localStorage choice each:
 *   motion  'auto' removes data-motion (the OS and the governor decide), 'full' and 'calm' set it; the CSS
 *           already reads html[data-motion] (design/motion.css), so this only writes the attribute.
 *   badges  the frame's WorkspaceTabs reads the key at render (frame/WorkspaceTabs.tsx tabBadgesOn), so a
 *           change shows on the next render of the tab row (the next workspace switch), not at once.
 * Every storage access is in try/catch: private windows and blocked storage throw.
 */
export type MotionChoice = 'auto' | 'full' | 'calm'
const MOTION_KEY = 'ww.motion'
const BADGE_KEY = 'ww.tabBadges'

export function readMotion(): MotionChoice {
  try {
    const v = localStorage.getItem(MOTION_KEY)
    return v === 'full' || v === 'calm' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function applyMotion(m: MotionChoice): void {
  const root = document.documentElement
  if (m === 'auto') root.removeAttribute('data-motion')
  else root.setAttribute('data-motion', m)
}

export function setMotion(m: MotionChoice): void {
  applyMotion(m)
  try {
    localStorage.setItem(MOTION_KEY, m)
  } catch {
    /* blocked: the choice holds for this page only */
  }
}

export function tabBadgesOn(): boolean {
  try {
    return localStorage.getItem(BADGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setTabBadges(on: boolean): void {
  try {
    localStorage.setItem(BADGE_KEY, on ? 'on' : 'off')
  } catch {
    /* blocked */
  }
}
