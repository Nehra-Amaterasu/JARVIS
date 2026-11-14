// HandoffKey (spec 21.5, package DB01): a 44 px mono key that opens a target and carries context with it. It never
// executes anything: `onOpen` receives the target and the context and the caller navigates. When the state is not LIVE
// the key is dashed and inert and the reason sits beside it, so a key never promises a page that is not there.
import { Lamp, lampText, type LampState } from '../../kit'
import { handoffLabel, type HandoffTarget } from './layout'
import './handoff.css'

export interface HandoffKeyProps extends HandoffTarget {
  label: string
  /** LIVE (default) opens; any other state draws the inert dashed key with the reason. */
  state?: LampState
  reason?: string
  onOpen: (t: HandoffTarget) => void
  className?: string
}

export function HandoffKey({ label, target, context, state = 'live', reason, onOpen, className }: HandoffKeyProps) {
  const open = state === 'live'
  const spoken = open ? handoffLabel(label, context) : `${label}: unavailable, ${lampText(state, reason ?? 'not ready')}`
  return (
    <span className={`dg-hk${className ? ` ${className}` : ''}`} data-component="handoff-key" data-state={state} data-form={open ? 'key' : 'hollow'}>
      <button
        type="button"
        className="dg-hk-key"
        aria-label={spoken}
        aria-disabled={open ? undefined : true}
        onClick={() => { if (open) onOpen({ target, context }) }}
      >
        <span className="dg-hk-label">{label}</span>
        <svg className="dg-hk-arrow" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2 6h8M6.5 2.5 10 6 6.5 9.5" /></svg>
      </button>
      {!open && <span className="dg-hk-why"><Lamp state={state} reason={reason} bare />{lampText(state, reason ?? 'not ready')}</span>}
    </span>
  )
}
