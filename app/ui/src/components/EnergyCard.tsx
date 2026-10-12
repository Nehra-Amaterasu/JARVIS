/**
 * Energy: what the switchboard cost today, this week, this month, and what was left
 * on in an empty room (SIH 2022 DR704, ROADMAP SIH-2).
 *
 * Every number is an ESTIMATE — rated watts x on-time (app/jarvis_app/energy.py) —
 * so the numbers are amber and the card says so in words. Cyan appears only for what
 * sensors really reported (live presence, a relay the board took); red only for a
 * relay the safety check refused. Nothing here claims a switch that did not happen:
 * loads JARVIS cannot switch are "recorded", not "turned on".
 */
import { Gauge, Hand, Moon, PlugZap, TriangleAlert, Zap } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { api, post } from '../lib/api'
import {
  PERIOD_LABEL, PERIOD_TAB, barRows, canKeep, clockHM, energyTone, fmtKwh, fmtMinutes, fmtRupees, nudgeBadge,
  relayLabel, seriesHeights, sourceNote, type EnergyView, type Period,
} from '../lib/energy'
import { usePoll } from '../lib/format'
import { Presence, Ticker } from '../lib/motion'
import { useStore } from '../lib/store'
import '../styles/energy.css'

const PERIODS: Period[] = ['day', 'week', 'month']
const POLL_MS = 5000

export function EnergyCard() {
  const toast = useStore((s) => s.toast)
  const events = useStore((s) => s.events)
  const [period, setPeriod] = useState<Period>('day')
  const [error, setError] = useState<string | null>(null)
  const [view, loading, reload] = usePoll(async () => {
    try {
      const v = await api<EnergyView>(`/api/energy?period=${period}`)
      setError(null)
      return v
    } catch (e) {
      setError((e as Error).message)
      throw e
    }
  }, POLL_MS, [period])
  // A switch (button, voice, auto-off) or a nudge arrives as an event: refresh at once.
  const lastEvent = events.filter((e) => e.source === 'energy' || e.source === 'limbs').slice(-1)[0]?.id
  useEffect(() => { reload() }, [lastEvent]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (path: string, body: unknown, ok?: (r: Record<string, unknown>) => string | null) => {
    try {
      const r = await post<Record<string, unknown>>(path, body)
      const msg = ok?.(r)
      if (msg) toast(msg, 'sim')
      reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }

  if (!view) {
    return (
      <section className="card energy rise" aria-busy={loading}>
        <div className="card-head"><div className="card-title"><Zap size={15} /> Energy</div></div>
        {error
          ? <div className="energy-error"><TriangleAlert size={16} /> <span>Energy ledger unavailable: {error}</span>
              <button className="btn sm" onClick={reload}>Retry</button></div>
          : <div className="energy-skeleton">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton scan" style={{ height: 64 }} />)}
              <div className="skeleton scan" style={{ height: 140, gridColumn: '1 / -1' }} />
            </div>}
      </section>
    )
  }

  const r = view.report
  const tone = energyTone(view)
  const meta = Object.fromEntries(view.circuits.circuits.map((c) => [c.id, c]))
  const rows = barRows(r.circuits)
  const heights = seriesHeights(r.series)
  const note = sourceNote(r)
  const w = view.waste
  const presenceTone = !w.status.state || w.status.state === 'starting' || w.status.state === 'unknown'
    ? '' : view.presence.sim ? 'sim' : 'live'
  const presenceText = view.presence.state
    ? `${view.presence.sim ? 'simulated' : 'sensed'} · ${view.presence.state}` : 'no presence data'

  return (
    <section className="card energy rise">
      <div className="card-head">
        <div className="card-title"><Zap size={15} /> Energy</div>
        <div className="energy-head-right">
          <div className="seg" role="tablist" aria-label="Report period">
            {PERIODS.map((p) => (
              <button key={p} role="tab" aria-selected={period === p} className={period === p ? 'on' : ''}
                onClick={() => setPeriod(p)}>{PERIOD_TAB[p]}</button>
            ))}
          </div>
          <span className={`pill ${tone}`} title={r.basis}><i className="led" />{tone === 'live' ? 'metered' : 'estimate'}</span>
        </div>
      </div>

      <div className="energy-stats">
        <div className="estat">
          <span className="eyebrow">{PERIOD_LABEL[period]} · kWh</span>
          <span className={`dot estat-num ${tone}`}><Ticker value={r.kwh} fmt={fmtKwh} /></span>
          <span className="mono muted">{r.month_kwh_to_date > 0 ? `${fmtKwh(r.month_kwh_to_date)} kWh this month so far` : 'nothing on yet'}</span>
        </div>
        <div className="estat">
          <span className="eyebrow">Cost · energy charge</span>
          <span className={`dot estat-num ${tone}`}>₹<Ticker value={r.rupees} fmt={fmtRupees} /></span>
          <span className={`mono ${r.tariff.example ? 'sim' : 'muted'}`} title={r.tariff.note}>
            ₹{r.tariff.marginal_rate.toFixed(2)}/kWh slab{r.tariff.example ? ' · example tariff' : ''}</span>
        </div>
        <div className="estat">
          <span className="eyebrow">Waste · on in an empty room</span>
          <span className={`dot estat-num ${tone}`} title={fmtMinutes(r.waste.minutes)}>
            <Ticker value={r.waste.minutes} fmt={(n) => String(Math.round(n))} /><small> min</small></span>
          <span className="mono muted">{fmtKwh(r.waste.kwh)} kWh · ₹{fmtRupees(r.waste.rupees)}
            {r.waste.sim_minutes > 0 && <span className="sim"> · +{Math.round(r.waste.sim_minutes)} min simulated</span>}</span>
        </div>
      </div>

      <div className="espark" aria-label={`kWh per ${period === 'day' ? 'hour' : 'day'}`}>
        {heights.map((h, i) => (
          <i key={r.series[i].t} className={r.series[i].future ? 'future' : r.series[i].kwh > 0 ? '' : 'zero'}
            style={{ height: `${Math.max(h, 2)}%` }}
            title={`${r.series[i].label}: ${fmtKwh(r.series[i].kwh)} kWh · ₹${fmtRupees(r.series[i].rupees)}`} />
        ))}
      </div>
      <div className="espark-axis mono">
        <span>{r.series[0]?.label}</span><span>{r.series[Math.floor(r.series.length / 2)]?.label}</span><span>{r.series[r.series.length - 1]?.label}</span>
      </div>

      <p className="energy-note"><Gauge size={14} />
        <span><b>Estimate.</b> Rated watts × the time each circuit was on — not a meter reading. {note}</span></p>

      {view.problems.length > 0 && (
        <ul className="energy-problems">
          {view.problems.map((p, i) => <li key={i} className="pop" style={{ '--i': i } as CSSProperties}><TriangleAlert size={13} /> {p}</li>)}
        </ul>
      )}

      <div className="energy-cols">
        <div className="ecirc">
          <div className="eyebrow">Circuits · {PERIOD_LABEL[period].toLowerCase()}</div>
          {rows.map((row, i) => {
            const c = meta[row.id]
            const st = view.states[row.id]
            const rl = c ? relayLabel(c, view.circuits.safe_current_a) : null
            const on = !!st?.on
            const led = on ? (st?.link === 'usb' ? 'live' : 'sim') : ''
            return (
              <div key={row.id} className={`erow rise ${on ? 'on' : ''}`} style={{ '--i': i } as CSSProperties}>
                <span className={`erow-led ${led}`} title={on ? `on · ${st?.link === 'usb' ? 'relay board' : st?.link === 'manual' ? 'as you reported' : 'virtual room'}` : 'off'} />
                <div className="erow-name">
                  <b>{row.name}</b>
                  <span className="mono muted">{row.id} · {row.room} · {c ? `${c.rated_w} W` : '?'}{on && st ? ` · ${Math.round(st.watts)} W now` : ''}
                    {c?.must_not_auto_off ? ' · never auto-off' : ''}</span>
                </div>
                <div className={`bar ${tone} erow-bar`}><i style={{ width: `${row.pct}%` }} /></div>
                <span className={`mono erow-kwh ${row.kwh > 0 ? tone : 'muted'}`}><Ticker value={row.kwh} fmt={fmtKwh} /> kWh</span>
                {rl && <span className={`chip erow-chip ${rl.tone}`} title={rl.title}>{rl.tone === 'fault' && <TriangleAlert size={11} />}{rl.text}</span>}
                {c && !c.switchable && (
                  <button className="chip press erow-mark" title="Records what you did by hand — JARVIS does not switch this circuit"
                    onClick={() => void act(`/api/energy/circuits/${row.id}/state`, { on: !on }, (res) => String(res.note ?? ''))}>
                    {on ? 'mark off' : 'mark on'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="ewatch">
          <div className="eyebrow">Empty-room watch · {w.config.sensed_room ?? 'no room set'}</div>
          <div className="ewatch-status">
            <span className={`pill pop ${presenceTone}`} key={presenceText}><i className="led" />{presenceText}</span>
            <span className="dim">{w.status.text}</span>
          </div>

          <div className="eauto">
            <button className={`switch ${view.auto_off ? 'on' : ''}`} aria-pressed={view.auto_off} aria-label="Auto-off"
              onClick={() => void act('/api/energy/auto-off', { enabled: !view.auto_off })} />
            <div>
              <b>Auto-off</b>
              <span>After {w.config.auto_off_after_min} min empty, and only after JARVIS has asked aloud. Never at night
                ({w.config.night.start}–{w.config.night.end}), never when someone may be asleep, never on simulated presence.</span>
            </div>
          </div>
          {w.config.notes.length > 0 && <div className="mono sim enotes">{w.config.notes.join(' · ')}</div>}

          <div className="eyebrow">Nudges</div>
          <ul className="enudges">
            {w.nudges.slice(0, 8).map((n, i) => {
              const b = nudgeBadge(n)
              return (
                <li key={n.id} className={`enudge pop ${n.sim ? 'sim' : ''}`} style={{ '--i': i } as CSSProperties}>
                  <div className="enudge-top">
                    <span className="mono muted">{clockHM(n.ts)}</span>
                    {n.kind === 'long_on' ? <PlugZap size={12} /> : n.night ? <Moon size={12} /> : null}
                    {n.sim && <span className="pill sim">simulated</span>}
                    <span className={`pill pop ${b.tone === 'muted' ? '' : b.tone}`} key={b.text}>{b.text}</span>
                  </div>
                  <p>{n.text}</p>
                  <Presence show={canKeep(n)}>
                    <button className="btn sm" onClick={() => void act(`/api/energy/nudges/${n.id}/keep`, {}, () => 'Kept on: no automatic switch-off this time.')}>
                      <Hand size={13} /> Keep it on
                    </button>
                  </Presence>
                </li>
              )
            })}
            {w.nudges.length === 0 && (
              <li className="empty enudge-empty">No nudges yet. One appears when something stays on in an empty
                {` ${w.config.sensed_room ?? 'room'}`} for {w.config.nudge_after_min} minutes.</li>
            )}
          </ul>
        </div>
      </div>

      <footer className="energy-foot mono">
        <span className={r.tariff.example ? 'sim' : ''}>{r.tariff.name}</span>
        <span>{r.tariff.telescopic ? 'telescopic' : 'non-telescopic'} slabs · {r.excludes} not included</span>
        {view.circuits.example && <span className="sim">example circuits — copy circuits.example.json to data/app/circuits.json and edit it there</span>}
      </footer>
    </section>
  )
}
