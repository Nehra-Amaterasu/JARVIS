// Career / Money (spec 20.8.6, package T02): the plan for funding study abroad and the nearer costs. Rupees and euros sit in separate
// columns; the conversion is a rate the student types and stamps with its day. A funding bridge draws each source the student states
// as a span and the total of the fees they have confirmed as the far bank; a gap is a visible gap with its amount, and with no
// confirmed fee the bridge says UNKNOWN, never zero. No advice, no interest rate stated as a fact, no promise of a scholarship: a
// scholarship is a row the student found and typed, and its deadline goes to the Runway.
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { useGame } from '../../../germoney/game/store'
import { usePlan } from '../../../germoney/game/plan'
import { FUNDING_PATHS } from '../../../germoney/game/trials'
import { dateKey } from '../../../germoney/game/util'
import { Button, Drawer, Field, IconButton, PrimaryButton } from '../../../shared/kit'
import { paginate } from '../model'
import { bridge, costItems, costKey, costRows, eur, rateRead, rupees, totals, type CostItem, type CostRow, type RateRead, type Span } from './model'
import { stampText, useCareerLocal, type Cell, type CellRead, type FundingKind, type FundingSource } from './store'
import { LampWord } from '../../left/LampWord'
import { ConfirmForm, Frame, Plate, Stamped, useSim, useWidth, PHONE_BELOW } from './ui'
import { lookV3Enabled, useViewChrome, type ViewChromeSpec } from '../../../shell/v3'

const PAGE = 5
const KIND_WORD: Record<FundingKind, string> = { family: 'A family contribution you state', scholarship: 'A scholarship you found', work: 'Part-time work you plan', loan: 'A loan you state' }

export interface MoneyProps {
  today: string
  cells: Record<string, Cell>
  rate: RateRead & { source: string }
  saved: { inr: number; on: string | null }
  custom: { id: string; label: string; inr: number; due: string }[]
  funding: FundingSource[]
  onConfirmCost: (id: string, value: string, on: string) => void
  onClearCost: (id: string) => void
  onRate: (value: number, on: string, source: string) => void
  onLog: (amount: number, note: string) => void
  onAddCost: (c: { label: string; inr: number; due: string }) => void
  onRemoveCost: (id: string) => void
  onAddFunding: (f: FundingSource) => void
  onRemoveFunding: (id: string) => void
  width?: number
  initialDrawer?: 'log' | 'source' | 'paths' | string | null
  simulated?: boolean
  /** The cost lines; the list the app already holds (plus the student's own) when not given. */
  items?: CostItem[]
}

const rateCell = (r: RateRead & { source: string }): CellRead => (r.live && r.value ? { state: 'live', value: String(r.value), on: r.on } : { state: 'waiting', value: '', on: null })

/** The rupee cell of a euro row is derived: LIVE only with a confirmed fee and a typed, stamped rate, and it is stamped with the rate's day. */
function inrRead(r: CostRow, rate: RateRead): CellRead {
  if (r.inr === null) return { state: 'waiting', value: '', on: null }
  return r.cur === 'INR' ? r.read : { state: 'live', value: rupees(r.inr), on: rate.on }
}

function Bridge({ spans, cost, savedWaiting, unconfirmed, needsRate, onRemove }: { spans: Span[]; cost: number | null; savedWaiting: boolean; unconfirmed: number; needsRate: number; onRemove: (id: string) => void }) {
  const b = bridge(spans, cost)
  const sim = useSim()
  const scale = Math.max(b.covered, b.cost ?? 0, 1)
  const letters = 'ABCDEFGHIJ'
  // while any fee is unconfirmed the total is only the confirmed fees, so a shortfall is a lower bound and is never called "Gap"
  const partial = unconfirmed > 0 || needsRate > 0
  return (
    <div className="t2-bridge" data-bridge={b.state}>
      <div className="t2-deck" role="img" aria-label={b.state === 'unknown' ? `The bridge: ${rupees(b.covered)} stated, no confirmed cost yet` : `The bridge: ${rupees(b.covered)} covers ${rupees(b.cost ?? 0)}${b.gap ? `, ${partial ? 'a gap so far, on confirmed fees only, of' : 'a gap of'} ${rupees(b.gap)}` : ''}`}>
        {spans.map((s, i) => (
          <span key={s.id} className="t2-span" data-kind={s.kind} style={{ width: `${(s.inr / scale) * 100}%` }}><b>{letters[i]}</b></span>
        ))}
        {b.gap ? <span className="t2-span t2-gap" style={{ width: `${(b.gap / scale) * 100}%` }}><b>{partial ? 'gap so far' : 'gap'}</b></span> : null}
        {b.state === 'unknown' && <span className="t2-span t2-gap t2-unknown"><b>cost unknown</b></span>}
        <span className="t2-bank" aria-hidden="true" />
      </div>
      <p className="t2-bridge-read" role="status">
        {b.state === 'unknown' ? 'Far bank: UNKNOWN. No fee is confirmed yet, so there is no total to bridge to.' : b.state === 'covered' ? `The spans cover the far bank of ${rupees(b.cost ?? 0)}.` : `Far bank ${rupees(b.cost ?? 0)}. The spans cover ${rupees(b.covered)}. ${partial ? 'Gap so far, on confirmed fees only' : 'Gap'}: ${rupees(b.gap ?? 0)}.`}
        {b.state === 'gap' && partial && <> <LampWord state="waiting" /></>}
        {unconfirmed > 0 ? ` ${unconfirmed} fee${unconfirmed === 1 ? ' is' : 's are'} unconfirmed and not in the total.` : ''}
        {needsRate > 0 ? ` ${needsRate} euro fee${needsRate === 1 ? ' needs' : 's need'} the typed rate.` : ''}
      </p>
      <ul className="t2-legend" aria-label="Spans of the bridge">
        {spans.map((s, i) => (
          <li key={s.id}>
            <b>{letters[i]}</b>
            <span>{s.label}</span>
            <output>{rupees(s.inr)}</output>
            <small>{sim ? 'SIMULATED' : 'LIVE'}, stated {stampText(s.on)}</small>
            {s.kind !== 'savings' && <IconButton label={`Remove ${s.label}`} size="md" onClick={() => onRemove(s.id)}><Trash2 size={16} aria-hidden="true" /></IconButton>}
          </li>
        ))}
        {savedWaiting && <li data-waiting="true"><b>-</b><span>Savings</span><output>--</output><small>WAITING: nothing logged yet</small></li>}
        {spans.length === 0 && !savedWaiting && <li className="t2-quiet">No source stated yet.</li>}
      </ul>
    </div>
  )
}

export function MoneyView(p: MoneyProps) {
  const [rootRef, w] = useWidth<HTMLDivElement>(p.width)
  const phone = w < PHONE_BELOW
  const [drawer, setDrawer] = useState<string | null>(p.initialDrawer ?? null)
  const [page, setPage] = useState(0)
  const items = useMemo(() => p.items ?? costItems(p.custom), [p.items, p.custom])
  const rate: RateRead = { value: p.rate.value, on: p.rate.on, live: p.rate.live }
  const rows = useMemo(() => costRows(items, p.cells, rate), [items, p.cells, rate.value, rate.on, rate.live]) // eslint-disable-line react-hooks/exhaustive-deps
  const tot = totals(rows)
  const spans: Span[] = [
    ...(p.saved.inr > 0 && p.saved.on ? [{ id: 'savings', label: 'Savings you logged', inr: p.saved.inr, on: p.saved.on, kind: 'savings' as const }] : []),
    ...p.funding.map((f) => ({ id: f.id, label: f.label, inr: f.inr, on: f.on, kind: f.kind })),
  ]
  const pg = paginate(rows, page, PAGE)
  const open = drawer && drawer.startsWith('cost:') ? rows.find((r) => r.id === drawer.slice(5)) ?? null : null
  const pager = pg.pages > 1 ? (
    <nav className="t2-pager" aria-label="Costs, pages">
      <IconButton label="Previous costs" size="md" aria-disabled={pg.page === 0} onClick={() => pg.page > 0 && setPage(pg.page - 1)}><ChevronLeft size={18} aria-hidden="true" /></IconButton>
      <span role="status" aria-live="polite">{pg.from} to {pg.to} of {pg.total}</span>
      <IconButton label="Next costs" size="md" aria-disabled={pg.page >= pg.pages - 1} onClick={() => pg.page < pg.pages - 1 && setPage(pg.page + 1)}><ChevronRight size={18} aria-hidden="true" /></IconButton>
    </nav>
  ) : null
  const bridgeState = tot.counted === 0 ? 'waiting' : 'live'
  const v3 = lookV3Enabled()
  // the two keys used less than weekly sit behind More (rule 4.7); the accent key, Add a source, stays in the first tray
  const chrome = useMemo<ViewChromeSpec | null>(() => (v3 ? { more: [
    { id: 'paths', label: 'Paths to research', onSelect: () => setDrawer('paths') },
    { id: 'log', label: 'Log money', onSelect: () => setDrawer('log') },
  ] } : null), [v3])
  useViewChrome(chrome)
  const bridgePlate = (
    <Plate id="bridge" label="FUNDING BRIDGE" state={tot.counted === 0 ? 'waiting' : 'live'} reason={tot.counted === 0 ? 'no confirmed fee yet' : `${tot.counted} confirmed fee${tot.counted === 1 ? '' : 's'} to bridge to`} className="t2-bridgeplate">
      <Bridge spans={spans} cost={tot.counted > 0 ? tot.inr : null} savedWaiting={p.saved.on === null} unconfirmed={tot.unconfirmed} needsRate={tot.needsRate} onRemove={p.onRemoveFunding} />
    </Plate>
  )
  const assumePlate = (
    <Plate id="assume" label="ASSUMPTIONS" state={rate.live ? 'live' : 'waiting'} reason={rate.live ? 'your typed rate' : 'type the rate'} className="t2-assumeplate">
      <RateForm key={`${p.rate.on}-${p.rate.value}`} today={p.today} rate={p.rate} onSave={p.onRate} />
    </Plate>
  )
  const ledgerPlate = (
    <Plate id="ledger" label="LEDGER" state={tot.counted === 0 ? 'waiting' : 'live'} reason="euros and rupees apart" className="t2-ledgerplate" corner={pager}>
      <div className="t2-ledgerhead" aria-hidden="true"><span>Due</span><span>Item</span><span>Euros</span><span>Rupees</span><span /></div>
      <ul className="t2-ledger" aria-label="Costs">
        {pg.rows.map((r) => (
          <li key={r.id} className="t2-lrow" data-cost={r.id}>
            <span className="t2-when">{r.due}</span>
            <b className="t2-lname">{r.label}</b>
            {r.cur === 'EUR' ? <Stamped label={`${r.label}, euros`} read={r.read} fmt={(v) => eur(Number(v))} className="t2-lcell" /> : <span className="t2-na" aria-label={`${r.label}: no euro figure`}>no euro figure</span>}
            <Stamped label={`${r.label}, rupees`} read={inrRead(r, rate)} fmt={(v) => (r.cur === 'INR' ? rupees(Number(v)) : v)} why={r.cur === 'EUR' ? (r.amount === null ? 'unconfirmed' : 'needs the typed rate') : 'unconfirmed'} className="t2-lcell" />
            <span className="t2-lkeys">
              <Button size="md" aria-label={`Confirm the fee of ${r.label}`} onClick={() => setDrawer(`cost:${r.id}`)}>Confirm</Button>
              {r.custom && <IconButton label={`Remove ${r.label}`} size="md" onClick={() => p.onRemoveCost(r.id)}><Trash2 size={16} aria-hidden="true" /></IconButton>}
            </span>
          </li>
        ))}
      </ul>
    </Plate>
  )

  return (
    <Frame
      simulated={p.simulated} view="money" ruler="MONEY" title="Money" form={phone ? 'phone' : 'desk'} rootRef={rootRef} state={bridgeState}
      sub={<>What studying abroad costs, in rupees and euros apart. Press Add a source to say how it is paid for. A fee counts once you confirm it. {rate.live ? `Rate ${rate.value}, checked ${stampText(rate.on!)}.` : 'No rate typed yet.'}</>}
      v3={{ ratio: [1.2, 1.5, 0.85], trays: [
        { job: 'BRIDGE', node: bridgePlate, peek: { name: 'Costs', lamp: bridgeState, note: tot.counted === 0 ? 'no confirmed fee yet' : undefined } },
        { job: 'COSTS', node: ledgerPlate, peek: { name: 'Costs' } },
        { job: 'RATE', node: assumePlate, peek: { name: 'Rate', lamp: rate.live ? 'live' : 'waiting', note: rate.live ? undefined : 'type the rate' } },
      ] }}
      keys={
        <>
          {!v3 && <Button size="lg" onClick={() => setDrawer('paths')}>Paths to research</Button>}
          {!v3 && <Button size="lg" onClick={() => setDrawer('log')}>Log money</Button>}
          <PrimaryButton claimId="career-money-source" rank="workspace" size="lg" onClick={() => setDrawer('source')}>Add a source</PrimaryButton>
        </>
      }
      extra={
        <>
          <LogDrawer open={drawer === 'log'} onClose={() => setDrawer(null)} onLog={p.onLog} onAddCost={p.onAddCost} />
          <SourceDrawer open={drawer === 'source'} onClose={() => setDrawer(null)} today={p.today} onAdd={p.onAddFunding} />
          <Drawer open={drawer === 'paths'} onClose={() => setDrawer(null)} title="Paths to research" className="t2-drawer">
            <div className="t2-form">
              <p className="t2-quiet">These are things to look into, not advice. Nothing here is a promise, and no rate or award is claimed.</p>
              {FUNDING_PATHS.map((f) => <p key={f.label} className="t2-path-note"><b>{f.label}</b><span>{f.note}</span></p>)}
            </div>
          </Drawer>
          <Drawer open={!!open} onClose={() => setDrawer(null)} title={open ? open.label : 'Fee'} className="t2-drawer">
            {open && (
              <ConfirmForm
                key={open.id + open.read.state} label={open.cur === 'EUR' ? 'Fee in euros' : 'Fee in rupees'} read={open.read} today={p.today} kind="number"
                bank={open.bank !== null && !open.custom ? `${open.cur === 'EUR' ? eur(open.bank) : rupees(open.bank)}${open.asOf ? `, checked ${stampText(open.asOf)}` : ''}, a figure from the list` : open.bank !== null ? `${rupees(open.bank)}, your own estimate` : null}
                hint="As the fee's own page says; verify before paying."
                onSave={(v, on) => p.onConfirmCost(open.id, v, on)} onClear={() => p.onClearCost(open.id)}
              />
            )}
          </Drawer>
        </>
      }
    >
      <div className="t2-money">
        {bridgePlate}
        {ledgerPlate}
        {assumePlate}
      </div>
    </Frame>
  )
}

function RateForm({ today, rate, onSave }: { today: string; rate: RateRead & { source: string }; onSave: MoneyProps['onRate'] }) {
  const [value, setValue] = useState(rate.value ? String(rate.value) : '')
  const [on, setOn] = useState(rate.on ?? today)
  const [source, setSource] = useState(rate.source)
  return (
    <div className="t2-rate">
      <Stamped label="Rupees per euro" read={rateCell(rate)} fmt={(v) => `₹${v} to €1`} why="type today's rate" />
      <div className="t2-rate-fields">
        <Field label="Rupees per euro" kind="number" value={value} onChange={(e) => setValue(e.target.value)} />
        <Field label="Day you checked it" kind="date" value={on} onChange={(e) => setOn(e.target.value)} />
        <Field label="Where you read it" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      <Button size="md" disabledReason={Number(value) > 0 && on ? undefined : 'Type the rate and the day'} onClick={() => onSave(Number(value), on, source.trim())}>Save the rate</Button>
    </div>
  )
}

function LogDrawer({ open, onClose, onLog, onAddCost }: { open: boolean; onClose: () => void; onLog: MoneyProps['onLog']; onAddCost: MoneyProps['onAddCost'] }) {
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const [nc, setNc] = useState({ label: '', inr: '', due: '' })
  return (
    <Drawer open={open} onClose={onClose} title="Log money" className="t2-drawer">
      <div className="t2-form">
        <Field label="Amount saved, in rupees" kind="number" value={amt} onChange={(e) => setAmt(e.target.value)} hint="A minus sign withdraws." />
        <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} hint="Salary, a gift, tutoring." />
        <Button tone="primary" size="lg" disabledReason={Number(amt) ? undefined : 'Type an amount'} onClick={() => { onLog(Number(amt), note); setAmt(''); setNote(''); onClose() }}>Log savings</Button>
        <Field label="A cost to add" value={nc.label} onChange={(e) => setNc({ ...nc, label: e.target.value })} hint="A flight, a deposit." />
        <Field label="Cost in rupees" kind="number" value={nc.inr} onChange={(e) => setNc({ ...nc, inr: e.target.value })} />
        <Field label="Due month" kind="date" value={nc.due ? `${nc.due}-01` : ''} onChange={(e) => setNc({ ...nc, due: e.target.value.slice(0, 7) })} />
        <Button size="lg" disabledReason={nc.label && Number(nc.inr) && nc.due ? undefined : 'Fill all three'} onClick={() => { onAddCost({ label: nc.label, inr: Number(nc.inr), due: nc.due }); setNc({ label: '', inr: '', due: '' }); onClose() }}>Add cost</Button>
      </div>
    </Drawer>
  )
}

function SourceDrawer({ open, onClose, today, onAdd }: { open: boolean; onClose: () => void; today: string; onAdd: (f: FundingSource) => void }) {
  const [kind, setKind] = useState<FundingKind>('family')
  const [label, setLabel] = useState('')
  const [amt, setAmt] = useState('')
  const [deadline, setDeadline] = useState('')
  return (
    <Drawer open={open} onClose={onClose} title="Add a source" className="t2-drawer">
      <div className="t2-form">
        <p className="t2-quiet">{KIND_WORD[kind]}. You type the amount; nothing is looked up, no rate is claimed and nothing here is a promise.</p>
        <Field label="Kind" kind="select" value={kind} onChange={(e) => setKind(e.target.value as FundingKind)}>
          {(Object.keys(KIND_WORD) as FundingKind[]).map((k) => <option key={k} value={k}>{KIND_WORD[k]}</option>)}
        </Field>
        <Field label="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Field label="Amount, in rupees" kind="number" value={amt} onChange={(e) => setAmt(e.target.value)} />
        {kind === 'scholarship' && <Field label="Its deadline" kind="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} hint="It goes to the Runway as a row." />}
        <Button tone="primary" size="lg" disabledReason={label.trim() && Number(amt) > 0 ? undefined : 'Type a name and an amount'} onClick={() => { onAdd({ id: `f-${Date.now().toString(36)}`, label: label.trim(), kind, inr: Number(amt), on: today, deadline: kind === 'scholarship' && deadline ? deadline : undefined }); setLabel(''); setAmt(''); setDeadline(''); onClose() }}>Add the source</Button>
      </div>
    </Drawer>
  )
}

export default function Money() {
  const today = useGame((s) => s.today)
  const warChest = useGame((s) => s.g.warChest)
  const inrPerEur = useGame((s) => s.g.settings.inrPerEur)
  const addSavings = useGame((s) => s.addSavings)
  const setCustom = useGame((s) => s.setCustomCost)
  const setSettings = useGame((s) => s.setSettings)
  const upsert = usePlan((s) => s.upsertApp)
  const cells = useCareerLocal((s) => s.cells)
  const rateLocal = useCareerLocal((s) => s.rate)
  const funding = useCareerLocal((s) => s.funding)
  const confirmCell = useCareerLocal((s) => s.confirmCell)
  const clearCell = useCareerLocal((s) => s.clearCell)
  const setRate = useCareerLocal((s) => s.setRate)
  const addFunding = useCareerLocal((s) => s.addFunding)
  const removeFunding = useCareerLocal((s) => s.removeFunding)
  const lastLog = warChest.log.length ? dateKey(new Date(warChest.log[warChest.log.length - 1].t)) : null
  const rr = rateRead(inrPerEur, rateLocal.on)
  return (
    <MoneyView
      today={today} cells={cells} rate={{ ...rr, source: rateLocal.source }}
      saved={{ inr: warChest.saved, on: lastLog }} custom={warChest.custom} funding={funding}
      onConfirmCost={(id, v, on) => confirmCell(costKey(id), v, on)} onClearCost={(id) => clearCell(costKey(id))}
      onRate={(v, on, source) => { setSettings({ inrPerEur: Math.max(1, v) }); setRate(on, source) }}
      onLog={(a, n) => addSavings(a, n)}
      onAddCost={(c) => { const id = `c-${Date.now().toString(36)}`; setCustom({ id, label: c.label, inr: c.inr, due: c.due }); confirmCell(costKey(id), String(c.inr), useGame.getState().today) }}
      onRemoveCost={(id) => { setCustom(null, id); clearCell(costKey(id)) }}
      onAddFunding={(f) => {
        addFunding(f)
        if (f.kind === 'scholarship' && f.deadline) void upsert({ id: `scholarship-${f.id}`, org: f.label, programme: 'scholarship', closes: f.deadline, url: '', status: 'idea' })
      }}
      onRemoveFunding={removeFunding}
    />
  )
}

