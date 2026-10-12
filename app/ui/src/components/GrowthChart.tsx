/**
 * GrowthChart — is the brain actually growing? (ROADMAP Y2)
 *
 * Three readings of the same store, one at a time (never two y-scales on one plot):
 *   Total     stacked by source: how big each part of the memory is by each month
 *             (by the date the memory is FROM — a 2021 DM sits in 2021)
 *   Monthly   the same, as rows per month
 *   Learned   rows in the store per day, read from LanceDB's own write history: when
 *             JARVIS actually learned them. Cyan, because it is measured.
 * The scrubber's month is drawn as a cursor; dragging across the plot scrubs the galaxy.
 * Every series has a legend chip (click to hide it), a hover tooltip, and a table view.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtInt } from '../lib/format'
import { areaPaths, monthLabel, niceTicks, stackGrowth, type Growth } from '../lib/galaxy'

type View = 'total' | 'monthly' | 'learned'
const H = 168
const PAD = { l: 44, r: 14, t: 12, b: 24 }

export function GrowthChart({ growth, month, onScrub }: { growth: Growth; month: number; onScrub?: (m: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [view, setView] = useState<View>('total')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<number | null>(null)
  const drag = useRef(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const months = growth.months
  const n = months.length
  const stack = useMemo(() => stackGrowth(growth, view === 'total', hidden), [growth, view, hidden])
  const legendRows = useMemo(() => stackGrowth(growth, false).layers, [growth])
  const iw = w - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b

  // ---- the learned view (dates, not months)
  const ledger = growth.ingest
  const ledgerMax = ledger.reduce((m, e) => Math.max(m, e.rows), 0)
  const yMax = view === 'learned' ? ledgerMax : stack.max
  const ticks = niceTicks(yMax || 1, 3)
  const top = ticks[ticks.length - 1] || 1
  const y = (v: number) => PAD.t + ih - (v / top) * ih
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const lx = (i: number) => PAD.l + (ledger.length <= 1 ? iw : (i / (ledger.length - 1)) * iw)

  // The area paths are rebuilt only when the data, the view or the width change — not
  // on every scrubber month (the replay re-renders this component ~5 times a second).
  const paths = useMemo(() => areaPaths(stack.layers, { left: PAD.l, top: PAD.t, width: iw, height: ih }, top), [stack, iw, ih, top])
  const [tableOpen, setTableOpen] = useState(false)
  const years = months.map((m, i) => [m, i] as const).filter(([m]) => m.endsWith('-01'))
  const yearStep = Math.max(1, Math.ceil(years.length / Math.max(1, Math.floor(iw / 56))))

  const indexAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    const fx = (clientX - r.left - PAD.l) / Math.max(1, iw)
    const len = view === 'learned' ? ledger.length : n
    return Math.max(0, Math.min(len - 1, Math.round(fx * (len - 1))))
  }
  const onMove = (e: React.PointerEvent) => {
    const i = indexAt(e.clientX)
    setHover(i)
    if (drag.current && view !== 'learned') onScrub?.(i)
  }

  const toggle = (k: string) => setHidden((h) => {
    const next = new Set(h)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })

  const cursor = view !== 'learned' && month >= 0 && month < n ? x(Math.min(n - 1, month)) : null
  const tip = hover === null ? null : view === 'learned'
    ? (ledger[hover] ? { title: ledger[hover].date, rows: [{ label: 'Rows in the store', color: 'var(--live)', v: ledger[hover].rows }] } : null)
    : { title: monthLabel(months[hover]), rows: stack.layers.slice().reverse().map((l) => ({ label: l.label, color: l.color, v: l.y1[hover] - l.y0[hover] })) }

  return (
    <div className="gx-chart">
      <div className="gx-chart-head">
        <span className="eyebrow">Growth</span>
        <div className="seg" role="tablist" aria-label="Growth view">
          {(['total', 'monthly', 'learned'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => { setView(v); setHover(null) }}>
              {v === 'total' ? 'Total' : v === 'monthly' ? 'Per month' : 'When learned'}
            </button>
          ))}
        </div>
      </div>

      {view !== 'learned' && (
        <div className="gx-chart-legend">
          {legendRows.map((l) => (
            <button key={l.key} className={`chip press ${hidden.has(l.key) ? 'off' : ''}`} onClick={() => toggle(l.key)}
              aria-pressed={!hidden.has(l.key)} title={hidden.has(l.key) ? 'Show' : 'Hide'}>
              <i className="gx-sw" style={{ background: l.color }} />{l.label}<span className="mono muted">{fmtInt(l.total)}</span>
            </button>
          ))}
          {Object.keys(growth.undated).length > 0 && (
            <span className="mono muted gx-undated" title="Rows whose timestamp is missing or unreadable are counted but cannot be placed on a month">
              + {fmtInt(Object.values(growth.undated).reduce((a, b) => a + b, 0))} undated
            </span>
          )}
        </div>
      )}

      <div ref={box} className="gx-plot" onPointerMove={onMove} onPointerLeave={() => { setHover(null); drag.current = false }}
        onPointerDown={(e) => { drag.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); if (view !== 'learned') onScrub?.(indexAt(e.clientX)) }}
        onPointerUp={() => { drag.current = false }}>
        {(view === 'learned' ? ledger.length === 0 : n === 0) ? (
          <div className="empty gx-chart-empty">
            {view === 'learned' ? 'No write history yet — LanceDB records one version per write.' : 'Nothing dated in memory yet.'}
          </div>
        ) : (
          <svg width={w} height={H} role="img" aria-label={view === 'learned' ? 'Rows in the memory store per day' : 'Memories by source per month'}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className="gx-grid" />
                <text x={PAD.l - 8} y={y(t) + 3} className="gx-tick" textAnchor="end">{fmtInt(t)}</text>
              </g>
            ))}
            {view !== 'learned' && paths.map((l) => (
              <path key={l.key} d={l.d} fill={l.color} className="gx-area" />
            ))}
            {view !== 'learned' && years.filter((_, k) => k % yearStep === 0).map(([m, i]) => (
              <text key={m} x={x(i)} y={H - 6} className="gx-tick" textAnchor="middle">{m.slice(0, 4)}</text>
            ))}
            {view === 'learned' && (
              <>
                <path d={ledger.map((e, i) => `${i ? 'L' : 'M'}${lx(i)},${y(e.rows)}`).join('')} className="gx-line" />
                {ledger.length > 0 && <circle cx={lx(ledger.length - 1)} cy={y(ledger[ledger.length - 1].rows)} r={4} className="gx-dot" />}
                <text x={PAD.l} y={H - 6} className="gx-tick">{ledger[0]?.date}</text>
                <text x={w - PAD.r} y={H - 6} className="gx-tick" textAnchor="end">{ledger[ledger.length - 1]?.date}</text>
              </>
            )}
            {cursor !== null && (
              <g className="gx-cursor">
                <line x1={cursor} x2={cursor} y1={PAD.t - 4} y2={PAD.t + ih} />
              </g>
            )}
            {hover !== null && (
              <line x1={view === 'learned' ? lx(hover) : x(hover)} x2={view === 'learned' ? lx(hover) : x(hover)}
                y1={PAD.t} y2={PAD.t + ih} className="gx-cross" />
            )}
          </svg>
        )}
        {tip && (
          <div className="gx-tip glass-thin" style={{ left: Math.min(w - 190, Math.max(0, (view === 'learned' ? lx(hover!) : x(hover!)) + 12)) }}>
            <div className="mono">{tip.title}</div>
            {tip.rows.map((r) => (
              <div key={r.label} className="gx-tip-row"><i className="gx-sw" style={{ background: r.color }} />{r.label}<b>{fmtInt(r.v)}</b></div>
            ))}
          </div>
        )}
      </div>

      <details className="gx-table" onToggle={(e) => setTableOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="mono muted">Show as a table</summary>
        {!tableOpen ? null : view === 'learned' ? (
          <table><thead><tr><th>Day</th><th>Rows</th></tr></thead>
            <tbody>{ledger.slice(-14).reverse().map((e) => <tr key={e.date}><td>{e.date}</td><td>{fmtInt(e.rows)}</td></tr>)}</tbody></table>
        ) : (
          <table>
            <thead><tr><th>Month</th>{stack.layers.map((l) => <th key={l.key}>{l.label}</th>)}</tr></thead>
            <tbody>
              {months.map((m, i) => [m, i] as const).slice(-12).reverse().map(([m, i]) => (
                <tr key={m}><td>{monthLabel(m)}</td>{stack.layers.map((l) => <td key={l.key}>{fmtInt(l.y1[i] - l.y0[i])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  )
}
