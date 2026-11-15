// Moving between the four Focus views and out to Study and Day: the shell's own go(), in one place.
import { useShell } from '../../shell/store'

export type FocusView = 'start' | 'session' | 'rest' | 'drill'
export const goFocus = (view: FocusView) => useShell.getState().go({ product: 'ww', section: 'focus', view })
export const goPapers = () => useShell.getState().go({ product: 'ww', section: 'study', view: 'papers' })
export const goToday = () => useShell.getState().go({ product: 'ww', section: 'day', view: 'today' })
