/**
 * The theme switch, through the `tint` motion (plan 5.7.3 #12): a root view transition of 200 ms
 * opacity, or an instant swap where there is none. Setup > Appearance (chunk 12) puts a control on it;
 * this chunk owns the mechanism and the persisted choice so the frame already paints the chosen theme.
 * Ash is the default and carries no attribute; Paper and Indigo are `html[data-theme]`.
 */
import { runTint } from '../design/motion/transition'

export type ThemeId = 'ash' | 'paper' | 'indigo'
export const THEMES: ThemeId[] = ['ash', 'paper', 'indigo']
const KEY = 'ww.theme'

export function readTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'paper' || v === 'indigo' ? v : 'ash'
  } catch {
    return 'ash'
  }
}

export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement
  if (theme === 'ash') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function setTheme(theme: ThemeId): Promise<void> {
  return runTint(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* blocked: the theme still changes for this page */
    }
  })
}
