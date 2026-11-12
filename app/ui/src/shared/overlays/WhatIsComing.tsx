// The overlay "What is coming" (id `roadmap`, spec 12.2 and 12.4). It merges only the registries the build
// passes in, so a single-product build lists only its own entries (T6). One deep: it holds no control that opens
// another overlay, only Close. Esc or Alt+Left close it and focus returns to whatever opened it. Tab and
// Shift+Tab wrap inside it (aria-modal alone does not stop a real browser tabbing out to the page behind).
import { useEffect, useMemo, useRef } from 'react'
import { VIEW_IDS } from '../planned/homes'
import { BLOCKER_ORDER, BLOCKER_WORDS, fillLine, listable, sectionOf } from '../planned/registry'
import type { Registry } from '../planned/types'
import '../planned/planned.css'

export interface WhatIsComingProps {
  /** Only the registries present in this build. */
  registries: readonly Registry[]
  /** Scroll to this entry and mark it, when the overlay was opened from a plate, a chip or the palette. */
  focusId?: string
  onClose: () => void
}

const SECTION_WORDS: Record<string, string> = {
  core: 'Core', room: 'Room', senses: 'Senses', memory: 'Memory', console: 'Console',
  day: 'Day', focus: 'Focus', study: 'Study', tree: 'Tree', career: 'Career', proof: 'Proof',
  settings: 'Settings', phone: 'Phone',
}
/** Rail order of spec 3.2, then Settings and the phone last. */
const SECTION_ORDER = [...new Set(VIEW_IDS.map((v) => v.split('.')[0])), 'settings', 'phone']

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function WhatIsComing({ registries, focusId, onClose }: WhatIsComingProps) {
  const entries = useMemo(() => listable(registries), [registries])
  const groups = useMemo(() => {
    const present = SECTION_ORDER.filter((s) => entries.some((e) => sectionOf(e) === s))
    // A section outside the frozen table would be dropped silently otherwise.
    const extra = [...new Set(entries.map(sectionOf))].filter((s) => !SECTION_ORDER.includes(s))
    return [...present, ...extra].map((s) => ({
      section: s,
      rows: entries
        .filter((e) => sectionOf(e) === s)
        .sort((a, b) => BLOCKER_ORDER.indexOf(a.blocker) - BLOCKER_ORDER.indexOf(b.blocker)),
    }))
  }, [entries])

  const opener = useRef<Element | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    opener.current = document.activeElement
    const row = focusId ? document.querySelector<HTMLElement>(`[data-coming-row="${CSS.escape(focusId)}"]`) : null
    // jsdom has no scrollIntoView; a real browser does.
    row?.scrollIntoView?.({ block: 'center' })
    closeRef.current?.focus()
    return () => {
      const back = opener.current as HTMLElement | null
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus()
    }
  }, [focusId])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' || (ev.altKey && ev.key === 'ArrowLeft')) {
        ev.preventDefault()
        onClose()
        return
      }
      if (ev.key !== 'Tab') return
      const root = rootRef.current
      if (!root) return
      // One query per Tab press, over a card that holds a handful of controls: O(controls), no listener per row.
      const stops = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getAttribute('aria-disabled') !== 'true')
      if (stops.length === 0) {
        ev.preventDefault()
        return
      }
      const first = stops[0]
      const last = stops[stops.length - 1]
      const at = document.activeElement
      const outside = !at || !root.contains(at)
      if (outside || (ev.shiftKey && at === first)) {
        ev.preventDefault()
        ;(ev.shiftKey ? last : first).focus()
      } else if (!ev.shiftKey && at === last) {
        ev.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div ref={rootRef} className="pl-overlay" data-overlay="roadmap" role="dialog" aria-modal="true" aria-labelledby="pl-overlay-title">
      <div className="pl-overlay-head">
        <h2 id="pl-overlay-title" className="pl-overlay-title">What is coming</h2>
        <button ref={closeRef} type="button" className="pl-close" onClick={onClose}>Close</button>
      </div>
      <p className="pl-meta">Each row says what is missing and what it needs. A row marked built, not verified has code that no check has confirmed yet.</p>
      {groups.map((g) => (
        <section key={g.section} className="pl-group" data-coming-group={g.section} aria-labelledby={`pl-g-${g.section}`}>
          <h3 id={`pl-g-${g.section}`} className="pl-group-title">{SECTION_WORDS[g.section] ?? g.section}</h3>
          <ul className="pl-rows">
            {g.rows.map((e) => (
              <li key={e.id} className="pl-row" data-coming-row={e.id} data-focus={e.id === focusId ? 'true' : undefined}>
                <p><strong>{e.label}</strong></p>
                <p className="pl-line">{fillLine(e.line)}</p>
                {e.works_today && <p className="pl-meta">Works today: {e.works_today}</p>}
                <p className="pl-meta">Needs: {e.needs}</p>
                <p className="pl-meta">{BLOCKER_WORDS[e.blocker]}{e.when ? `: ${e.when}` : ''}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
