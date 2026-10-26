/** Per-viewer tree preferences (the chosen tree, zoom sensitivity). Storage can throw (private mode): never fatal. */
export const PREF_TREE = 'ww.tree.active'
export const PREF_SENS = 'ww.tree.zoomSensitivity'

export function readPref(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
export function writePref(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* not persisted; the choice still holds for this session */ }
}
/** Zoom sensitivity, 0.5x..2x; 1 when unset or garbage. */
export function readSensitivity(): number {
  const v = Number(readPref(PREF_SENS))
  return Number.isFinite(v) && v >= 0.5 && v <= 2 ? v : 1
}
