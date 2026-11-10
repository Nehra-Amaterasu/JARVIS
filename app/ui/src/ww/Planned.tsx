// The adapter between the registry and the kit (plan 7). A page writes <Planned id="sharpen"/> and gets the
// right pattern; it never copies the line, so the page, the Roadmap and the tests cannot disagree.
import type { ReactNode } from 'react'
import { Button, ComingCard, EmptyState } from './kit'
import { fillLine, plannedById } from './plannedFeatures'
import './planned.css'

export interface PlannedProps {
  id: string
  /** Live values for the `N` tokens in the line, in order. Without them N stays: a placeholder invents no count. */
  fill?: readonly (string | number)[]
  /** Pattern E only: the real first action. Passed by the page because only the page knows what it does. */
  action?: ReactNode
  /** Pattern R only: show the one-line hint inline (where it changes today's decision). Otherwise R renders nothing here. */
  hint?: boolean
  /** Position among siblings, for the one `arrive` a ComingCard is allowed. */
  index?: number
}

/**
 * E: an empty state whose action is real. D: a control that exists, focusable, with its reason printed beside it.
 * C: the kit's ComingCard fed from the entry. R: nothing in the layout (the Roadmap drawer lists it), or one
 * muted line when `hint` is set.
 * An unknown id renders nothing and does not throw: a deleted entry (feature shipped) must not crash a page
 * that still has the tag; plannedFeatures.test.tsx catches the leftover tag instead.
 */
export function Planned({ id, fill, action, hint, index }: PlannedProps) {
  const e = plannedById(id)
  if (!e) return null
  const line = fillLine(e.line, fill)
  switch (e.pattern) {
    case 'empty':
      return (
        <div className="ww-planned" data-planned={e.id} data-pattern="empty">
          <EmptyState title={line} action={action} />
        </div>
      )
    case 'disabled':
      return (
        <div className="ww-planned" data-planned={e.id} data-pattern="disabled">
          <Button size="sm" disabledReason={line}>{e.label}</Button>
        </div>
      )
    case 'coming':
      return (
        <div data-planned={e.id} data-pattern="coming">
          <ComingCard featureId={e.id} label={e.label} line={line} when={e.when} index={index} />
        </div>
      )
    case 'roadmap':
      return hint ? (
        <p className="ww-planned-hint" data-planned={e.id} data-pattern="roadmap">{line}</p>
      ) : null
  }
}
