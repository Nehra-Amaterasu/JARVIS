// PaperStrata (package Y01, spec 20.7.1): years across, syllabus topics down, one dot where a topic was set in a year. The dot's
// size is the topic's share of that paper's marks (a tick when the marks are not known), its shape the question type, its fill
// who tagged it. The right margin counts "k of N" papers and, from 3 papers on, draws the Wilson interval of that count. Fewer
// than 3 papers and the margin says so in words instead of a figure. Everything is a count of papers on file: nothing here
// says what a paper will contain.
//
// Built on the D03 LedgerTable for its table twin (`V`), and on plain SVG glyphs for the matrix (StrataCore draws isometric
// slabs of one evidence number per unit; a topic-by-year matrix is not that form). One tab stop, arrows walk, Enter opens.
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Segmented } from '../../../shared/kit'
import { AsciiPlate } from '../../../shared/grammar'
import { Lamp, readingOf, showsNumber, type LampState } from '../../../shared/lamp'
import { LedgerTable } from '../../../shared/data/tables'
import type { Col, Row } from '../../../shared/data/tables'
import type { Topic } from '../ports'
import { CropCard } from '../review/CropCard'
import { TagChip } from '../review/TagChip'
import { COPY } from './copy'
import type { Coverage } from './CoverageLedger'
import { ONE_PAPER, TOO_FEW, countText, intervalText, patternState, wilson } from './stats'
import {
  GLYPH_OF, ROWS_PER_PAGE, TYPE_WORD, YEAR_WINDOW, dotSize, mergeCells, setIn, topicWindow, unitsOf, walk, yearWindow,
  type StrataCell, type Walk,
} from './strataModel'

export type { StrataCell } from './strataModel'

export interface PaperStrataProps {
  cells: StrataCell[]
  years: number[]
  topics: Topic[]
  coverage: Coverage
  onOpen: (qid: string) => void
  /** The state of the source of the counts. Numbers and dots draw for LIVE and SIMULATED only. */
  state?: LampState
  reason?: string
  /** The paper chosen in the list: its column is washed. */
  selectedYear?: number | null
  /** `f` on a cell: filter the list and the questions to this topic. */
  onFilterTopic?: (topicId: string) => void
  /** `p` on a cell: practise this topic. */
  onPractise?: (topicId: string) => void
  label?: string
  rowsPerPage?: number
}

const NO_TOPIC = 'all'

function Glyph({ cell }: { cell: StrataCell }) {
  const d = dotSize(cell.share)
  const kind = GLYPH_OF[cell.type]
  const dashed = cell.tag === 'MODEL'
  const common = { className: 'pp-glyph', 'data-tag': cell.tag, 'data-kind': kind, 'aria-hidden': true as const }
  const o = 13
  if (cell.share <= 0) return <svg {...common} data-kind="tick" width="28" height="28" viewBox="0 0 28 28"><line x1="9" y1="14" x2="19" y2="14" strokeLinecap="round" /></svg>
  const r = d / 2
  return (
    <svg {...common} width="28" height="28" viewBox="0 0 28 28" data-dashed={dashed ? 'true' : undefined}>
      {kind === 'circle' && <circle cx={o + 1} cy={o + 1} r={r} />}
      {kind === 'square' && <rect x={o + 1 - r} y={o + 1 - r} width={d} height={d} rx={Math.min(3, r / 2)} />}
      {kind === 'triangle' && <path d={`M${o + 1} ${o + 1 - r} L${o + 1 + r} ${o + 1 + r * 0.8} L${o + 1 - r} ${o + 1 + r * 0.8} Z`} strokeLinejoin="round" />}
      {kind === 'cross' && <path d={`M${o + 1 - r * 0.8} ${o + 1 - r * 0.8} L${o + 1 + r * 0.8} ${o + 1 + r * 0.8} M${o + 1 + r * 0.8} ${o + 1 - r * 0.8} L${o + 1 - r * 0.8} ${o + 1 + r * 0.8}`} strokeLinecap="round" />}
      {cell.tag === 'HAND' && <line className="pp-hand" x1="9" y1="26" x2="19" y2="26" />}
    </svg>
  )
}

/** The Wilson bar: the track is 0 to 100 percent of papers, the band is the interval, the tick is k over N. */
function WilsonBar({ k, n }: { k: number; n: number }) {
  const { lo, hi } = wilson(k, n)
  return (
    <span className="pp-wb" aria-hidden="true">
      <span className="pp-wb-band" style={{ insetInlineStart: `${lo * 100}%`, inlineSize: `${Math.max(2, (hi - lo) * 100)}%` }} />
      <span className="pp-wb-tick" style={{ insetInlineStart: `${(k / n) * 100}%` }} />
    </span>
  )
}

export function PaperStrata({
  cells, years, topics, coverage, onOpen, state = 'live', reason, selectedYear, onFilterTopic, onPractise, label = 'Paper strata', rowsPerPage = ROWS_PER_PAGE,
}: PaperStrataProps) {
  const uid = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const [unit, setUnit] = useState<string>(NO_TOPIC)
  const [tPage, setTPage] = useState(0)
  const [yPage, setYPage] = useState(0)
  const [at, setAt] = useState<[number, number]>([0, 0])
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [twin, setTwin] = useState(false)
  const [fit, setFit] = useState<number>(YEAR_WINDOW)
  const [dim, setDim] = useState<[number, number]>([132, 76])

  const live = showsNumber(state)
  const merged = useMemo(() => mergeCells(cells), [cells])
  const n = Math.max(coverage.papers, years.length)
  const units = useMemo(() => unitsOf(topics), [topics])
  const tw = useMemo(() => topicWindow(topics, unit === NO_TOPIC ? null : unit, tPage, rowsPerPage), [topics, unit, tPage, rowsPerPage])
  const yw = useMemo(() => yearWindow(years, yPage, fit), [years, yPage, fit])
  const rows = tw.shown
  const cols = yw.shown
  const cellAt = (t: Topic, y: number) => merged.find((c) => c.topicId === t.id && c.year === y)
  const empty = !live || years.length === 0 || merged.length === 0
  const ps = patternState(n)

  // the year columns that fit: 44 px each beside the 132 px topic names and the 76 px count column
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const d: [number, number] = w < 480 ? [84, 56] : [132, 76]
      setDim((c) => (c[0] === d[0] ? c : d))
      setFit(Math.max(2, Math.min(YEAR_WINDOW, Math.floor((w - 12 - d[0] - d[1]) / 44))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [empty, twin])

  // ------------------------------------------------------------------ keys
  const move = (to: [number, number]) => {
    setAt(to)
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>(`[data-rc="${to[0]}:${to[1]}"]`)?.focus())
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(k)) {
      e.preventDefault()
      move(walk(at[0], at[1], k as Walk, rows.length, cols.length))
      return
    }
    const t = rows[at[0]]
    if (!t) return
    if (k === 'f') { e.preventDefault(); setPinned((p) => (p === t.id ? null : t.id)); onFilterTopic?.(t.id) }
    else if (k === 'p') { e.preventDefault(); onPractise?.(t.id) }
  }

  const show = (r: number, c: number, el: HTMLElement) => {
    const w = wrap.current
    if (!w) return
    const a = el.getBoundingClientRect()
    const b = w.getBoundingClientRect()
    setHover({ r, c, x: a.left - b.left + a.width / 2, y: a.top - b.top })
  }

  // ------------------------------------------------------------------ the table twin (V)
  const twinCols: Col[] = useMemo(() => [
    { key: 'topic', label: 'Topic', pinned: true, width: '16ch' },
    ...yw.shown.map((y) => ({ key: `y${y}`, label: String(y), kind: 'number' as const, unit: '%', width: '7ch' })),
    { key: 'k', label: 'Set in', width: '9ch', sortable: false },
  ], [yw.shown])
  const twinRows: Row[] = useMemo(() => topics.filter((t) => unit === NO_TOPIC || t.unit === unit).map((t) => {
    const row: Row = { id: t.id, topic: t.label, k: countText(setIn(merged, t.id, years), n) }
    for (const y of yw.shown) { const c = merged.find((x) => x.topicId === t.id && x.year === y); if (c) row[`y${y}`] = Math.round(c.share * 100) }
    return row
  }), [topics, unit, merged, years, n, yw.shown])

  const hovered = hover && rows[hover.r] && cols[hover.c] ? { t: rows[hover.r], y: cols[hover.c], cell: cellAt(rows[hover.r], cols[hover.c]) } : null

  return (
    <section className="pp-strata" data-component="paper-strata" data-state={state} aria-label={label} onKeyDown={(e) => { if (e.key === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement).closest('input, textarea, select')) setTwin((v) => !v) }}>
      <header className="pp-strata-bar">
        {units.length > 1 && live ? (
          <Segmented
            variant="choice"
            label="Unit filter"
            value={unit}
            onChange={(u) => { setUnit(u); setTPage(0); setAt([0, 0]) }}
            options={[{ id: NO_TOPIC, label: 'All' }, ...units.map((u) => ({ id: u, label: u }))]}
          />
        ) : <span className="pp-strata-title">Topics by year</span>}
        <span className="pp-strata-lamp">
          <Lamp reading={readingOf({ state, reason })} />
        </span>
      </header>

      {empty ? (
        <div className="pp-strata-empty" data-component="strata-empty">
          <AsciiPlate
            tier="data"
            label="An empty grid: topics down, years across, nothing on file"
            text={['year  .  .  .  .  .  .', '----+--+--+--+--+--+--', 'row   .  .  .  .  .  .', 'row   .  .  .  .  .  .', 'row   .  .  .  .  .  .'].join('\n')}
          />
          <p className="pp-empty-line">{live ? COPY.empty : COPY.waitingPrefix + (reason ? `: ${reason}` : '')}</p>
          <p className="pp-empty-note">{live ? COPY.emptyNote : 'No dot is drawn until a source has reported.'}</p>
        </div>
      ) : twin ? (
        <div className="pp-twin">
          <LedgerTable label="Topics by year, as a table (share of the paper's marks)" columns={twinCols} rows={twinRows} state={state} reason={reason} density="dense" maxHeight={440} />
        </div>
      ) : (
        <div className="pp-gridwrap" ref={wrap} style={{ ['--cols' as string]: cols.length, ['--lab' as string]: `${dim[0]}px`, ['--cnt' as string]: `${dim[1]}px` }}>
          <div className="pp-yearhead" role="presentation">
            <span className="pp-yh-pad" />
            {cols.map((y) => <span key={y} className="pp-yh" data-selected={selectedYear === y ? 'true' : undefined}>{y}</span>)}
            <span className="pp-yh pp-yh-count">set in</span>
          </div>
          <div className="pp-grid" role="grid" aria-label={`${label}: ${rows.length} topics by ${cols.length} years`} aria-describedby={`${uid}-desc`} onKeyDown={onKey}>
            {rows.map((t, r) => {
              const k = setIn(merged, t.id, years)
              return (
                <div key={t.id} role="row" className="pp-row" data-pinned={pinned === t.id ? 'true' : pinned ? 'dim' : undefined}>
                  <span role="rowheader" className="pp-rowhead" title={`${t.label} (${t.unit})`}>{t.label}</span>
                  {cols.map((y, c) => {
                    const cell = cellAt(t, y)
                    const name = cell
                      ? `${t.label}, ${y}: ${TYPE_WORD[cell.type]}, ${cell.share > 0 ? `${Math.round(cell.share * 100)} percent of the marks` : 'marks not found'}, tagged by ${cell.tag}, margin ${cell.margin.toFixed(2)}. Enter opens the question.`
                      : `${t.label}, ${y}: not set in this paper`
                    return (
                      <div key={y} role="gridcell" className="pp-cell" data-selected={selectedYear === y ? 'true' : undefined}>
                        <button
                          type="button"
                          className="pp-dot"
                          data-rc={`${r}:${c}`}
                          data-empty={cell ? undefined : 'true'}
                          tabIndex={at[0] === r && at[1] === c ? 0 : -1}
                          aria-label={name}
                          aria-describedby={hover && hover.r === r && hover.c === c && cell ? `${uid}-tip` : undefined}
                          onFocus={(e) => { setAt([r, c]); if (cell) show(r, c, e.currentTarget); else setHover(null) }}
                          onBlur={() => setHover(null)}
                          onPointerEnter={(e) => { if (cell) show(r, c, e.currentTarget) }}
                          onPointerLeave={() => setHover(null)}
                          onClick={() => { setAt([r, c]); if (cell) onOpen(cell.qid) }}
                        >
                          {cell ? <Glyph cell={cell} /> : <span className="pp-none" aria-hidden="true">·</span>}
                        </button>
                      </div>
                    )
                  })}
                  <span className="pp-count" role="gridcell">
                    <span className="pp-count-text">{countText(k, n)}</span>
                    {ps === 'figure' ? <WilsonBar k={k} n={n} /> : <span className="pp-wb pp-wb-hollow" aria-hidden="true" />}
                    <span className="ww-sr-only">{ps === 'figure' ? `, ${intervalText(k, n)}` : `, ${ps === 'counts-only' ? ONE_PAPER : TOO_FEW}`}</span>
                  </span>
                </div>
              )
            })}
          </div>
          {hovered?.cell && hover && (
            <div id={`${uid}-tip`} role="tooltip" className="pp-tip" style={{ insetInlineStart: Math.min(Math.max(8, hover.x - 148), (wrap.current?.clientWidth ?? 600) - 304), insetBlockStart: hover.y > 220 ? hover.y - 196 : hover.y + 50 }}>
              <CropCard size="callout" img={hovered.cell.crop?.img} textStatus={hovered.cell.crop?.textStatus ?? 'crop-only'} simulated={state === 'simulated'} label={`${hovered.t.label}, ${hovered.y}`} />
              <p className="pp-tip-line">
                <TagChip source={hovered.cell.tag} /> <span>tagged by: {hovered.cell.tag}, margin {hovered.cell.margin.toFixed(2)}</span>
              </p>
            </div>
          )}
        </div>
      )}

      <footer className="pp-strata-foot">
        <p id={`${uid}-desc`} className="pp-legend">
          <span className="pp-legend-item"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" /></svg>numerical</span>
          <span className="pp-legend-item"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2" /></svg>derivation</span>
          <span className="pp-legend-item"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2 L12 11 L2 11 Z" strokeLinejoin="round" /></svg>short</span>
          <span className="pp-legend-item"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path className="pp-lx" d="M3 3 L11 11 M11 3 L3 11" strokeLinecap="round" /></svg>choice</span>
          <span className="pp-legend-size">size: marks · dashed: model · underline: hand</span>
        </p>
        <span className="pp-pagers">
          {yw.pages > 1 && !twin && (
            <span className="pp-pager" role="group" aria-label="Years">
              <button type="button" className="pp-pg" aria-label="Older years" disabled={yPage >= yw.pages - 1} onClick={() => { setYPage((p) => p + 1); setAt([at[0], 0]) }}>‹</button>
              <button type="button" className="pp-pg" aria-label="Newer years" disabled={yPage === 0} onClick={() => { setYPage((p) => p - 1); setAt([at[0], 0]) }}>›</button>
            </span>
          )}
          {tw.pages > 1 && !twin && (
            <span className="pp-pager" role="group" aria-label={`Topics, page ${tPage + 1} of ${tw.pages}`}>
              <button type="button" className="pp-pg" aria-label="Earlier topics" disabled={tPage === 0} onClick={() => { setTPage((p) => p - 1); setAt([0, at[1]]) }}>↑</button>
              <button type="button" className="pp-pg" aria-label="More topics" disabled={tPage >= tw.pages - 1} onClick={() => { setTPage((p) => p + 1); setAt([0, at[1]]) }}>↓</button>
            </span>
          )}
          {!empty && (
            <button type="button" className="pp-pg pp-pg-word" aria-pressed={twin} aria-keyshortcuts="V" onClick={() => setTwin((v) => !v)}>{twin ? 'Dots' : 'Table'}<kbd className="pp-key" aria-hidden="true">V</kbd></button>
          )}
        </span>
      </footer>
      {!empty && ps !== 'figure' && <p className="pp-pattern-note" role="status">{ps === 'counts-only' ? ONE_PAPER : TOO_FEW}</p>}
    </section>
  )
}

