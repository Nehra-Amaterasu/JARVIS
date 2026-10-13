/**
 * Connect 05.4: JARVIS on the phone. The laptop serves a phone page on the home
 * network (off until switched on here); a phone pairs by scanning the code shown
 * here and can be removed at any time. Every control calls app/jarvis_app/routes_phone.py.
 */
import { useEffect, useState } from 'react'
import { Check, Copy, QrCode, Smartphone, X } from 'lucide-react'
import { usePoll, useNow } from '../lib/format'
import { useStore } from '../lib/store'
import {
  cancelPairing, lastSeen, loadPhone, phoneStatus, revokePhone, savePhone, startPairing, svgSrc, TAILSCALE_SERVE,
  type PairCode, type PhoneView,
} from '../lib/phone'

function Cmd({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false)
  return (
    <span className="cx-cmd">
      <code title={cmd}>{cmd}</code>
      <button className="btn ghost sm icon" aria-label="Copy command" onClick={() => {
        void navigator.clipboard.writeText(cmd)
        setDone(true)
        window.setTimeout(() => setDone(false), 1400)
      }}>{done ? <Check size={13} /> : <Copy size={13} />}</button>
    </span>
  )
}

export function PhoneCard() {
  const [view, , reload] = usePoll(loadPhone, 8000)
  const [local, setLocal] = useState<PhoneView | null>(null)
  const v = local ?? view
  useEffect(() => setLocal(null), [view])
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState<PairCode | null>(null)
  const [codeAt, setCodeAt] = useState(0)
  const [base, setBase] = useState<string>('')
  const [cert, setCert] = useState('')
  const [key, setKey] = useState('')
  const [urls, setUrls] = useState('')
  const now = useNow(1000)
  useEffect(() => {
    if (!v) return
    setCert(v.cert)
    setKey(v.key)
    setUrls(v.urls.join(', '))
  }, [v?.cert, v?.key, v?.urls.join(',')])            // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (k: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(k)
    try {
      await fn()
      if (ok) toast(ok, 'info')
    } catch (e) {
      toast((e as Error).message || 'That did not work.', 'fault')
    } finally {
      setBusy(null)
    }
  }
  const status = phoneStatus(v)
  const left = code ? Math.max(0, code.expires_in - Math.round((now - codeAt) / 1000)) : 0
  useEffect(() => { if (code && left === 0) setCode(null) }, [code, left])
  const bases = v?.open_at.map((u) => u.replace(/\/phone$/, '')) ?? []

  return (
    <section className="card cx-card">
      <div className="card-head">
        <span className="card-title"><span className="track">P1</span>Phone</span>
        <span className={`pill ${status.tone}`}><i className="led" />{status.text}</span>
      </div>

      <div className="cx-foot" style={{ flexWrap: 'wrap' }}>
        <button className={`btn sm ${v?.enabled ? '' : 'primary'}`} disabled={!v || busy !== null || v.forced !== null}
          onClick={() => act('toggle', async () => {
            const r = await savePhone({ enabled: !v!.enabled })
            setLocal(r)
            if (!r.enabled) setCode(null)
          }, v?.enabled ? 'Phone access off.' : undefined)}>
          <Smartphone size={13} />{v?.enabled ? 'Switch phone access off' : 'Switch phone access on'}
        </button>
        <span className="muted cx-small">
          {v?.forced != null
            ? `Set by JARVIS_PHONE=${v.forced ? 1 : 0} when the app started.`
            : 'Off by default. On: the laptop also serves a phone page on your home Wi-Fi (port '
              + (v?.port ?? 8778) + '). The desktop window is unchanged.'}
        </span>
      </div>

      {v?.enabled && v.error && <div className="cx-banner"><span>Not listening: {v.error}</span></div>}

      {v?.enabled && v.running && (
        <>
          <div className="cx-small">
            <span className="muted">Open on the phone: </span>
            {v.open_at.map((u) => <code key={u} className="mono" style={{ marginRight: 10 }}>{u}</code>)}
          </div>

          {/* pairing */}
          {!code ? (
            <div className="cx-foot" style={{ flexWrap: 'wrap' }}>
              {bases.length > 1 && (
                <select className="field cx-select" value={base || bases[0]} onChange={(e) => setBase(e.target.value)} aria-label="Address in the code">
                  {bases.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
              <button className="btn sm primary" disabled={busy !== null} onClick={() => act('pair', async () => {
                const c = await startPairing(base || bases[0])
                setCode(c)
                setCodeAt(Date.now())
              })}><QrCode size={13} />Pair a phone</button>
              <span className="muted cx-small">Shows a code for 5 minutes, good for one phone.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <img src={svgSrc(code.qr_svg)} alt={`QR code for ${code.url}`} width={196} height={196}
                style={{ borderRadius: 10, imageRendering: 'pixelated' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <span className="muted cx-small">Scan with the phone's camera, or open <b className="mono">{code.url}</b> and type:</span>
                <span className="mono" style={{ fontSize: 28, letterSpacing: '0.12em' }}>{code.code}</span>
                <span className="muted cx-small">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left · one use</span>
                <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => act('cancel', async () => {
                  await cancelPairing()
                  setCode(null)
                })}><X size={13} />Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* paired phones */}
      {v && v.devices.length > 0 && (
        <div className="cx-small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="muted">Paired phones</span>
          {v.devices.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Smartphone size={14} />
              <b>{d.name}</b>
              <span className="muted">seen {lastSeen(d.last_seen, now)}</span>
              <button className="btn ghost sm" style={{ marginLeft: 'auto' }} disabled={busy !== null}
                onClick={() => act('revoke', async () => {
                  await revokePhone(d.id)
                  reload()
                }, `${d.name} removed: it can no longer reach JARVIS.`)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* what he must do himself */}
      {v?.enabled && (
        <details className="cx-small">
          <summary style={{ cursor: 'pointer' }}>Firewall, microphone and HTTPS</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <span>1. Let the phone in (once, in an <b>admin</b> PowerShell; the app never changes the firewall). Your Wi-Fi must be a <i>Private</i> network:</span>
            <Cmd cmd={v.firewall_cmd} />
            <span>2. Light, fan and typing work over plain http. The <b>microphone</b> needs https: Chrome only gives a page the mic in a secure context.
              {v.mic_ready ? ' An https address is set: open that one on the phone.' : ' Easiest: Tailscale on the laptop and the phone, HTTPS turned on in its admin console, then:'}</span>
            {!v.mic_ready && <Cmd cmd={TAILSCALE_SERVE(v.port)} />}
            <span>Then add the address it prints (https://&lt;laptop&gt;.&lt;tailnet&gt;.ts.net) here:</span>
            <div className="cx-foot">
              <input className="field" style={{ flex: 1 }} value={urls} placeholder="https://laptop.tail1234.ts.net"
                onChange={(e) => setUrls(e.target.value)} aria-label="Extra addresses" />
              <button className="btn sm" disabled={busy !== null} onClick={() => act('urls', async () => {
                setLocal(await savePhone({ urls: urls.split(/[\s,]+/).filter(Boolean) }))
              }, 'Saved.')}>Save</button>
            </div>
            <span>Or a certificate you made (tailscale cert, mkcert): the phone page is then served over https on :{v.port}.</span>
            <div className="cx-foot" style={{ flexWrap: 'wrap' }}>
              <input className="field" style={{ flex: 1, minWidth: 160 }} value={cert} placeholder="C:\path\cert.pem"
                onChange={(e) => setCert(e.target.value)} aria-label="Certificate file" />
              <input className="field" style={{ flex: 1, minWidth: 160 }} value={key} placeholder="C:\path\key.pem"
                onChange={(e) => setKey(e.target.value)} aria-label="Key file" />
              <button className="btn sm" disabled={busy !== null} onClick={() => act('cert', async () => {
                setLocal(await savePhone({ cert, key }))
              }, cert ? 'HTTPS set: the phone page restarted on https.' : 'HTTPS off.')}>Use</button>
            </div>
          </div>
        </details>
      )}
    </section>
  )
}
