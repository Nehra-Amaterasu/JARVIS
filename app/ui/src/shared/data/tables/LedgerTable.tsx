// LedgerTable (wave 6, D03, spec 20.5.2): a rack ledger, not a spreadsheet. 32 px rows with a 44 px row button, a sticky
// header plate with a ruler under it, sort glyphs in text, F2 inline edit, a column chooser, a drawer on expand, key-value
// cards under 900 px and an inline lamp column. The whole table takes one state lamp: for WAITING, PLANNED and FAULT
// every number, spark and meter is drawn as a hollow dashed form that says why, never as a value.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { LAMP_SPECS, isLampState, showsNumber, type LampState } from '../../lamp'
import {
  CARD_FIELDS, METER_DOTS, ariaSort, cardFields, formatNumber, isEditable, isSortable, kindOf, meterFill, moveFocus, nextSort,
  parseNumber, sortGlyph, sortRows, sparkText, visibleColumns, type Col, type Pos, type Row, type Sort,
} from './layout'
import { LampTag, WHY, useNarrow } from './parts'
import './tables.css'

export interface LedgerTableProps {
  columns: Col[]
  rows: Row[]
  density?: 'normal' | 'dense'
  /** The state of the source of the numbers. Numbers draw only for LIVE and SIMULATED. */
  state: LampState
  onEdit?: (row: Row, col: Col, value: string | number) => void
  /** The table's name: it labels the grid and heads the bar. */
  label?: string
  /** Why the state is what it is, in words; defaults to the state's own reason. */
  reason?: string
  /** Force the form; `auto` follows the 900 px breakpoint. */
  layout?: 'auto' | 'table' | 'cards'
  loading?: boolean
  empty?: ReactNode
  emptyAction?: ReactNode
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  /** Extra drawer content under the key-value list of the row. */
  renderDetail?: (row: Row) => ReactNode
  /** Scroll height of the grid in px; the header stays put. */
  maxHeight?: number
  defaultSort?: Sort
  defaultHidden?: string[]
  /** Start with a drawer open or the column chooser open (the gallery shows both). */
  defaultOpenId?: string | null
  defaultChooserOpen?: boolean
}

interface Edit { rowId: string; key: string; draft: string; bad: boolean }

const pad = (n: number) => String(n).padStart(2, '0')

export function LedgerTable({
  columns, rows, density = 'normal', state, onEdit, label = 'Ledger', reason, layout = 'auto', loading, empty, emptyAction,
  selectedId, onSelect, renderDetail, maxHeight, defaultSort = null, defaultHidden, defaultOpenId = null, defaultChooserOpen = false,
}: LedgerTableProps) {
  const uid = useId()
  const narrow = useNarrow()
  const asCards = layout === 'cards' || (layout === 'auto' && narrow)
  const live = showsNumber(state)
  const why = reason ?? WHY[state]

  const [sort, setSort] = useState<Sort>(defaultSort)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(defaultHidden ?? []))
  const [chooser, setChooser] = useState(defaultChooserOpen)
  const [openId, setOpenId] = useState<string | null>(defaultOpenId)
  const [own, setOwn] = useState<string | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [pos, setPos] = useState<Pos>({ r: 0, c: 0 })
  const [said, setSaid] = useState('')
  const want = useRef(false)
  const drawerWants = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const chooserKey = useRef<HTMLButtonElement>(null)
  const drawerClose = useRef<HTMLButtonElement>(null)

  const cols = useMemo(() => visibleColumns(columns, hidden), [columns, hidden])
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort])
  const selected = selectedId !== undefined ? selectedId : own
  const openRow = openId ? sorted.find((r) => r.id === openId) ?? null : null
  const titleCol = cardFields(cols).title ?? columns.find((c) => kindOf(c) === 'text') ?? columns[0]
  const titleOf = (r: Row) => String(r[titleCol?.key ?? 'id'] ?? r.id)

  const select = (id: string | null) => {
    if (selectedId === undefined) setOwn(id)
    onSelect?.(id)
  }

  // keep the roving stop inside the grid when rows or columns change under it
  useEffect(() => {
    setPos((p) => {
      const r = Math.min(p.r, sorted.length - 1)
      const c = Math.min(p.c, cols.length)
      return r === p.r && c === p.c ? p : { r: Math.max(sorted.length ? r : -1, -1), c }
    })
  }, [sorted.length, cols.length])

  useLayoutEffect(() => {
    if (!want.current) return
    want.current = false
    root.current?.querySelector<HTMLElement>(`[data-pos="${pos.r}:${pos.c}"]`)?.focus({ preventScroll: false })
  }, [pos, edit])

  useEffect(() => {
    if (openRow && drawerWants.current) {
      drawerWants.current = false
      drawerClose.current?.focus()
    }
  }, [openRow])

  const goto = (p: Pos) => {
    want.current = true
    setPos(p)
  }

  // ------------------------------------------------------------------ actions
  const doSort = (key: string) => {
    const next = nextSort(sort, key)
    setSort(next)
    const name = columns.find((c) => c.key === key)?.label ?? key
    setSaid(next ? `Sorted by ${name}, ${next.dir === 'asc' ? 'ascending' : 'descending'}` : 'Sort cleared, original order')
  }
  const toggleOpen = (row: Row, from?: Pos) => {
    if (openId === row.id) {
      setOpenId(null)
      if (from) goto(from)
    } else {
      drawerWants.current = true
      setOpenId(row.id)
      select(row.id)
    }
  }
  const closeDrawer = () => {
    const i = sorted.findIndex((r) => r.id === openId)
    setOpenId(null)
    if (i >= 0) goto({ r: i, c: 0 })
  }
  const canEdit = (c: Col) => isEditable(c) && (kindOf(c) === 'text' || live)
  const startEdit = (row: Row, col: Col) => {
    if (!canEdit(col)) return
    const v = row[col.key]
    setEdit({ rowId: row.id, key: col.key, draft: v == null ? '' : kindOf(col) === 'number' ? formatNumber(v, col.digits) : String(v), bad: false })
  }
  const endEdit = (commit: boolean, refocus: boolean) => {
    if (!edit) return
    const row = rows.find((r) => r.id === edit.rowId)
    const col = columns.find((c) => c.key === edit.key)
    if (commit && row && col) {
      if (kindOf(col) === 'number') {
        const n = parseNumber(edit.draft)
        if (n === null) {
          if (refocus) return void setEdit({ ...edit, bad: true })
        } else onEdit?.(row, col, n)
      } else onEdit?.(row, col, edit.draft.trim())
    }
    setEdit(null)
    if (refocus) want.current = true
  }

  // ------------------------------------------------------------------ keys: one grid, one tab stop
  const onGridKey = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('.d3-input')) return
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pos]')
    if (!el) return
    const [r, c] = el.dataset.pos!.split(':').map(Number)
    const here: Pos = { r, c }
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key)) {
      e.preventDefault()
      let next = moveFocus(here, e.key, sorted.length, cols.length, e.ctrlKey)
      if (next.r === -1 && next.c === 0) next = { r: -1, c: 1 }
      if (next.r !== -1 || sorted.length > 0 || next.c !== 0) goto(next)
      return
    }
    const row = r >= 0 ? sorted[r] : undefined
    const col = c >= 1 ? cols[c - 1] : undefined
    if (e.key === 'F2' && row && col) {
      e.preventDefault()
      if (canEdit(col)) startEdit(row, col)
      return
    }
    if (e.target !== el || !row || !col) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (canEdit(col)) startEdit(row, col)
      else toggleOpen(row, here)
    } else if (e.key === ' ') {
      e.preventDefault()
      select(selected === row.id ? null : row.id)
    }
  }

  // ------------------------------------------------------------------ cells
  const hollow = (col: Col) => (
    <span className="d3-hollow" role="img" aria-label={`${col.label}: no value. ${LAMP_SPECS[state].label}${why ? `, ${why}` : ''}`}>
      -- --
    </span>
  )
  const cell = (row: Row, col: Col): ReactNode => {
    const v = row[col.key]
    switch (kindOf(col)) {
      case 'lamp':
        return <LampTag state={isLampState(v) ? v : 'waiting'} />
      case 'number': {
        if (!live || formatNumber(v, col.digits) === '') return hollow(col)
        return (
          <>
            <span className="d3-num">{formatNumber(v, col.digits)}</span>
            {col.unit && <span className="d3-unit">{col.unit}</span>}
          </>
        )
      }
      case 'spark': {
        const t = live && Array.isArray(v) ? sparkText(v as number[]) : ''
        return t ? (
          <span className="d3-spark" role="img" aria-label={`${col.label}: ${(v as number[]).slice(-12).join(', ')}`}>{t}</span>
        ) : hollow(col)
      }
      case 'meter': {
        if (!live || typeof v !== 'number') return hollow(col)
        const n = meterFill(v)
        return (
          <span className="d3-meter" role="img" aria-label={`${col.label}: ${n} of ${METER_DOTS}`}>
            {Array.from({ length: METER_DOTS }, (_, i) => <i key={i} data-on={i < n ? 'true' : 'false'} />)}
          </span>
        )
      }
      default:
        return <span className="d3-text">{v == null || v === '' ? '' : String(v)}</span>
    }
  }

  // select once when the editor mounts: an inline ref callback would re-run on every keystroke and swallow the typing
  const selectOnMount = useCallback((el: HTMLInputElement | null) => { el?.select() }, [])
  const editor = (row: Row, col: Col) => (
    <span className="d3-edit">
      <input
        className="d3-input"
        aria-label={`${col.label} of ${titleOf(row)}`}
        aria-invalid={edit?.bad || undefined}
        inputMode={kindOf(col) === 'number' ? 'decimal' : 'text'}
        value={edit!.draft}
        autoFocus
        ref={selectOnMount}
        onChange={(e) => setEdit({ ...edit!, draft: e.target.value, bad: false })}
        onBlur={() => endEdit(true, false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); endEdit(true, true) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endEdit(false, true) }
        }}
      />
      {edit?.bad && <span className="d3-err" role="alert">numbers only</span>}
    </span>
  )

  // ------------------------------------------------------------------ pieces
  const bar = (
    <header className="d3-bar">
      <h3 className="d3-cap" id={`${uid}-cap`}>{label}</h3>
      <LampTag state={state} />
      <p className="d3-why">{live ? (state === 'simulated' ? why : `${sorted.length} ${sorted.length === 1 ? 'row' : 'rows'}`) : `${why}. Numbers are not drawn.`}</p>
      <span className="d3-grow" />
      <button
        ref={chooserKey}
        type="button"
        className="d3-key"
        aria-expanded={chooser}
        aria-controls={`${uid}-cols`}
        onClick={() => setChooser((o) => !o)}
      >
        <span aria-hidden="true">▤</span> Columns <span className="d3-key-n">{cols.length}/{columns.length}</span>
      </button>
    </header>
  )

  const chooserPanel = chooser && (
    <div
      id={`${uid}-cols`}
      className="d3-chooser"
      role="group"
      aria-label="Columns shown"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); setChooser(false); chooserKey.current?.focus() }
      }}
    >
      {columns.map((c) => (
        <label key={c.key} className="d3-choice">
          <input
            type="checkbox"
            checked={c.pinned || !hidden.has(c.key)}
            disabled={c.pinned || (!hidden.has(c.key) && cols.length === 1)}
            onChange={(e) => setHidden((h) => { const n = new Set(h); if (e.target.checked) n.delete(c.key); else n.add(c.key); return n })}
          />
          <span>{c.label}</span>
          {c.pinned && <span className="d3-unit">pinned</span>}
        </label>
      ))}
    </div>
  )

  const keyValues = (row: Row) => (
    <dl className="d3-kv">
      {columns.map((c) => (
        <div key={c.key} className="d3-kv-row">
          <dt>{c.label}</dt>
          <dd>{cell(row, c)}</dd>
        </div>
      ))}
    </dl>
  )

  const drawer = openRow && (
    <>
      {asCards && <div className="d3-scrim" aria-hidden="true" onClick={closeDrawer} />}
      <aside
        className="d3-drawer"
        data-place={asCards ? 'sheet' : 'side'}
        aria-label={`Details: ${titleOf(openRow)}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); closeDrawer() }
        }}
      >
        <header className="d3-drawer-head">
          <h4 className="d3-drawer-title">{titleOf(openRow)}</h4>
          <button ref={drawerClose} type="button" className="d3-key d3-key-sq" aria-label={`Close details of ${titleOf(openRow)}`} onClick={closeDrawer}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        {keyValues(openRow)}
        {renderDetail?.(openRow)}
      </aside>
    </>
  )

  const emptyBlock = (
    <div className="d3-empty">
      <p>{empty ?? 'No rows yet.'}</p>
      {emptyAction}
    </div>
  )

  // ------------------------------------------------------------------ the two forms
  const asTable = (
    <div className="d3-body">
      <div className="d3-scroll" style={maxHeight ? { maxHeight } : undefined}>
        <table className="d3-table" role="grid" aria-labelledby={`${uid}-cap`} aria-rowcount={sorted.length + 1} aria-busy={loading || undefined} onKeyDown={onGridKey}>
          <thead>
            <tr>
              <th className="d3-gut-h" scope="col"><span className="d3-vh">Row</span></th>
              {cols.map((c, j) => {
                const here = pos.r === -1 && pos.c === j + 1
                const k = kindOf(c)
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className="d3-th"
                    data-kind={k}
                    aria-sort={isSortable(c) ? ariaSort(sort, c.key) : undefined}
                    style={c.width ? { width: c.width } : undefined}
                    {...(isSortable(c) ? {} : { 'data-pos': `-1:${j + 1}`, tabIndex: here ? 0 : -1 })}
                  >
                    {isSortable(c) ? (
                      <button type="button" className="d3-sort" data-pos={`-1:${j + 1}`} tabIndex={here ? 0 : -1} onClick={() => { setPos({ r: -1, c: j + 1 }); doSort(c.key) }}>
                        <span>{c.label}</span>
                        <span className="d3-glyph" aria-hidden="true">{sortGlyph(sort, c.key)}</span>
                      </button>
                    ) : (
                      <span className="d3-sort d3-sort-off">{c.label}</span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }, (_, i) => (
                  <tr key={i} className="d3-ghost" aria-hidden="true">
                    <td className="d3-gut" />
                    {cols.map((c) => <td key={c.key}><span className="d3-hollow">-- --</span></td>)}
                  </tr>
                ))
              : sorted.map((row, i) => {
                  const isSel = selected === row.id
                  const isOpen = openId === row.id
                  return (
                    <tr key={row.id} aria-selected={isSel} data-open={isOpen || undefined} data-row={row.id}>
                      <td className="d3-gut">
                        <button
                          type="button"
                          className="d3-rowbtn"
                          data-pos={`${i}:0`}
                          tabIndex={pos.r === i && pos.c === 0 ? 0 : -1}
                          aria-expanded={isOpen}
                          aria-label={`Details of ${titleOf(row)}`}
                          onClick={() => { setPos({ r: i, c: 0 }); toggleOpen(row) }}
                        >
                          <span className="d3-idx">{pad(i + 1)}</span>
                          <span className="d3-mark" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                        </button>
                      </td>
                      {cols.map((c, j) => {
                        const editing = edit?.rowId === row.id && edit.key === c.key
                        const k = kindOf(c)
                        return (
                          <td
                            key={c.key}
                            role="gridcell"
                            className="d3-td"
                            data-kind={k}
                            data-editable={canEdit(c) || undefined}
                            data-pos={`${i}:${j + 1}`}
                            tabIndex={pos.r === i && pos.c === j + 1 ? 0 : -1}
                            aria-readonly={canEdit(c) ? undefined : true}
                            onFocus={() => setPos((p) => (p.r === i && p.c === j + 1 ? p : { r: i, c: j + 1 }))}
                            onDoubleClick={() => startEdit(row, c)}
                          >
                            {editing ? editor(row, c) : cell(row, c)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
          </tbody>
        </table>
        {!loading && sorted.length === 0 && emptyBlock}
      </div>
      {drawer}
    </div>
  )

  const cf = cardFields(cols)
  const asList = (
    <div className="d3-body">
      <ul className="d3-cards" aria-labelledby={`${uid}-cap`} aria-busy={loading || undefined}>
        {loading
          ? Array.from({ length: 3 }, (_, i) => <li key={i} className="d3-card d3-ghost" aria-hidden="true"><span className="d3-hollow">-- --</span></li>)
          : sorted.map((row, i) => (
              <li key={row.id} className="d3-card" aria-current={selected === row.id || undefined} data-open={openId === row.id || undefined}>
                <div className="d3-card-head">
                  <span className="d3-idx">{pad(i + 1)}</span>
                  <h4 className="d3-card-title">{cf.title ? String(row[cf.title.key] ?? row.id) : row.id}</h4>
                  {cf.lamp && cell(row, cf.lamp)}
                </div>
                <dl className="d3-kv d3-kv-card">
                  {cf.fields.slice(0, CARD_FIELDS).map((c) => (
                    <div key={c.key} className="d3-kv-row">
                      <dt>{c.label}</dt>
                      <dd>{cell(row, c)}</dd>
                    </div>
                  ))}
                </dl>
                <button type="button" className="d3-key d3-card-more" aria-expanded={openId === row.id} onClick={() => toggleOpen(row)}>
                  Details <span className="d3-vh"> of {titleOf(row)}</span> <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
      </ul>
      {!loading && sorted.length === 0 && emptyBlock}
      {drawer}
    </div>
  )

  return (
    <div
      ref={root}
      className="d3 d3-ledger"
      data-component="LedgerTable"
      data-state={state}
      data-density={density}
      data-layout={asCards ? 'cards' : 'table'}
    >
      {bar}
      {chooserPanel}
      {asCards ? asList : asTable}
      {!asCards && (
        <footer className="d3-foot" aria-hidden="true">
          <span>↑ ↓ ← → move</span><span>F2 edit</span><span>Enter details</span><span>Space select</span>
        </footer>
      )}
      <p className="d3-vh" role="status" aria-live="polite">{said}</p>
    </div>
  )
}
