// The three registered Senses views (shell/views/senses-*.view.ts), each the same surface the gallery draws, wired to the
// shared store (one /ws/aankhen connection for all three), the toast and the shell's navigation. Loaded lazily by the
// view registrations behind the product test, so a Well Wisher only build holds none of it.
import type { ReactElement } from 'react'
import { useCallback } from 'react'
import { useStore } from '../../lib/store'
import { useShell } from '../../shell/store'
import { PresenceView } from './PresenceView'
import { SignalView } from './SignalView'
import { TeachView } from './TeachView'
import { SensesFrame } from './parts'
import { SENSES_SENTENCE } from './model'
import { useSenses } from './store'

function useLive() {
  const { store, state } = useSenses()
  const toast = useStore((s) => s.toast)
  const onGo = useCallback((view: 'presence' | 'signal' | 'teach') => useShell.getState().go({ product: 'jarvis', section: 'senses', view }), [])
  return { store, state, toast, onGo }
}

const framed = (v: ReactElement) => <SensesFrame text={SENSES_SENTENCE}>{v}</SensesFrame>

export function SensesPresence() { return framed(<PresenceView {...useLive()} />) }
export function SensesSignal() { return framed(<SignalView {...useLive()} />) }
export function SensesTeach() { return framed(<TeachView {...useLive()} />) }
