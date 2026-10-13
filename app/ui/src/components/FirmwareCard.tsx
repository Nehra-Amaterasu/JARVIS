/**
 * The board's firmware: config.h's tunable values as a validated form, firmware.ino
 * read-only, Compile, and Flash over USB or Wi-Fi.
 *
 * A flash is two requests on purpose (board_ctl.py): the button asks the server for a
 * PLAN (what would happen, to which port or address), the dialog shows it, and only
 * its "Flash now" sends the plan's id with confirm=true. The server refuses anything
 * else, so no stray click and no script can upload firmware.
 *
 * Progress arrives on the event bus (store.boardProgress) and the job's own record
 * (/api/board/job) has the full tool output.
 */
import { AlertTriangle, Cpu, FileCode2, Hammer, Settings2, Usb, Wifi, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../lib/api'
import { configDraft, flashReady, pinProblem, sizeLine, type BoardView, type ConfigView, type FlashPlan, type JobView } from '../lib/board'
import { useNow, usePoll } from '../lib/format'
import { useStore } from '../lib/store'

type Pane = 'settings' | 'source'

export function FirmwareCard({ v, reload }: { v: BoardView | null; reload: () => void }) {
  const toast = useStore((s) => s.toast)
  const progress = useStore((s) => s.boardProgress)
  const [pane, setPane] = useState<Pane>('settings')
  const [plan, setPlan] = useState<FlashPlan | null>(null)
  const running = v?.job?.state === 'running'
  // While a job runs, its full record every 700 ms; otherwise the board view's copy.
  const [jobPoll] = usePoll(() => api<{ job: JobView | null }>('/api/board/job'), running ? 700 : 0, [running])
  const job = (running ? jobPoll?.job : null) ?? v?.job ?? null
  const live = progress && job && progress.job === job.id && job.state === 'running' ? progress : null
  const pct = (live?.pct as number | null | undefined) ?? job?.pct ?? null

  const lastState = useRef<string | undefined>(undefined)
  useEffect(() => {
    const s = v?.job?.state
    if (lastState.current === 'running' && s && s !== 'running') {
      toast(v?.job?.result.summary ?? `${v?.job?.kind} ${s}`, s === 'ok' ? 'live' : 'fault')
    }
    lastState.current = s
  }, [v?.job?.state]) // eslint-disable-line react-hooks/exhaustive-deps

  const compile = async () => {
    try {
      await post('/api/board/compile')
      reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  const askFlash = async (target: 'usb' | 'wifi') => {
    try {
      setPlan(await post<FlashPlan>('/api/board/flash/plan', target === 'usb' ? { target, port: v?.usb?.port } : { target, ip: v?.ip }))
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  const ready = v ? flashReady(v) : { ok: false, why: '…' }
  const usbPort = v?.usb?.port
  return (
    <section className="card firmware">
      <div className="card-head">
        <span className="card-title"><FileCode2 size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />Firmware</span>
        <div className="firmware-tabs" role="tablist">
          <button role="tab" aria-selected={pane === 'settings'} className={pane === 'settings' ? 'on' : ''} onClick={() => setPane('settings')}>
            <Settings2 size={13} />Abilities · config.h</button>
          <button role="tab" aria-selected={pane === 'source'} className={pane === 'source' ? 'on' : ''} onClick={() => setPane('source')}>
            <Cpu size={13} />firmware.ino</button>
        </div>
      </div>

      <div className="firmware-body">
        <div className="firmware-main">{pane === 'settings' ? <ConfigForm onSaved={reload} /> : <SourceView />}</div>

        <aside className="firmware-side">
          <div className="eyebrow">Build</div>
          <button className="btn" disabled={running || !v?.tools.arduino_cli} onClick={() => void compile()}>
            <Hammer size={14} />{running && job?.kind === 'compile' ? 'Compiling…' : 'Compile'}
          </button>
          {!v?.tools.arduino_cli && <div className="fault firmware-note">arduino-cli not found (Arduino IDE 2 installs it).</div>}
          {v?.build ? (
            <div className="firmware-build">
              <div className="mono"><b>{v.build.version}</b> · {new Date(v.build.at * 1000).toLocaleTimeString('en-GB')} · {v.build.seconds} s</div>
              <div className="bar live"><i style={{ width: `${v.build.flash_pct ?? 0}%` }} /></div>
              <div className="mono muted">{sizeLine(v.build)}</div>
              <div className="mono muted">
                RAM {v.build.ram_bytes?.toLocaleString('en-US') ?? '—'} B · OTA <span className={v.build.ota_in_build ? 'live' : 'sim'}>{v.build.ota_in_build ? 'in' : 'not in'} this build</span>
              </div>
              {v.build.fresh === false && <div className="sim firmware-note">Sources changed since this build: compile again before flashing.</div>}
            </div>
          ) : <div className="muted firmware-note">Nothing compiled yet. The image goes to data/app/firmware/build (it carries the Wi-Fi password, so it stays private).</div>}

          <div className="eyebrow" style={{ marginTop: 6 }}>Flash</div>
          <button className="btn" disabled={!ready.ok || !usbPort} onClick={() => void askFlash('usb')}
            title={!usbPort ? 'no board on USB' : ready.why ?? ''}>
            <Usb size={14} />Over USB{usbPort ? ` · ${usbPort}` : ''}
          </button>
          <button className="btn" disabled={!ready.ok || !v?.ip || !v?.tools.espota} onClick={() => void askFlash('wifi')}
            title={!v?.ip ? 'set the board\'s Wi-Fi address first' : ready.why ?? ''}>
            <Wifi size={14} />Over Wi-Fi{v?.ip ? ` · ${v.ip}` : ''}
          </button>
          <div className="muted firmware-note">{ready.why ? `Not yet: ${ready.why}.` : 'Each flash shows what it will do and waits for your confirm.'}</div>

          {job && (
            <div className={`firmware-job ${job.state}`}>
              <div className="firmware-job-head">
                <span className={`pill ${job.state === 'ok' ? 'live' : job.state === 'failed' ? 'fault' : 'sim'}`}>
                  {job.state === 'running' && <i className="led breathe" />}{job.kind} · {job.state === 'running' ? job.phase : job.state}
                </span>
                <span className="mono muted">{job.seconds} s</span>
              </div>
              {job.state === 'running' && <div className="bar live"><i style={{ width: `${pct ?? 3}%` }} /></div>}
              <div className="mono firmware-job-line">{job.state === 'running' ? (live?.line as string | undefined) ?? job.lines.at(-1) ?? job.detail : job.result.summary ?? job.result.error}</div>
              <details>
                <summary className="muted">Tool output ({job.lines.length} lines)</summary>
                <pre className="log firmware-log">{job.cmd.length ? `$ ${job.cmd.join(' ')}\n` : ''}{job.lines.join('\n')}</pre>
              </details>
            </div>
          )}
        </aside>
      </div>
      {/* A portal: the page's glass (backdrop-filter) would otherwise trap position: fixed inside the card. */}
      {plan && createPortal(<ConfirmFlash plan={plan} onClose={() => setPlan(null)} onStarted={() => { setPlan(null); reload() }} />, document.body)}
    </section>
  )
}

/** config.h as a form: pins from a list, switches, fixed choices. Never free text. */
function ConfigForm({ onSaved }: { onSaved: () => void }) {
  const toast = useStore((s) => s.toast)
  const [cfg, setCfg] = useState<ConfigView | null>(null)
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api<ConfigView>('/api/board/config').then(setCfg).catch((e) => toast((e as Error).message, 'fault'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const check = useMemo(() => (cfg ? configDraft(cfg, draft) : { changes: {}, problems: [] }), [cfg, draft])
  if (!cfg) return <div className="skeleton" style={{ height: 240 }} />
  const val = (k: string) => draft[k] ?? cfg.values[k] ?? 0
  const set = (k: string, n: number) => setDraft((d) => ({ ...d, [k]: n }))
  const pins = [-1, ...cfg.safe_pins]
  const save = async () => {
    setSaving(true)
    try {
      const r = await post<ConfigView>('/api/board/config', { changes: check.changes })
      setCfg(r)
      setDraft({})
      toast(`config.h saved: ${Object.keys(r.changed ?? {}).join(', ') || 'no change'}. Compile and flash to apply.`, 'live')
      onSaved()
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setSaving(false)
    }
  }
  const dirty = Object.keys(check.changes).length > 0
  return (
    <div className="cfg">
      {cfg.fields.map((f) => {
        const v = val(f.key)
        const changed = f.key in check.changes
        const why = f.kind === 'pin' && changed ? pinProblem(v, cfg) : null
        return (
          <div key={f.key} className={`cfg-row ${changed ? 'changed' : ''} ${why ? 'bad' : ''}`}>
            <div className="cfg-label">
              <b>{f.label}</b>
              <span className="mono muted">{f.key}</span>
            </div>
            <div className="cfg-control">
              {f.kind === 'bool' ? (
                <button className={`switch ${v ? 'on' : ''}`} aria-pressed={!!v} aria-label={f.label} onClick={() => set(f.key, v ? 0 : 1)} />
              ) : (
                <select className="field cfg-select mono" value={v} aria-label={f.label} onChange={(e) => set(f.key, Number(e.target.value))}>
                  {(f.kind === 'pin' ? pins : f.options ?? []).map((n) => (
                    <option key={n} value={n}>{f.kind === 'pin' ? (n === -1 ? 'none (-1)' : `GPIO ${n}`) : `${n}${f.key.endsWith('_HZ') ? ' Hz' : ''}`}</option>
                  ))}
                  {!(f.kind === 'pin' ? pins : f.options ?? []).includes(v) && <option value={v}>{v} (hand-edited)</option>}
                </select>
              )}
            </div>
            <div className="cfg-help muted">{why ? <span className="fault">GPIO {v}: {why}</span> : f.help}</div>
          </div>
        )
      })}
      <div className="cfg-readonly mono muted">
        Read-only here: {Object.entries(cfg.readonly).map(([k, n]) => `${k} ${n}`).join(' · ')}. Wi-Fi, tokens and the OTA password live in secrets.h, which this app never opens.
      </div>
      {check.problems.length > 0 && <div className="fault cfg-problems">{check.problems.join('; ')}</div>}
      <div className="cfg-actions">
        <button className="btn primary sm" disabled={!dirty || check.problems.length > 0 || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : `Save to config.h${dirty ? ` (${Object.keys(check.changes).length})` : ''}`}
        </button>
        <button className="btn ghost sm" disabled={!dirty} onClick={() => setDraft({})}>Undo</button>
        <span className="muted mono">{cfg.path}</span>
      </div>
    </div>
  )
}

/** firmware.ino, read-only, with line numbers. */
function SourceView() {
  const [src, setSrc] = useState<{ text: string; lines: number; version: string | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api<{ text: string; lines: number; version: string | null }>('/api/board/source?name=firmware.ino')
      .then(setSrc).catch((e) => setErr((e as Error).message))
  }, [])
  if (err) return <div className="fault">{err}</div>
  if (!src) return <div className="skeleton" style={{ height: 240 }} />
  const lines = src.text.split('\n')
  return (
    <div className="src">
      <div className="mono muted src-head">aankhen/firmware/firmware.ino · {src.lines} lines · {src.version} · read-only</div>
      <pre className="src-code" tabIndex={0}>
        {lines.map((l, i) => <div key={i} className="src-line"><span className="src-n">{i + 1}</span>{l || ' '}</div>)}
      </pre>
    </div>
  )
}

/** The plan, spelled out; the password field for Wi-Fi; Cancel or Flash now. */
function ConfirmFlash({ plan, onClose, onStarted }: { plan: FlashPlan; onClose: () => void; onStarted: () => void }) {
  const toast = useStore((s) => s.toast)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const now = useNow(1000)
  const go = async () => {
    setBusy(true)
    try {
      await post('/api/board/flash', { plan_id: plan.id, confirm: true, ...(plan.needs_password ? { password } : {}) })
      setPassword('')
      onStarted()
    } catch (e) {
      toast((e as Error).message, 'fault')
      setBusy(false)
    }
  }
  const where = plan.target === 'usb' ? `over USB on ${plan.port}` : `over Wi-Fi to ${plan.ip}`
  return (
    <div className="flash-scrim" role="dialog" aria-modal="true" aria-label="Confirm flashing">
      <div className="card flash-dialog">
        <div className="card-head">
          <span className="card-title"><Zap size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />Flash {plan.version} {where}?</span>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Cancel"><X size={14} /></button>
        </div>
        <ol className="flash-steps">{plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {plan.warnings.map((w, i) => <div key={i} className="flash-warn sim"><AlertTriangle size={14} />{w}</div>)}
        {plan.needs_password && (
          <label className="flash-pass">
            <span className="eyebrow">OTA password (OTA_PASS_VALUE in secrets.h)</span>
            <input className="field mono" type="password" autoComplete="off" value={password} autoFocus
              onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && password) void go() }} />
          </label>
        )}
        <div className="flash-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={busy || (plan.needs_password && password.length < 12)} onClick={() => void go()}>
            <Zap size={14} />{busy ? 'Starting…' : 'Flash now'}
          </button>
        </div>
        <div className="mono muted flash-foot">This confirmation expires in {Math.max(0, Math.round(plan.expires_at - now / 1000))} s.</div>
      </div>
    </div>
  )
}
