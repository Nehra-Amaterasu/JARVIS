// Career / Abroad (spec 20.8.6, package T02): compare universities and courses abroad. Spec sheets (SpecTable, up to six columns, the
// first column sticky), a route map that is a diagram and not a geographic map, and a rack of requirements as hardware (RackChecklist).
// Every cell is a Readout: LIVE only when the student confirmed it from the university's own page and the day is stamped, otherwise
// WAITING "unconfirmed". The one figure verified from a page (VERIFIED_FACT) is quoted with its source and the day it was read; the
// list's own text for a university is shown only as "the list says", unconfirmed. Nothing is fetched: the one-click button opens the
// page and stamps today.
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useGame } from '../../../germoney/game/store'
import { TARGET_UNIVERSITIES, type University } from '../../../germoney/data/universities'
import { TRIALS } from '../../../germoney/game/trials'
import { Button, Chip, Drawer, Key } from '../../../shared/kit'
import { LampWord } from '../../left/LampWord'
import { RACK_BLOCKED_BY, RACK_ITEMS, SPEC_ROWS, compareColumns, eur, orderColumns, rackState, specKey, type RackId, type SpecRowId } from './model'
import { MAX_COLS, VERIFIED_FACT, cellRead, slug, stampText, useCareerLocal, type Cell, type CellRead } from './store'
import { ConfirmForm, Frame, Plate, Stamped, useKeys, useSim, useWidth, PHONE_BELOW } from './ui'

export interface UniCol { key: string; name: string; uni: University }
export const allUnis = (): UniCol[] => TARGET_UNIVERSITIES.map((u) => ({ key: slug(u.name), name: u.name, uni: u }))

/** What the old list says for a row, quoted only as unconfirmed text in the cell drawer. */
function listSays(u: University, row: SpecRowId): string | null {
  if (row === 'course') return u.program
  if (row === 'language') return u.language
  if (row === 'window') return u.intake
  if (row === 'exam') return u.prerequisites
  return null
}

export interface AbroadProps {
  today: string
  cells: Record<string, Cell>
  shortlist: string[]
  pinned: string | null
  done: Record<string, string>
  trialState: Record<string, { stage: number; examDate?: string }>
  onShortlist: (keys: string[]) => void
  onPin: (key: string | null) => void
  onConfirm: (key: string, value: string, on: string) => void
  onClear: (key: string) => void
  onRack: (key: string, on: string | null) => void
  onOpenPage: (uni: UniCol) => void
  onStage: (id: string, stage: number) => void
  onTrialDate: (id: string, date: string) => void
  width?: number
  initialDrawer?: string | null
  initialCompare?: boolean
  simulated?: boolean
  /** The universities to compare; the list the app already holds when not given. */
  unis?: UniCol[]
}

/** The finance row is the one figure with a page behind it: LIVE with its source and the day it was read. */
const financeRead = (): CellRead => ({ state: 'live', value: String(VERIFIED_FACT.amountEur), on: VERIFIED_FACT.checkedOn })

function readFor(cells: Record<string, Cell>, uni: string, row: SpecRowId): CellRead {
  if (row === 'finance') return financeRead()
  return cellRead(cells, specKey(uni, row))
}
const fmtFor = (row: SpecRowId) => (v: string) => (row === 'finance' ? eur(Number(v)) : v)

function Route({ cols, pinned, onPin }: { cols: UniCol[]; pinned: string | null; onPin: (k: string | null) => void }) {
  const slots = [[16, 40], [38, 22], [62, 30], [24, 74], [50, 70], [78, 66]]
  return (
    <div className="t2-route">
      <svg viewBox="0 0 300 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <polygon points="40,70 70,28 120,14 180,20 232,34 268,66 252,108 204,130 140,136 80,124 48,100" />
        <path d="M70 28 L204 130 M120 14 L252 108 M232 34 L80 124 M268 66 L48 100 M40 70 L180 20 M140 136 L180 20 M120 14 L140 136" />
        <ellipse cx="150" cy="75" rx="104" ry="36" />
      </svg>
      {cols.map((c, i) => {
        const [x, y] = slots[i % slots.length]
        return (
          <button key={c.key} type="button" className="t2-flag" style={{ left: `${x}%`, top: `${y}%` }} aria-pressed={pinned === c.key} onClick={() => onPin(pinned === c.key ? null : c.key)} aria-label={`${c.name}: ${pinned === c.key ? 'pinned' : 'pin this column'}`}>
            <i aria-hidden="true" />
            <span>{c.name}</span>
          </button>
        )
      })}
      {cols.length === 0 && <p className="t2-quiet t2-route-empty">No university shortlisted yet.</p>}
    </div>
  )
}

export function AbroadView(p: AbroadProps) {
  const [rootRef, w] = useWidth<HTMLDivElement>(p.width)
  const phone = w < PHONE_BELOW
  const all = useMemo(() => p.unis ?? allUnis(), [p.unis])
  // With nothing chosen the first four of the list are shown so the page is not empty, and every label says so: "chosen" counts p.shortlist
  const noneChosen = p.shortlist.length === 0
  const chosen = noneChosen ? all.slice(0, 4).map((c) => c.key) : p.shortlist
  const [compare, setCompare] = useState(!!p.initialCompare)
  const ordered = orderColumns(chosen, p.pinned)
  const shown = compare ? compareColumns(ordered, p.pinned) : ordered
  const cols = shown.map((k) => all.find((c) => c.key === k)).filter((c): c is UniCol => !!c)
  const [drawer, setDrawer] = useState<string | null>(p.initialDrawer ?? null)
  const [hotRow, setHotRow] = useState<string | null>(null)
  const [at, setAt] = useState<[number, number]>([0, 0])
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const rackUni = p.pinned && chosen.includes(p.pinned) ? p.pinned : cols[0]?.key ?? null
  const rackCol = all.find((c) => c.key === rackUni) ?? null
  useKeys({ c: () => setCompare((v) => !v) })
  const sim = useSim()

  const focusCell = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(SPEC_ROWS.length - 1, r))
    const cc = Math.max(0, Math.min(cols.length - 1, c))
    setAt([rr, cc])
    cellRefs.current[`${rr}:${cc}`]?.focus()
  }
  const onCellKey = (e: KeyboardEvent, r: number, c: number) => {
    const d: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }
    if (d[e.key]) { e.preventDefault(); focusCell(r + d[e.key][0], c + d[e.key][1]) }
    else if (e.key === 'Enter') { e.preventDefault(); setDrawer(`cell:${cols[c].key}:${SPEC_ROWS[r].id}`) }
  }

  const cellDrawer = drawer?.startsWith('cell:') ? drawer.split(':') : null
  const dCol = cellDrawer ? all.find((c) => c.key === cellDrawer[1]) ?? null : null
  const dRow = cellDrawer ? SPEC_ROWS.find((r) => r.id === cellDrawer[2]) ?? null : null
  // the roving tab stop is clamped at render: Compare or a removed university shrinks the columns, and the grid must keep one tab stop
  const tabRow = Math.max(0, Math.min(at[0], SPEC_ROWS.length - 1))
  const tabCol = Math.max(0, Math.min(at[1], cols.length - 1))
  // LIVE only when a cell this sheet shows (a university's own cell, not the national finance figure) is confirmed
  const lampWhole = cols.some((c) => SPEC_ROWS.some((r) => r.id !== 'finance' && cellRead(p.cells, specKey(c.key, r.id)).state === 'live')) ? 'live' : 'waiting'

  const renderCell = (c: UniCol, row: (typeof SPEC_ROWS)[number], r: number, ci: number, grid: boolean) => {
    const read = readFor(p.cells, c.key, row.id)
    const national = row.id === 'finance'
    const label = `${row.label}${national ? ' (national figure, all columns)' : ''}, ${c.name}: ${read.state === 'live' ? `${fmtFor(row.id)(read.value)}, LIVE, checked ${stampText(read.on ?? '')}` : 'WAITING, unconfirmed'}. Enter to confirm`
    const open = () => { setAt([r, ci]); setDrawer(`cell:${c.key}:${row.id}`) }
    return (
      <div
        key={`${c.key}:${row.id}`} role={grid ? 'gridcell' : 'button'} tabIndex={grid ? (tabRow === r && tabCol === ci ? 0 : -1) : 0} className="t2-gcell" data-hot={hotRow === row.id ? 'true' : undefined}
        ref={(el) => { cellRefs.current[`${r}:${ci}`] = el }}
        aria-label={label}
        onKeyDown={(e) => { if (grid) onCellKey(e, r, ci); else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }} onClick={open}
        onMouseEnter={() => setHotRow(row.id)} onMouseLeave={() => setHotRow(null)} onFocus={() => setHotRow(row.id)} onBlur={() => setHotRow(null)}
      >
        <Stamped label={`${row.label}, ${c.name}`} read={read} fmt={fmtFor(row.id)} />
      </div>
    )
  }

  const anyDone = !!rackCol && RACK_ITEMS.some((it) => p.done[`${rackCol.key}:${it.id}`])

  const rack = (
    <Plate id="rack" label="RACK" state={anyDone ? 'live' : 'waiting'} reason={rackCol ? (anyDone ? 'your own keys, per university' : 'no key marked done yet') : 'shortlist a university'} className="t2-rackplate">
      {rackCol ? (
        <>
          <p className="t2-rack-for">For <b>{rackCol.name}</b></p>
          <ul className="t2-rack" aria-label={`Requirements for ${rackCol.name}`}>
            {RACK_ITEMS.map((it) => {
              const st = rackState(it.id as RackId, p.done, rackCol.key)
              const on = st === 'on'
              const need = RACK_BLOCKED_BY[it.id as RackId] ?? []
              const wait = need.filter((n) => !p.done[`${rackCol.key}:${n}`]).map((n) => RACK_ITEMS.find((x) => x.id === n)!.label)
              return (
                <li key={it.id} data-rack={st}>
                  <Key
                    label={`${it.label}: ${on ? 'done, press to undo' : st === 'blocked' ? 'blocked' : 'not done, press to mark done'}`} pressed={on}
                    disabledReason={st === 'blocked' ? `after ${wait.join(' and ')}` : undefined}
                    icon={<span className="t2-keyglyph" aria-hidden="true">{on ? '✓' : st === 'blocked' ? '–' : ''}</span>}
                    onPress={() => p.onRack(`${rackCol.key}:${it.id}`, on ? null : p.today)}
                  />
                  <span className="t2-rack-name"><b>{it.label}</b>
                    <small>{on && <><LampWord state={sim ? 'simulated' : 'live'} />{' '}</>}{on ? `done ${stampText(p.done[`${rackCol.key}:${it.id}`])}` : st === 'blocked' ? `after ${wait.join(' and ')}` : 'not done'}</small>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="t2-quiet"><LampWord state="planned" /> Study and Life blocks from a requirement</p>
        </>
      ) : <p className="t2-quiet">Shortlist a university to see its requirements.</p>}
    </Plate>
  )

  const keys = (
    <>
      <Button size="lg" onClick={() => setDrawer('trials')}>Exams and documents</Button>
      <Button size="lg" onClick={() => setDrawer('shortlist')}>Shortlist</Button>
      <Button size="lg" aria-pressed={compare} onClick={() => setCompare((v) => !v)}>{compare ? 'Show all' : 'Compare two'} (C)</Button>
    </>
  )

  return (
    <Frame
      simulated={p.simulated} view="abroad" ruler="ABROAD" title="Abroad" form={phone ? 'phone' : 'desk'} rootRef={rootRef} state={lampWhole}
      sub={<>{cols.length} universit{cols.length === 1 ? 'y' : 'ies'} side by side{noneChosen ? ' (the first four from the list, none chosen yet)' : ''}. A university's cell is LIVE only after you confirm it from its own page. Proof of finances is one national figure, the same in every column.</>}
      keys={keys}
      extra={
        <>
          <Drawer open={!!cellDrawer && !!dCol && !!dRow && dRow.id !== 'finance'} onClose={() => setDrawer(null)} title={dCol && dRow ? `${dRow.label}, ${dCol.name}` : 'Cell'} className="t2-drawer">
            {dCol && dRow && dRow.id !== 'finance' && (
              dRow.id === 'checked' ? (
                <div className="t2-form">
                  <Stamped label="Page checked on" read={cellRead(p.cells, specKey(dCol.key, 'checked'))} />
                  <p className="t2-quiet">The button opens the university's page in your browser and stamps today. Nothing is fetched or read for you; you read the page and confirm each cell.</p>
                  <Button size="lg" tone="primary" onClick={() => p.onOpenPage(dCol)}>Open the page and stamp today</Button>
                  {cellRead(p.cells, specKey(dCol.key, 'checked')).state === 'live' && <Button size="md" onClick={() => p.onClear(specKey(dCol.key, 'checked'))}>Take the stamp off</Button>}
                </div>
              ) : (
                <ConfirmForm
                  key={`${dCol.key}:${dRow.id}`} label={dRow.label} read={cellRead(p.cells, specKey(dCol.key, dRow.id))} today={p.today}
                  bank={listSays(dCol.uni, dRow.id)}
                  onSave={(v, on) => p.onConfirm(specKey(dCol.key, dRow.id), v, on)} onClear={() => p.onClear(specKey(dCol.key, dRow.id))}
                />
              )
            )}
          </Drawer>
          <Drawer open={drawer === 'shortlist'} onClose={() => setDrawer(null)} title="Shortlist" className="t2-drawer">
            <div className="t2-form">
              <p className="t2-quiet">Up to {MAX_COLS} universities, each one a column. {p.shortlist.length} chosen{noneChosen ? '; the sheet shows the first four from the list until you choose' : ''}.</p>
              <div className="t2-chips" role="group" aria-label="Universities">
                {all.map((c) => (
                  <Chip key={c.key} grouped selected={p.shortlist.includes(c.key)} onClick={() => p.onShortlist(p.shortlist.includes(c.key) ? p.shortlist.filter((k) => k !== c.key) : p.shortlist.length < MAX_COLS ? [...p.shortlist, c.key] : p.shortlist)}>{c.name}</Chip>
                ))}
              </div>
            </div>
          </Drawer>
          <TrialsDrawer open={drawer === 'trials'} onClose={() => setDrawer(null)} today={p.today} cells={p.cells} trialState={p.trialState} onStage={p.onStage} onDate={p.onTrialDate} onConfirm={p.onConfirm} onClear={p.onClear} />
        </>
      }
    >
      <div className="t2-abroad">
        <Plate id="spec" label="SPEC SHEETS" state={lampWhole} reason={compare ? 'two columns, compare' : noneChosen ? 'first four from the list, none chosen yet' : 'the pinned column first'} className="t2-specplate" corner={<Button size="md" onClick={() => window.open(VERIFIED_FACT.source, '_blank', 'noopener')}>Open the source</Button>}>
          {cols.length === 0 ? <p className="t2-quiet">No university shortlisted. Open Shortlist to choose up to {MAX_COLS}.</p> : phone ? (
            <div className="t2-cards">
              {cols.map((c, ci) => (
                <section key={c.key} className="t2-ucard" aria-label={c.name}>
                  <h3>{c.name}</h3>
                  <dl>
                    {SPEC_ROWS.map((row, r) => <div key={row.id}><dt>{row.label}{row.id === 'finance' ? ' (national figure, all columns)' : ''}</dt><dd>{renderCell(c, row, r, ci, false)}</dd></div>)}
                  </dl>
                </section>
              ))}
            </div>
          ) : (
            <div className="t2-grid" role="grid" aria-label="Spec sheets" aria-rowcount={SPEC_ROWS.length + 1} style={{ ['--cols' as string]: cols.length }}>
              <div role="row" className="t2-grow t2-ghead">
                <span role="columnheader" className="t2-rowhead" />
                {cols.map((c) => (
                  <span key={c.key} role="columnheader" className="t2-colhead">
                    <button type="button" aria-pressed={p.pinned === c.key} aria-label={`${c.name}: ${p.pinned === c.key ? 'pinned, press to unpin' : 'pin this column'}`} onClick={() => p.onPin(p.pinned === c.key ? null : c.key)} data-pinned={p.pinned === c.key ? 'true' : undefined}>{c.name}</button>
                  </span>
                ))}
              </div>
              {SPEC_ROWS.map((row, r) => (
                <div role="row" key={row.id} className="t2-grow" data-hot={hotRow === row.id ? 'true' : undefined} aria-rowindex={r + 2}>
                  <span role="rowheader" className="t2-rowhead">{row.label}{row.id === 'finance' && <small> national figure, all columns</small>}</span>
                  {cols.map((c, ci) => renderCell(c, row, r, ci, true))}
                </div>
              ))}
            </div>
          )}
          <p className="t2-source">Proof of finances: {eur(VERIFIED_FACT.amountEur)} a year, opened and read on {stampText(VERIFIED_FACT.checkedOn)}: {VERIFIED_FACT.source}. The page gave no language level and no semester fee.</p>
        </Plate>
        <div className="t2-right">
          <Plate id="route" label="ROUTE MAP" state="live" reason={noneChosen ? 'a diagram of the first four from the list, none chosen: no street data, no live position' : 'a diagram of your shortlist: no street data, no live position'} className="t2-routeplate">
            <Route cols={cols} pinned={p.pinned} onPin={p.onPin} />
          </Plate>
          {rack}
        </div>
      </div>
    </Frame>
  )
}

function TrialsDrawer({ open, onClose, today, cells, trialState, onStage, onDate, onConfirm, onClear }: { open: boolean; onClose: () => void; today: string; cells: Record<string, Cell>; trialState: AbroadProps['trialState']; onStage: AbroadProps['onStage']; onDate: AbroadProps['onTrialDate']; onConfirm: AbroadProps['onConfirm']; onClear: AbroadProps['onClear'] }) {
  return (
    <Drawer open={open} onClose={onClose} title="Exams and documents" className="t2-drawer">
      <div className="t2-form">
        <p className="t2-quiet">Fees and dates change: confirm each from the official page. The list's price is quoted as unconfirmed; confirm a fee on Money.</p>
        {TRIALS.map((t) => {
          const st = trialState[t.id]
          const stage = st?.stage ?? -1
          const dateKey = `trial:${t.id}:date`
          const read = cellRead(cells, dateKey)
          return (
            <div key={t.id} className="t2-trial" data-trial={t.id}>
              <b>{t.name}</b>
              <span className="t2-quiet">{t.issuer}. {t.kind}{t.cost ? `. The list says ${t.cost.currency === 'EUR' ? eur(t.cost.amount) : `₹${t.cost.amount.toLocaleString('en-IN')}`}, checked ${stampText(t.cost.asOf)}: unconfirmed` : '. No fee in the list: check the page'}</span>
              <div className="t2-chips" role="group" aria-label={`${t.name} progress`}>
                {t.stages.map((s, i) => <Chip key={s} grouped selected={i <= stage} onClick={() => onStage(t.id, i === stage ? i - 1 : i)}>{s}</Chip>)}
              </div>
              <ConfirmForm
                key={t.id + read.state} label={`Exam or deadline date of ${t.name}`} kind="date" read={read} today={today}
                hint="As the official page says. A date counts as checked only with the day you read it."
                onSave={(v, on) => { onConfirm(dateKey, v, on); onDate(t.id, v) }} onClear={() => { onClear(dateKey); onDate(t.id, '') }}
              />
            </div>
          )
        })}
      </div>
    </Drawer>
  )
}

export default function Abroad() {
  const today = useGame((s) => s.today)
  const trials = useGame((s) => s.g.trials)
  const setStage = useGame((s) => s.setTrialStage)
  const setDate = useGame((s) => s.setTrialDate)
  const cells = useCareerLocal((s) => s.cells)
  const shortlist = useCareerLocal((s) => s.shortlist)
  const pinned = useCareerLocal((s) => s.pinned)
  const done = useCareerLocal((s) => s.done)
  const confirmCell = useCareerLocal((s) => s.confirmCell)
  const clearCell = useCareerLocal((s) => s.clearCell)
  const setDone = useCareerLocal((s) => s.setDone)
  const setShortlist = useCareerLocal((s) => s.setShortlist)
  const pin = useCareerLocal((s) => s.pin)
  const state = useMemo(() => Object.fromEntries(Object.entries(trials).map(([k, v]) => [k, { stage: v.stage, examDate: v.examDate }])), [trials])
  return (
    <AbroadView
      today={today} cells={cells} shortlist={shortlist} pinned={pinned} done={done} trialState={state}
      onShortlist={setShortlist} onPin={pin}
      onConfirm={confirmCell} onClear={clearCell} onRack={setDone}
      onOpenPage={(c) => { window.open(c.uni.portalUrl, '_blank', 'noopener'); confirmCell(specKey(c.key, 'checked'), 'page opened', useGame.getState().today) }}
      onStage={setStage}
      onTrialDate={setDate}
    />
  )
}
