/**
 * The Armory's pieces, used by the Road (the reward shop, achievements, the War
 * Chest: what Germany costs and when) and by the settings drawer (rest day,
 * nudges, targets, recovery). Mission v2 retired the Armory as a tab.
 */
import { Award, Coins, Lock, Plus, Settings2, ShoppingBag, Trash2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../lib/store'
import { ACHIEVEMENTS } from '../game/achievements'
import * as E from '../game/engine'
import { Marks } from '../game/kit'
import { useGame } from '../game/store'
import { CHEST_ITEMS, FUNDING_PATHS, toInr } from '../game/trials'
import { addDays, fromKey, MONTHS, prettyDate } from '../game/util'
import { NeonBar, confirmDialog } from '../ui'

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/* ------------------------------------------------------------------ shop */
export function Shop() {
  const g = useGame((s) => s.g)
  const buy = useGame((s) => s.buy)
  const save = useGame((s) => s.saveShop)
  const toast = useStore((s) => s.toast)
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState<E.ShopItem[]>([])
  const rewards = g.shop.filter((i) => i.kind === 'reward')
  const items = g.shop.filter((i) => i.kind !== 'reward')
  const startEdit = () => { setDraft(g.shop.map((i) => ({ ...i }))); setEdit(true) }
  const doBuy = (i: E.ShopItem) => confirmDialog(i.label, `Spend ${i.cost} DM? You have ${g.marks}.`, 'Buy', () => { const e = buy(i.id); if (e) toast(e, 'fault') }, false)
  return (
    <>
      <div className="sec-title"><ShoppingBag size={15} /><span>Rewards</span><em className="mono">you set the menu and the prices</em>
        <span style={{ flex: 1 }} />
        {edit ? <>
          <button className="btn sm ghost" onClick={() => setEdit(false)}>Cancel</button>
          <button className="btn sm primary" onClick={() => { save(draft); setEdit(false); toast('Armory updated.', 'live') }}>Save</button>
        </> : <button className="btn sm ghost" onClick={startEdit}>Edit rewards</button>}
      </div>
      {edit ? (
        <section className="card shop-edit">
          {draft.map((i, k) => (
            <div key={i.id} className="se-row">
              <input className="field" value={i.label} disabled={i.kind !== 'reward'} onChange={(e) => setDraft(draft.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} />
              <input className="field sm" type="number" min={1} value={i.cost} onChange={(e) => setDraft(draft.map((x, j) => (j === k ? { ...x, cost: Number(e.target.value) } : x)))} />
              <span className="mono muted small">{i.kind}</span>
              {i.kind === 'reward' && <button className="icon-btn" aria-label="Remove" onClick={() => setDraft(draft.filter((_, j) => j !== k))}><Trash2 size={14} /></button>}
            </div>
          ))}
          <button className="btn sm" onClick={() => setDraft([...draft, { id: `r-${Date.now().toString(36)}`, label: 'New reward', cost: 100, kind: 'reward' }])}><Plus size={13} />Add a reward</button>
          <p className="muted small">Price rewards by what they cost you in time: a full day's work earns ~110 DM.</p>
        </section>
      ) : (
        <div className="shop-grid">
          {rewards.map((i) => (
            <button key={i.id} className={`shop-item ${g.marks >= i.cost ? '' : 'poor'}`} onClick={() => doBuy(i)}>
              <span className="si-label">{i.label}</span><Marks n={i.cost} size="sm" />
            </button>
          ))}
          {items.map((i) => (
            <button key={i.id} className={`shop-item item ${g.marks >= i.cost ? '' : 'poor'}`} onClick={() => doBuy(i)}>
              <span className="si-label">{i.label}</span><Marks n={i.cost} size="sm" />
            </button>
          ))}
        </div>
      )}
      {g.purchases.length > 0 && (
        <div className="purchase-log mono muted small">{g.purchases.slice(-6).reverse().map((p) => <span key={p.t}>{new Date(p.t).toLocaleDateString()} · {p.label} · −{p.cost} DM</span>)}</div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ achievements */
export function Achievements() {
  const got = useGame((s) => s.g.achievements)
  return (
    <>
      <div className="sec-title"><Award size={15} /><span>Achievements</span><em className="mono">{Object.keys(got).length} / {ACHIEVEMENTS.length}</em></div>
      <div className="ach-grid">
        {ACHIEVEMENTS.map((a) => (
          <div key={a.id} className={`ach ${got[a.id] ? 'got' : ''}`} title={a.desc}>
            {got[a.id] ? <Award size={18} /> : <Lock size={16} />}
            <b>{a.name}</b><span className="muted small">{a.desc}</span>
            <span className="mono small">{got[a.id] ? prettyDate(got[a.id], true) : `+${a.marks} DM`}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ war chest */
export function WarChest() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const addSavings = useGame((s) => s.addSavings)
  const setCustom = useGame((s) => s.setCustomCost)
  const setSettings = useGame((s) => s.setSettings)
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const [nc, setNc] = useState({ label: '', inr: '', due: '' })
  const rate = g.settings.inrPerEur
  const rows = [
    ...CHEST_ITEMS.map((c) => ({ id: c.id, label: c.label, inr: toInr(c.cost, rate), due: c.due, src: `${c.cost.currency === 'EUR' ? `€${c.cost.amount.toLocaleString('en-IN')} · ` : ''}${c.cost.source}`, custom: false })),
    ...g.warChest.custom.map((c) => ({ id: c.id, label: c.label, inr: c.inr, due: c.due, src: 'your estimate', custom: true })),
  ].sort((a, b) => a.due.localeCompare(b.due))
  const total = rows.reduce((a, r) => a + r.inr, 0)
  const saved = g.warChest.saved
  // Running totals: by each due month, how much must exist; monthly saving needed from today.
  let run = 0
  const withRun = rows.map((r) => {
    run += r.inr
    const [y, m] = r.due.split('-').map(Number)
    const now = fromKey(today)
    const months = Math.max(1, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()))
    return { ...r, run, perMonth: Math.max(0, (run - saved) / months) }
  })
  const next = withRun.find((r) => r.run > saved)
  return (
    <>
      <div className="sec-title"><Wallet size={15} /><span>War Chest</span><em className="mono">what Germany costs, and when — real money, not Marks</em></div>
      <section className="card war-chest">
        <div className="wc-top">
          <div><span className="eyebrow">Saved</span><b className="dot">{inr(saved)}</b></div>
          <div><span className="eyebrow">Needed by summer 2028</span><b className="dot">{inr(total)}</b></div>
          <div><span className="eyebrow">Gap</span><b className={`dot ${total - saved > 0 ? 'fault' : 'live'}`}>{inr(Math.max(0, total - saved))}</b></div>
          <div><span className="eyebrow">Next due</span><b className="small">{next ? `${next.label} · ${MONTHS[Number(next.due.slice(5, 7)) - 1]} ${next.due.slice(0, 4)}` : 'covered'}</b>
            {next && <span className="mono muted small">save {inr(next.perMonth)}/month to make it</span>}</div>
        </div>
        <NeonBar progress={total ? saved / total : 0} tone={saved >= total ? 'live' : 'chrome'} />
        <div className="wc-table">
          {withRun.map((r) => (
            <div key={r.id} className={`wc-row ${r.run <= saved ? 'covered' : ''}`}>
              <span className="mono">{r.due}</span><span>{r.label}</span><span className="dot small">{inr(r.inr)}</span>
              <span className="muted small">{r.src}</span>
              {r.custom ? <button className="icon-btn" aria-label="Remove" onClick={() => setCustom(null, r.id)}><Trash2 size={13} /></button> : <span />}
            </div>
          ))}
        </div>
        <div className="wc-forms">
          <div className="field-row">
            <input className="field sm" type="number" placeholder="₹ amount (− to withdraw)" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <input className="field" placeholder="note (salary, gift, tutoring…)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn sm primary" disabled={!Number(amt)} onClick={() => { addSavings(Number(amt), note); setAmt(''); setNote('') }}><Coins size={13} />Log</button>
          </div>
          <div className="field-row">
            <input className="field" placeholder="Add a cost (flight, deposit…)" value={nc.label} onChange={(e) => setNc({ ...nc, label: e.target.value })} />
            <input className="field sm" type="number" placeholder="₹" value={nc.inr} onChange={(e) => setNc({ ...nc, inr: e.target.value })} />
            <input className="field sm" type="month" value={nc.due} onChange={(e) => setNc({ ...nc, due: e.target.value })} />
            <button className="btn sm" disabled={!nc.label || !Number(nc.inr) || !nc.due} onClick={() => { setCustom({ id: `c-${Date.now().toString(36)}`, label: nc.label, inr: Number(nc.inr), due: nc.due }); setNc({ label: '', inr: '', due: '' }) }}><Plus size={13} />Add</button>
            <label className="mono small muted">₹ per € <input className="field sm" type="number" value={rate} onChange={(e) => setSettings({ inrPerEur: Math.max(1, Number(e.target.value) || 100) })} /></label>
          </div>
        </div>
        <span className="eyebrow">Funding paths — to research, not advice</span>
        <div className="funding">{FUNDING_PATHS.map((f) => <div key={f.label}><b>{f.label}</b><span className="muted small">{f.note}</span></div>)}</div>
        <p className="muted small">Figures as checked on 9 Oct 2026 — set the exchange rate to today's and verify each fee before paying.</p>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ settings & modes */
export function SettingsCard() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const set = useGame((s) => s.setSettings)
  const setSeason = useGame((s) => s.setSeasonStart)
  const startRecovery = useGame((s) => s.startRecovery)
  const endRecovery = useGame((s) => s.endRecovery)
  const declareRest = useGame((s) => s.declareRest)
  const toast = useStore((s) => s.toast)
  const s = g.settings
  const mode = E.modeOn(g, today)
  const recUsed = g.modes.recovery.filter((p) => p.from >= g.seasonStart).length
  return (
    <>
      <div className="sec-title"><Settings2 size={15} /><span>Settings & modes</span></div>
      <section className="card settings-card">
        <div className="set-grid">
          <label>Weekly rest day
            <select className="field" value={s.restWeekday} onChange={(e) => set({ restWeekday: Number(e.target.value) })}>
              {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
            </select></label>
          <label>Move this week's rest to
            <select className="field" value="" onChange={(e) => { if (e.target.value) { const err = declareRest(e.target.value); toast(err ?? `Rest moved to ${prettyDate(e.target.value)}.`, err ? 'fault' : 'live') } }}>
              <option value="">—</option>
              {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => <option key={d} value={d}>{WEEKDAYS[fromKey(d).getDay()]} {prettyDate(d)}</option>)}
            </select></label>
          <label>Nudge at <input className="field" type="time" value={s.nudgeAt} onChange={(e) => set({ nudgeAt: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={s.voiceNudges} onChange={(e) => set({ voiceNudges: e.target.checked })} />JARVIS speaks the nudge</label>
          <label className="check"><input type="checkbox" checked={s.sound} onChange={(e) => set({ sound: e.target.checked })} />Game sounds</label>
          <label className="check"><input type="checkbox" checked={s.focusScene} onChange={(e) => set({ focusScene: e.target.checked })} />Crucible switches the room to the focus scene</label>
          <label>Silicon h/week <input className="field sm" type="number" min={1} value={s.targets.silicon} onChange={(e) => set({ targets: { ...s.targets, silicon: Math.max(1, Number(e.target.value)) } })} /></label>
          <label>German h/week <input className="field sm" type="number" min={1} value={s.targets.deutsch} onChange={(e) => set({ targets: { ...s.targets, deutsch: Math.max(1, Number(e.target.value)) } })} /></label>
          <label>Workouts/week <input className="field sm" type="number" min={1} max={7} value={s.targets.workouts} onChange={(e) => set({ targets: { ...s.targets, workouts: Math.max(1, Number(e.target.value)) } })} /></label>
          <label>Season starts <input className="field" type="month" value={g.seasonStart.slice(0, 7)} onChange={(e) => e.target.value && setSeason(`${e.target.value}-01`)} /></label>
        </div>

        <div className="modes">
          <div>
            <b>Exam mode</b>
            <p className="muted small">Exam mode now comes from your academics: the exam dates under Exams, and the plan's phases. On exam days the Floor needs only the study rep. Grades decide German admissions; the game never punishes you for them.</p>
            {g.modes.exam.length > 0 && <p className="mono muted small">Older exam periods from your save still count: {g.modes.exam.map((p) => `${p.label || 'Exams'} ${prettyDate(p.from)} to ${prettyDate(p.to)}`).join(', ')}</p>}
          </div>
          <div>
            <b>Recovery mode</b> <span className="mono muted small">{recUsed} / 2 used this season</span>
            <p className="muted small">For illness or a real crisis: 14 days where any one rep secures the day and XP runs at 60%. Twice a season, no more — it is a bridge, not a habit.</p>
            {mode === 'recovery'
              ? <button className="btn sm" onClick={() => endRecovery()}>End recovery today</button>
              : <button className="btn sm ghost" disabled={recUsed >= 2} onClick={() => confirmDialog('Recovery mode', 'Start 14 days of Recovery? Any one rep secures a day; XP ×0.6.', 'Start', () => { const e = startRecovery(); if (e) toast(e, 'fault') }, false)}>Start recovery</button>}
          </div>
        </div>
      </section>
    </>
  )
}
