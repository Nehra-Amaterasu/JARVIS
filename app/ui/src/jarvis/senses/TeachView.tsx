// Senses, Teach (spec 20.9.3): the four steps as sigil rings, what is left to do and the key for it, the teach desk and the
// learned model. The guided room measurement and First light are the classic sheets (components/MeasureRoom,
// components/FirstLight), imported and hosted in a Senses drawer: their forms and calls are unchanged.
//
//   left 520                                  right 750
//   rings 2 x 2   room, quiet, drill, held    teach desk   mini drill, phone recording, train
//   next steps    what is missing, the keys   spatial model the learned rows, advisory
//
// The copy says "predicting" until all four rings are lit; the arc in Presence draws digits only after the last one.
import { useState } from 'react'
import { Lamp, type LampReading } from '../../shared/lamp'
import { readinessLine } from '../../lib/roomMeasure'
import { FirstLightSheet } from '../../components/FirstLight'
import { MeasureSheet } from '../../components/MeasureRoom'
import { CoreDrawer } from '../core/CoreDrawer'
import { KeyBtn, Panel, SensesSentence, effectiveSource, useNarrow, type SensesViewProps } from './parts'
import { LearnedPanel, TeachDesk } from './TeachDesk'
import { TeachRingForm } from './TeachRings'
import { SENSES_SENTENCE, teachRings } from './model'
import './senses.css'

export function TeachView({ state, store, toast, fixture }: SensesViewProps) {
  const narrow = useNarrow()
  const [sheet, setSheet] = useState<'measure' | 'light' | null>(null)
  const known = !!state.readiness
  const rings = teachRings(state.readiness)
  const lit = rings.filter((r) => r.done).length
  const source = effectiveSource(state)
  const reading: LampReading = known
    ? { state: fixture ? 'simulated' : 'live', since: null, reason: `${lit} of 4 steps done, read from the server` }
    : { state: 'waiting', since: null, reason: 'readiness not read yet' }
  const todo = (state.readiness?.items ?? []).filter((i) => !i.ok)
  const close = () => setSheet(null)
  const live = source === 'live'
  return (
    <div className="js js-teach" data-narrow={narrow ? 'true' : undefined} data-source={source}>
      <section className="js-left js-left-teach" aria-label="Steps">
        <Panel tag="SEN" title="Four steps" reading={reading} className="js-p-rings">
          <div className="js-rings">
            {rings.map((r) => <TeachRingForm key={r.id} ring={r} known={known} simulated={!!fixture} />)}
          </div>
          <p className="js-readline">{known ? `${readinessLine(state.readiness).replace(/\.$/, '')}.${lit === 4 ? '' : ' Until the last ring is lit it says predicting.'}` : 'Waiting for the readiness check.'}</p>
        </Panel>
        <Panel tag="SEN" title="What is left" reading={{ state: known ? (todo.length ? 'waiting' : fixture ? 'simulated' : 'live') : 'waiting', since: null, reason: known ? (todo.length ? `${todo.length} to do` : 'nothing left') : 'not read yet' }} className="js-p-next">
          {todo.length === 0 && known && <p className="js-note">Nothing left: every step is done.</p>}
          {!known && <p className="js-note">The list appears when the readiness check answers.</p>}
          <ul className="js-rows js-todo">
            {todo.map((i) => (
              <li key={i.id}><Lamp reading={{ state: 'waiting', since: null, reason: i.how }} showLabel={false} subject={i.label} /><span className="js-row-name">{i.label}</span><small className="js-mono-dim">{i.how}</small></li>
            ))}
          </ul>
          <div className="js-action-row js-keys">
            <KeyBtn onClick={() => setSheet('measure')} disabledReason={fixture ? 'Not drawn in a specimen' : undefined}>Measure my room</KeyBtn>
            <KeyBtn onClick={() => setSheet('light')} disabledReason={fixture ? 'Not drawn in a specimen' : undefined}>First light</KeyBtn>
          </div>
        </Panel>
        <SensesSentence text={SENSES_SENTENCE} />
      </section>

      <section className="js-right js-right-teach" aria-label="Teach">
        <TeachDesk state={state} store={store} toast={toast} fixture={fixture} />
        <LearnedPanel state={state} fixture={fixture} />
      </section>

      <CoreDrawer open={sheet === 'measure'} onClose={close} title="Measure my room" tag="SEN">
        <div className="js-classic"><MeasureSheet onClose={close} onSaved={() => { void store.loadReadiness(); toast?.('Room saved as measured', 'live') }} /></div>
      </CoreDrawer>
      <CoreDrawer open={sheet === 'light'} onClose={close} title="First light" tag="SEN">
        <div className="js-classic">
          <FirstLightSheet frame={state.latest} live={live} onClose={close} toast={(m, t) => toast?.(m, t)} />
        </div>
      </CoreDrawer>
    </div>
  )
}
