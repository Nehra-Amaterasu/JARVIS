// IntakeLedger (package C03, spec 21.4.2 S4): the items brought in, ordered by when they matter and grouped under three headers
// in the table's own type (This week, Later, No date; Earlier only when something is). Six rows a page, 44 px each, so the first
// screenful is what matters first and nothing scrolls inside the box. One row is one tab stop (roving), arrows walk and page,
// and the source of every row is a ProvenanceChip with words. A row he has left alone for 14 days folds into one line.
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { CalendarDays, FileText, Flag } from 'lucide-react'
import { COPY } from './copy'
import { PER_PAGE, dueWords, pageOf, provenanceLine, walkOrder } from './model'
import { ProvenanceChip } from './ProvenanceChip'
import { TrayArt } from './TrayArt'
import type { IntakeKind, IntakeRow, SubjectOption } from './types'

const KIND_ICON: Record<IntakeKind, typeof Flag> = { deadline: Flag, event: CalendarDays, file: FileText }
const KIND_WORD: Record<IntakeKind, string> = { deadline: 'Deadline', event: 'Event', file: 'File' }
const STATE_WORD = { new: '', accepted: 'Accepted', declined: 'Declined', taken: 'Sent' } as const

export interface IntakeLedgerProps {
  rows: readonly IntakeRow[]
  subjects: readonly SubjectOption[]
  now: number
  page: number
  onPage: (page: number) => void
  selId: string | null
  onSelect: (id: string) => void
  /** Why the ledger is empty when it is: a WAITING reason, or the plain "nothing yet". */
  emptyTitle: string
  emptyNote: string
  /** NEW rows folded away because they sat for 14 days. */
  older: number
  showOlder: boolean
  onToggleOlder: () => void
  /** True when the desk is LIVE and empty: the tray picture moves. A WAITING desk shows it still. */
  live?: boolean
}

export function IntakeLedger({ rows, subjects, now, page, onPage, selId, onSelect, emptyTitle, emptyNote, older, showOlder, onToggleOlder, live = false }: IntakeLedgerProps) {
  const pg = pageOf(rows, page, now)
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef<string | null>(null)
  const label = (id: string) => subjects.find((s) => s.id === id)?.label ?? ''
  const tabId = pg.groups.flatMap((g) => g.rows).find((r) => r.id === selId)?.id ?? pg.groups[0]?.rows[0]?.id

  useEffect(() => {
    if (pending.current && pending.current === selId) {
      const el = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-row]') ?? []).find((e) => e.dataset.row === selId)
      el?.focus()
      pending.current = null
    }
  })

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const order = walkOrder(rows)
    const at = order.findIndex((r) => r.id === (selId ?? tabId))
    const next = order[Math.min(order.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (!next) return
    e.preventDefault()
    pending.current = next.id
    onPage(Math.floor(order.indexOf(next) / PER_PAGE))
    onSelect(next.id)
  }

  return (
    <section className="ik-ledger" aria-label="Items brought in" data-component="intake-ledger" onKeyDown={onKey}>
      <div className="ik-list" ref={root}>
        {rows.length === 0 ? (
          <div className="ik-empty" data-component="intake-empty">
            <TrayArt moving={live} />
            <p className="ik-empty-line">{emptyTitle}</p>
            <p className="ik-empty-note">{emptyNote}</p>
          </div>
        ) : (
          pg.groups.map((g) => (
            <div key={g.key} className="ik-group" role="group" aria-label={`${g.label}, ${g.total}`}>
              <h3 className="ik-ghead"><span>{g.label}</span><span className="ik-gcount">{g.total}</span></h3>
              <ul>
                {g.rows.map((r) => {
                  const Icon = KIND_ICON[r.kind]
                  const subj = label(r.subject)
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="ik-row"
                        data-row={r.id}
                        data-state={r.state}
                        aria-current={selId === r.id ? 'true' : undefined}
                        tabIndex={tabId === r.id ? 0 : -1}
                        onClick={() => onSelect(r.id)}
                      >
                        <Icon className="ik-kind" size={16} aria-hidden="true" />
                        <span className="ww-sr-only">{KIND_WORD[r.kind]}: </span>
                        <span className="ik-row-main">
                          <span className="ik-row-title">{r.title}</span>
                          <span className="ik-row-sub">{`${subj || 'no subject'} · ${r.kind === 'file' ? (r.file?.name ?? 'file') : r.ambiguous ? 'date needs your choice' : dueWords(r.date, r.time, now)}`}</span>
                        </span>
                        {STATE_WORD[r.state] && <span className="ik-row-state">{STATE_WORD[r.state]}</span>}
                        <ProvenanceChip source={r.source} detail={provenanceLine(r, now)} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
      </div>
      <div className="ik-foot">
        {older > 0 && (
          <button type="button" className="ik-older" aria-expanded={showOlder} onClick={onToggleOlder}>
            {showOlder ? `Hide ${older} older item${older === 1 ? '' : 's'}` : `${older} older item${older === 1 ? '' : 's'}, ${COPY.olderNote}`}
          </button>
        )}
        {pg.pages > 1 && (
          <div className="ik-pager" role="group" aria-label={`Items, page ${pg.page + 1} of ${pg.pages}`}>
            <button type="button" className="ik-pg" aria-label="Earlier page" disabled={pg.page === 0} onClick={() => onPage(pg.page - 1)}>{'‹'}</button>
            <span>{pg.page + 1} of {pg.pages}</span>
            <button type="button" className="ik-pg" aria-label="Later page" disabled={pg.page >= pg.pages - 1} onClick={() => onPage(pg.page + 1)}>{'›'}</button>
          </div>
        )}
      </div>
    </section>
  )
}
