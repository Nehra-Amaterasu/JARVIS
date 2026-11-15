// The Senses gallery states (A.J03): the three views on stamped fixtures, loaded lazily by gallery/entries/J03.tsx behind
// the product test. The box is the real canvas under the shell's view row (1302 x 668), drawn at 0.72 on a desk screen and
// at the width of the page on a phone. Every reading is from the simulation source, so every lamp says SIMULATED.
import { useMemo, useSyncExternalStore } from 'react'
import { fixtureState, fixtureStore, type FixtureKind } from './fixtures'
import { PresenceView } from './PresenceView'
import { SignalView } from './SignalView'
import { TeachView } from './TeachView'
import './senses.css'

export type J03StateId = 'presence' | 'presence-none' | 'presence-trusted' | 'presence-offline' | 'signal' | 'signal-none' | 'teach' | 'teach-unread'

const SPEC: Record<J03StateId, { view: 'presence' | 'signal' | 'teach'; kind: FixtureKind }> = {
  presence: { view: 'presence', kind: 'simulated' },
  'presence-none': { view: 'presence', kind: 'none' },
  'presence-trusted': { view: 'presence', kind: 'trusted' },
  'presence-offline': { view: 'presence', kind: 'offline' },
  signal: { view: 'signal', kind: 'simulated' },
  'signal-none': { view: 'signal', kind: 'none' },
  teach: { view: 'teach', kind: 'simulated' },
  'teach-unread': { view: 'teach', kind: 'unread' },
}

export function J03State({ state: id }: { state: J03StateId }) {
  const spec = SPEC[id]
  // one store per specimen, seeded once: a press of Pause or the tape key changes the store like it does in the app
  const store = useMemo(() => { const st = fixtureStore(); st.seed(fixtureState(spec.kind)); return st }, [spec.kind])
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const props = { state, store, fixture: true }
  return (
    <div className="js-gallery-box" data-j03={id}>
      {spec.view === 'presence' && <PresenceView {...props} />}
      {spec.view === 'signal' && <SignalView {...props} />}
      {spec.view === 'teach' && <TeachView {...props} />}
    </div>
  )
}
