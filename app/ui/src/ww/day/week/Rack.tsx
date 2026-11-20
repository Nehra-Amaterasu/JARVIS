// The timetable rack and the attendance margin ledger of the Week view (spec 20.5.3, package L03).
//
// Rack: today's classes from the timetable, one plate each (subject, time, room), with a free-slot plate wherever two classes leave
// a gap. Ledger: one row per subject, a 20-dot meter of the attended share, a tick at the line the student set, and the margin in
// classes. The word is "margin", never a warning; below the line the tick is a half disc and the text says what reaches it. The
// formula of the focused row is printed under the list (focus and hover both set it), so the arithmetic is never a secret.
//
// Honest by construction: the ledger is LIVE only when a class was entered today. Later it says WAITING and how long ago, and the
// dots and margins draw as hollow forms (a figure is drawn only beside a LIVE or SIMULATED lamp).
import { useId, useState } from 'react'
import { Button, Drawer } from '../../../shared/kit'
import { showsNumber, type LampState } from '../../../shared/lamp'
import { TodayPlate } from '../today/Plate'
import { METER, byMargin, fmtMinutes, marginLine, rackItems, type MarginRow, type RackClass } from './model'

/** Rows drawn in a plate before the rest goes under the one key. */
export const RACK_ROWS = 4
export const MARGIN_ROWS = 3

const STATUS_WORD: Record<string, string> = { present: 'marked present', absent: 'marked absent', cancelled: 'cancelled' }

export interface RackProps {
  classes: readonly RackClass[]
  state: LampState
  reason: string
  /** The rest of the list, under one key. */
  onAll?: () => void
  /** Draw every row (the drawer's list) instead of the first few. */
  all?: boolean
  /** A free slot is a key: it opens the capture line with the slot's start time already in it. */
  onFree?: (slot: FreeSlot) => void
}

export interface FreeSlot { from: string; to: string; minutes: number }

export function Rack({ classes, state, reason, onAll, all, onFree }: RackProps) {
  const items = rackItems(classes)
  const shown = all ? items : items.slice(0, RACK_ROWS)
  const ready = showsNumber(state)
  return (
    <TodayPlate id="rack" label="Timetable, today" state={state} reason={reason}
      corner={ready && !all && items.length > RACK_ROWS && onAll ? <Button size="sm" grouped onClick={onAll} data-open="timetable">All {items.length}</Button> : undefined}>
      {ready && items.length === 0 ? (
        <p className="dy-note">No class is on the timetable today.</p>
      ) : !ready ? (
        <ul className="wk-rack" data-hollow="true" aria-label="No timetable: waiting">
          {[0, 1, 2].map((i) => <li key={i} className="wk-class" data-hollow="true"><span className="dy-mono dy-hollow">– –:– –</span><span className="wk-dash" /></li>)}
        </ul>
      ) : (
        <>
          <ul className="wk-rack" aria-label="Classes today and the free time between them">
            {shown.map((it) => it.type === 'class' ? (
              <li key={it.key} className="wk-class" data-status={it.cls.status ?? 'open'}>
                <span className="dy-mono wk-class-time">{it.cls.start}{it.cls.end ? ` to ${it.cls.end}` : ''}</span>
                <span className="wk-class-name">{it.cls.name}</span>
                <span className="wk-class-meta">{[it.cls.room, it.cls.status ? STATUS_WORD[it.cls.status] : 'not marked yet'].filter(Boolean).join(' · ')}</span>
              </li>
            ) : (
              <li key={it.key}>
                <button type="button" className="wk-free" data-free="" disabled={!onFree} onClick={() => onFree?.({ from: it.from, to: it.to, minutes: it.minutes })}
                  aria-label={`Free ${fmtMinutes(it.minutes)}, ${it.from} to ${it.to}${onFree ? '. Write a line for it' : ''}`}>
                  <span className="wk-free-label">free {fmtMinutes(it.minutes)}</span>
                  <span className="dy-mono wk-class-time">{it.from} to {it.to}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </TodayPlate>
  )
}

/** The 20-dot meter: filled disc = attended share, ring = the rest, a tick (or a half disc below the line) at the student's line. */
export function DotRow({ line, hollow }: { line: ReturnType<typeof marginLine>; hollow: boolean }) {
  const pitch = 7
  const w = METER * pitch
  const below = line.tone === 'below'
  const tickX = line.tick * pitch
  return (
    <svg className="wk-dots" viewBox={`0 -2 ${w} 16`} width={w} height={16} aria-hidden="true" focusable="false">
      {Array.from({ length: METER }, (_, i) => {
        const on = !hollow && i < line.dots
        return on
          ? <circle key={i} className="wk-dot-on" cx={i * pitch + pitch / 2} cy={6} r={2.6} />
          : <circle key={i} className="wk-dot-off" cx={i * pitch + pitch / 2} cy={6} r={2.3} />
      })}
      {!hollow && line.tone !== 'none' && (below
        ? <path className="wk-tick-half" d={`M${tickX - 3} 12 A3 3 0 0 0 ${tickX + 3} 12 Z`} />
        : <rect className="wk-tick" x={tickX - 0.75} y={-2} width={1.5} height={14} />)}
    </svg>
  )
}

export interface MarginsProps {
  rows: readonly MarginRow[]
  /** The student's required share, 0 to 1. */
  required: number
  state: LampState
  reason: string
  onAll?: () => void
  /** Show every subject (the drawer's list) instead of the first few. */
  all?: boolean
}

export function Margins({ rows, required, state, reason, onAll, all }: MarginsProps) {
  const ordered = byMargin(rows, required)
  const shown = all ? ordered : ordered.slice(0, MARGIN_ROWS)
  const ready = showsNumber(state)
  const [focus, setFocus] = useState<string | null>(null)
  const formulaId = useId()
  const at = ordered.find((r) => r.subject === focus)
  const formula = at ? marginLine(at, required).formula : 'margin = floor((attended - r x held) / r), where r is the share you set. Focus a row to see its numbers.'
  const body = (
    <>
      {rows.length === 0 ? (
        <p className="dy-note">No subject is entered yet. Type the week into Setup, then mark classes in the left column.</p>
      ) : (
        <ul className="wk-margins" aria-label="Attendance margin per subject, least margin first">
          {shown.map((r) => {
            const line = marginLine(r, required)
            return (
              <li key={r.subject}>
                <div role="group" tabIndex={0} className="wk-margin" data-tone={line.tone} data-hollow={ready ? undefined : 'true'} aria-describedby={formulaId}
                  onFocus={() => setFocus(r.subject)} onMouseEnter={() => setFocus(r.subject)} onMouseLeave={() => setFocus((f) => (f === r.subject ? null : f))} onBlur={() => setFocus((f) => (f === r.subject ? null : f))}
                  aria-label={ready ? `${r.name}: ${r.attended} of ${r.held} entered, ${line.text}` : `${r.name}: no figure, ${state}`}>
                  <span className="wk-margin-name">{r.name}</span>
                  <DotRow line={line} hollow={!ready} />
                  <span className="wk-margin-text dy-mono">{ready ? line.text : '– –'}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p id={formulaId} className="wk-formula dy-mono">{ready ? formula : 'No figure to work out until a class is entered today.'}</p>
    </>
  )
  if (all) return <div className="wk-margins-all">{body}</div>
  return (
    <TodayPlate id="margins" label="Attendance margin" state={state} reason={reason}
      corner={!all && rows.length > MARGIN_ROWS && onAll ? <Button size="sm" grouped onClick={onAll} data-open="subjects">All {rows.length}</Button> : undefined}>
      {body}
    </TodayPlate>
  )
}

/** The rest of both lists under one key (Hick: the plates show a few rows, the drawer shows all). */
export function AllDrawer({ open, onClose, classes, rows, required, state, reason, rackState, rackReason }: {
  open: boolean; onClose: () => void; classes: readonly RackClass[]; rows: readonly MarginRow[]; required: number
  state: LampState; reason: string; rackState: LampState; rackReason: string
}) {
  return (
    <Drawer open={open} onClose={onClose} title="Timetable and margins" className="dy-sheet wk-sheet">
      <div className="wk-drawer-body">
        <Rack classes={classes} state={rackState} reason={rackReason} all />
        <Margins rows={rows} required={required} state={state} reason={reason} all />
      </div>
    </Drawer>
  )
}
