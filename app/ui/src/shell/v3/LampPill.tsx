/**
 * The one lamp pill (design-language-v3.md 3.3 item 3). The same on every view: a ring of one short arc per lamp, then the
 * worst state first and the rest after it ("1 FAULT · 6 WAITING"). It counts every lamp of the shared table across all
 * products, the same rows the spine reads (lamps.ts), so a fault is never hidden on another view and the pill and the spine
 * cannot disagree. It is a 44 px button that opens an opaque popover headed "STATE, WORST FIRST": each lamp with its shape,
 * its word and its reason, fault first, and a press on a row opens the lamp's section (jury round 3). On the phone the same
 * words wrap onto two lines before a word is dropped.
 */
import { useRef } from 'react'
import { LAMP_SPECS } from '../../shared/lamp/types'
import { PillRing, StateGlyph } from './Glyphs'
import { pillParts, pillText, type LampRow } from './lamps'
import { subProjectById } from './subprojects'
import { Popover, usePopoverChoose } from './Popover'

export interface LampPillProps {
  rows: readonly LampRow[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A press on a lamp row: open its section. */
  onGoSection: (section: string) => void
}

export function LampPill({ rows, open, onOpenChange, onGoSection }: LampPillProps) {
  const btn = useRef<HTMLButtonElement>(null)
  const parts = pillParts(rows)
  const worst = parts[0]
  const text = pillText(parts)
  return (
    <Popover open={open} onClose={() => onOpenChange(false)} triggerRef={btn} label="System state, worst first" className="s3-lampwrap"
      trigger={
        <button ref={btn} type="button" className="s3-key s3-pillbtn" aria-haspopup="dialog" aria-expanded={open}
          aria-label={`System state: ${text}`} data-worst={worst?.state} onClick={() => onOpenChange(!open)}>
          <PillRing states={rows.map((r) => r.reading.state)} />
          <span className="s3-pilltext">
            {parts.map((p, i) => (
              <span key={p.state} className="s3-pillpart" data-state={p.state}>
                {i === 0 && p.state === 'fault' && <span className="s3-pill-tri"><StateGlyph state="fault" /></span>}
                {p.count} {p.word}
                {i < parts.length - 1 && <span className="s3-pilldot" aria-hidden="true"> {'·'}</span>}
                {i < parts.length - 1 && ' '}
              </span>
            ))}
          </span>
        </button>
      }>
      <p className="s3-cap">STATE, WORST FIRST</p>
      <LampList rows={rows} onGoSection={onGoSection} />
    </Popover>
  )
}

function LampList({ rows, onGoSection }: { rows: readonly LampRow[]; onGoSection: (section: string) => void }) {
  const choose = usePopoverChoose()
  return (
    <ul className="s3-lamplist">
      {rows.map((r) => (
        <li key={r.def.id}>
          <button type="button" className="s3-lamprow" data-lamp={r.def.id} data-state={r.reading.state} onClick={() => choose(() => onGoSection(r.def.home))}>
            <span className="s3-lampshape" data-state={r.reading.state}><StateGlyph state={r.reading.state} size={16} /></span>
            <span className="s3-lamptext">
              <b>{r.def.label} <span className="s3-lampword">{LAMP_SPECS[r.reading.state].label}</span></b>
              <small>{subProjectById(r.def.project).name} {'·'} {r.reason}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
