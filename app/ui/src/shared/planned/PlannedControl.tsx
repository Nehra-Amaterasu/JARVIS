// One entry rendered by its pattern (spec 12.4), from the one record, so the page never copies a line.
//   E  an empty state whose action is real (the page supplies it)
//   D  a focusable control, aria-disabled (never the `disabled` attribute), the reason printed beside it
//   C  the dashed plate
//   R  nothing in the layout (the chip and the overlay list it), or one muted line when `hint` is set
// An unknown id renders nothing and does not throw: a deleted entry (the feature shipped) must not crash a page
// that still has the tag. T3 catches a leftover renderer instead.
import { useId, type ReactNode } from 'react'
import { fillLine } from './registry'
import { openPlanned } from './open'
import type { Registry } from './types'
import { PlannedPlate } from './PlannedPlate'
import './planned.css'

export interface PlannedControlProps {
  registry: Registry
  id: string
  fill?: readonly (string | number)[]
  /** Pattern E only: the real first action. Only the page knows what it does. */
  action?: ReactNode
  /** Pattern R only: show the one muted line inline. */
  hint?: boolean
  onOpen?: (id: string) => void
}

export function PlannedControl({ registry, id, fill, action, hint, onOpen }: PlannedControlProps) {
  const reasonId = useId()
  const e = registry.byId(id)
  if (!e) return null
  const line = fillLine(e.line, fill)
  const open = () => (onOpen ?? openPlanned)(e.id)
  switch (e.pattern) {
    case 'empty':
      return (
        <div className="pl-empty" data-planned={e.id} data-pattern="empty">
          <p className="pl-line">{line}</p>
          {action}
        </div>
      )
    case 'disabled':
      return (
        <div className="pl-disabled" data-planned={e.id} data-pattern="disabled">
          <button type="button" className="pl-btn" aria-disabled="true" aria-describedby={reasonId} aria-haspopup="dialog" data-planned-open="" onClick={open}>
            {e.label}
          </button>
          <span id={reasonId} className="pl-line">{line}</span>
        </div>
      )
    case 'coming':
      return <PlannedPlate entry={e} fill={fill} onOpen={onOpen} />
    case 'roadmap':
      return hint ? (
        <p className="pl-hint" data-planned={e.id} data-pattern="roadmap">{line}</p>
      ) : null
  }
}
