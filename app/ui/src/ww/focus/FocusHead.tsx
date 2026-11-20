/**
 * The one header block of the four Focus views (EL-FOCUS): the eyebrow ("Focus"), the title on the shared title token, and an optional
 * line under it. Start, Session, Rest and the Drill all draw this same block, so the four screens share one top edge and one type scale:
 * eyebrow (label token), title (title token), body (body token) and the hero numeral (display-compact token) for readings.
 */
import type { ReactNode } from 'react'

export function FocusHead({ title, testId, children }: { title: string; testId?: string; children?: ReactNode }) {
  return (
    <header className="fv-head">
      <p className="fv-kick">Focus</p>
      <h2 className="fv-title" data-testid={testId}>{title}</h2>
      {children}
    </header>
  )
}

/** A lamp and the reason beside it, printed in words that wrap (a state's reason is never cut with an ellipsis). */
export function WhyLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={className ? `fv-why ${className}` : 'fv-why'}>{children}</p>
}
