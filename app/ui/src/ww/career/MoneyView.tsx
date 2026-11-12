// Career > Money: CA7 War chest, rupees only (plan 3.3, 4.7). The game currency (Marks, DM) lives on
// Plan > Rewards and never appears here: the two were one page before and read as one number.
import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useGame } from '../../germoney/game/store'
import { FUNDING_PATHS } from '../../germoney/game/trials'
import { Button, Card, Drawer, Field, IconButton, COUNTED, Meter, Segmented, Stat } from '../kit'
import { Paged } from './Paged'
import { chestRows, dueMonth, inr, type ChestRow } from './model'

function LogMoney({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addSavings = useGame((s) => s.addSavings)
  const setCustom = useGame((s) => s.setCustomCost)
  const setSettings = useGame((s) => s.setSettings)
  const rate = useGame((s) => s.g.settings.inrPerEur)
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const [nc, setNc] = useState({ label: '', inr: '', due: '' })
  return (
    <Drawer open={open} onClose={onClose} title="Log money">
      <div className="cr-form">
        <Field label="Amount saved, in rupees" kind="number" value={amt} onChange={(e) => setAmt(e.target.value)} hint="A minus sign withdraws." />
        <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} hint="Salary, a gift, tutoring." />
        <Button
          tone="primary"
          disabledReason={Number(amt) ? undefined : 'Type an amount'}
          onClick={() => {
            addSavings(Number(amt), note)
            setAmt('')
            setNote('')
            onClose()
          }}
        >
          Log savings
        </Button>
        <hr className="cr-rule" />
        <Field label="A cost to add" value={nc.label} onChange={(e) => setNc({ ...nc, label: e.target.value })} hint="A flight, a deposit." />
        <Field label="Cost in rupees" kind="number" value={nc.inr} onChange={(e) => setNc({ ...nc, inr: e.target.value })} />
        <Field label="Due month" kind="date" value={nc.due ? `${nc.due}-01` : ''} onChange={(e) => setNc({ ...nc, due: e.target.value.slice(0, 7) })} />
        <Button
          disabledReason={nc.label && Number(nc.inr) && nc.due ? undefined : 'Fill all three'}
          onClick={() => {
            setCustom({ id: `c-${Date.now().toString(36)}`, label: nc.label, inr: Number(nc.inr), due: nc.due })
            setNc({ label: '', inr: '', due: '' })
            onClose()
          }}
        >
          Add cost
        </Button>
        <hr className="cr-rule" />
        <Field label="Rupees per euro" kind="number" value={rate} onChange={(e) => setSettings({ inrPerEur: Math.max(1, Number(e.target.value) || 100) })} hint="Set it to today's rate; the euro costs below follow it." />
      </div>
    </Drawer>
  )
}

function ChestLine({ r, saved }: { r: ChestRow; saved: number }) {
  const setCustom = useGame((s) => s.setCustomCost)
  return (
    <div className="cr-chest" data-covered={r.run <= saved ? 'true' : undefined} data-chest={r.id}>
      <span className="cr-when">{r.due}</span>
      <span className="cr-clip" title={r.eur ? `${r.label} (${r.eur} at the rate set)` : r.label}>{r.label}</span>
      <span className="cr-cost">{inr(r.inr)}</span>
      <span className="cr-clip cr-sub" title={r.src}>{r.run <= saved ? 'covered' : r.src}</span>
      {r.custom ? (
        <IconButton label={`Remove ${r.label}`} size="sm" onClick={() => setCustom(null, r.id)}>
          <Trash2 size={14} aria-hidden="true" />
        </IconButton>
      ) : (
        <span />
      )}
    </div>
  )
}

export function MoneyView() {
  const saved = useGame((s) => s.g.warChest.saved)
  const custom = useGame((s) => s.g.warChest.custom)
  const rate = useGame((s) => s.g.settings.inrPerEur)
  const today = useGame((s) => s.today)
  const [log, setLog] = useState(false)
  const [mode, setMode] = useState<'costs' | 'funding'>('costs')
  const rows = useMemo(() => chestRows({ saved, custom, rate, today }), [saved, custom, rate, today])
  const total = rows.reduce((a, r) => a + r.inr, 0)
  const gap = Math.max(0, total - saved)
  const next = rows.find((r) => r.run > saved)
  return (
    <div className="cr-view cr-view-one" data-view="money">
      <Card
        data-card="CA7"
        title="War chest"
        kicker="what Germany costs and when, in rupees"
        action={
          <Button size="sm" onClick={() => setLog(true)}>
            Log money
          </Button>
        }
        className="cr-fill"
      >
        <div className="cr-stats">
          <Stat label="Saved" value={saved} fmt={inr} reading={COUNTED} />
          <Stat label="Needed by summer 2028" value={total} fmt={inr} reading={COUNTED} />
          <Stat label="Gap" value={gap} fmt={inr} reading={COUNTED} />
          <div className="cr-next-due">
            <span className="ww-stat-label">Next due</span>
            <span className="cr-next-due-text">{next ? `${next.label} . ${dueMonth(next.due)}` : 'covered'}</span>
            {next && <span className="cr-sub">save {inr(next.perMonth)} a month to make it</span>}
          </div>
        </div>
        <Meter value={total ? saved / total : 0} label={`Saved ${inr(saved)} of ${inr(total)}`} reading={COUNTED} />
        <div className="cr-mode">
          <Segmented<'costs' | 'funding'> label="War chest section" variant="compact" value={mode} onChange={setMode} options={[{ id: 'costs', label: 'Costs' }, { id: 'funding', label: 'Funding paths' }]} />
        </div>
        {mode === 'costs' ? (
          <Paged items={rows} rowKey={(r) => r.id} row={(r) => <ChestLine r={r} saved={saved} />} label="costs" fallback={6} empty="No costs listed." />
        ) : (
          <div className="cr-funding">
            <p className="cr-foot">Funding paths are things to research, not advice.</p>
            <Paged items={FUNDING_PATHS} rowKey={(f) => f.label} row={(f) => (
              <div className="cr-fund">
                <b>{f.label}</b>
                <span className="cr-clip cr-sub" title={f.note}>{f.note}</span>
              </div>
            )} label="funding paths" fallback={4} empty="No funding paths." />
          </div>
        )}
        <p className="cr-foot">Figures checked on 9 Oct 2026. Set the rate to today's and verify each fee before paying.</p>
      </Card>
      <LogMoney open={log} onClose={() => setLog(false)} />
    </div>
  )
}
