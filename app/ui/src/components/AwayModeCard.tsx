/**
 * Away mode (SIH-1): security for when the family is out, without cameras.
 *
 * One card: the arming state with its countdowns, the family's phones and when each
 * was last seen, recent incidents with their 60 s trace, and — always visible a click
 * away — what it cannot do. The server decides everything (app/jarvis_app/away.py);
 * this card only shows it and sends arm / disarm / phone changes.
 *
 * Colour is provenance: cyan = watched by real sensors, amber = simulated or waiting,
 * red = a real alarm or a fault.
 */
import { Plus, Search, Shield, ShieldAlert, ShieldCheck, ShieldOff, Smartphone, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../lib/api'
import {
  armedByText, countdown, evidenceText, fmtAgo, normMac, phaseView, phoneProblem, traceBars,
  type AwayStatus, type Incident, type Neighbor, type Phase,
} from '../lib/away'
import { clock, usePoll } from '../lib/format'
import { Presence, Ticker } from '../lib/motion'
import { useStore } from '../lib/store'
import '../styles/away.css'

const GLYPH: Record<Phase, typeof Shield> = {
  disarmed: ShieldOff, arming: Shield, armed: ShieldCheck, pending: ShieldAlert, alarm: ShieldAlert,
}

export function AwayModeCard() {
  const toast = useStore((s) => s.toast)
  const events = useStore((s) => s.events)
  const [st, loading, reload] = usePoll(() => api<AwayStatus>('/api/security'), 1000)
  const [incidents, , reloadInc] = usePoll(() => api<Incident[]>('/api/security/incidents?limit=6'), 20000)
  // Arming, alerts and closed incidents arrive as events: refresh at once.
  const lastSec = events.filter((e) => e.source === 'security').slice(-1)[0]?.id
  useEffect(() => { reload(); reloadInc() }, [lastSec]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast(ok, 'live')
      reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(false)
    }
  }

  if (!st) {
    return (
      <section className={`card away-card ${loading ? 'scan' : ''}`}>
        <Head phase={null} />
        {loading
          ? <div className="skeleton" style={{ height: 56 }} />
          : <div className="empty">Away mode isn’t answering. The server may be an older build without it.</div>}
      </section>
    )
  }

  const view = phaseView(st)
  const cd = countdown(st)
  const Glyph = GLYPH[st.phase]
  return (
    <section className="card away-card" data-tone={view.tone}>
      <Head phase={st.phase} tone={view.tone} label={view.label} />

      <div className="away-hero">
        <span key={st.phase} className={`away-glyph pop ${view.tone} ${st.phase === 'alarm' || st.phase === 'pending' ? 'breathe' : ''}`}>
          <Glyph size={26} strokeWidth={1.6} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div key={view.label} className="away-state rise">{view.label}</div>
          <div className="away-line">{view.line}</div>
        </div>
        <div className="away-actions">
          {st.armed
            ? <button className="btn danger" disabled={busy} onClick={() => void act(() => post('/api/security/disarm'), 'Away mode disarmed')}>Disarm</button>
            : <button className="btn primary" disabled={busy} onClick={() => void act(() => post('/api/security/arm', { by: 'app' }), 'Away mode armed')}>Arm now</button>}
        </div>
      </div>

      <Presence show={!!cd}>
        <div className={`away-count ${st.phase === 'pending' ? view.tone : ''}`}>
          <span className="meter"><i style={{ width: `${Math.round((cd?.frac ?? 0) * 100)}%` }} /></span>
          <span className="dot away-secs"><Ticker value={cd ? Math.ceil(cd.left) : null} />s</span>
        </div>
      </Presence>

      {st.config_problem && <div className="banner fault-banner rise">{st.config_problem}</div>}
      {st.warnings.map((w, i) => <div key={w} className="banner sim rise" style={{ ['--i' as string]: i }}>{w}</div>)}

      {st.incident && <Receipts actions={st.incident.actions} />}

      <Phones st={st} busy={busy} act={act} />

      <div className="away-auto">
        <button className={`switch ${st.config.auto_arm ? 'on' : ''}`} aria-pressed={st.config.auto_arm} aria-label="Auto-arm"
          disabled={busy} onClick={() => void act(() => api('/api/security/config', { method: 'PUT', body: { auto_arm: !st.config.auto_arm } }))} />
        <div>
          <div className="away-sub-title">Arm by itself</div>
          <div className="away-note">
            When no family phone has been seen for <b>{st.config.away_after_min} min</b>. It disarms itself when one comes back.
            Keep this off if anyone at home has no listed phone.
          </div>
        </div>
      </div>

      <Incidents list={incidents ?? []} />

      <details className="away-limits">
        <summary>What away mode can’t do</summary>
        <ul>{st.limits.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="away-note">
          Phones must keep a <b>fixed Wi-Fi address</b> on this network. iPhone: Settings › Wi-Fi › (i) › Private Wi-Fi
          Address › Fixed. Android: Wi-Fi › this network › Privacy › use device MAC (or a randomised MAC that stays the same).
          Reserving each phone’s IP in the router helps too. Nothing is watched or recorded while disarmed, and no record is
          kept of who came and went.
        </p>
      </details>
    </section>
  )
}

function Head({ phase, tone = 'idle', label }: { phase: Phase | null; tone?: string; label?: string }) {
  return (
    <div className="card-head">
      <div className="card-title"><span className="track">SIH-1</span>Away mode</div>
      {phase && (
        <span key={phase} className={`pill pop ${tone === 'idle' ? '' : tone}`}>
          {tone !== 'idle' && <i className="led" />}{label}
        </span>
      )}
    </div>
  )
}

/** What the alarm really did, from its receipts (lights delivered? voice spoken?). */
function Receipts({ actions }: { actions: NonNullable<AwayStatus['incident']>['actions'] }) {
  const rows = [['Lights', actions.lights], ['Voice', actions.speech]] as const
  return (
    <div className="away-receipts rise">
      {rows.map(([name, r]) => r && (
        <span key={name} className={`chip pop ${r.done ? 'ok' : 'no'}`} title={r.detail}>
          {name}: {r.done ? 'done' : 'not done'} <span className="muted">· {r.detail}</span>
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ phones */
function Phones({ st, busy, act }: { st: AwayStatus; busy: boolean; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="away-section">
      <div className="away-sub">
        <span className="eyebrow">Family phones</span>
        <span className="mono muted away-check">
          {st.check ? (st.check.ok ? `checked ${fmtAgo(st.now - st.check.at)}` : `check failing: ${st.check.error}`) : 'not checked yet'}
        </span>
        {st.phones.length > 0 && (
          <button className="btn ghost sm" disabled={busy} onClick={() => void act(() => post('/api/security/check'))}>Check now</button>
        )}
      </div>
      {st.phones.length === 0 && (
        <div className="away-empty rise">
          <Smartphone size={18} strokeWidth={1.6} />
          <span>No phones listed yet. Add every family member’s phone so JARVIS can tell when the house is empty.</span>
        </div>
      )}
      {st.phones.map((p, i) => (
        <div key={p.key} className="away-row rise" style={{ ['--i' as string]: i }}>
          <i className={`home-dot ${p.home ? 'on' : ''}`} title={p.home ? 'on the Wi-Fi recently' : 'not seen recently'} />
          <div style={{ minWidth: 0 }}>
            <div className="who">{p.name}</div>
            <div className="addr">
              {[p.mac, p.ip].filter(Boolean).join(' · ')}
              {p.ip_now && p.ip_now !== p.ip && <> · now {p.ip_now}</>}
              {p.randomised_mac && <> · private MAC</>}
            </div>
          </div>
          <span key={p.last_seen ?? 'never'} className={`away-seen pop ${p.home ? 'live' : ''}`} title={evidenceText(p.evidence)}>
            {fmtAgo(p.seen_ago_s)}
          </span>
          <button className="btn ghost icon sm" aria-label={`Remove ${p.name}`} disabled={busy}
            onClick={() => void act(() => api(`/api/security/phones/${encodeURIComponent(p.key)}`, { method: 'DELETE' }), `${p.name}'s phone removed`)}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {!adding && st.phones.length < 12 && (
        <button className="btn sm away-add" onClick={() => setAdding(true)}><Plus size={14} /> Add a phone</button>
      )}
      <Presence show={adding}>
        <AddPhone onClose={() => setAdding(false)} act={act} busy={busy} />
      </Presence>
    </div>
  )
}

function AddPhone({ onClose, act, busy }: { onClose: () => void; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; busy: boolean }) {
  const toast = useStore((s) => s.toast)
  const [form, setForm] = useState({ name: '', mac: '', ip: '' })
  const [found, setFound] = useState<Neighbor[] | null>(null)
  const [looking, setLooking] = useState(false)
  const problem = phoneProblem(form)
  const find = async () => {
    setLooking(true)
    try {
      setFound(await api<Neighbor[]>('/api/security/neighbors'))
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setLooking(false)
    }
  }
  const save = () => act(async () => {
    await post('/api/security/phones', { name: form.name.trim(), mac: form.mac.trim() ? normMac(form.mac) : null, ip: form.ip.trim() || null })
    onClose()
  }, `${form.name.trim()}'s phone added`)
  return (
    <div className="away-form-wrap rise">
      <div className="away-form">
        <input className="field" placeholder="Whose phone (e.g. Papa)" value={form.name} maxLength={40}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="field mono" placeholder="MAC  3a-11-22-33-44-55" value={form.mac}
          onChange={(e) => setForm({ ...form, mac: e.target.value })} />
        <input className="field mono" placeholder="IP  192.168.1.23 (optional)" value={form.ip}
          onChange={(e) => setForm({ ...form, ip: e.target.value })} />
        <div className="away-form-btns">
          <button className="btn primary sm" disabled={busy || !!problem} title={problem ?? ''} onClick={() => void save()}>Add</button>
          <button className="btn ghost icon sm" aria-label="Cancel" onClick={onClose}><X size={14} /></button>
        </div>
      </div>
      <div className="away-note">
        {problem && (form.name || form.mac || form.ip) ? <span className="sim">{problem} </span> : null}
        Don’t know the MAC? Turn the phone’s Wi-Fi off and on, then
        <button className={`btn ghost sm ${looking ? 'scan' : ''}`} disabled={looking} onClick={() => void find()}>
          <Search size={13} /> find devices on this Wi-Fi
        </button>
      </div>
      <Presence show={!!found}>
        <div className="away-found">
          {found?.length === 0 && <div className="muted">This PC hasn’t talked to any device yet. Open a website on the phone and try again.</div>}
          {found?.map((n, i) => (
            <button key={n.mac + n.ip} className="away-found-row rise press" style={{ ['--i' as string]: i }} disabled={n.listed}
              onClick={() => setForm({ ...form, mac: n.mac, ip: n.ip })}>
              <span className="mono">{n.mac}</span>
              <span className="mono muted">{n.ip}</span>
              {n.state !== 'unknown' ? <span className={`pill ${n.state === 'Reachable' ? 'live' : ''}`}>{n.state.toLowerCase()}</span> : <span />}
              <span className="muted">{n.listed ? 'listed' : n.randomised_mac ? 'private MAC — likely a phone' : 'factory MAC'}</span>
            </button>
          ))}
        </div>
      </Presence>
    </div>
  )
}

/* ------------------------------------------------------------------ incidents */
function Incidents({ list }: { list: Incident[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Incident | null>(null)
  const toggle = (id: string) => {
    setDetail(null)
    setOpen(open === id ? null : id)
  }
  useEffect(() => {
    if (!open) return
    let alive = true
    void api<Incident>(`/api/security/incidents/${encodeURIComponent(open)}`).then((d) => { if (alive) setDetail(d) }).catch(() => {})
    return () => { alive = false }
  }, [open])
  return (
    <div className="away-section">
      <div className="away-sub"><span className="eyebrow">Recent incidents</span></div>
      {list.length === 0 && <div className="away-empty rise"><ShieldCheck size={18} strokeWidth={1.6} /><span>None so far.</span></div>}
      {list.map((inc, i) => {
        const tone = inc.simulated ? 'sim' : 'fault'
        return (
          <div key={inc.id} className="rise" style={{ ['--i' as string]: i }}>
            <button className={`away-inc press ${open === inc.id ? 'open' : ''}`} onClick={() => toggle(inc.id)}>
              <span className={`pill ${tone}`}><i className="led" />{inc.label ?? (inc.kind === 'tamper' ? 'sensor' : 'live')}</span>
              <span className="mono">{clock(inc.confirmed_at)}</span>
              <span className="away-inc-what">
                {inc.kind === 'tamper' ? 'Sensor offline' : 'Motion while armed'}
                <span className="muted"> · {inc.outcome ?? (inc.stage === 'pending' ? 'entry delay running' : 'open')}</span>
              </span>
              <span className="mono muted">{inc.duration_s !== null ? `${inc.duration_s} s` : '…'}</span>
            </button>
            <Presence show={open === inc.id}>
              <div className="away-inc-detail">
                {!detail ? <div className="skeleton scan" style={{ height: 40 }} /> : <IncidentDetail inc={detail} />}
              </div>
            </Presence>
          </div>
        )
      })}
    </div>
  )
}

function IncidentDetail({ inc }: { inc: Incident }) {
  const W = 320, H = 44
  const { bars, zeroX, thrY } = traceBars(inc.trace ?? [], W, H)
  return (
    <div className="fade-in">
      {bars.length > 0 && (
        <svg className="away-trace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
          aria-label="Motion score per second around the alarm, relative to its threshold">
          <line x1={0} x2={W} y1={thrY} y2={thrY} className="thr" />
          <line x1={zeroX} x2={zeroX} y1={0} y2={H} className="zero" />
          {bars.map((b, i) => (
            <rect key={i} x={b.x - 1.5} width={3} y={H - b.h} height={b.h} rx={1}
              className={b.pos ? (inc.simulated ? 'pos sim' : 'pos') : 'neg'} style={{ ['--i' as string]: i }} />
          ))}
        </svg>
      )}
      <div className="kv away-kv">
        <span>Confirmed</span><span className="mono">{new Date(inc.confirmed_at * 1000).toLocaleString('en-GB')}</span>
        <span>Armed</span><span>{armedByText(inc.armed_by)}</span>
        <span>Sensors</span><span className={inc.simulated ? 'sim' : 'live'}>{inc.source ?? '—'}{inc.simulated ? ' (not the real house)' : ''}</span>
        {inc.actions.lights && <><span>Lights</span><span>{inc.actions.lights.done ? 'on' : 'not confirmed'} · {inc.actions.lights.detail}</span></>}
        {inc.actions.speech && <><span>Voice</span><span>{inc.actions.speech.done ? 'spoken' : 'not spoken'} · {inc.actions.speech.detail}</span></>}
        <span>Trace</span><span className="mono">{inc.trace?.length ?? 0} s · line = threshold · mark = confirmation</span>
      </div>
    </div>
  )
}
