// HandoffChip (spec 20.9.7, A.J01): a 28 px chip under a Core turn or a Memory item that wrote into Well Wisher, e.g.
// `[WW] Day 3 Dec 18:00`. With the notify port present it is a link to the target view; with the port null (a JARVIS
// build without Well Wisher) it is plain text that says the planner is not here, so it never offers a jump that cannot
// land. The chip is 28 px tall as drawn; the link's hit area is 44 px (a transparent ::before, handoff.css).
//
// The target is a view id of the shell's table (`ww/day.today`); anything else is refused and drawn as text.
import type { MouseEvent } from 'react'
import { sectionById } from '../../shell/ids'
import './handoff.css'

export interface HandoffChipProps {
  product: 'ww'
  /** `ww/<section>.<view>`, for example `ww/day.today`. */
  target: string
  /** What was written, e.g. "Day 3 Dec 18:00". At most 48 characters are shown. */
  label: string
  /** Optional: whether the `notify` port is installed (Well Wisher is in this build). Default true. */
  notifyPresent?: boolean
  /** Optional: open the target. Without it the link only carries the shell's route in its href. */
  onOpen?: (place: { product: 'ww'; section: string; view: string }) => void
}

/** `ww/day.today` -> the shell place, or null when the id is not a Well Wisher view of the table. */
export function handoffPlace(target: string): { product: 'ww'; section: string; view: string } | null {
  const m = /^ww\/([a-z]+)\.([a-z]+)$/.exec(target)
  if (!m) return null
  const s = sectionById(m[1])
  if (!s || s.product !== 'ww' || !s.views.includes(m[2])) return null
  return { product: 'ww', section: s.id, view: m[2] }
}

/** The shell's own route form for a place (shell/ids parseRoute reads `#/section/view`). */
export const handoffHref = (p: { section: string; view: string }) => `#/${p.section}/${p.view}`

export function HandoffChip({ product, target, label, notifyPresent = true, onOpen }: HandoffChipProps) {
  const place = product === 'ww' ? handoffPlace(target) : null
  const text = label.slice(0, 48)
  if (!place || !notifyPresent) {
    const why = !place ? 'not a Well Wisher view' : 'the day planner is not here'
    return (
      <span className="hc" data-component="handoff-chip" data-state="unavailable" title={`Well Wisher: ${text}. ${why}`}>
        <span className="hc-tag" aria-hidden="true">[WW]</span>
        <span className="hc-text">{text}</span>
        <span className="hc-why">{why}</span>
      </span>
    )
  }
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen) return
    e.preventDefault()
    onOpen(place)
  }
  return (
    <a className="hc" data-component="handoff-chip" data-state="live" href={handoffHref(place)} onClick={click} aria-label={`Open in Well Wisher: ${text}`}>
      <span className="hc-tag" aria-hidden="true">[WW]</span>
      <span className="hc-text">{text}</span>
      <svg className="hc-arrow" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M3 9 9 3M4.5 3H9v4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  )
}
