// State and rows of design language v3 (spec 4.1 rules 8 to 15, spec 6): the Chip (a lamp shape and its word) and the Ledger
// (rows of label, value, lamp and reason that wrap and never clip). The lamp shapes and words are the shared ones
// (shared/kit/Lamp over shared/lamp/types): nothing here redraws a lamp.
import type { ReactNode } from 'react'
import { LAMP_WORD, LampGlyph, showsValue, type LampState } from '../Lamp'
import { cx } from '../util'
import '../glass.css'

export interface ChipProps {
  /** A lamp state: draws its shape (14 px) and its word. */
  state?: LampState
  /** Why: kept as text for assistive technology; the row prints the reason as its second line. */
  reason?: string
  /** A plain tag (VOICE STAGE, MIC · NO LEVEL). Without a state this is the whole chip. */
  children?: ReactNode
  className?: string
}

/** 11 px mono capitals, never cut, in its own column at the right of its row. The word of a fault stays in ink. */
export function Chip({ state, reason, children, className }: ChipProps) {
  return (
    <span className={cx('v3-chip', className)} data-state={state} data-kind={state ? 'state' : 'tag'}>
      {state && <LampGlyph state={state} size={14} />}
      <span className="v3-chip-word">{children ?? (state ? LAMP_WORD[state] : null)}</span>
      {state && reason && <span className="v3-sr">{`: ${reason}`}</span>}
    </span>
  )
}

export interface LedgerRow {
  id: string
  label: ReactNode
  /** The second line, real text: why it is in this state. WAITING rows always have one. */
  reason?: string
  /** Shown only under LIVE or SIMULATED; every other state prints a dash (a reading is never invented). */
  value?: string | number | null
  state: LampState
  /** The remedy of a fault, in its own row (a Key): a fault and its remedy are one row. */
  action?: ReactNode
}

export interface LedgerProps {
  rows: readonly LedgerRow[]
  label: string
  /** Makes each row a key that selects it. */
  selectedId?: string | null
  onSelect?: (id: string) => void
  className?: string
}

export const NO_VALUE_DASH = '–'

/** Rows of label, value, lamp and reason. Text wraps and the row grows: an ellipsis is never allowed on a state or a reason. */
export function Ledger({ rows, label, selectedId, onSelect, className }: LedgerProps) {
  const selectable = !!onSelect
  return (
    <ul className={cx('v3-ledger', className)} aria-label={label}>
      {rows.map((r) => {
        const shown = showsValue(r.state) && r.value !== undefined && r.value !== null && r.value !== ''
        const main = (
          <>
            <span className="v3-ledger-label">{r.label}</span>
            {r.reason && <span className="v3-ledger-reason">{r.reason}</span>}
          </>
        )
        return (
          <li
            key={r.id}
            className="v3-ledger-row"
            data-state={r.state}
            data-selectable={selectable ? 'true' : undefined}
            data-selected={selectable && selectedId === r.id ? 'true' : undefined}
          >
            {selectable ? (
              <button type="button" className="v3-ledger-main" data-button="true" aria-pressed={selectedId === r.id} onClick={() => onSelect?.(r.id)}>
                {main}
              </button>
            ) : (
              <span className="v3-ledger-main">{main}</span>
            )}
            <span className="v3-ledger-value">
              {shown ? (
                r.value
              ) : (
                <>
                  <span aria-hidden="true">{NO_VALUE_DASH}</span>
                  <span className="v3-sr">no value</span>
                </>
              )}
            </span>
            <Chip state={r.state} />
            {r.action && <span className="v3-ledger-act">{r.action}</span>}
          </li>
        )
      })}
    </ul>
  )
}
