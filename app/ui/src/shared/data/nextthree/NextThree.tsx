// NextThree (spec 21.5, package DB01): up to three actions, each with a reason line and its own lamp. It shows fewer and
// never pads. The ranking is done elsewhere (arithmetic first); this form only draws it. The scores print in mono when a
// row has focus, and are always in the row's spoken description. A row with `onOpen` is a button that opens its target.
import { Lamp, lampText, showsValue, type LampState } from '../../kit'
import { scoreText, visibleRows, type NextItem } from './layout'
import './nextthree.css'

export interface NextThreeProps {
  items: readonly NextItem[]
  /** The state of the whole list: only LIVE and SIMULATED draw rows. */
  state: LampState
  reason?: string
  /** Opens a row's target; nothing is executed here. */
  onOpen?: (id: string) => void
  className?: string
}

export function NextThree({ items, state, reason, onOpen, className }: NextThreeProps) {
  const rows = showsValue(state) ? visibleRows(items) : []
  const hollow = rows.length === 0
  const why = lampText(state, reason ?? (showsValue(state) ? 'nothing to suggest yet' : state === 'waiting' ? 'needs papers on file' : undefined))
  return (
    <section className={`dg-n3${className ? ` ${className}` : ''}`} data-component="next-three" data-grammar="ascii" data-state={state} data-form={hollow ? 'hollow' : 'rows'} aria-label="Next three">
      {hollow ? (
        <p className="dg-n3-hollow"><Lamp state={state} reason={reason} bare /><span>{why}</span></p>
      ) : (
        <ol className="dg-n3-list">
          {rows.map((it, i) => {
            const scores = showsValue(it.state) ? scoreText(it.scores) : ''
            const inner = (
              <>
                <span className="dg-n3-n" aria-hidden="true">{i + 1}</span>
                <span className="dg-n3-body">
                  <span className="dg-n3-title">{it.title}</span>
                  <span className="dg-n3-reason">{it.reason}</span>
                  {scores && <span className="dg-n3-scores" aria-hidden="true">{scores}</span>}
                </span>
                <span className="dg-n3-lamp"><Lamp state={it.state} /></span>
              </>
            )
            const spoken = `${i + 1}. ${it.title}. ${it.reason}.${scores ? ` Scores: ${scores}.` : ''} ${lampText(it.state)}`
            return (
              <li key={it.id} className="dg-n3-row" data-state={it.state}>
                {onOpen ? (
                  <button type="button" className="dg-n3-btn" aria-label={spoken} onClick={() => onOpen(it.id)}>{inner}</button>
                ) : (
                  <div className="dg-n3-btn" role="group" tabIndex={0} aria-label={spoken}>{inner}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {state === 'simulated' && !hollow && <span className="dg-stamp">SIMULATED</span>}
    </section>
  )
}
