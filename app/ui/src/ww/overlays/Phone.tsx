// O2 Phone (plan 4.13): the doorway the owner asked for on 9 Nov, so pairing a phone no longer means leaving
// Well Wisher for Connect. It REUSES what already pairs a phone, and adds nothing to it:
//   lib/phone.ts          the same calls PhoneCard makes (/api/remote, /api/remote/pair)
//   qr_svg                the server draws the QR; the page shows it as an <img> (svgSrc), no QR library
//   /phone/ww             the phone's Well Wisher page, served by routes_phone_ww.py on the listener
// Steps in the order they happen: turn the listener on, pair, scan. Primary: Pair a phone while the listener runs
// and no code is showing; otherwise none (the overlay is then "close only").
import { useEffect, useState } from 'react'
import { QrCode, Smartphone, X } from 'lucide-react'
import { usePoll } from '../../lib/format'
import { useStore } from '../../lib/store'
import {
  cancelPairing, lastSeen, loadPhone, phoneStatus, revokePhone, savePhone, startPairing, svgSrc, TAILSCALE_SERVE,
  type PairCode, type PhoneView,
} from '../../lib/phone'
import { Button, Fold, PrimaryButton } from '../kit'
import { registerOverlay } from '../frame/overlayRegistry'
import './overlays.css'

/** The phone's Well Wisher address for each address the listener has: the pairing code opens the same host. */
export const wwAddresses = (v: PhoneView | null): string[] => (v?.open_at ?? []).map((u) => `${u.replace(/\/phone\/?$/, '')}/phone/ww`)

export function PhoneSheet() {
  const [view, loading, reload] = usePoll(loadPhone, 8000)
  const [local, setLocal] = useState<PhoneView | null>(null)
  const v = local ?? view
  useEffect(() => setLocal(null), [view])
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState<PairCode | null>(null)
  const [left, setLeft] = useState(0)
  const [base, setBase] = useState('')
  // The firewall help REPLACES the steps while it is open (the owner's no-scroll rule: steps, QR, address, devices and a
  // two-command help together are taller than the window).
  const [help, setHelp] = useState(false)

  // The countdown ticks only while a code is showing, so a closed or idle sheet holds no timer.
  useEffect(() => {
    if (!code) return
    const end = Date.now() + code.expires_in * 1000
    const tick = () => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) setCode(null)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [code])
  // the pairing worked: the device list grew while a code was showing
  const [seen, setSeen] = useState<number | null>(null)
  useEffect(() => {
    const n = v?.devices.length ?? 0
    if (seen !== null && n > seen && code) setCode(null)
    setSeen(n)
  }, [v?.devices.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (k: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(k)
    try {
      await fn()
      if (ok) toast(ok, 'live')
    } catch (e) {
      toast((e as Error).message || 'That did not work.', 'fault')
    } finally {
      setBusy(null)
    }
  }

  const status = phoneStatus(v)
  const paired = v?.devices.length ?? 0
  const running = !!v?.enabled && !!v.running
  const bases = v?.open_at.map((u) => u.replace(/\/phone\/?$/, '')) ?? []
  const addresses = wwAddresses(v)
  const word = !v ? 'Checking' : paired > 0 ? 'Paired' : 'Not paired'

  // Until the first answer the sheet is a note only. The kit's Button remounts when it stops being
  // blocked, so a control focused while the listener state was unknown would lose focus to <body> on arrival.
  if (!v) {
    return (
      <div className="ov-body" data-overlay="phone" data-primary-none="">
        {loading
          ? <p className="ov-note">Checking the phone listener.</p>
          : (
            <>
              <p className="ov-note" role="alert">The phone listener did not answer, so nothing here can be changed. Nothing was.</p>
              <Button onClick={reload}>Retry</Button>
            </>
          )}
      </div>
    )
  }

  return (
    <div className="ov-body" data-overlay="phone" data-primary-none={running && !code ? undefined : ''}>
      <p className="ov-lead" data-phone-status="">{`Phone   status: ${word}`}<span className="ov-note">{`   Listener: ${status.text}.`}</span></p>

      <div hidden={help}>
      <ol className="ov-steps">
        <li>
          <span className="ov-step-text">Turn on the phone listener</span>
          <Button size="sm" loading={busy === 'toggle'} disabled={!v || v.forced !== null}
            disabledReason={v?.forced != null ? `Set by JARVIS_PHONE=${v.forced ? 1 : 0} when the app started.` : undefined}
            onClick={() => void act('toggle', async () => {
              const r = await savePhone({ enabled: !v!.enabled })
              setLocal(r)
              if (!r.enabled) setCode(null)
            })}>
            <Smartphone size={14} aria-hidden="true" />{v?.enabled ? 'Turn the listener off' : 'Turn the listener on'}
          </Button>
          {!v?.enabled && v && <span className="ov-note">Listener off. It serves a phone page on your home Wi-Fi only while it is on.</span>}
          {v?.enabled && v.error && <span className="ov-note" role="alert">{`Error: not listening: ${v.error}`}</span>}
        </li>
        <li>
          <span className="ov-step-text">Pair a phone</span>
          {!code
            ? (
              <>
                {bases.length > 1 && (
                  <select className="ww-input" value={base || bases[0]} onChange={(e) => setBase(e.target.value)} aria-label="Address in the code">
                    {bases.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}
                <PrimaryButton claimId="phone-pair" rank="overlay" when={running} loading={busy === 'pair'}
                  disabledReason={running ? undefined : 'Turn the listener on first.'}
                  onClick={() => void act('pair', async () => { setCode(await startPairing(base || bases[0])) })}>
                  <QrCode size={14} aria-hidden="true" />Pair a phone
                </PrimaryButton>
                <span className="ov-note">Shows a code for 5 minutes, good for one phone.</span>
              </>
            )
            : (
              <div className="ov-qr">
                <img src={svgSrc(code.qr_svg)} alt={`QR code for ${code.url}`} width={160} height={160} className="ov-qr-img" />
                <div className="ov-qr-text">
                  <span className="ov-note">{`Scan the QR with the phone's camera, or open ${code.url} and type:`}</span>
                  <span className="ov-code" aria-label="Pairing code">{code.code}</span>
                  <span className="ov-note">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left, one use`}</span>
                  <Button size="sm" onClick={() => void act('cancel', async () => { await cancelPairing(); setCode(null) })}>
                    <X size={14} aria-hidden="true" />Cancel
                  </Button>
                </div>
              </div>
            )}
        </li>
        <li>
          <span className="ov-step-text">Scan the QR with the phone</span>
          <span className="ov-note">The phone then opens its own page and stays paired until you remove it here.</span>
        </li>
      </ol>

      <div className="ov-address" data-phone-address="">
        <p className="ov-lead">Well Wisher on the phone</p>
        {addresses.length > 0
          ? addresses.map((a) => <code key={a} className="ov-mono">{a}</code>)
          : <code className="ov-mono">/phone/ww</code>}
        <p className="ov-note">Taps that work there: topic, +min, class P/A/C, counters. Not there yet: papers, formulas.</p>
      </div>

      {v && v.devices.length > 0 && (
        <div className="ov-devices">
          <p className="ov-lead">Paired phones</p>
          {v.devices.map((d) => (
            <div key={d.id} className="ov-device">
              <span><b>{d.name}</b> <span className="ov-note">{`seen ${lastSeen(d.last_seen)}`}</span></span>
              <Button size="sm" loading={busy === `rm-${d.id}`} onClick={() => void act(`rm-${d.id}`, async () => { await revokePhone(d.id); reload() }, `${d.name} removed: it can no longer reach JARVIS.`)}>
                {`Remove ${d.name}`}
              </Button>
            </div>
          ))}
        </div>
      )}

      </div>

      {v?.enabled && (
        <Fold title="Firewall, microphone and HTTPS" level={3} open={help} onToggle={setHelp}>
          <p className="ov-note">Let the phone in once, in an admin PowerShell (the app never changes the firewall). Your Wi-Fi must be a Private network:</p>
          <code className="ov-mono">{v.firewall_cmd}</code>
          <p className="ov-note">Light, fan and typing work over plain http. The microphone needs https. Easiest is Tailscale with HTTPS on:</p>
          <code className="ov-mono">{TAILSCALE_SERVE(v.port)}</code>
          <p className="ov-note">Extra addresses and a certificate file are set on Connect, in the Phone card.</p>
        </Fold>
      )}
    </div>
  )
}

registerOverlay('phone', PhoneSheet as never)
