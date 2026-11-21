// Senses, Teach (spec 20.9.3): the four steps as sigil rings, what is left to do and the key for it, the teach desk and the
// learned model. The guided room measurement and First light are the classic sheets (components/MeasureRoom,
// components/FirstLight), imported and hosted in a Senses drawer: their forms and calls are unchanged.
//
//   left 520                                  right 750
//   rings 4 across  room, quiet, drill, held  teach desk   mini drill, phone recording, train
//   what is left    a sentence per step, the  spatial model the learned rows, advisory
//                   command behind a copy key
// Each column's last card stretches to the bottom of the view, so both columns end on the same line.
//
// The copy says "predicting" until all four rings are lit; the arc in Presence draws digits only after the last one.
import { useCallback, useState } from 'react'
import { Lamp, type LampReading } from '../../shared/lamp'
import { readinessLine } from '../../lib/roomMeasure'
import { FirstLightSheet } from '../../components/FirstLight'
import { MeasureSheet } from '../../components/MeasureRoom'
import { CoreDrawer } from '../core/CoreDrawer'
import { Zones, lookV3Enabled } from '../../shell/v3'
import { KeyBtn, Panel, effectiveSource, useNarrow, type SensesViewProps } from './parts'
import { LearnedPanel, TeachDesk } from './TeachDesk'
import { TeachRingForm } from './TeachRings'
import { splitHow, teachRings } from './model'
import './senses.css'
import './senses-v3.css'

export function TeachView({ state, store, toast, fixture }: SensesViewProps) {
  const narrow = useNarrow()
  const [sheet, setSheet] = useState<'measure' | 'light' | null>(null)
  const known = !!state.readiness
  const rings = teachRings(state.readiness)
  const lit = rings.filter((r) => r.done).length
  const source = effectiveSource(state)
  // WAITING until all four rings are lit: three of four is still a prediction, so it never reads LIVE
  const reading: LampReading = known && lit === 4
    ? { state: fixture ? 'simulated' : 'live', since: null, reason: 'all 4 steps done, read from the server' }
    : { state: 'waiting', since: null, reason: known ? `${lit} of 4 steps done` : 'readiness not read yet' }
  const todo = (state.readiness?.items ?? []).filter((i) => !i.ok)
  const close = () => setSheet(null)
  const live = source === 'live'
  const copy = useCallback(async (cmd: string) => {
    try { await navigator.clipboard.writeText(cmd); toast?.('Command copied', 'info') } catch { toast?.(`The browser did not allow copying. The command is: ${cmd}`, 'fault') }
  }, [toast])
  const ringsEl = (
        <Panel tag="SEN" title="Four steps" reading={reading} className="js-p-rings" aside={<span className="js-count" data-testid="steps-count">{known ? `${lit} of 4` : '-- of 4'}</span>}>
          <div className="js-rings">
            {rings.map((r) => <TeachRingForm key={r.id} ring={r} known={known} simulated={!!fixture} />)}
          </div>
          <p className="js-note js-rings-note">{known ? `${readinessLine(state.readiness).replace(/\.$/, '')}.${lit === 4 ? '' : ' Until the last ring is lit it says predicting.'}` : 'Waiting for the readiness check.'}</p>
        </Panel>
  )
  const leftEl = (
        <Panel tag="SEN" title="What is left" reading={{ state: known ? (todo.length ? 'waiting' : fixture ? 'simulated' : 'live') : 'waiting', since: null, reason: known ? (todo.length ? `${todo.length} to do` : 'nothing left') : 'not read yet' }} className="js-p-next">
          {todo.length === 0 && known && <p className="js-note">Nothing left: every step is done.</p>}
          {!known && <p className="js-note">The list appears when the readiness check answers.</p>}
          <ul className="js-rows js-todo">
            {todo.map((i) => {
              const h = splitHow(i.how)
              return (
                <li key={i.id}>
                  <Lamp reading={{ state: 'waiting', since: null, reason: h.sentence }} showLabel={false} subject={i.label} />
                  <span className="js-todo-text"><span className="js-row-name">{i.label}</span><small>{h.sentence}</small></span>
                  {h.command && <button type="button" className="js-chip js-copy" onClick={() => void copy(h.command as string)} aria-label={`Copy command, ${i.label}`} title={h.command}>Copy command</button>}
                </li>
              )
            })}
          </ul>
          <div className="js-action-row js-keys">
            <KeyBtn onClick={() => setSheet('measure')} disabledReason={fixture ? 'Not drawn in a specimen' : undefined}>Measure my room</KeyBtn>
            <KeyBtn onClick={() => setSheet('light')} disabledReason={fixture ? 'Not drawn in a specimen' : undefined}>First light</KeyBtn>
          </div>
        </Panel>
  )
  const deskEl = <TeachDesk state={state} store={store} toast={toast} fixture={fixture} />
  const learnedEl = <LearnedPanel state={state} fixture={fixture} />
  const drawersEl = (
    <>
      <CoreDrawer open={sheet === 'measure'} onClose={close} title="Measure my room" tag="SEN">
        <div className="js-classic"><MeasureSheet onClose={close} onSaved={() => { void store.loadReadiness(); toast?.('Room saved as measured', 'live') }} /></div>
      </CoreDrawer>
      <CoreDrawer open={sheet === 'light'} onClose={close} title="First light" tag="SEN">
        <div className="js-classic">
          <FirstLightSheet frame={state.latest} live={live} onClose={close} toast={(m, t) => toast?.(m, t)} />
        </div>
      </CoreDrawer>
    </>
  )

  if (lookV3Enabled()) {
    // Under the v3 look: teach the room (the desk), the four steps as they stand and what is left to do, then the checks the
    // model has passed (the learned rows). It still says predicting until all four rings are lit.
    const plane = reading.state === 'live' ? 'live' : reading.state === 'simulated' ? 'simulated' : 'waiting'
    return (
      <div className="js js-teach js-v3" data-narrow={narrow ? 'true' : undefined} data-source={source}>
        <Zones ratio={[1.75, 1.05, 1.05]}
          first={{ job: 'TEACH', children: <div className="js3-col js3-scroll">{deskEl}</div> }}
          second={{ job: 'PROGRESS', peek: { name: 'Four steps', lamp: plane, note: reading.reason }, children: <div className="js3-col js3-scroll">{ringsEl}{leftEl}</div> }}
          third={{ job: 'CHECKS', peek: { name: 'What the model learned', lamp: plane, note: known ? 'predicting until all four steps are done' : 'readiness not read yet' }, children: <div className="js3-col js3-scroll">{learnedEl}</div> }} />
        {drawersEl}
      </div>
    )
  }

  return (
    <div className="js js-teach" data-narrow={narrow ? 'true' : undefined} data-source={source}>
      <section className="js-left js-left-teach" aria-label="Steps">
        {ringsEl}
        {leftEl}
      </section>

      <section className="js-right js-right-teach" aria-label="Teach">
        {deskEl}
        {learnedEl}
      </section>

      {drawersEl}
    </div>
  )
}
